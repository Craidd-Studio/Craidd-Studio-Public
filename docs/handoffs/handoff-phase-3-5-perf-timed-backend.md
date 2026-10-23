# Phase 3.5 handoff: timed perf backend, UI pending

**Roadmap track:** Phase 3.5 profiling.
**Status:** Local backend checkpoint, 22 October 2026. No push or merge authorized.

Craidd Studio is a Linux IDE for linked projects and debugging. Profiling sources
must expose their actual clocks, coverage, provenance and limits; a passing
native harness does not establish desktop or human acceptance.

## Current state

Branch `codex/profiling-perf-timed` is stacked on M1 commit `5039abf` from
`codex/profiling-metric-csv-m1`. M1's automated gates and its human-usability
failure remain distinct. Two existing dirty M1 documents were preserved and
excluded from the perf checkpoint: `gr-001-m1-results.md` and
`gr-001-m1-uiux.md` under `docs/feats/profiling/revisions/`.

The approved perf core and window-scoped IPC now provide native timed capture,
separate stack payloads, weighted top-down/bottom-up branches and filters,
verified source locations, partial/loss states, raw cache retention/pinning,
reopening, owner Stop/close/shutdown and debugger refusal hooks. No profiling UI
was built. The user requested a ChatGPT design prompt before UI work; that
prompt was supplied. The supplied HTML visualization stays local; publication
was stopped after the user said they had its file location. No live site URL
was produced.

Read [accepted decisions](../feats/profiling/revisions/perf-timed-implementation-decisions.md),
[backend results and gates](../feats/profiling/revisions/perf-timed-backend-results.md),
[many-thread retention](../feats/profiling/revisions/gr-002-many-thread-retention.md),
the [source contract](../feats/profiling/design-profile-source-contract.md), and
the [fixture README](../../workspaces/profiling-perf-backend/README.md).
The evidence JSON files record the actual build/tool/machine and per-TID data.

## Locked decisions and remaining review

Use `cpu-clock:u`, 99 Hz by default with 999 Hz selectable, 10 seconds by
default and 120 seconds maximum, explicit FP or DWARF 8,192/16,384. State the
on-CPU sample interval and output cost before starting. Existing threads only;
show newly observed threads and observation limits. Separate clocks until M3.
Keep ten unpinned captures per solution plus pins. Never signal the target,
change policy, offer privileged perf, or assume LLDB coexistence.

The user accepted the **512 MiB raw cap and 32 MiB finalisation reserve**,
parsed-data bounds, retention and 100 ms gained-thread polling. State that polling
can miss short-lived threads and FP can miss callers above no-FP modules.
**Flight recording is excluded from this release**: DWARF history costs far more
than the FP matrix, while FP loses callers. The matrix remains evidence.

Read the [follow-up results](../feats/profiling/revisions/perf-backend-follow-up-results.md)
and [matched overhead report](../feats/profiling/revisions/perf-matched-overhead-results.md).
Five alternating repetitions per mode with 16/32 workers completed. Descriptive
median slowdown ranges from −0.063% to 0.473%, with spread and machine conditions
recorded; it is not a correction for production timings. Mono map names resolve
100% of fixture leaf weight versus 0% without a map. .NET remains at 0% even
with a stable map containing sampled IPs: that gate FAILS. Craidd preserves
perf-reported map origin; no alternate JIT mechanism was added. An observed
Mono parser/ELF-guard problem was fixed and qualified.

Actual LLDB-first refusal and the shared perf-first debugger guard pass with a
real adapter. Private module/debug substitutions pass after fixing missing
separate-debug candidate identity reporting. A debug mismatch conservatively
withholds module names/source and marks PARTIAL. Live PID reuse stays BLOCKED
within ordinary-user/no-policy-change constraints; stale-ID tests are distinct.
The user accepted reuse as BLOCKED and authorized large-symbol scale despite
the .NET-specific FAIL. The [23 October scale/diagnostic record](../feats/profiling/revisions/perf-scale-and-dotnet-diagnostic-results.md)
now records 200,000 generated functions with matching separate debug info,
20/20 sampled hot leaves named with source lines, two optimized captures and
two fresh-process reopens without loss. Decoder symbolization/DWARF/parser
wall is 225–275 ms plus 452–503 ms identity checks; parser CPU 4–5 ms. Observed
aggregate decoder peak RSS/PSS is 82.44/68.57 MiB across the two runs, with
separate baseline and kernel high-water scopes recorded. Existing IPC remains
responsive in a real debug Tauri/Xvfb window; no new profiling UI is built.

Exactly one authorized .NET diagnostic with `DOTNET_EnableWriteXorExecute=0`
resolved 100% of fixture leaf weight and removed doublemapper mappings. The
normal .NET gate remains FAIL; no product workaround or automatic retry.
Flame graphs and full JIT delivery are deferred. M2 then M3 remain approved but
wait behind the timed in-IDE slice.

The supplied image is retained in the [metric-inspection editor design](../feats/profiling/design-metric-inspection-editor.md).
It is a credible chart-first candidate inside the existing Profiling editor tab,
not an approved replacement shell or implementation. Statistical labels, axes,
linked selection, responsive layout and accessibility still need review.

Still required: UI design approval and implementation, live Profile only IPC
flow through human-facing capture controls, actual window-close/IDE-exit desktop
tests, another perf version, memory at maximum retention and human usability.
Live PID reuse remains an accepted environmental block, with stale-incarnation
checks retained; it is not a reason to hold the other work. Core close/shutdown tests are not desktop
acceptance. Do not fix M1's separate whole-IDE memory baseline in this slice.

## Next task and opening prompt

Review the documented candidate with the user before changing any UI. The
authorized large-symbol qualification is complete within its stated scope. Once
UI implementation is explicitly released from hold, implement the approved timed-capture surface using the existing backend, preserving CSV's
editor-only host and standard process/Gold's sidebar/editor support. Run and
report the remaining gates individually. Keep all commits local until the user
reports human acceptance.

> Continue the approved GR-002 timed in-IDE slice on codex/profiling-perf-timed.
> First read AGENT.md, docs/working-protocol.md, the current roadmap/model and
> this handoff's linked decisions/results. Preserve dirty M1 usability records.
> The backend is a qualified checkpoint, not a delivered UI. Review my ChatGPT
> UI design before implementation; retain honest clocks, coverage and loss.
> Read the follow-up and 23 October scale report: normal .NET naming FAILS,
> its one W^X-off diagnostic passes, and live PID reuse is accepted BLOCKED.
> UI stays on hold; do not push or merge. Flight recording is excluded from this
> release. The 200k-function fixture passes within scope; full JIT delivery,
> flame graphs and M2/M3 wait.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
