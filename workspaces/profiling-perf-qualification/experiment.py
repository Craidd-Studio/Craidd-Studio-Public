#!/usr/bin/env python3
"""Bounded GR-002 experiments: byte-ring retention or positive LOST evidence.

Signals address only our perf child. The fixture stops later through stdin.
No elevation, installation, system-policy changes or debugger are involved.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import time

from qualify import incarnation, run


def sysctls():
    return {name: Path("/proc/sys/" + name.replace(".", "/")).read_text().strip()
            for name in ["kernel.perf_event_paranoid", "kernel.kptr_restrict", "kernel.yama.ptrace_scope"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=["retention", "loss"])
    parser.add_argument("--binary", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--frequency", type=int, default=99)
    parser.add_argument("--pages", type=int, default=4)
    parser.add_argument("--seconds", type=float, default=8)
    args = parser.parse_args()
    if args.pages not in [1, 4, 16] or not 1 <= args.frequency <= 1000 or not 2 <= args.seconds <= 12:
        parser.error("pages must be 1/4/16, frequency 1..1000, seconds 2..12")
    if args.output.exists() and any(args.output.iterdir()):
        parser.error("output directory must be empty")
    args.output.mkdir(parents=True, exist_ok=True)
    perf = shutil.which("perf")
    if not perf:
        parser.error("perf is not accessible")
    result = {"kind": args.kind, "settings": vars(args) | {"binary": str(args.binary), "output": str(args.output)},
              "sysctlsBefore": sysctls(), "uid": os.getuid(),
              "credentials": [line for line in Path("/proc/self/status").read_text().splitlines()
                              if line.startswith(("Uid:", "CapEff:", "NoNewPrivs:", "Seccomp:"))],
              "binarySha256": hashlib.sha256(args.binary.read_bytes()).hexdigest(),
              "runnerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              "perfVersion": subprocess.check_output([perf, "--version"], text=True).strip(),
              "pageBytes": os.sysconf("SC_PAGESIZE"), "signals": [], "commands": {},
              "note": "single hot TID scope for retention; target PID scope for positive LOST; experimental settings only"}
    target_log = open(args.output / "target.log", "w+")
    target = subprocess.Popen([str(args.binary)], stdin=subprocess.PIPE, stdout=target_log,
                              stderr=subprocess.STDOUT, text=True)
    collector = None
    collector_suspended = False
    exit_code = 0
    try:
        birth = incarnation(target.pid)
        result.update(targetPid=target.pid, targetBirth=birth)
        ready_deadline = time.monotonic() + 5
        while time.monotonic() < ready_deadline:
            rows = (args.output / "target.log").read_text().splitlines()
            if sum(row.startswith("THREAD ") for row in rows) == 3:
                break
            time.sleep(.025)
        else:
            raise RuntimeError("fixture workers did not become ready")
        tasks = {p.name: (p / "comm").read_text().strip() for p in Path(f"/proc/{target.pid}/task").iterdir()}
        result["tasks"] = tasks
        hot_tid = next(tid for tid, name in tasks.items() if name == "hot-worker")
        result["selectedHotTid"] = int(hot_tid)
        data = args.output / "capture.data"
        command = [perf, "record", "--no-buildid-cache", "--clockid", "mono", "--timestamp", "--per-thread", "--no-inherit", "--user-callchains", "-e", "cpu-clock:u",
                   "-F", str(args.frequency), "-m", str(args.pages), "--call-graph",
                   "fp" if args.kind == "retention" else "dwarf,8192", "-o", str(data)]
        if args.kind == "retention":
            command += ["-t", hot_tid, "--overwrite", "--switch-output=signal"]
        else:
            command += ["-p", str(target.pid)]
        result["commands"]["record"] = {"command": command}
        with open(args.output / "record.stdout", "w") as stdout, open(args.output / "record.stderr", "w") as stderr:
            collector = subprocess.Popen(command, stdout=stdout, stderr=stderr)
            result["collectorPid"] = collector.pid
            result["collectorStartMonotonicNs"] = time.monotonic_ns()
            if args.kind == "retention":
                try:
                    collector.wait(timeout=args.seconds)
                    raise RuntimeError("perf exited before retention trigger")
                except subprocess.TimeoutExpired:
                    trigger_ns = time.monotonic_ns()
                    collector.send_signal(signal.SIGUSR2)
                    result["signals"].append({"signal": "SIGUSR2", "pid": collector.pid, "monotonicNs": trigger_ns})
                    result["triggerMonotonicNs"] = trigger_ns
                    deadline = time.monotonic() + 3
                    while time.monotonic() < deadline:
                        candidates = [p for p in args.output.glob("capture.data.*") if p.is_file() and p.stat().st_size > 0]
                        if candidates:
                            result["snapshotCandidatesBeforeStop"] = [str(p) for p in candidates]
                            break
                        time.sleep(.05)
                    else:
                        raise RuntimeError("no timestamped snapshot appeared after SIGUSR2")
                    time.sleep(.3)
            else:
                try:
                    collector.wait(timeout=.7)
                    raise RuntimeError("perf exited before collector-only pause")
                except subprocess.TimeoutExpired:
                    collector.send_signal(signal.SIGSTOP)
                    collector_suspended = True
                    result["signals"].append({"signal": "SIGSTOP", "pid": collector.pid, "monotonicNs": time.monotonic_ns()})
                    time.sleep(.6)
                    collector.send_signal(signal.SIGCONT)
                    collector_suspended = False
                    result["signals"].append({"signal": "SIGCONT", "pid": collector.pid, "monotonicNs": time.monotonic_ns()})
                    time.sleep(max(.2, args.seconds - 1.3))
            if collector.poll() is None:
                collector.send_signal(signal.SIGINT)
                result["signals"].append({"signal": "SIGINT", "pid": collector.pid, "monotonicNs": time.monotonic_ns()})
            collector.wait(timeout=15)
        result["commands"]["record"]["exitCode"] = collector.returncode
        result["targetAliveAfterCollectorStop"] = target.poll() is None and incarnation(target.pid) == birth
        files = sorted(args.output.glob("capture.data*"))
        result["rawFiles"] = [{"path": str(p), "bytes": p.stat().st_size} for p in files if p.is_file()]
        expected_stop = collector.returncode in [0, -signal.SIGINT] and any(s["signal"] == "SIGINT" for s in result["signals"])
        result["expectedCollectorStopExit"] = expected_stop
        if not expected_stop:
            raise RuntimeError("perf failed; inspect record.stderr")
        selected = max((Path(p) for p in result["snapshotCandidatesBeforeStop"]), key=lambda p: p.stat().st_size) if args.kind == "retention" else data
        result["selectedDataFile"] = str(selected)
        for name, command in [
            ("leaves", [perf, "script", "--ns", "-G", "-F", "comm,pid,tid,time,period,event,ip,sym,dso", "-i", str(selected)]),
            ("stacks", [perf, "script", "--ns", "--show-lost-events", "-i", str(selected)]),
            ("raw-records", [perf, "script", "-D", "-i", str(selected)]),
        ]:
            result["commands"][name] = run(command, args.output, name)
            if result["commands"][name]["exitCode"]:
                raise RuntimeError(name + " decoding failed")
    except (OSError, RuntimeError, subprocess.SubprocessError) as error:
        result["error"] = str(error)
        exit_code = 2
    finally:
        if collector and collector.poll() is None:
            if collector_suspended:
                collector.send_signal(signal.SIGCONT)
            collector.send_signal(signal.SIGINT)
            try:
                collector.wait(timeout=10)
            except subprocess.TimeoutExpired:
                collector.kill()
                collector.wait()
        if target.poll() is None:
            result["targetAliveBeforeNormalShutdown"] = True
            target.stdin.write("stop\n")
            target.stdin.flush()
            target.wait(timeout=10)
        target.stdin.close()
        target_log.close()
        result["targetNormalExitCode"] = target.returncode
        result["sysctlsAfter"] = sysctls()
        result["sysctlsUnchanged"] = result["sysctlsBefore"] == result["sysctlsAfter"]
        (args.output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
        print(args.output)
        print(json.dumps({key: result.get(key) for key in ["kind", "error", "selectedDataFile", "targetAliveAfterCollectorStop", "sysctlsUnchanged"]}, indent=2))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
