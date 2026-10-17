# Unity profiling — UI/UX harness checklist

**Roadmap track:** Phase 3.x / 3.5, Unity attach and profiling acceptance.

**Status:** Native fixture evidence updated 17 October 2026.
The [scope follow-up](../bugs/17-10-2026/profiler-scopes-report.md) records the
subsequent approved navigation changes and separate human manual evidence.
Results below describe the earlier repair gate, not complete profiler acceptance. The user supplied
an independent Claude Opus 5.5 review; Codex implemented and reran the repairs.
See the [final repair report](../bugs/16-10-2026/unity-profiling-final-report.md).
Four entries retain unproved clauses; the master checkbox stays open.
The later scope follow-up additionally found a **failed ten-minute uncapped
zero-loss check** (15 missing source events). Its retained sample bound held;
sustained-load zero-loss qualification remains open. Earlier passing clauses
below are historical evidence, not a claim that this new failure passed.

For the next joint human/UI review, use the
[detailed Unity acceptance runbook](unity-profiling-manual-acceptance-checklist.md).
It includes the new Profiling editor host and starts with fresh unchecked tasks;
the historical results in this file must not prefill it. The later
[language extension plan](profiling-language-extension-plan.md) keeps C++, C#,
managed LDI and Rust/live-native qualification separate.

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

The real Tauri WebDriver harness is deliberately imported from `uiux/ui-harness`
at `280b1d8`; integration is `64674d4` with synchronization `98f16aa` and dead-driver cleanup `eaf6851`.
Run `npm run test:ui:build`, then `npm run test:ui:profiling`.
`npm run test:ui:profiling:long` adds the ten-minute sample-ring run.
`tests/ui/profiling.html` remains a separate synthetic/mock presentation fixture.
Actual app/code revisions, copied-source/plugin hashes and runtime measurements
are recorded in the report and its portable evidence. No other checkout was
modified or merged wholesale.

- [x] **U00 — Harness integration (critical):** a real-app Unity profiling scenario is runnable from this branch; exact command, app revision, test revision and environment are recorded. A browser fixture is explicitly labelled synthetic.
- [x] **U01 — Reproducible evidence (critical):** report Unity version, Editor PID/start identity, plugin build/reload identity, Craidd build, display scaling, panel width and window dimensions. Capture screenshots after state transitions. Separate source inspection, automated assertions, real runtime results and user observations.

Every checkbox needs a result entry using its ID. Leave failed, blocked and
unrun items unchecked. A compile or a mocked event is insufficient for a live
runtime checkbox. Do not alter user logs, credentials, saved settings or unsaved
Unity scenes to make a test pass. Use disposable projects where a test needs
mutation; never replace the user's live profiling owner with a harness owner.

## Visible and understandable controls

- [x] **U02 — Toolbar rendering (critical):** Attach, Snapshot, Snapshot and record again, Stop, and Settings have visible graphics/text in the actual Tauri webview. Test cold startup, no editor open, editor open, dev and embedded builds. Verify font/asset/CSP failures rather than relying on Monaco's incidental styles. Accessible names and tooltips alone do not pass visual acceptance.
- [x] **U03 — Panel layout (critical):** inspect 288, 360 and 420 px panel widths at a recorded window height and normal desktop scale. Controls, tabs, metrics and collapsible headers remain readable and reachable; no accidental horizontal scrolling, overlap or oversized blank sections. Include keyboard focus and disabled states.
- [ ] **U04 — State and guidance:** Idle, Ready for Play, Live, Snapshot, Disconnected and Stopped are understandable. Process gauges and prepared Gold coverage are distinguished. Empty views explain the next useful action. Selecting a snapshot clearly freezes the view and provides an obvious return to Current session.

## Attach and Gold results

