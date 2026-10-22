# GR-002 no-FP shared module and many-thread retention

**Roadmap track:** Phase 3.5 profiling.
**Status:** Qualification record, 22 October 2026. Native evidence only; UI remains on hold and flight recording remains a separate proposed decision.
**Measured source baseline:** `5039abfbf72148dc4a3195bc753113153d77d6a0` plus this branch's qualification sources; source/build/raw hashes are in the evidence.

This extends the [20 October qualification](perf-qualification-results.md) with
an explicitly runtime-loaded module compiled without frame pointers, and
per-thread ring measurements across **16 and 32 simultaneously busy workers**.
It does not qualify Unity, IL2CPP, a managed/JIT runtime or the deferred
200,000-function symbol-scale workload.

## Artifacts and reproduction

- [New evidence JSON](../../../../workspaces/profiling-perf-qualification/evidence-2026-10-22-many-thread.json) contains both timed contrasts and all twelve retention cells: every selected TID's sample count, first/last timestamp, trigger ages, measured wall rate, raw record bytes, CPU ticks, normal-exit work count and wrap interpretation; commands, versions, build IDs, credentials, actual maps/resources and raw hashes are included.
- [FP main fixture](../../../../workspaces/profiling-perf-qualification/many_thread_fixture.cpp), [native module generator](../../../../workspaces/profiling-perf-qualification/generate_native_workload.py) and [qualification runner](../../../../workspaces/profiling-perf-qualification/many_thread_qualification.py).
- Old fixtures and the 20 October JSON files remain unchanged. Current raw outputs are in `/tmp/craidd-perf-gr002-20261022-build-v1`, `/tmp/craidd-perf-gr002-20261022-shared-{fp,dwarf}-v1` and `/tmp/craidd-perf-gr002-20261022-ring-{16,32}-{99,999}-{1,4,16}-v1`. These temporary directories contain complete perf.data, decoded stacks/raw records, compiler logs and disassembly. The repository JSON contains bounded evidence, not those complete raw files.

