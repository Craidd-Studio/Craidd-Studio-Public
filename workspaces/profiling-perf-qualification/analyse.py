#!/usr/bin/env python3
"""Analyse explicitly selected fields from the installed perf script version.

Unknown lines are retained diagnostically. This is qualification tooling, not a
production parser, and never equates sample shares with exact elapsed self time.
"""
import argparse
from collections import Counter, defaultdict
import json
from pathlib import Path
import re


HEADER = re.compile(
    r"^\s*(?P<comm>\S+)\s+(?P<pid>\d+)(?:/|\s+)(?P<tid>\d+)\s+"
    r"(?P<time>\d+\.\d+):\s+(?P<period>\d+)\s+(?P<event>\S+):\s+"
    r"(?P<ip>[0-9a-fA-F]+)\s+(?P<symbol>.*?)\s+\((?P<module>.*)\)\s*$"
)


def analyse(directory, prefix=""):
    leaves = directory / (prefix + "leaves.stdout")
    samples, unknown = [], []
    for line in leaves.read_text().splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        match = HEADER.match(line)
        if not match:
            unknown.append(line)
            continue
        sample = match.groupdict()
        for name in ["pid", "tid", "period"]:
            sample[name] = int(sample[name])
        sample["time"] = float(sample["time"])
        sample["symbol"] = re.sub(r"\+0x[0-9a-fA-F]+$", "", sample["symbol"])
        samples.append(sample)
    per_thread = defaultdict(list)
    for sample in samples:
        per_thread[sample["tid"]].append(sample)
    threads = {}
    for tid, rows in per_thread.items():
        first, last = min(r["time"] for r in rows), max(r["time"] for r in rows)
        counts = Counter(row["symbol"] for row in rows)
        periods = Counter()
        for row in rows:
            periods[row["symbol"]] += row["period"]
        total_period = sum(periods.values())
        threads[str(tid)] = {
            "comm": rows[0]["comm"], "samples": len(rows), "firstTime": first, "lastTime": last,
            "observedSpanSeconds": last - first,
            "observedSamplesPerWallSecond": (len(rows) - 1) / (last - first) if last > first else None,
            "periodSum": total_period,
            "topSampledFunctions": [{"symbol": symbol, "sampleCount": counts[symbol], "period": period,
                                     "sampledEventSharePct": 100 * period / total_period if total_period else None}
                                    for symbol, period in periods.most_common(8)],
        }
    stacks_path = directory / (prefix + ("script.stdout" if prefix else "stacks.stdout"))
    stack_text = stacks_path.read_text() if stacks_path.exists() else ""
    blocks = [block for block in stack_text.split("\n\n") if block.strip()]
    raw_path = directory / (prefix + "raw-records.stdout")
    raw = raw_path.read_text() if raw_path.exists() else ""
    # LOST_SAMPLES counters can describe the same loss already reported by
    # LOST records. Keep the two evidence sources separate, never add them.
    lost_records = [line for line in raw.splitlines() if "PERF_RECORD_LOST:" in line]
    lost_sample_records = [line for line in raw.splitlines() if "PERF_RECORD_LOST_SAMPLES:" in line]
    lost_counts = [int(m.group(1)) for line in lost_records for m in [re.search(r"lost[:= ]+(\d+)", line, re.I)] if m]
    lost_sample_counts = [int(m.group(1)) for line in lost_sample_records for m in [re.search(r"lost samples\s*:\s*(\d+)", line, re.I)] if m]
    times = [row["time"] for row in samples]
    result = {
        "sampleCount": len(samples), "unparsedLineCount": len(unknown), "unparsedExamples": unknown[:10],
        "firstTime": min(times) if times else None, "lastTime": max(times) if times else None,
        "spanSeconds": max(times) - min(times) if times else None,
        "events": dict(Counter(row["event"] for row in samples)),
        "modules": dict(Counter(row["module"] for row in samples)),
        "unresolvedSampleCount": sum("unknown" in row["symbol"].lower() or row["symbol"].startswith("0x") for row in samples),
        "unresolvedStackFrameCount": stack_text.count("[unknown]"),
        "unresolvedStackFrameExamples": [line.strip() for line in stack_text.splitlines() if "[unknown]" in line][:5],
        "threads": threads,
        "hotParentChainBlocks": sum("known_hot" in block and "hot_parent" in block for block in blocks),
        "lostRecordCount": len(lost_records), "lostRecordExamples": lost_records[:10],
        "lostCountsParsed": lost_counts,
        "lostCountSum": sum(lost_counts) if len(lost_counts) == len(lost_records) else None,
        "lostSampleCounterRecordCount": len(lost_sample_records),
        "lostSampleCounterSum": sum(lost_sample_counts) if len(lost_sample_counts) == len(lost_sample_records) else None,
        "lostSampleCounterExamples": lost_sample_records[:5],
        "lossAccounting": "LOST records and LOST_SAMPLES counters are separate, potentially overlapping reports; never summed together",
        "note": "sampled event/period shares; no exact self-time or causal attribution",
    }
    result_path = directory / "results.json"
    if result_path.exists():
        experiment = json.loads(result_path.read_text())
        if "triggerMonotonicNs" in experiment and times:
            trigger = experiment["triggerMonotonicNs"] / 1e9
            result["oldestSampleAgeAtTriggerSeconds"] = trigger - min(times)
            result["newestSampleAgeAtTriggerSeconds"] = trigger - max(times)
            result["nominalRingDataBytes"] = experiment["settings"]["pages"] * experiment["pageBytes"]
            result["scope"] = "single hot TID, per-thread ring"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--prefix", default="")
    args = parser.parse_args()
    result = analyse(args.directory, args.prefix)
    target = args.directory / (args.prefix + "analysis.json")
    target.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
    return 1 if not result["sampleCount"] or result["unparsedLineCount"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
