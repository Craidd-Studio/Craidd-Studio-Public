# Unity profiling — UI/UX harness checklist

**Roadmap track:** Phase 3.x / 3.5, Unity attach and profiling acceptance.

**Status:** Open, 16 October 2026. Requested reviewer: Opus 5.5. No Opus review has run.

**Master checkbox:**

- [ ] **Unity profiling is usable through the real Craidd UI:** complete the critical checks below and publish a report with screenshots, measured values, remaining failures and exact revision.

The user's standard is the compact, organised Visual Studio 2019 diagnostics
panel, informed by Rider and VS Code. Keep that agreed direction. This is an
implementation and usability review, not a new design exercise.

Read the [review brief](../handoffs/handoff-unity-profiling-uiux-2026-10-16.md),
[initial findings](../bugs/16-10-2026/unity-profiling-uiux-report.md),
[Gold contract](../feats/profiling/design-gold-capture.md) and
[fixture instructions](../../workspaces/unity/README.md).

## Harness and evidence

This branch currently has `tests/ui/profiling.html`, which mounts production
components with synthetic data and mocked IPC. The real Tauri WebDriver harness
was found in another checkout at revision `280b1d8`, under `tests/ui/` with its
design in `docs/uiux/design-ui-test-harness.md`. It is absent from this branch.
Integrate the applicable harness before claiming a real desktop harness pass;
run it against the current profiling implementation, not that older checkout's
binary. Preserve unrelated work in that checkout.

- [ ] **U00 — Harness integration (critical):** a real-app Unity profiling scenario is runnable from this branch; exact command, app revision, test revision and environment are recorded. A browser fixture is explicitly labelled synthetic.
- [ ] **U01 — Reproducible evidence (critical):** report Unity version, Editor PID/start identity, plugin build/reload identity, Craidd build, display scaling, panel width and window dimensions. Capture screenshots after state transitions. Separate source inspection, automated assertions, real runtime results and user observations.

Every checkbox needs a result entry using its ID. Leave failed, blocked and
unrun items unchecked. A compile or a mocked event is insufficient for a live
runtime checkbox. Do not alter user logs, credentials, saved settings or unsaved
Unity scenes to make a test pass. Use disposable projects where a test needs
mutation; never replace the user's live profiling owner with a harness owner.

## Visible and understandable controls

- [ ] **U02 — Toolbar rendering (critical):** Attach, Snapshot, Snapshot and record again, Stop, and Settings have visible graphics/text in the actual Tauri webview. Test cold startup, no editor open, editor open, dev and embedded builds. Verify font/asset/CSP failures rather than relying on Monaco's incidental styles. Accessible names and tooltips alone do not pass visual acceptance.
- [ ] **U03 — Panel layout (critical):** inspect 288, 360 and 420 px panel widths at a recorded window height and normal desktop scale. Controls, tabs, metrics and collapsible headers remain readable and reachable; no accidental horizontal scrolling, overlap or oversized blank sections. Include keyboard focus and disabled states.
- [ ] **U04 — State and guidance:** Idle, Ready for Play, Live, Snapshot, Disconnected and Stopped are understandable. Process gauges and prepared Gold coverage are distinguished. Empty views explain the next useful action. Selecting a snapshot clearly freezes the view and provides an obvious return to Current session.

## Attach and Gold results

