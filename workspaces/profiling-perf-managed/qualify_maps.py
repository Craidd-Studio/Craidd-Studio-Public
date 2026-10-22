#!/usr/bin/env python3
"""Probe perf's own .NET/Mono map resolution before changing product decoding.

All files from the runtime are read-only inputs. Fixtures receive stdin stop;
the Rust harness owns and stops perf. Use a fresh output directory.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import time

LEAF = re.compile(r'^\s*(.*?)\s+(\d+)/(\d+)\s+(\d+\.\d+):\s+(\d+)\s+(\S+):\s+([0-9a-fA-F]+)\s+(.*)$')


def symbol_module(text):
    text = text.rstrip()
    if not text.endswith(')'):
        return None
    depth = 0
    for index in range(len(text)-1, -1, -1):
        if text[index] == ')':
            depth += 1
        elif text[index] == '(':
            depth -= 1
            if depth == 0:
                return text[:index].rstrip(), text[index+1:-1]
    return None


def fingerprint(path):
    if not path.is_file():
        return None
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--build', type=Path, required=True)
    p.add_argument('--harness', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--frequency', type=int, default=99)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    result = {'machine': platform.node(), 'kernel': platform.release(), 'uid': os.geteuid(),
              'perfVersion': subprocess.check_output(['perf', '--version'], text=True).strip(),
              'harness': fingerprint(args.harness), 'sourceFiles': [fingerprint(Path(__file__)), fingerprint(Path(__file__).parent / 'Program.cs'), fingerprint(Path(__file__).parents[2] / 'src-tauri/src/perf_capture.rs'), fingerprint(Path(__file__).parents[2] / 'src-tauri/src/perf_model.rs')], 'fixture': [fingerprint(args.build / 'dotnet/ManagedPerfFixture.dll'), fingerprint(args.build / 'ManagedPerfFixture.exe')], 'runtimeVersions': {'dotnetSdk': subprocess.check_output(['dotnet','--version'], text=True).strip(), 'dotnetRuntimes': subprocess.check_output(['dotnet','--list-runtimes'], text=True), 'mono': subprocess.check_output(['mono','--version'], text=True)}, 'cases': []}
    for runtime in ['dotnet', 'mono']:
        for enabled in [False, True]:
            case = {'runtime': runtime, 'mapEnabled': enabled}
            result['cases'].append(case)
            if not shutil.which(runtime):
                case.update(gate='BLOCKED', reason='runtime not installed')
                continue
            folder = args.output / (runtime + ('-map' if enabled else '-no-map'))
            folder.mkdir()
            env = {**os.environ, 'DOTNET_CLI_TELEMETRY_OPTOUT': '1', 'DOTNET_CLI_HOME': '/tmp/craidd-perf-managed-cli',
                   'DOTNET_PerfMapEnabled': '1' if enabled else '0', 'DEBUGINFOD_URLS': '', 'LC_ALL': 'C'}
            env.pop('COMPlus_PerfMapEnabled', None)
            env.pop('MONO_ENV_OPTIONS', None)
            command = ['dotnet', str(args.build / 'dotnet/ManagedPerfFixture.dll')] if runtime == 'dotnet' else ['mono', *(['--jitmap'] if enabled else []), str(args.build / 'ManagedPerfFixture.exe')]
            case['command'], case['environmentOverrides'] = command, {k: env[k] for k in ['DOTNET_PerfMapEnabled', 'DEBUGINFOD_URLS']}
            with (folder / 'target.log').open('w') as log:
                target = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, text=True, env=env)
                try:
                    deadline = time.monotonic() + 10
                    while time.monotonic() < deadline:
                        if 'READY' in (folder / 'target.log').read_text():
                            break
                        if target.poll() is not None:
                            raise RuntimeError('fixture exited before READY')
                        time.sleep(.025)
                    else:
                        raise RuntimeError('fixture did not become ready')
                    time.sleep(2)
                    map_path = Path('/tmp/perf-%d.map' % target.pid)
                    case['mapBeforeCapture'] = fingerprint(map_path)
                    case['pid'] = target.pid
                    run = subprocess.run([str(args.harness), 'capture', str(target.pid), str(folder / 'capture'),
                                          str(args.frequency), '2', 'fp'], capture_output=True, text=True, timeout=90)
                    (folder / 'harness.stderr').write_text(run.stderr)
                    run.check_returncode()
                    product = json.loads(run.stdout)
                    (folder / 'product.json').write_text(json.dumps(product, indent=2) + '\n')
                    case['product'] = product
                    raw = next((folder / 'capture/cache').glob('*/*/perf.data'))
                    decode = subprocess.run(['perf', 'script', '--ns', '-G', '-F', 'comm,pid,tid,time,period,event,ip,sym,dso', '-i', str(raw)],
                                            capture_output=True, text=True, env=env, timeout=30)
                    (folder / 'leaves.stdout').write_text(decode.stdout)
                    (folder / 'leaves.stderr').write_text(decode.stderr)
                    samples, unknown = [], []
                    for line in decode.stdout.splitlines():
                        if not line.strip() or line.startswith('#'):
                            continue
                        m = LEAF.match(line)
                        if m:
                            parts = symbol_module(m[8])
                            if parts:
                                samples.append({'tid': int(m[3]), 'period': int(m[5]), 'symbol': parts[0], 'module': parts[1], 'ip': m[7]})
                            else:
                                unknown.append(line)
                        else:
                            unknown.append(line)
                    total = sum(s['period'] for s in samples)
                    method = sum(s['period'] for s in samples if 'ManagedPerfFixture' in s['symbol'])
                    map_weight = sum(s['period'] for s in samples if s['module'] == str(map_path) and s['symbol'] != '[unknown]')
                    tree = product.get('bottomUp') or {}
                    product_method = sum(n['selfWeight'] for n in tree.get('children', []) if 'ManagedPerfFixture' in n['frame']['symbol'])
                    case.update(captureDecodeGate='PASS' if decode.returncode == 0 and samples and not unknown else 'PARTIAL',
                                methodNamesGate=('PASS' if method > 0 and product_method == method else 'FAIL') if enabled else 'NOT TESTED',
                                raw=fingerprint(raw), decodedSamples=len(samples), unknownLines=unknown[:10],
                                totalSampledWeight=total, perfFixtureMethodWeight=method,
                                perfFixtureMethodSharePct=100*method/total if total else None,
                                perfMapMethodWeight=map_weight, perfMapMethodSharePct=100*map_weight/total if total else None,
                                productFixtureMethodWeight=product_method,
                                productFixtureMethodSharePct=100*product_method/total if total else None,
                                productOmittedTreeChildren=tree.get('omittedChildren'),
                                perfMethodExamples=[s for s in samples if 'ManagedPerfFixture' in s['symbol']][:8],
                                moduleExamples=sorted({s['module'] for s in samples}),
                                mapAfterDecode=fingerprint(map_path), targetSurvived=target.poll() is None)
                    if map_path.is_file():
                        # Immutable evidence copy only; never edit/rename the runtime's map.
                        shutil.copyfile(map_path, folder / 'runtime-map.copy')
                        entries = []
                        for line in map_path.read_text().splitlines():
                            fields = line.split(' ',2)
                            if len(fields) == 3:
                                try: entries.append((int(fields[0],16),int(fields[1],16),fields[2]))
                                except ValueError: pass
                        case['mapContainsSampledFixtureIpExamples'] = [{'ip': sample['ip'], 'method': name} for sample in samples[:8] for start,size,name in entries if start <= int(sample['ip'],16) < start+size and 'ManagedPerfFixture' in name]
                except Exception as e:
                    case.update(gate='FAIL', reason=str(e))
                finally:
                    if target.poll() is None:
                        target.stdin.write('stop\n')
                        target.stdin.flush()
                    target.wait(timeout=10)
                    target.stdin.close()
            case['normalFixtureExit'] = target.returncode
            (args.output / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(args.output / 'results.json')


if __name__ == '__main__':
    main()