Use fresh output directories, from the repository root:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py build --output /tmp/new-many-build
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py capture timed --build /tmp/new-many-build --output /tmp/new-many-fp --workers 2 --frequency 99 --pages 128 --seconds 3 --unwinder fp
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py capture timed --build /tmp/new-many-build --output /tmp/new-many-dwarf --workers 2 --frequency 99 --pages 128 --seconds 3 --unwinder dwarf
PYTHONDONTWRITEBYTECODE=1 python3 workspaces/profiling-perf-qualification/many_thread_qualification.py capture retention --build /tmp/new-many-build --output /tmp/new-many-ring --workers 16 --frequency 99 --pages 4 --seconds 8 --unwinder fp
```

Repeat the last command **serially** for 16/32 workers × 99/999 Hz × 1/4/16
pages. No target receives a signal. SIGUSR2 snapshots and SIGINT Stop address
only the owned perf subprocess; the target later shuts down through stdin
`stop`. No installation, elevation, capability, sysctl or policy change is part
of these runners.

## Machine and settings

Machine: `sk27`, AMD Ryzen 9 9950X3D, 16 physical cores / 32 logical CPUs;
process affinity allowed CPUs 0–31. Linux `7.2.11-arch1-1`; installed perf
**7.2.11-1**; GCC **16.2.1 20260810**. The runner could not read the root
`/sys/fs/cgroup/cpu.max` path, so it makes no quota claim. Actual per-TID wall
sampling rates and CPU ticks are recorded instead of assuming full CPU access.
Backend compilation was paused during this coordinated workload slot; other
desktop activity was not made into an isolated benchmark environment.

Captures ran on the ordinary desktop host as UID 1000, effective capabilities
zero, `NoNewPrivs=0`, `Seccomp=0`. Observed sysctls remained
`perf_event_paranoid=2`, `kptr_restrict=0`, `ptrace_scope=1` before/after every
trial. Each collector uses `cpu-clock:u`, `--user-callchains --per-thread
--no-inherit --timestamp --clockid mono`, explicit busy-worker TIDs and a
4,096-byte page size. Thus the waiting main thread is excluded; there are
exactly 16 or 32 measured **busy workers**, with no sleeping worker pool.
All selected workers report positive completed-work counts at normal exit.

Requested perf frequency concerns the sampled CPU-clock event. It is **not a
per-thread wall-time rate guarantee** when a thread is not on CPU. The JSON
keeps the configured frequency, observed wall rates and separate whole-trial
CPU snapshots rather than equating them.

## Runtime-loaded no-FP module: FP versus DWARF

The generated library contains 64 four-function chains—**256 generated
functions plus one public entry**. Each busy worker repeatedly calls:

`native_worker_parent → generated_workload_entry → generated_outer_N → generated_middle_N → generated_inner_N → generated_leaf_N`.

The main is built `-O2 -g -fno-omit-frame-pointer
-mno-omit-leaf-frame-pointer`. The shared library is built separately with
`-O2 -g -fPIC -shared -fomit-frame-pointer -fno-optimize-sibling-calls` and
loaded through `dlopen`/`dlsym`. Non-inlining and disabled sibling-call
optimisation keep the intended ancestor chain present in machine code.
Disassembly verifies an FP main function and a no-FP generated middle function;
ELF symbol count, debug sections and distinct build IDs are preserved.
This is an illustrative compiled native module, not a Unity-generated artifact.

Both timed captures use the same main and shared library, two busy workers,
99 Hz, a three-second requested span and 128 data pages per selected TID.

| Observation | FP | DWARF, 8,192 stack bytes |
| --- | --- | --- |
| Decoded samples | 588 | 590 |
| Stacks with generated leaf | 587 | 590 |
| Stacks with generated inner / middle | 0 / 0 | 590 / 590 |
| Stacks with generated outer | 1 (a direct sample there) | 590 |
| Stacks with public generated entry | 0 | 590 |
| Stacks with FP main's `native_worker_parent` | 0 | 590 |
| Unparsed leaf lines / LOST records / LOST counters | 0 / 0 / 0 | 0 / 0 / 0 |
| Raw perf.data bytes | 91,700 | 5,019,396 |
| Same target incarnation alive after collector Stop | Yes | Yes |

The native module and main build IDs in the capture match the actual binaries:
main `35f3a4430163e161774cf8b80fa64f3708834260`, library
`fbc016c3494713865f89daddee8dde632f5ddc98`.
Unresolved system-library frames remain visible with module/address.

**FP completeness fails across this no-FP module even though the main uses
frame pointers.** It sees the sampled leaf but omits real ancestors, including
the FP caller. DWARF recovers every deliberately constructed ancestor in all
590 samples. This supports explicit unwinder/coverage choices; it does not
justify silently interpreting an FP call tree as complete. It also does not
prove DWARF works for every runtime, stack size or binary.

## Retention with all workers busy

Each retention trial runs for eight requested seconds, snapshots once with
`--overwrite --switch-output=signal`, then stops the collector. The table shows
ranges **across individual TIDs**, not a fictitious single process-wide ring.
Data per ring excludes one metadata page. Aggregate mapped bytes come from
actual `/proc/<perf-pid>/maps` observations and include those metadata pages.

| Busy TIDs | Requested Hz | Data KiB per TID | Actual aggregate perf mapping bytes | Retained samples per TID | First-to-last span range, s | Observed samples / wall second |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | 99 | 4 | 131,072 | 46–46 | 0.454536–0.454582 | 98.992–99.002 |
| 16 | 99 | 16 | 327,680 | 186–186 | 1.868678–1.868872 | 98.990–99.000 |
| 16 | 99 | 64 | 1,114,112 | 744–744 | 7.505098–7.505972 | 98.988–98.999 |
| 16 | 999 | 4 | 131,072 | 46–46 | 0.045045–0.046046 | 977.274–999.007 |
| 16 | 999 | 16 | 327,680 | 186–186 | 0.185180–0.185221 | 998.808–999.029 |
| 16 | 999 | 64 | 1,114,112 | 744–744 | 0.743739–0.744746 | 997.656–999.007 |
| 32 | 99 | 4 | 262,144 | 46–46 | 0.454545–0.536901 | 83.814–99.000 |
| 32 | 99 | 16 | 655,360 | 186–186 | 1.868735–2.195111 | 84.278–98.997 |
| 32 | 99 | 64 | 2,228,224 | 723–744 (3 unfilled) | 7.505922–7.977789 | 90.592–98.989 |
| 32 | 999 | 4 | 262,144 | 46–46 | 0.045045–0.052870 | 851.147–999.004 |
| 32 | 999 | 16 | 655,360 | 186–186 | 0.185188–0.241061 | 767.441–998.984 |
| 32 | 999 | 64 | 2,228,224 | 744–744 | 0.743766–0.901463 | 824.215–998.970 |

The actual mapping count equals the selected busy-thread count in every cell.
The measured total matches `TIDs × (data pages + 1 metadata page) × 4,096`.
For example, 32 TIDs with 16 data pages map **2,228,224 bytes**, comprising
2,097,152 data bytes and 131,072 metadata bytes. It is not one 65,536-byte
buffer shared by the process. Changing worker count changes aggregate storage
and event volume even when the per-thread setting stays constant.

Recorded ages relative to the monotonic timestamp immediately before sending
SIGUSR2:

| Workers / Hz / pages | Oldest retained sample age range, s | Newest sample signed age range, ms |
| --- | --- | --- |
| 16 / 99 / 1 | 0.459977–0.460925 | 5.441–6.389 |
| 16 / 99 / 4 | 1.873612–1.875074 | 4.839–6.388 |
| 16 / 99 / 16 | 7.511780–7.512005 | 5.965–6.891 |
| 16 / 999 / 1 | 0.045296–0.046539 | 0.251–0.637 |
| 16 / 999 / 4 | 0.185328–0.186005 | 0.108–0.786 |
| 16 / 999 / 16 | 0.744157–0.745506 | 0.398–0.869 |
| 32 / 99 / 1 | 0.456545–0.548839 | 0.116–11.938 |
| 32 / 99 / 4 | 1.873222–2.203787 | 0.012–11.820 |
| 32 / 99 / 16 | 7.513418–7.979107 | 0.527–11.142 |
| 32 / 999 / 1 | 0.045052–0.053793 | -0.004–1.528 |
| 32 / 999 / 4 | 0.185213–0.241765 | 0.008–1.801 |
| 32 / 999 / 16 | 0.743865–0.902268 | 0.054–1.006 |

One newest sample is about four microseconds **after** the trigger-send
timestamp (a signed age of roughly −0.004 ms). The runner preserves it rather
than clamping it away: signal delivery/snapshot handling is not instantaneous.
These observations do not establish an exact snapshot boundary or a universal
“last N seconds” window.

### Wrap evidence and lower bounds

Kernel ring-header counters could not be read through the optional read-only
owned-perf `/proc/<pid>/mem` probe: it returned **EIO**. No policy was changed
and no alternative privileged read was attempted. The report therefore does
not claim directly observed head/tail wrap counters.

Wrap classification instead uses each TID's retained raw SAMPLE record bytes
against its known actual ring data capacity, and whether early timestamps are
absent. Full histories contain 46/186/744 mostly 88-byte SAMPLE records at
1/4/16 pages, leaving less than one record of space, with the oldest samples
well after collection began. These are strong **inferences of wrap**, explicitly
labelled as such in the JSON.

There is a material exception: **32 workers, 99 Hz, 16 pages** has three rings
with 723, 736 and 737 samples, whose first samples are still about 22 ms after
collector startup. They are not full. Their observed ~7.97-second spans are
**lower bounds on retention, not measured capacities**. The other 29 TIDs in
that cell have full retained histories, but one starts only 89 ms after
collector startup: its wrap is **uncertain**, rather than forced into the
wrapped category. The remaining 28 meet the full-record/late-start inference.
A global earliest-to-latest process
span would hide this difference; use the per-TID evidence.

No LOST records or LOST_SAMPLES counters appeared in these overwrite trials.
That does **not** mean full coverage: older history is intentionally overwritten
and its omitted count is unknown. The FP ancestry limitation above also remains
in force throughout this FP matrix.

## Resources and boundaries

Before-trigger collector RSS observations range from **18,424 to 18,720 kB**.
These are `/proc/status` observations, separate from mapped ring bytes; they
must not be added together as if independent allocations. Accounted collector
child CPU during each eight-second record is **0.021951–0.069234 CPU seconds**,
with exact user/system values in the JSON. This measures collector child CPU,
not target slowdown, total system cost, parse cost or UI responsiveness.
Finalisation and decoder memory peaks are not established by the before-trigger
RSS observations. No unprofiled matched-throughput baseline was run.

Every target survived collector Stop as the same PID/start-time incarnation,
then all workers completed normal stdin shutdown. Every cell preserves exact
command lines, perf exit status, raw-file hash and per-worker CPU ticks.
The requested rate was sometimes lower in wall time, especially with 32 busy
threads: for instance a short 999 Hz ring measured as low as ~767 samples per
wall second. This is reported, not silently replaced with the requested value.
Whole-trial CPU occupancy and short retained spans have different boundaries;
they are not used to invent exact per-window overhead or causality.

## Gates

| Gate | Result | Boundary |
| --- | --- | --- |
| FP main / separate no-FP debug library / runtime load | PASS | 256 generated functions plus entry; real ELF/debug/build evidence |
| DWARF recovers constructed cross-module ancestry | PASS | All 590 samples in this declared native fixture and stack setting |
| FP provides complete cross-module ancestry | FAIL | Expected limitation demonstrated: real generated ancestors and FP caller disappear |
| 16 and 32 all-busy-worker capture | PASS | Every selected TID sampled, positive work count, explicit identity |
| Per-TID retention timestamps/counts/rates | PASS | Twelve serial single trials with complete per-TID JSON |
| Actual per-thread mappings / aggregate bytes | PASS | Exact map count and bytes observed, not assumed process-wide |
| Direct ring head/tail counters | NOT TESTED | Read-only proc memory probe returned EIO |
| Wrap / capacity interpretation | PARTIAL | Full-record/time inference; three unfilled histories explicitly lower bounds and one full history with uncertain wrap |
| Safe collector Stop / no target signals / policy unchanged | PASS | Same target incarnation alive, normal shutdown, unchanged sysctls |
| Positive LOST handling | NOT TESTED in this matrix | Earlier 652-loss diagnostic remains separate; overwrite is not zero truncation |
| Matched workload overhead / full finalisation/decoder memory | NOT TESTED | Collector observations are not a slowdown verdict |
| UI / Unity / managed/JIT / 200k symbol scale | NOT TESTED | Outside this qualification; UI on hold |
| Flight-recorder product delivery | NOT TESTED | Separate future user decision, no duration guarantee approved |

These results qualify a narrower native configuration and expose its limits.
They do not authorise flight-recorder delivery, remove the UI hold, or turn
unresolved/skipped frames into complete attribution.

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
