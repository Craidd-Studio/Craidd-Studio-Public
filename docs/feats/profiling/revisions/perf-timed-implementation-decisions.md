# GR-002 timed capture: implementation decisions

**Roadmap track:** Phase 3.5 profiling.
**Status:** Accepted scope, 22 October 2026. The backend checkpoint and qualification are recorded in [results](perf-timed-backend-results.md). UI design remains under review; this document does not claim desktop acceptance.
**Branch:** `codex/profiling-perf-timed`, stacked on local M1 commit `5039abf`.

## Accepted first delivery

The existing **Profile only** target supplies a PID and start tick. Captures use
`cpu-clock:u`, explicit user callchains, existing threads only, and a separate
monotonic clock domain. CSV rows, process observations and stacks remain separate
types under the [source contract](../design-profile-source-contract.md).

Defaults are 99 Hz (approximately 10 ms/sample per busy thread), 10 seconds,
maximum 120 seconds. 999 Hz (approximately 1 ms) is selectable; higher rates are
refused pending overhead qualification. FP and DWARF are explicit choices.
DWARF stack size is either 8,192 or 16,384 bytes. There is no automatic fallback.
Before capture, show the configuration, existing TID count and estimated output
cost. Sampling can miss a short spike at either frequency.

The initial scope is native timed capture, top-down/bottom-up trees, thread,
module and capture-time filters, unresolved frames, loss accounting and safe
Stop. Percentages use sampled-event weights, never exact function duration.
Module filtering is a display lens. Source navigation needs a verified solution
file and matching debug information. Do not infer a project/module binding.

Each capture owns its collector and a directory in Craidd's cache, namespaced
by canonical solution path. Keep the latest ten unpinned captures; pinning
preserves older captures. Stop, window close, IDE shutdown, collector failure and
target exit preserve partial output and address only the owned collector.
An active tracer blocks capture; internal LLDB attachment must also refuse an
active perf capture until coexistence is qualified. No policy/capability changes,
privileged execution or implicit debuginfod access are permitted.

Existing threads are listed with TID/start tick. Poll `/proc` for newly observed
threads during capture, record the poll interval and count, and explicitly state
that short-lived threads between polls can be missed. New threads are not added
silently. A changed target incarnation invalidates attribution rather than
moving the result to the new process.

## Proposed raw-output limit

**Proposed: 512 MiB per capture**, with a 32 MiB finalization reserve, early size monitoring and an OS file-size
limit on the collector. Reaching the cap marks the capture PARTIAL even when the
remaining data decodes. The cap includes final perf metadata; a capped file can
be incomplete and must retain that diagnostic. It never silently discards loss.

The earlier 8 KiB DWARF fixture wrote 2,730,260 bytes for 319 samples, about
8,559 bytes/sample. At 32 busy threads, 99 Hz and 10 seconds, that extrapolates to
about 259 MiB. A 16 KiB stack increases the estimate by 8,192 bytes/sample;
32 busy threads at 999 Hz can reach the proposed cap in about one second.
These are output-cost estimates, not overhead measurements or guarantees.
Record actual bytes and sample counts for both stack sizes before UI acceptance.

The separate parsed-data bounds are explicit: retained sample/frame budgets and
bounded diagnostic examples. Any omitted samples mark the result PARTIAL. Raw
data is retained for external tools and later parsing. A query returns a bounded
tree branch rather than serializing the complete sample set to the UI.

## Review gates and deferred work

Parsing, native lifecycle/recovery, symbol resolution, desktop behaviour and
human usability are separate PASS / FAIL / PARTIAL / BLOCKED / NOT TESTED gates,
with machine, perf version, source build and fixture recorded. A backend harness
does not pass desktop behaviour. No UI implementation starts before review of
the user's ChatGPT design. Keep commits local until human acceptance.

Flight recording stays **proposed**, outside the product slice. Measure per-TID
ring retention with 16 and 32 busy threads at 99 and 999 Hz before a decision.
JIT maps, symbol-scale qualification and flame graphs follow this slice. M2 live
CSV follow and M3 clock mapping/comparison wait behind GR-002.

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