- [ ] **U05 — Unity-first attach (critical):** open Unity before Craidd; find the main Editor for `workspaces/unity`, including Hub hard-linked executable names. Asset-import workers are ordinary helper targets, not matching Editors. Preselect only an unambiguous matching Editor; attachment remains an explicit action. Reject PID reuse/stale targets.
- [x] **U06 — Profile only (critical):** the selected Editor discovers prepared hooks without a launch environment variable. CPU-time/RSS graphs update, and connected source coverage is visible. Profile only does not pause Unity or attach a debugger. Stop profiling leaves the foreign process running.
- [x] **U07 — Marker meaning (critical):** the UI distinguishes compiled fixture hooks from gutter intent requiring a prepared/rebuilt source. Gold markers record automatically and never act as user execution breakpoints. Unity C# attach/LDI support is not inferred from a native hook or LLDB attach.
- [ ] **U08 — Benchmark selection:** Full session is the default (superseding earlier automatic Solo focus); Solo is selectable; a deliberate range selection stays selected as more hits arrive. All benchmarks remain available in the dropdown. A Solo shortcut returns to the overview. Missing Solo and no-hit cases are usable.
- [x] **U09 — Collapsibles:** Gold lists Recorded hits/segments compactly; expanding an entry exposes its thread, batch, duration/status and memory values. New hits do not reset unrelated selection or expansion. The panel remains usable with large histories.

## Native memory: prove the complete path

- [ ] **U10 — Unity action executes (critical):** in Play, choose Unity's top menu Craidd → Probe → Allocate retained native 1 MiB. Record the actual native before/after values, immediate Inspector update and `[Craidd Probe]` Console/log entry. If clicking gives no feedback, diagnose callback dispatch, loaded assembly, exceptions and logging. Do not tick this from a separate native process test.
- [x] **U11 — Craidd receives retained allocation (critical):** correlate U10 with an authenticated source allocation and the selected benchmark. With a clear baseline and no periodic retained allocations, Still live increases by 1,048,576 bytes. Record Solo and the allocation range separately; never sum nested cohorts as unique heap usage.
- [x] **U12 — Clear and snapshot comparison (critical):** take a retained snapshot, return to Current session, clear through Unity's Craidd → Probe menu, then take another snapshot. Native counter and cohort live bytes return to zero; Freed increases. Earlier snapshots remain unchanged. RSS may stay elevated. If component disable/Play exit frees memory, record that event explicitly.
- [x] **U13 — Coverage limits:** memory is described as instrumented native allocation cohorts plus process RSS. Managed heap objects, retention paths, GC events, heap dumps and allocation stacks remain unavailable unless a real collector is delivered and qualified. GPU/hardware cycles remain labelled planned/unavailable.

## Lifecycle and sustained use

- [x] **U14 — Repeated Play (critical):** Stop Play closes captures and retains results/ownership as Ready for Play. Next Play creates a new batch without another Attach. Explicit Stop/close disarms collection; target exit/reuse invalidates ownership.
- [x] **U15 — Record again:** Snapshot and record again creates an immutable snapshot and a new recording segment/batch without losing benchmark names. Document cohort attribution across the boundary, including frees belonging to an older segment. Disable the action while waiting for Play.
- [x] **U16 — Disconnect/reconnect (critical):** force a provider disconnect in a disposable run. Open captures become incomplete; reconnection permits fresh Solo/ranges and native allocations, with honest coverage status. Connected must not imply that a closed Solo is still recording.
- [x] **U17 — History limits (critical):** run beyond the 2,000-capture and 2,400-sample bounds. New captures, allocations, later frees, Play and Record again continue working. Distinguish expected rolling-history eviction from malformed/lost source events in the UI; a normal bounded window must not imply every capture is corrupt.
- [x] **U18 — Threads and CPU:** thread/batch filters affect Gold inspection and preserve selection. They do not freeze other threads or filter whole-process gauges. CPU time is not described as hardware cycles; debugger pauses are explicit in wall-time interpretation.

## Required report and handback

- [x] **U19 — Findings and repair report (critical):** list each failure with severity, reproduction, expected/actual behavior, evidence file and relevant source. For each repair include commit, before/after evidence and regressions run. End with pass/fail/blocked/unrun counts, remaining usability blockers and a short user testing sequence. Identify the actual reviewer/model; never attribute local findings to Opus without its response.

