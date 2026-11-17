#!/usr/bin/env python3
"""Native no-FP module and many-busy-thread perf qualification, without UI.

Build once, then run serial bounded trials. Only the owned perf child receives
signals; normal target shutdown uses stdin. No policy/capability changes.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import resource
import shutil
import signal
import struct
import subprocess
import time

from analyse import analyse
from experiment import sysctls
from generate_native_workload import generate
from qualify import incarnation, run


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def fresh(path):
    if path.exists() and any(path.iterdir()):
        raise RuntimeError("output directory must be empty")
    path.mkdir(parents=True, exist_ok=True)


def build(output):
    fresh(output)
    source = Path(__file__).with_name("many_thread_fixture.cpp")
    generated = output / "generated_workload.cpp"
    generated.write_text(generate())
    commands = {}
    commands["library"] = run(["g++", "-std=c++17", "-O2", "-g", "-fPIC", "-shared", "-fomit-frame-pointer",
                                "-fno-optimize-sibling-calls", "-Wl,--build-id", str(generated), "-o", str(output / "libgenerated-no-fp.so")], output, "build-library")
    commands["main"] = run(["g++", "-std=c++17", "-O2", "-g", "-pthread", "-fno-omit-frame-pointer", "-mno-omit-leaf-frame-pointer",
                             "-Wl,--build-id", str(source), "-ldl", "-o", str(output / "fixture")], output, "build-main")
    offsets = output / "offsets.cpp"
    offsets.write_text('#include <linux/perf_event.h>\n#include <cstddef>\n#include <cstdio>\nint main(){printf("{\\"dataHead\\":%zu,\\"dataTail\\":%zu,\\"dataOffset\\":%zu,\\"dataSize\\":%zu}\\n",offsetof(perf_event_mmap_page,data_head),offsetof(perf_event_mmap_page,data_tail),offsetof(perf_event_mmap_page,data_offset),offsetof(perf_event_mmap_page,data_size));}\n')
    # Use local headers to discover metadata offsets; do not assume an ABI offset.
    commands["offset-build"] = run(["g++", str(offsets), "-o", str(output / "offsets")], output, "build-offsets")
    if any(cmd["exitCode"] != 0 for cmd in commands.values()):
        raise RuntimeError("native build failed; inspect build logs")
    metadata = json.loads(subprocess.check_output([str(output / "offsets")], text=True))
    for name, binary in [("main", output / "fixture"), ("library", output / "libgenerated-no-fp.so")]:
        for kind, command in [("symbols", ["nm", "-C", str(binary)]), ("notes", ["readelf", "-n", str(binary)]),
                              ("sections", ["readelf", "-S", str(binary)])]:
            commands[name + "-" + kind] = run(command, output, name + "-" + kind)
    commands["library-asm"] = run(["objdump", "-d", "--disassemble=generated_middle_000", str(output / "libgenerated-no-fp.so")], output, "library-asm")
    commands["main-asm"] = run(["objdump", "-d", "--disassemble=native_worker_parent", str(output / "fixture")], output, "main-asm")
    symbols = (output / "library-symbols.stdout").read_text()
    generated_count = len(re.findall(r" [Tt] generated_(?:leaf|inner|middle|outer)_\d{3}$", symbols, re.M))
    evidence = {"commands": commands, "metadataOffsets": metadata, "generatedFunctions": generated_count,
                "mainFramePointer": bool(re.search(r"mov\s+%rsp,%rbp", (output / "main-asm.stdout").read_text())),
                "libraryMiddleFramePointer": bool(re.search(r"mov\s+%rsp,%rbp", (output / "library-asm.stdout").read_text())),
                "hashes": {p.name: digest(p) for p in [source, generated, output / "fixture", output / "libgenerated-no-fp.so"]},
                "buildIds": {name: re.search(r"Build ID:\s+(\w+)", (output / (name + "-notes.stdout")).read_text()).group(1) for name in ["main", "library"]}}
    assert generated_count == 256 and evidence["mainFramePointer"] and not evidence["libraryMiddleFramePointer"]
    (output / "build.json").write_text(json.dumps(evidence, indent=2) + "\n")
    print(output)


def thread_cpu(pid, tids):
    result = {}
    for tid in tids:
        tail = Path(f"/proc/{pid}/task/{tid}/stat").read_text().rsplit(")", 1)[1].split()
        result[tid] = {"userTicks": int(tail[11]), "systemTicks": int(tail[12])}
    return {"monotonicNs": time.monotonic_ns(), "clockTicksPerSecond": os.sysconf("SC_CLK_TCK"), "threads": result}


def proc_resources(pid, offsets):
    result = {"monotonicNs": time.monotonic_ns()}
    try:
        result["status"] = [line for line in Path(f"/proc/{pid}/status").read_text().splitlines()
                            if line.startswith(("VmRSS:", "VmHWM:", "VmSize:", "Threads:", "CapEff:"))]
        maps = Path(f"/proc/{pid}/maps").read_text().splitlines()
        perf_maps = [line for line in maps if "perf_event" in line]
        result["perfMaps"] = perf_maps
        result["perfMapCount"] = len(perf_maps)
        result["perfMappedBytes"] = sum(int(line.split()[0].split("-")[1], 16) - int(line.split()[0].split("-")[0], 16) for line in perf_maps)
        result["fdCount"] = len(list(Path(f"/proc/{pid}/fd").iterdir()))
        headers = []
        try:
            fd = os.open(f"/proc/{pid}/mem", os.O_RDONLY)
            try:
                for line in perf_maps:
                    address = int(line.split()[0].split("-")[0], 16)
                    values = {name: struct.unpack("Q", os.pread(fd, 8, address + offset))[0] for name, offset in offsets.items()}
                    values["map"] = line
                    # overwrite writes backwards; preserve the raw unsigned head.
                    values["backwardHeadDistanceBytes"] = (-values["dataHead"]) % (1 << 64)
                    values["wrappedIfBackward"] = values["dataSize"] > 0 and values["backwardHeadDistanceBytes"] > values["dataSize"]
                    headers.append(values)
            finally:
                os.close(fd)
            result["ringHeaders"] = headers
        except (OSError, ValueError, struct.error) as error:
            result["ringHeadersUnavailable"] = str(error)
    except OSError as error:
        result["unavailable"] = str(error)
    return result


def capture(args):
    fresh(args.output)
    build_dir = args.build
    build_evidence = json.loads((build_dir / "build.json").read_text())
    perf = shutil.which("perf")
    if not perf:
        raise RuntimeError("perf missing")
    source = Path(__file__)
    result = {"timestampUtc": datetime.now(timezone.utc).isoformat(), "settings": vars(args) | {"build": str(build_dir), "output": str(args.output)},
              "machine": {"uname": list(platform.uname()), "logicalCpuCount": os.cpu_count(), "allowedCpus": sorted(os.sched_getaffinity(0)),
                          "cpuModel": next((line.split(":", 1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), 'unknown'),
                          "cpuMax": Path('/sys/fs/cgroup/cpu.max').read_text().strip() if Path('/sys/fs/cgroup/cpu.max').exists() else None},
              "credentials": [line for line in Path('/proc/self/status').read_text().splitlines() if line.startswith(('Uid:', 'CapEff:', 'NoNewPrivs:', 'Seccomp:'))],
              "perfVersion": subprocess.check_output([perf, '--version'], text=True).strip(), "sysctlsBefore": sysctls(),
              "buildEvidence": build_evidence, "runnerSha256": digest(source), "signals": [], "commands": {}}
    target_log = open(args.output / "target.log", "w+")
    target = subprocess.Popen([str(build_dir / "fixture"), str(build_dir / "libgenerated-no-fp.so"), str(args.workers)], stdin=subprocess.PIPE,
                              stdout=target_log, stderr=subprocess.STDOUT, text=True)
    collector = None
    code = 0
    try:
        birth = incarnation(target.pid)
        result.update(targetPid=target.pid, targetBirth=birth)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            rows = (args.output / "target.log").read_text().splitlines()
            workers = [row.split()[2] for row in rows if row.startswith("THREAD busy-worker ")]
            if len(workers) == args.workers and 'READY' in rows:
                break
            time.sleep(.025)
        else:
            raise RuntimeError("workers not ready")
        result["selectedTids"] = workers
        result["targetCpuBefore"] = thread_cpu(target.pid, workers)
        data = args.output / "capture.data"
        command = [perf, "record", "--no-buildid-cache", "--clockid", "mono", "--timestamp", "--per-thread", "--no-inherit", "--user-callchains",
                   "-e", "cpu-clock:u", "-F", str(args.frequency), "--call-graph", 'dwarf,8192' if args.unwinder == 'dwarf' else 'fp',
                   "-m", str(args.pages), "-t", ','.join(workers), "-o", str(data)]
        if args.kind == 'retention':
            command += ['--overwrite', '--switch-output=signal']
        result["commands"]["record"] = command
        before_usage = resource.getrusage(resource.RUSAGE_CHILDREN)
        with open(args.output / "record.stdout", 'w') as stdout, open(args.output / "record.stderr", 'w') as stderr:
            collector = subprocess.Popen(command, stdout=stdout, stderr=stderr)
            result['collectorPid'] = collector.pid
            result['collectorStartMonotonicNs'] = time.monotonic_ns()
            try:
                collector.wait(timeout=.25)
                raise RuntimeError('perf exited before first resource observation')
            except subprocess.TimeoutExpired:
                result['collectorResourcesEarly'] = proc_resources(collector.pid, build_evidence['metadataOffsets'])
            remaining = max(.01, args.seconds - (time.monotonic_ns() - result['collectorStartMonotonicNs']) / 1e9)
            try:
                collector.wait(timeout=remaining)
                raise RuntimeError('perf exited before capture deadline')
            except subprocess.TimeoutExpired:
                result['targetCpuBeforeTrigger'] = thread_cpu(target.pid, workers)
                result['collectorResourcesBeforeTrigger'] = proc_resources(collector.pid, build_evidence['metadataOffsets'])
                if args.kind == 'retention':
                    result['triggerMonotonicNs'] = time.monotonic_ns()
                    collector.send_signal(signal.SIGUSR2)
                    result['signals'].append({'signal':'SIGUSR2','pid':collector.pid,'monotonicNs':result['triggerMonotonicNs']})
                    time.sleep(.3)
                    candidates = [p for p in args.output.glob('capture.data.*') if p.stat().st_size > 0]
                    if not candidates:
                        raise RuntimeError('no snapshot output after SIGUSR2')
                    result['snapshotCandidatesBeforeStop'] = [str(p) for p in candidates]
                collector.send_signal(signal.SIGINT)
                result['signals'].append({'signal':'SIGINT','pid':collector.pid,'monotonicNs':time.monotonic_ns()})
                collector.wait(timeout=15)
        after_usage = resource.getrusage(resource.RUSAGE_CHILDREN)
        result['collectorAccountedCpuSeconds'] = {'user':after_usage.ru_utime-before_usage.ru_utime,'system':after_usage.ru_stime-before_usage.ru_stime,
                                                'note':'waited child CPU usage during record; not workload slowdown or UI overhead'}
        result['collectorExitCode'] = collector.returncode
        result['expectedCollectorStopExit'] = collector.returncode in [0,-signal.SIGINT]
        result['targetAliveAfterStop'] = target.poll() is None and incarnation(target.pid) == birth
        result['targetCpuAfterStop'] = thread_cpu(target.pid, workers)
        if not result['expectedCollectorStopExit']:
            raise RuntimeError('unexpected collector exit; inspect stderr')
        selected = max((Path(p) for p in result['snapshotCandidatesBeforeStop']),key=lambda p:p.stat().st_size) if args.kind == 'retention' else data
        result['rawData'] = {'path':str(selected),'bytes':selected.stat().st_size,'sha256':digest(selected)}
        for name, command in [
            ('leaves',[perf,'script','--ns','-G','-F','comm,pid,tid,time,period,event,ip,sym,dso','-i',str(selected)]),
            ('stacks',[perf,'script','--ns','--show-lost-events','-i',str(selected)]),
            ('raw-records',[perf,'script','-D','-i',str(selected)]),
            ('build-ids',[perf,'buildid-list','-i',str(selected)]),
        ]:
            result['commands'][name] = run(command,args.output,name)
            if result['commands'][name]['exitCode']:
                raise RuntimeError(name+' decode failed')
        result['analysis'] = analyse(args.output)
        # Snapshot trigger metadata is not on disk yet, so add it explicitly.
        if args.kind == 'retention':
            trigger = result['triggerMonotonicNs']/1e9
            for tid,row in result['analysis']['threads'].items():
                row['oldestAgeAtTriggerSeconds'] = trigger-row['firstTime']
                row['newestAgeAtTriggerSeconds'] = trigger-row['lastTime']
                row['firstSampleDelayAfterCollectorStartSeconds'] = row['firstTime']-result['collectorStartMonotonicNs']/1e9
            result['analysis']['nominalDataBytesPerRing'] = args.pages*os.sysconf('SC_PAGESIZE')
        stacks = (args.output/'stacks.stdout').read_text()
        blocks = [block for block in stacks.split('\n\n') if block.strip()]
        result['chainCoverage'] = {name:sum(name in block for block in blocks) for name in ['generated_leaf_','generated_inner_','generated_middle_','generated_outer_','generated_workload_entry','native_worker_parent']}
        result['chainExamples'] = blocks[:2]
        result['recordStderr'] = (args.output/'record.stderr').read_text()
        result['capturedBuildIds'] = (args.output/'build-ids.stdout').read_text()
    except (OSError,RuntimeError,subprocess.SubprocessError) as error:
        result['error'] = str(error)
        code = 2
    finally:
        if collector and collector.poll() is None:
            collector.send_signal(signal.SIGINT)
            try: collector.wait(timeout=10)
            except subprocess.TimeoutExpired:
                collector.kill(); collector.wait()
        if target.poll() is None:
            target.stdin.write('stop\n'); target.stdin.flush(); target.wait(timeout=10)
        target.stdin.close(); target_log.close()
        result['targetNormalExitCode'] = target.returncode
        result['sysctlsAfter'] = sysctls()
        result['sysctlsUnchanged'] = result['sysctlsBefore'] == result['sysctlsAfter']
        (args.output/'results.json').write_text(json.dumps(result,indent=2)+'\n')
        print(args.output)
        print(json.dumps({k:result.get(k) for k in ['error','rawData','targetAliveAfterStop','sysctlsUnchanged','chainCoverage']},indent=2))
    return code


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action',required=True)
    b = sub.add_parser('build'); b.add_argument('--output',type=Path,required=True)
    c = sub.add_parser('capture')
    c.add_argument('kind',choices=['timed','retention']); c.add_argument('--build',type=Path,required=True); c.add_argument('--output',type=Path,required=True)
    c.add_argument('--workers',type=int,choices=[1,2,16,32],default=16); c.add_argument('--frequency',type=int,choices=[99,999],default=99)
    c.add_argument('--pages',type=int,choices=[1,4,16,128],default=16); c.add_argument('--seconds',type=float,default=8)
    c.add_argument('--unwinder',choices=['fp','dwarf'],default='fp')
    args = parser.parse_args()
    if args.action=='build': build(args.output)
    else:
        if not 2<=args.seconds<=10: parser.error('seconds must be 2..10')
        raise SystemExit(capture(args))
