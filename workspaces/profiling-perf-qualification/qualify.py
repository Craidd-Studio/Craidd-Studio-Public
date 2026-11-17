#!/usr/bin/env python3
"""Build/smoke a native target and retain perf evidence, without policy changes.

Only the perf child receives SIGINT. The owned fixture receives stdin "stop"
after recording its survival. Exit 2 means a missing/refused collector.
Raw output is evidence; passing this runner alone does not qualify a parser.
"""
import argparse
from datetime import datetime, timezone
import glob
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import signal
import subprocess
import tempfile
import time


def run(command, output, name):
    started = time.monotonic()
    result = subprocess.run(command, capture_output=True, text=True, timeout=30)
    (output / (name + ".stdout")).write_text(result.stdout)
    (output / (name + ".stderr")).write_text(result.stderr)
    return {"command": command, "exitCode": result.returncode,
            "seconds": time.monotonic() - started}


def incarnation(pid):
    stat = Path(f"/proc/{pid}/stat").read_text()
    return stat[stat.rfind(")") + 2:].split()[19]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--seconds", type=float, default=3)
    parser.add_argument("--frequency", type=int, default=99)
    args = parser.parse_args()
    if not 1 <= args.seconds <= 30 or not 1 <= args.frequency <= 1000:
        parser.error("seconds must be 1..30 and frequency 1..1000")
    output = args.output or Path(tempfile.mkdtemp(prefix="craidd-perf-qualification-"))
    if output.exists() and any(output.iterdir()):
        parser.error("output directory must be empty; preserve earlier evidence")
    output.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).with_name("fixture.cpp")
    candidates = ["/usr/bin/perf", "/usr/libexec/perf", *glob.glob("/usr/lib/linux-tools/*/perf")]
    perf = shutil.which("perf") or next((p for p in candidates if os.access(p, os.X_OK)), None)
    status = Path("/proc/self/status").read_text().splitlines()
    result = {
        "timestampUtc": datetime.now(timezone.utc).isoformat(),
        "machine": {"uname": list(platform.uname()), "cpu": next((line.split(":", 1)[1].strip()
                    for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unknown"),
                    "memory": Path("/proc/meminfo").read_text().splitlines()[0]},
        "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "runnerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "baseline": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
        "sysctls": {name: Path("/proc/sys/" + name.replace(".", "/")).read_text().strip()
                    for name in ["kernel.perf_event_paranoid", "kernel.kptr_restrict", "kernel.yama.ptrace_scope"]},
        "credentials": [line for line in status if line.startswith(("Uid:", "Gid:", "Cap", "NoNewPrivs:", "Seccomp:"))],
        "perfPath": perf, "alternativePaths": {p: os.access(p, os.X_OK) for p in candidates},
        "captureSettings": {"event": "cpu-clock:u", "frequency": args.frequency, "seconds": args.seconds,
                            "note": "qualification settings, not accepted product defaults"},
        "tools": {}, "modes": {}, "gates": {}
    }
    try:
        for tool in ["g++", "readelf", "nm", "objdump"]:
            if not shutil.which(tool):
                raise RuntimeError(f"Missing build/evidence tool: {tool}")
            result["tools"][tool] = run([tool, "--version"], output, tool + "-version")
            result["tools"][tool]["version"] = (output / (tool + "-version.stdout")).read_text().splitlines()[0]
        if perf:
            result["tools"]["perf"] = run([perf, "--version"], output, "perf-version")
            result["tools"]["perf"]["version"] = (output / "perf-version.stdout").read_text().strip()
        for mode, flags in [("fp", ["-fno-omit-frame-pointer", "-mno-omit-leaf-frame-pointer"]),
                            ("dwarf", ["-fomit-frame-pointer"])]:
            binary = output / ("fixture-" + mode)
            commands = {}
            commands["build"] = run(["g++", "-std=c++17", "-O2", "-g", "-pthread", "-Wl,--build-id",
                                      *flags, str(source), "-o", str(binary)], output, mode + "-build")
            if commands["build"]["exitCode"]:
                raise RuntimeError("Fixture build failed: " + mode)
            for name, command in [("symbols", ["nm", "-C", str(binary)]),
                                  ("sections", ["readelf", "-S", str(binary)]),
                                  ("build-id", ["readelf", "-n", str(binary)]),
                                  ("known-hot-asm", ["objdump", "-d", "--disassemble=known_hot", str(binary)])]:
                commands[name] = run(command, output, mode + "-" + name)
            symbols = (output / (mode + "-symbols.stdout")).read_text()
            sections = (output / (mode + "-sections.stdout")).read_text()
            assembly = (output / (mode + "-known-hot-asm.stdout")).read_text()
            frame_pointer_present = bool(re.search(r"mov\s+%rsp,%rbp", assembly))
            binary_evidence = {"knownSymbolsPresent": all(name in symbols for name in ["known_hot", "known_pool", "hot_parent"]),
                               "debugInfoPresent": ".debug_info" in sections,
                               "knownHotFramePointerPresent": frame_pointer_present,
                               "buildId": re.search(r"Build ID:\s+(\w+)", (output / (mode + "-build-id.stdout")).read_text()).group(1)}
            if not binary_evidence["knownSymbolsPresent"] or not binary_evidence["debugInfoPresent"] or frame_pointer_present != (mode == "fp"):
                raise RuntimeError("Fixture symbol/debug/frame build evidence failed: " + mode)
            target_log = open(output / (mode + "-target.log"), "w+")
            target = subprocess.Popen([str(binary)], stdin=subprocess.PIPE, stdout=target_log,
                                      stderr=subprocess.STDOUT, text=True)
            try:
                identity = incarnation(target.pid)
                deadline = time.monotonic() + 5
                while time.monotonic() < deadline:
                    target_log.flush()
                    log = (output / (mode + "-target.log")).read_text()
                    if log.count("THREAD ") == 3:
                        break
                    time.sleep(.025)
                else:
                    raise RuntimeError("Fixture workers did not become ready")
                tasks = {p.name: (p / "comm").read_text().strip()
                         for p in Path(f"/proc/{target.pid}/task").iterdir()}
                if list(tasks.values()).count("hot-worker") != 1 or list(tasks.values()).count("pool-worker") != 2:
                    raise RuntimeError("Fixture thread naming failed: " + mode)
                mode_result = {"binarySha256": hashlib.sha256(binary.read_bytes()).hexdigest(),
                               "commands": commands, "targetPid": target.pid, "targetBirth": identity,
                               "tasks": tasks, "buildAndSmoke": "PASS", "binaryEvidence": binary_evidence}
                result["modes"][mode] = mode_result
                if not perf:
                    mode_result.update(capture="BLOCKED", reason="perf executable not found",
                                       safeCollectorStop="BLOCKED", samples="BLOCKED", symbols="BLOCKED", loss="BLOCKED")
                else:
                    data = output / (mode + ".data")
                    command = [perf, "record", "--no-buildid-cache", "--clockid", "mono", "--timestamp", "--per-thread", "--no-inherit", "--user-callchains", "-e", "cpu-clock:u", "-F", str(args.frequency),
                               "--call-graph", "fp" if mode == "fp" else "dwarf,8192",
                               "-p", str(target.pid), "-o", str(data)]
                    with open(output / (mode + "-record.stdout"), "w") as stdout, open(output / (mode + "-record.stderr"), "w") as stderr:
                        collector = subprocess.Popen(command, stdout=stdout, stderr=stderr)
                        try:
                            collector.wait(timeout=args.seconds)
                            stopped_by_runner = False
                        except subprocess.TimeoutExpired:
                            collector.send_signal(signal.SIGINT)
                            stopped_by_runner = True
                            try:
                                collector.wait(timeout=15)
                            except subprocess.TimeoutExpired:
                                collector.kill()
                                collector.wait()
                                mode_result["collectorCleanup"] = "killed owned collector after SIGINT timeout"
                    mode_result["commands"]["record"] = {"command": command, "exitCode": collector.returncode,
                                                            "sigintSentToCollector": stopped_by_runner}
                    alive = target.poll() is None and incarnation(target.pid) == identity
                    mode_result["targetAliveAfterCollectorStop"] = alive
                    # This perf version finalises data then re-raises SIGINT.
                    # Accept that exit only for our deliberate Stop and still
                    # require real decoding/evidence review below.
                    expected_stop = collector.returncode == 0 or (stopped_by_runner and collector.returncode == -signal.SIGINT)
                    mode_result["expectedCollectorStopExit"] = expected_stop
                    if not expected_stop or not data.exists() or data.stat().st_size == 0:
                        mode_result.update(capture="BLOCKED", reason="perf refused/failed; inspect raw stderr",
                                           safeCollectorStop="PARTIAL" if alive else "FAIL", samples="BLOCKED", symbols="BLOCKED", loss="BLOCKED")
                    else:
                        mode_result.update(capture="PASS", safeCollectorStop="PASS" if alive and stopped_by_runner else "PARTIAL",
                                           samples="PARTIAL", symbols="PARTIAL", loss="PARTIAL",
                                           reviewRequired="Inspect raw attribution, callchains, symbols and loss; these are not parser acceptance results",
                                           rawDataBytes=data.stat().st_size)
                        commands["script"] = run([perf, "script", "--ns", "--show-lost-events", "-i", str(data)], output, mode + "-script")
                        commands["leaves"] = run([perf, "script", "--ns", "-G", "-F", "comm,pid,tid,time,period,event,ip,sym,dso", "-i", str(data)], output, mode + "-leaves")
                        commands["report"] = run([perf, "report", "--stdio", "-i", str(data), "--no-children",
                                                   "--sort", "pid,symbol", "--percent-limit", "0", "-n"], output, mode + "-report")
                        commands["raw-records"] = run([perf, "script", "-D", "-i", str(data)], output, mode + "-raw-records")
                        commands["build-ids"] = run([perf, "buildid-list", "-i", str(data)], output, mode + "-captured-build-ids")
                        commands["source-lines"] = run([perf, "script", "--ns", "--full-source-path", "-F", "+srcline", "-i", str(data)], output, mode + "-source-lines")
                mode_result["fixtureAliveBeforeNormalShutdown"] = target.poll() is None and incarnation(target.pid) == identity
            finally:
                if target.poll() is None:
                    target.stdin.write("stop\n")
                    target.stdin.flush()
                    target.wait(timeout=10)
                target.stdin.close()
                target_log.close()
        result["gates"] = {"nativeFixtureBuildAndSmoke": "PASS", "perfDiscovery": "PASS" if perf else "BLOCKED",
                           "captureQualification": "PARTIAL" if perf else "BLOCKED",
                           "desktopBehaviour": "NOT TESTED", "flightRecording": "NOT TESTED",
                           "jitAndSymbolScale": "NOT TESTED"}
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        result["error"] = str(error)
        result["gates"]["runner"] = "FAIL"
    finally:
        result["sysctlsAfter"] = {name: Path("/proc/sys/" + name.replace(".", "/")).read_text().strip()
                                  for name in result["sysctls"]}
        result["sysctlsUnchanged"] = result["sysctls"] == result["sysctlsAfter"]
        (output / "results.json").write_text(json.dumps(result, indent=2) + "\n")
        print(output)
        print(json.dumps(result["gates"], indent=2))
    return 1 if "error" in result else 2 if not perf or any(m.get("capture") == "BLOCKED" for m in result["modes"].values()) else 0


if __name__ == "__main__":
    raise SystemExit(main())
