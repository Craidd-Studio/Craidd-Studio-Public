#!/usr/bin/env python3
"""Actual LLDB and substituted-module backend gates, with normal-user tools.

No target receives a collector Stop signal. Debugger launch/detach owns its own
fixture session; stdin is normal shutdown. No policy or capability changes.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import select
import shutil
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / 'tests/fixtures/ldi-gate-0/tools'))
from dap import Dap


class Server:
    def __init__(self, harness, root):
        self.process = subprocess.Popen([str(harness), 'serve', str(root)], stdin=subprocess.PIPE,
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def request(self, action, **fields):
        self.process.stdin.write(json.dumps({'action': action, **fields}) + '\n')
        self.process.stdin.flush()
        if not select.select([self.process.stdout], [], [], 30)[0]:
            raise TimeoutError('backend probe reply timed out')
        line = self.process.stdout.readline()
        if not line:
            raise RuntimeError('backend probe exited: ' + self.process.stderr.read())
        return json.loads(line)

    def finished(self, identifier):
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            result = self.request('status', id=identifier)
            assert result['ok'], result
            if result['value']['state'] in ['complete', 'partial', 'failed']:
                return result['value']
            time.sleep(.025)
        raise TimeoutError('capture did not finalize')

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.write('{"action":"quit"}\n')
            self.process.stdin.flush()
            self.process.wait(timeout=15)
        self.process.stdin.close()
        self.process.stdout.close()
        self.process.stderr.close()


def tracer(pid):
    return int(next(line.split(':')[1] for line in Path('/proc/%d/status' % pid).read_text().splitlines() if line.startswith('TracerPid:')))


def live(pid):
    try:
        return Path('/proc/%d/stat' % pid).read_text().rsplit(')', 1)[1].split()[0] != 'Z'
    except FileNotFoundError:
        return False


def close_dap(dap):
    if dap.process.poll() is None:
        try:
            dap.request('disconnect', {'terminateDebuggee': False})
        except Exception:
            pass
        dap.process.stdin.close()
        try:
            dap.process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            # Only the owned adapter, never its debuggee or a process group.
            dap.process.terminate()
            dap.process.wait(timeout=5)
    dap.reader.join(timeout=2)
    dap.error_reader.join(timeout=2)
    dap.log.close()


def initialize(dap):
    return dap.request('initialize', {'clientID': 'craidd-perf-backend-gate', 'adapterID': 'lldb-dap',
                                     'pathFormat': 'path', 'linesStartAt1': True, 'columnsStartAt1': True,
                                     'supportsRunInTerminalRequest': False})


def wait_ready(path):
    end = time.monotonic() + 10
    while time.monotonic() < end:
        text = path.read_text() if path.exists() else ''
        if 'READY' in text:
            return int(next(line.split()[1] for line in text.splitlines() if line.startswith('TARGET ')))
        time.sleep(.025)
    raise TimeoutError('fixture did not reach READY')


def fingerprint(path):
    path = Path(path)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--harness', type=Path, required=True)
    p.add_argument('--build', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    result = {'machine': platform.node(), 'kernel': platform.release(), 'uid': os.geteuid(),
              'perfVersion': subprocess.check_output(['perf', '--version'], text=True).strip(),
              'lldbVersion': subprocess.check_output(['lldb-dap', '--version'], text=True),
              'harness': fingerprint(args.harness), 'sourceFiles': [fingerprint(HERE / 'src/main.rs'), fingerprint(HERE / 'qualify_remaining.py'), fingerprint(HERE.parents[1] / 'src-tauri/src/perf_capture.rs'), fingerprint(HERE.parents[1] / 'src-tauri/src/perf_model.rs')], 'gates': {}}
    options = {'frequency': 99, 'durationSeconds': 10, 'unwind': {'kind': 'fp'}}
    fixture, library = args.build / 'fixture', args.build / 'libgenerated-no-fp.so'
    result['fixture'] = [fingerprint(fixture), fingerprint(library)]
    result['cpu'] = next(line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name'))
    result['policyBefore'] = {k: Path('/proc/sys/'+v).read_text().strip() for k,v in [('perfEventParanoid','kernel/perf_event_paranoid'),('kptrRestrict','kernel/kptr_restrict'),('ptraceScope','kernel/yama/ptrace_scope')]}
    result['credentials'] = [line for line in Path('/proc/self/status').read_text().splitlines() if line.startswith(('CapEff:', 'NoNewPrivs:', 'Seccomp:'))]

    # The real debugger launches its own child, satisfying existing Yama policy.
    folder = args.output / 'lldb-first'
    folder.mkdir()
    fifo = folder / 'stdin.fifo'
    os.mkfifo(fifo)
    fd = os.open(fifo, os.O_RDWR | os.O_NONBLOCK)
    dap = Dap(['lldb-dap'], folder / 'dap.jsonl')
    backend = Server(args.harness, folder / 'backend')
    pid = None
    try:
        initialize(dap)
        request = dap.send('launch', {'program': str(fixture), 'cwd': str(args.build), 'args': [str(library), '2'],
                                     'stdio': [str(fifo), str(folder / 'target.log'), str(folder / 'target.stderr')],
                                     'disableASLR': False, 'stopOnEntry': False,
                                     'initCommands': ['settings set symbols.enable-external-lookup false']})
        dap.event('initialized')
        configured = dap.send('configurationDone')
        dap.response(request)
        dap.response(configured)
        pid = wait_ready(folder / 'target.log')
        observed = tracer(pid)
        refusal = backend.request('start', pid=pid, options=options)
        assert observed > 0 and not refusal['ok'] and 'traced' in refusal['error'], (observed, refusal)
        dap.request('disconnect', {'terminateDebuggee': False})
        survived = live(pid)
        result['gates']['lldbThenPerf'] = {'gate': 'PASS', 'pid': pid, 'tracerPid': observed, 'refusal': refusal,
                                         'targetSurvivedRefusalAndDetach': survived}
        assert survived
    except Exception as e:
        result['gates']['lldbThenPerf'] = {'gate': 'BLOCKED', 'reason': str(e), 'stderr': dap.stderr}
    finally:
        if pid is not None and live(pid):
            try:
                dap.request('disconnect', {'terminateDebuggee': False})
            except Exception:
                pass
        os.write(fd, b'stop\n')
        close_dap(dap)
        os.close(fd)
        backend.close()

    folder = args.output / 'perf-first'
    folder.mkdir()
    with (folder / 'target.log').open('w') as log:
        target = subprocess.Popen([str(fixture), str(library), '2'], stdin=subprocess.PIPE, stdout=log, text=True)
        backend = Server(args.harness, folder / 'backend')
        dap = Dap(['lldb-dap'], folder / 'dap.jsonl')
        try:
            wait_ready(folder / 'target.log')
            started = backend.request('start', pid=target.pid, options=options)
            assert started['ok'], started
            identifier = started['value']['id']
            initialize(dap)
            refused = backend.request('refuseDebugger', pid=target.pid)
            assert not refused['ok'] and 'Stop the active perf' in refused['error'], refused
            # Correct refusal prevents sending an attach request to the adapter.
            no_tracer = tracer(target.pid) == 0
            backend.request('stop', id=identifier)
            capture = backend.finished(identifier)
            result['gates']['perfThenLldb'] = {'gate': 'PASS', 'scope': 'Exact shared guard used by Craidd attach; real adapter initialized; attach request prevented',
                                             'guardRefusal': refused, 'tracerStayedZero': no_tracer, 'capture': capture,
                                             'targetSurvivedStop': target.poll() is None, 'dapAttachRequestsSent': 0}
            assert no_tracer and target.poll() is None
        finally:
            close_dap(dap)
            backend.close()
            target.stdin.write('stop\n')
            target.stdin.flush()
            target.wait(timeout=10)
            target.stdin.close()

    # Own private module/debug files only. The original qualification build is unchanged.
    folder = args.output / 'mismatch'
    private = folder / 'build'
    private.mkdir(parents=True)
    executable, module = private / 'fixture', private / library.name
    shutil.copy2(fixture, executable)
    shutil.copy2(library, module)
    debug = private / (library.name + '.debug')
    subprocess.run(['objcopy', '--only-keep-debug', str(module), str(debug)], check=True)
    subprocess.run(['strip', '--strip-debug', str(module)], check=True)
    subprocess.run(['objcopy', '--add-gnu-debuglink=' + str(debug), str(module)], check=True)
    backend = Server(args.harness, folder / 'backend')
    with (folder / 'target.log').open('w') as log:
        target = subprocess.Popen([str(executable), str(module), '2'], stdin=subprocess.PIPE, stdout=log, text=True)
        wait_ready(folder / 'target.log')
        started = backend.request('start', pid=target.pid, options={'frequency': 99, 'durationSeconds': 1, 'unwind': {'kind': 'dwarf', 'stackBytes': 8192}})
        assert started['ok'], started
        identifier = started['value']['id']
        matched = backend.finished(identifier)
        query = {'direction': 'bottomUp', 'path': [], 'limit': 200, 'tid': None, 'threadName': None, 'module': str(module), 'startNs': None, 'endNs': None}
        matched_tree = backend.request('tree', id=identifier, query=query)
        target.stdin.write('stop\n')
        target.stdin.flush()
        target.wait(timeout=10)
        target.stdin.close()
    backend.close()
    original_debug = private / 'original.debug'
    shutil.copy2(debug, original_debug)
    subprocess.run(['objcopy', '--only-keep-debug', str(executable), str(debug)], check=True)
    backend = Server(args.harness, folder / 'backend')
    backend.request('reopen', id=identifier)
    wrong_debug = backend.finished(identifier)
    wrong_debug_tree = backend.request('tree', id=identifier, query=query)
    backend.close()
    shutil.copy2(original_debug, debug)
    shutil.copy2('/usr/lib/libc.so.6', module)
    backend = Server(args.harness, folder / 'backend')
    backend.request('reopen', id=identifier)
    wrong_module = backend.finished(identifier)
    query = {'direction': 'bottomUp', 'path': [], 'limit': 200, 'tid': None, 'threadName': None, 'module': str(module), 'startNs': None, 'endNs': None}
    tree = backend.request('tree', id=identifier, query=query)
    backend.close()
    mismatch = [b for b in wrong_module['buildIds'] if b['module'] == str(module)]
    rows = tree.get('value', {}).get('children', [])
    passed = bool(mismatch) and mismatch[0]['state'] == 'mismatch' and bool(rows) and all(not n['frame']['resolved'] for n in rows)
    result['gates']['substitutedModule'] = {'gate': 'PASS' if passed else 'FAIL', 'matchedCapture': matched, 'reopened': wrong_module, 'tree': tree}
    debug_modules = [b for b in wrong_debug['buildIds'] if b['module'] == str(module)]
    debug_rows = wrong_debug_tree.get('value', {}).get('children', [])
    matched_rows = matched_tree.get('value', {}).get('children', [])
    debug_passed = bool(matched_rows) and any(n['frame']['resolved'] for n in matched_rows) and bool(debug_modules) and any(d['state'] == 'mismatch' for d in debug_modules[0].get('debugFiles', [])) and bool(debug_rows) and all(not n['frame']['resolved'] and n['frame']['source'] is None for n in debug_rows) and wrong_debug['state'] == 'partial'
    result['gates']['substitutedDebug'] = {'gate': 'PASS' if debug_passed else 'FAIL', 'matchedCapture': matched, 'matchedTree': matched_tree, 'reopened': wrong_debug, 'tree': wrong_debug_tree, 'scope': 'Conventional local debug candidates checked by build ID; mismatch conservatively withholds module names and source; no debuginfod or arbitrary search'}
    result['gates']['livePidReuse'] = {'gate': 'BLOCKED', 'reason': 'No ordinary-user API selects a reused host PID. Kernel policy/capabilities/next-PID manipulation and namespace privilege changes are excluded. Stale-ID or exit-race tests are not live reuse.'}
    result['policyAfter'] = {k: Path('/proc/sys/'+v).read_text().strip() for k,v in [('perfEventParanoid','kernel/perf_event_paranoid'),('kptrRestrict','kernel/kptr_restrict'),('ptraceScope','kernel/yama/ptrace_scope')]}
    (args.output / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(args.output / 'results.json')


if __name__ == '__main__':
    main()
