# GR-002 matched native sampling overhead

**Roadmap track:** Phase 3.5 profiling.
**Status:** Measurement record, 22 October 2026. Native timed capture only; no UI or flight-recorder delivery claim.
**Measured baseline:** `82cbf47a258e71fa95cc3541e57b0142fccf1ecc` plus the separate overhead fixture and runner, measured before the local task commit. Exact source, binary, build-ID and raw-data hashes are in the [evidence JSON](../../../../workspaces/profiling-perf-qualification/evidence-2026-10-22-overhead.json).

Five alternating matched repetitions per mode completed with **16 and 32 busy
workers**. The median measured slowdown was 0.008% / 0.019% / 0.111% with 16
workers, and −0.063% / 0.155% / 0.473% with 32 workers for FP 99 Hz / DWARF
8,192 bytes at 99 Hz / DWARF 8,192 bytes at 999 Hz respectively. These are
descriptive comparisons on one workload and machine. Small differences and
negative values must not be interpreted as a proved effect or speedup.

All 30 captures remained active across their measured intervals, sampled every
selected worker, reported zero LOST and zero LOST_SAMPLES, and stayed below the
512 MiB raw cap. Both targets survived every collector Stop and exited normally
through stdin. This does not supersede the [no-frame-pointer qualification](gr-002-many-thread-retention.md): FP omits real ancestry in this module, so its low overhead does not establish equivalent stack coverage.

## Workload and matched windows

The [overhead fixture](../../../../workspaces/profiling-perf-qualification/matched_overhead_fixture.cpp) is separate from the earlier measured fixtures. It loads the same [generated workload](../../../../workspaces/profiling-perf-qualification/generate_native_workload.py): 64 four-function chains, 256 generated native functions plus the public entry, compiled into a runtime-loaded shared library with `-O2 -g -fomit-frame-pointer -fno-optimize-sibling-calls`. The main uses frame pointers. All selected workers continuously execute the workload; the waiting main thread is excluded from perf.

Each worker stores a completed-call counter once after returning from the full
generated workload. Counters are lock-free relaxed atomics in separate
64-byte-aligned slots. The main reads them on a stdin snapshot request, recording
monotonic timestamps immediately before and after the counter reads. No worker
is paused or signalled. Instrumentation is identical in every mode; its own cost
is not claimed to be zero or separately qualified. Work that spans a boundary is
counted when it completes.

One target persists for each worker count. After two seconds of warm-up, each
repetition uses `baseline → mode → baseline → mode → baseline → mode → baseline`.
Mode order rotates deterministically by repetition and reverses on odd
repetitions. Every profiled window therefore has adjacent baseline controls.
There are **70 windows: 40 baselines and 30 profiled windows**, with five windows
per mode and worker count. No outliers were removed.

Each window requests one second between its two snapshot acknowledgements;
actual counter-read midpoint intervals range from **1.000111 to 1.003561 s**.
Counter-read brackets are **130–250 ns**. Throughput is the sum of per-worker
completed-call deltas divided by that measured elapsed interval, not process
startup/shutdown time. Counts, request/acknowledgement timestamps, read brackets
and per-worker deltas are preserved for every window.

The baseline throughput at each profiled midpoint is linearly interpolated
between the midpoints of its preceding and following baseline windows. The
reported time-equivalent slowdown is `100 × (baseline throughput / profiled
throughput − 1)`. The JSON also records the different throughput-drop quantity
`100 × (1 − profiled throughput / baseline throughput)`. Neither is a claim of
statistical significance or a causal decomposition of overhead.

## Machine and collection conditions

Machine `sk27`: AMD Ryzen 9 9950X3D, 16 physical cores / 32 logical CPUs, allowed
CPU affinity 0–31; Linux `7.2.11-arch1-1`, perf **7.2.11-1**, GCC
**16.2.1 20260810**. Per-CPU governors, temperature/frequency observations and
credentials are recorded in the evidence. Captures ran as UID 1000 with zero
effective capabilities, `NoNewPrivs=0`, `Seccomp=0`. No elevation or policy change
was used. Sysctls remained `perf_event_paranoid=2`, `kptr_restrict=0`,
`ptrace_scope=1`.

