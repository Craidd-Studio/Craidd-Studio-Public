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

The **512 MiB raw cap remains proposed** with measured cap evidence. Flight
recording remains a separate user decision; the new 16/32-busy-thread matrix
includes lower bounds and uncertain wrap, not a last-N-seconds guarantee. FP
ancestry across the no-FP library fails as expected; DWARF recovers the declared
chain. JIT maps, 200k-symbol scale and flame graphs are deferred. M2 then M3
remain approved but wait behind the timed in-IDE slice.

Still required: UI design review and implementation, live Profile only IPC flow,
actual window-close/IDE-exit desktop tests, real LLDB refusal, substituted-module
mismatch, live PID-reuse qualification, a second perf version, overhead/memory
qualification and human usability. Core close/shutdown tests are not desktop
acceptance. Do not fix M1's separate whole-IDE memory baseline in this slice.

## Next task and opening prompt

Review the user's ChatGPT profiler design before changing any UI. Then implement
the approved timed-capture surface using the existing backend, preserving CSV's
editor-only host and standard process/Gold's sidebar/editor support. Run and
report the remaining gates individually. Keep all commits local until the user
reports human acceptance.

> Continue the approved GR-002 timed in-IDE slice on codex/profiling-perf-timed.
> First read AGENT.md, docs/working-protocol.md, the current roadmap/model and
> this handoff's linked decisions/results. Preserve dirty M1 usability records.
> The backend is a qualified checkpoint, not a delivered UI. Review my ChatGPT
> UI design before implementation; retain honest clocks, coverage and loss.
> Do not push or merge. Flight recording, JIT, symbol scale and M2/M3 wait.

---

*Last updated: 22 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