- [ ] **U05 — Unity-first attach (critical):** open Unity before Craidd; find the main Editor for `workspaces/unity`, including Hub hard-linked executable names. Asset-import workers are ordinary helper targets, not matching Editors. Preselect only an unambiguous matching Editor; attachment remains an explicit action. Reject PID reuse/stale targets.
- [ ] **U06 — Profile only (critical):** the selected Editor discovers prepared hooks without a launch environment variable. CPU-time/RSS graphs update, and connected source coverage is visible. Profile only does not pause Unity or attach a debugger. Stop profiling leaves the foreign process running.
- [ ] **U07 — Marker meaning (critical):** the UI distinguishes compiled fixture hooks from gutter intent requiring a prepared/rebuilt source. Gold markers record automatically and never act as user execution breakpoints. Unity C# attach/LDI support is not inferred from a native hook or LLDB attach.
- [ ] **U08 — Benchmark selection:** one Solo is the initial overview; a deliberate range selection stays selected as more hits arrive. All benchmarks remain available in the dropdown. A Solo shortcut returns to the overview. Missing Solo and no-hit cases are usable.
- [ ] **U09 — Collapsibles:** Gold lists Recorded hits/segments compactly; expanding an entry exposes its thread, batch, duration/status and memory values. New hits do not reset unrelated selection or expansion. The panel remains usable with large histories.

## Native memory: prove the complete path

- [ ] **U10 — Unity action executes (critical):** in Play, choose Unity's top menu Craidd → Probe → Allocate retained native 1 MiB. Record the actual native before/after values, immediate Inspector update and `[Craidd Probe]` Console/log entry. If clicking gives no feedback, diagnose callback dispatch, loaded assembly, exceptions and logging. Do not tick this from a separate native process test.
- [ ] **U11 — Craidd receives retained allocation (critical):** correlate U10 with an authenticated source allocation and the selected benchmark. With a clear baseline and no periodic retained allocations, Still live increases by 1,048,576 bytes. Record Solo and the allocation range separately; never sum nested cohorts as unique heap usage.
- [ ] **U12 — Clear and snapshot comparison (critical):** take a retained snapshot, return to Current session, clear through Unity's Craidd → Probe menu, then take another snapshot. Native counter and cohort live bytes return to zero; Freed increases. Earlier snapshots remain unchanged. RSS may stay elevated. If component disable/Play exit frees memory, record that event explicitly.
- [ ] **U13 — Coverage limits:** memory is described as instrumented native allocation cohorts plus process RSS. Managed heap objects, retention paths, GC events, heap dumps and allocation stacks remain unavailable unless a real collector is delivered and qualified. GPU/hardware cycles remain labelled planned/unavailable.

## Lifecycle and sustained use

- [ ] **U14 — Repeated Play (critical):** Stop Play closes captures and retains results/ownership as Ready for Play. Next Play creates a new batch without another Attach. Explicit Stop/close disarms collection; target exit/reuse invalidates ownership.
- [ ] **U15 — Record again:** Snapshot and record again creates an immutable snapshot and a new recording segment/batch without losing benchmark names. Document cohort attribution across the boundary, including frees belonging to an older segment. Disable the action while waiting for Play.
- [ ] **U16 — Disconnect/reconnect (critical):** force a provider disconnect in a disposable run. Open captures become incomplete; reconnection permits fresh Solo/ranges and native allocations, with honest coverage status. Connected must not imply that a closed Solo is still recording.
- [ ] **U17 — History limits (critical):** run beyond the 2,000-capture and 2,400-sample bounds. New captures, allocations, later frees, Play and Record again continue working. Distinguish expected rolling-history eviction from malformed/lost source events in the UI; a normal bounded window must not imply every capture is corrupt.
- [ ] **U18 — Threads and CPU:** thread/batch filters affect Gold inspection and preserve selection. They do not freeze other threads or filter whole-process gauges. CPU time is not described as hardware cycles; debugger pauses are explicit in wall-time interpretation.

## Required report and handback

- [ ] **U19 — Findings and repair report (critical):** list each failure with severity, reproduction, expected/actual behavior, evidence file and relevant source. For each repair include commit, before/after evidence and regressions run. End with pass/fail/blocked/unrun counts, remaining usability blockers and a short user testing sequence. Identify the actual reviewer/model; never attribute local findings to Opus without its response.

The master checkbox stays open while any critical item is failed, blocked or
unrun. Noncritical gaps need explicit user-visible limitations. The report must
say whether this is useful for the current native test fixture; it must not
broaden that to Unity managed debugging or a public-release qualification.

---

*Last updated: Phase 3.x / 3.5, 16 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
