# GR-002 backend follow-up decisions

**Roadmap track:** Phase 3.5 profiling.
**Status:** Accepted direction, 22 October 2026. Backend-only qualification; UI remains on hold. Extends the accepted local checkpoint `82cbf47`.

## Accepted checkpoint and limits

The user accepted the 512 MiB raw cap, 32 MiB finalisation reserve and collector
file-size limit. Reaching the cap remains PARTIAL with its reason. Parsed-data
bounds, ten unpinned captures plus pins per solution and 100 ms gained-thread
polling are accepted. The UI must state that polling can miss short-lived
threads. FP and DWARF remain explicit modes with no automatic fallback. State
plainly: **An FP tree can be missing callers above modules built without frame
pointers.** The runtime-loaded no-FP fixture is evidence for that warning.

## Flight recording: excluded from this release

Flight recording will not ship in this release. Retain the
[16/32-thread matrix](gr-002-many-thread-retention.md) as evidence, not a product
promise. Its FP records were about 88 bytes; the measured 8,192-byte DWARF
records were about 8.5 KB. Record sizes and on-CPU sampling rates vary.
For illustration, five seconds at 32 busy threads and 99 Hz would need about
129 MiB of 8,559-byte records; at 999 Hz about 1.27 GiB, before metadata and
other overhead. FP history is smaller but can omit callers across no-FP modules.
Neither trade-off establishes reliable last-N-seconds retention or guarantees
that sampling observes a brief spike. No flight-recorder UI or product mode is
authorized by the retained experiment.

The [follow-up results](perf-backend-follow-up-results.md) record the completed measurements and remaining failed/blocked gates.

## Required backend gates

1. **Matched overhead:** Measure completed work/second on the many-thread
   workload without a collector, FP 99 Hz, DWARF 8,192 at 99 Hz and DWARF 8,192
   at 999 Hz. Use multiple alternating repetitions, warm-up and actual measured
   work windows. Record pairing, mode order, duration, loss/cap state and machine
   conditions. Report median and spread of paired slowdown, including negative
   observations; do not convert noise into a significance claim. A capped or
   failed collector cannot qualify a whole capture interval.
2. **JIT names:** Build a small .NET fixture with/without
   `DOTNET_PerfMapEnabled=1`; test Mono with/without `--jitmap` when installed.
   First compare perf's own decoded names and the existing production decode
   path. Report method-resolved sampled weight and denominator. If perf's map
   support works, preserve and label that provenance; build no alternate JIT
   symbol resolver, runtime controller or general JIT feature.
3. **Remaining safety/identity gates:** Exercise actual lldb-dap attachment then
   attempted perf, and perf then attempted debugger attachment; test substituted
   module/debug files; investigate a live PID-reuse race without policy changes.
   If a real reuse cannot be induced safely and repeatably, label that gate
   BLOCKED/PARTIAL with the exact limitation, separate from stale-ID tests.

Large-symbol scale stays deferred until these gates pass. Each result needs
PASS / FAIL / PARTIAL / BLOCKED / NOT TESTED, machine, perf version, build and
fixture. Timings under capture are not treated as unperturbed measurements
before the overhead gate. Keep commits local; no push, merge, sysctl/capability
changes or privileged perf. The [candidate editor design](../design-metric-inspection-editor.md)
is documentation only and does not release the UI hold.

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