The master checkbox stays open while any critical item is failed, blocked or
unrun. Noncritical gaps need explicit user-visible limitations. The report must
say whether this is useful for the current native test fixture; it must not
broaden that to Unity managed debugging or a public-release qualification.

## Result entries, 17 October 2026

**16 passed, 4 partial/unrun, 0 fully failed, 0 blocked.** Partial entries are
unchecked rather than counted as passes. Two separate general IDE harness
cases fail and are recorded in the report; they are outside this native
fixture checklist count. Critical U05/U10 still have unrun clauses, so the
master gate stays open. This is useful native fixture qualification, with no
managed Unity/LDI/public-release claim.

Portable measurements and screenshots are linked from the
[repair report](../bugs/16-10-2026/unity-profiling-final-report.md#measurements-and-commands).
The measurement JSON identifies exact artifact directories; step names below
refer to each scenario's `record.json`.

| ID | Result and evidence |
| --- | --- |
| U00 | **Pass.** Deliberate import `64674d4`; real embedded app, five opt-in scenarios, shared WebDriver library, script-driven disposable Editors, namespaces and PID/birth/ancestry proof. Synthetic fixture explicitly separate. |
| U01 | **Pass.** Portable measurement/source manifests give Unity version, historical copy PID/birth, plugin SHA, app binary SHA, source revision, viewport/DPR, requested and measured widths. State-transition screenshots are retained. |
| U02 | **Pass.** Real embedded and development URL, cold/no file and Monaco open. Four SVG controls measure 16×16 with painted stroke; Attach text visible. Monaco CSP violations are recorded separately; no CSP change. |
| U03 | **Pass for native fixture.** Summary/Memory at actual 288/360/420 outer widths, 1280×800 DPR 1; no horizontal overflow. Keyboard Tab reaches Record again; disabled cold/Ready states recorded. Shell/multi-monitor behavior is outside this check. |
| U04 | **Partial.** Idle, Ready, Live, explicit Snapshot review/Live return and Stop are exercised. Recovery/coverage warnings are proved; a dedicated readable Disconnected-state UI check remains unrun. |
| U05 | **Partial.** Real Unity-first matching copy is preselected; Profile only is explicit. Hard-link/worker exclusion has backend regression evidence. Every stale/ambiguous dialog state and PID-reuse UI rejection was not driven; no interaction with the user's Editor. |
| U06 | **Pass.** No socket launch variable; real authenticated provider and CPU/RSS update. Explicit Stop leaves the same disposable Editor playing. See first-play, second-play, final-profile and target identities. No debugger attach/stop commands are used. |
| U07 | **Pass.** Settings shows compiled-hook/prepared-source distinction and uninstrumented Unity C# warning. Native events arrive automatically; coverage-limits screenshot/text records managed/GPU boundaries. |
| U08 | **Partial for the historical gate.** Solo previously defaulted; the scope follow-up changes default to Full session; deliberate range remains selected with new hits; dropdown lists identities; no-hit idle overview tested. A dedicated ranges-only/no-Solo runtime and the Solo shortcut pointer action remain unrun. |
| U09 | **Pass for bounded retained history.** Real Gold group/hit expansion shows thread, batch, status, CPU and memory. More hits leave chosen benchmark/group open; large raw histories remain limited to retained per-marker hits. |
| U10 | **Partial.** Real `ExecuteMenuItem` in each disposable Editor succeeds; direct native bytes and actual `[Craidd Probe]` logs correlate. Graphical overlay visibly repaints. Immediate Inspector repaint and physical pointer clicks on overlay buttons were not tested; original live-session silence remains untouched. |
| U11 | **Pass.** Menu allocation gives exact 1,048,576 direct native bytes and retained bytes in both Solo and allocation-range cohorts. Periodic allocations disabled for comparison; inclusive sums are not treated as unique heap. |
| U12 | **Pass.** Two real menu snapshots show earlier 1.00 MiB unchanged and later 0 B; saving remains Live, explicit review/Live return works, Freed rises. Play-disable cleanup is logged and retained ownership is tested across boundaries. |
| U13 | **Pass.** Memory/Settings state native cohorts/RSS, managed heap/GC and heap objects/stacks unavailable, GPU/hardware cycles planned. This proves truthful scope labels, not delivery of those collectors. |
| U14 | **Pass for prepared native Editor flow.** Stop Play retains active context as Ready; next Play opens higher generation/batch without Attach. Explicit Stop revokes route. PID-incarnation invalidation has backend checks; arbitrary plugin reload is not qualified. |
| U15 | **Pass.** Real Record again saves a snapshot, opens a new Solo segment/batch; older retained cohort receives its later free. Rust all-pinned regression leaves active recording intact and reports admission failure. Ready disables the action. |
| U16 | **Pass.** Forced disconnect closes interrupted Solo; reconnect creates fresh Solo and records another allocation. Late free reaches old pinned cohort. Coverage interruption is retained. Verified harness-owned host SIGKILL removes route/socket; replacement reconnects to same copy PID without restart. |
| U17 | **Pass with revision limit.** Real uncapped run rolls past 2,400 samples and millions of raw captures; allocation/free/repeated Play still work with 0 source gaps/rejections/disconnects. Long run occurred during implementation; final build has short runtime checks plus unit edge regressions, not another ten-minute run. |
| U18 | **Pass for native inspection.** Real worker-thread/batch selection filters visible Gold hits while other native threads keep producing hits. Whole-process charts remain labelled CPU time/RSS; filter tooltip says it does not suspend threads. DAP pause presentation is source/regression-checked, not a new Unity debugger-pause qualification. |
| U19 | **Pass.** Report separates supplied Opus findings, user observations, Codex runtime evidence, source/unit proof, repairs/commits, commands, screenshots, partial checks, unrelated failures, limits and user test sequence. |

## Phase 2 shared-scope follow-up (automated evidence)

These checks refer to the [Phase 2 report](../bugs/17-10-2026/profiler-scopes-report.md),
not a new human acceptance claim. They leave the master checkbox open.

- [x] **P01 — Shared scope:** Full session, Gold/Solo and all tabs use the same time window; process CPU/RSS retain their process-wide semantics. Resolver edge tests and real interval/chart sample counts prove this.
- [x] **P02 — Completion:** selected Gold/Solo keeps its ID and fixed boundaries when Recording becomes Recorded, including a subsequent automated Play generation. Frozen End memory differs correctly from later free/survivor observations.
- [x] **P03 — Separate selectors:** Scope lists a marker once; individual retained hits use history/Focus or timeline. Global snapshot history contains saved moments, with related snapshots grouped first and one-click Live return.
- [x] **P04 — Active associations:** one live snapshot identity is shared by overlapping active recordings regardless of historical viewing scope. Completed selected recordings receive no new association. Multiple associated snapshots remain accessible after completion.
- [x] **P05 — Review and retention:** snapshot capture preserves selected source/scope/tab, including the explicitly reviewed saved moment at the unchanged eight-view bound. Oldest other views are evicted.
- [x] **P06 — Missing history:** selected-hit eviction stays explicit, with no silent replacement or Full-session chart fallback. Unit tests also cover unknown End, sub-poll ranges and partial sample history.
- [x] **P07 — Compact access:** real keyboard scope selection, timeline/history focus and all four tabs at 288/360/420 px widths pass without horizontal overflow. Saved history remains independently selectable.
- [ ] **P08 — Sustained uncapped zero-loss:** ten-minute run detected 15 missing source events. Bounded retention held; zero-loss qualification and regression attribution remain open.
- [ ] **P09 — Physical pointer follow-up:** independently verify scope switching with the mouse after returning from snapshot history. WebDriver option-level activation was unreliable; the qualified scope scenario uses real keyboard input and rendered identity assertions.
- [ ] **P10 — Human replay acceptance:** Stop Play → Play again without reattaching remains NOT EXPLICITLY VERIFIED by the human. Automated replay does not tick this box.

---

*Last updated: Phase 3.x / 3.5, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