Other agent builds and native/JIT captures were paused for the complete measured
slot. The ordinary desktop continued running; this is not an isolated or
thermally controlled benchmark. CPU temperatures observed across the windows
were **55.875–74.000 °C**. No readable temperature sensor was within 5 °C of its
reported critical limit. Readable thermal-throttling counters were unavailable,
so the run does **not** prove an absence of throttling. Per-CPU frequency
snapshots across active and idle CPUs ranged from 624,194 to 5,550,213 kHz;
they are instantaneous observations, not interval-average worker frequencies.

Approximate system busy CPU minus target and collector CPU ranged from
**0.65 to 1.33 CPU-seconds per window**. It never exceeded the declared warning
threshold of 5% of 32 available logical CPUs over the interval. Those proc reads
only approximately bracket the counter window; the residual is a concurrency
flag, not exact accounting or proof that background activity cannot affect a
small result. Baseline throughput itself ranged from 124,041–124,664 calls/s
with 16 workers and 227,562–232,934 calls/s with 32 workers. Adjacent controls
reduce slow drift but cannot remove every scheduling, frequency or thermal
effect inside a one-second window.

All captures use `cpu-clock:u`, explicit worker TIDs, `--user-callchains
--per-thread --no-inherit --timestamp --clockid mono`, and 128 data pages per
TID. The runner starts perf disabled, enables it through its control pipe and
waits for the installed version's acknowledgement (`ack` plus newline and NUL).
It then waits 50 ms before the measured window and 50 ms afterwards before
stopping only the owned perf child. Every child finalized on deliberate SIGINT
(exit −2). The enabled timestamp precedes every measured boundary, the child is
alive at both boundaries, and raw samples from every selected TID fall inside
every measured window. Collection, raw writing and their CPU/scheduling impact
are included in measured throughput. Collector startup, finalization, symbol
resolution and offline analysis are outside these windows and are not estimated
by the reported slowdown.

## Paired results

Quartiles use linear interpolation of the five ordered observations. Percentage
values below are slowdown, not event shares or exact self time.

| Busy workers | Capture | Repetitions | Median slowdown % | P25–P75 % | Min–max % |
| --- | --- | --- | --- | --- | --- |
| 16 | FP, 99 Hz | 5 | 0.008 | −0.015–0.024 | −0.080–0.088 |
| 16 | DWARF 8,192, 99 Hz | 5 | 0.019 | 0.003–0.076 | −0.015–0.153 |
| 16 | DWARF 8,192, 999 Hz | 5 | 0.111 | 0.017–0.262 | 0.016–0.273 |
| 32 | FP, 99 Hz | 5 | −0.063 | −0.080–0.096 | −0.722–0.282 |
| 32 | DWARF 8,192, 99 Hz | 5 | 0.155 | 0.016–0.673 | −0.050–0.784 |
| 32 | DWARF 8,192, 999 Hz | 5 | 0.473 | 0.170–0.694 | 0.077–0.985 |

The 32-worker results have more spread than the 16-worker results. In particular,
the negative FP median and overlapping ranges do not justify ranking small
differences between modes as a proved performance improvement. The result is
bounded evidence for this constructed workload, stack depth, sample event,
frequency, compiler and host; it does not predict overhead for Unity, IL2CPP,
managed runtimes, deep stacks, other events or a long production capture.

## Samples, loss and storage

Observed rates below are sample count divided by the actual measured **wall**
interval, across individual selected TIDs in all five repetitions. Requested
CPU-clock frequency is not a guaranteed per-thread wall rate. Raw sizes include
the short pre/postroll and file metadata; sample totals include only the measured
windows in this table.

| Workers / capture | Samples inside measured windows, total | Observed samples/wall second/TID, min / median / max | Raw bytes/capture, min–max |
| --- | --- | --- | --- |
| 16 / FP 99 | 7,916 | 96.986 / 98.986 / 98.987 | 227,468–229,004 |
| 16 / DWARF 99 | 7,919 | 97.985 / 98.985 / 98.986 | 14,826,092–14,969,396 |
| 16 / DWARF 999 | 79,903 | 994.857 / 998.857 / 998.859 | 149,805,916–149,865,212 |
| 32 / FP 99 | 15,481 | 79.904 / 97.882 / 98.984 | 410,604–412,332 |
| 32 / DWARF 99 | 15,469 | 82.785 / 97.746 / 98.983 | 28,800,164–29,272,220 |
| 32 / DWARF 999 | 155,864 | 849.998 / 985.748 / 998.013 | 288,876,844–294,036,484 |

Total retained raw evidence is **2,433,717,560 bytes**. Each owned perf child has
a hard `RLIMIT_FSIZE` of **536,870,912 bytes (512 MiB)** and an early file-size
monitor polling every 10 ms at one MiB below that cap. No capture reached either
limit; the largest was 294,036,484 bytes. The runner additionally limits aggregate
raw evidence to 8 GiB. These are safeguards; this experiment does not qualify a
cap-triggered partial capture or cap recovery.

Every raw capture has **zero PERF_RECORD_LOST and zero PERF_RECORD_LOST_SAMPLES**
and no incomplete-record diagnostic. The raw scanner keeps those two record
kinds and counters separate; it never adds them together. A synthetic input with
each counter equal to seven is labelled PARTIAL, not counted as fourteen lost
samples. A prior real DWARF file gives the same 590 samples as its existing perf
script decode. Every new raw file contains the declared CPU-clock event and a
control-mode software dummy event; sampled event identifiers are checked against
the CPU-clock event rather than assuming one event attribute per file.

## Gates and remaining limits

| Gate | Result | Evidence or limit |
| --- | --- | --- |
| Separate fixture, exact completed-work windows | PASS | Same atomic instrumentation in every mode; all workers progress; 140 snapshot read brackets retained. |
| Five alternating matched repetitions | PASS | 70 windows, adjacent interpolated controls, rotating/reversed order; no discarded trial. |
| Collector active throughout each window | PASS | Enable acknowledgement/timestamp, both boundary liveness checks, every selected TID sampled inside all 30 windows. |
| Raw cap and capture loss | PASS | Maximum 294,036,484 bytes; no monitor/hard-cap stop, LOST, LOST_SAMPLES or raw diagnostic. Cap-triggered recovery NOT TESTED here. |
| Observed environment warnings | PASS | No declared concurrency, near-critical sensor, no-progress or snapshot-width warning. Thresholds do not imply an isolated machine. |
| Target survival and normal shutdown | PASS | Same incarnation after each interval; both targets accept stdin stop and exit zero. No target signal. |
| System policy unchanged | PASS | Credentials and sysctls recorded before/after. |
| Raw scanner / source provenance | PASS | Real-file cross-check, distinct synthetic loss counters, event-ID checks, source/build/binary/raw SHA-256 and build IDs. |
| Thermal throttling attribution | NOT TESTED | No readable throttle counters; temperatures/frequencies observed only. |
| Statistical significance | NOT TESTED | Five observations per cell; descriptive medians/spreads only. |
| Symbol-resolution, desktop/UI or product overhead | NOT TESTED | Separate gates; no UI/product execution in this experiment. |
| Other machines, workloads, events or versions | NOT TESTED | One installed perf version and one constructed native workload. |

The first runner attempt stopped before any profiled measurement because it
expected a newline-only acknowledgement. The target shut down normally. After
accepting the installed perf version's NUL terminator, the fresh second attempt
completed all measured windows. Its initial deferred scanner rejected perf's
additional dummy-event attribute; the scanner was corrected and all existing
raw files were analysed offline. **No measurement was rerun or selected to
improve the result.** The evidence distinguishes the measured runner hash from
the later offline analysis revision, and records both historical failures.

## Reproduction and retained artifacts

The [runner](../../../../workspaces/profiling-perf-qualification/matched_overhead.py) uses only Python's standard library, GCC, ELF tools and installed perf. From the repository root, with fresh output directories and an agreed exclusive workload slot:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/matched_overhead.py build --output /tmp/new-overhead-build
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/matched_overhead.py run --build /tmp/new-overhead-build --output /tmp/new-overhead-results --repetitions 5 --seconds 1
```

If deferred analysis alone needs repeating, `analyse --output
/tmp/new-overhead-results` launches no target or collector. Current build/raw
artifacts are `/tmp/craidd-perf-gr002-20261022-overhead-build-v3` and
`/tmp/craidd-perf-gr002-20261022-matched-overhead-v2`. Their compiler logs,
perf.data and stderr are local temporary artifacts. The repository JSON keeps
the complete bounded measurement windows and evidence, not copies of the 2.43 GB
raw data. Existing qualification fixtures, retention evidence, product code and
UI files are unchanged by this task.

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
