# Profiler scopes — Phase 2 implementation and verification

**Roadmap track:** Phase 3.5, native Unity profiling and shared result scopes.

**Status:** Phase 2 implemented; automated UI qualification recorded below.
Sustained uncapped zero-loss qualification remains open, 17 October 2026.
Branch `feat/unity/profiling-a-to-p`, starting at `25eaaee`. The approved
[scope contract](../../feats/profiling/design-profiler-scopes.md) preserves the
existing panel, native capture and manual snapshots. This report does not
accept the complete profiler or broaden Unity managed/LDI support.

## User corrections and implemented behaviour

The first combined menu listed individual Gold hits alongside saved snapshots.
The user rejected that clutter during implementation. Its repeated entries
were recordings, not automatic manual snapshots, but the presentation was poor.
The implemented correction is **two separate selectors**:

- Existing snapshot history: saved manual moments and distinctly labelled
  previous-session archives, with a one-click Live return. Saving stays in the
  current view; snapshot review is explicit and immutable.
- Scope: Full session, Solo and each Gold benchmark listed once. Choosing a
  benchmark focuses its latest retained invocation once. Repeated hits remain
  in the existing collapsed history with Focus recording. Timeline clicks use
  the same scope. New hits cannot replace an explicit selected capture.

A selected active Gold/Solo becomes **Recorded** when it ends, retaining the
same capture identity and fixed boundaries across tabs, later data and new
Play generations. Full session is the new default. This supersedes the earlier
automatic Solo focus; Solo remains selectable.

Summary, CPU/RSS, Gold, Memory and Events share one resolver. Scope state is
independent of the active tab and saved-snapshot source. Existing toolbars,
charts, timeline, tabs, manual snapshot comparison and native workflows remain.

The user's further clarification makes associations independent of viewing:
Take Snapshot reads current live observations, even while browsing historical
scopes. Every recording active then receives the same snapshot identity; no
per-recording data copies are created. Completed selected recordings receive
no new association. Associated manual moments survive End within the eight-view
retention bound. The dropdown groups related snapshots first, with all other
manual history and previous sessions accessible. Snapshot capture preserves the
selected tab as well as scope/source. At the eight-view bound, the reviewed
snapshot is retained and the oldest other view is evicted. It remains enabled whenever the current
live process has samples; stopped session data is already retained for review.
Internal Gold boundary observations are separate summaries, not manual snapshots
or heap-object dumps.

## Source changes and commits

| Commit | Change |
| --- | --- |
| `ca0851b` | Frozen End cohort/process observations, native window activity, deduplicated session totals, coverage baselines and bounded timestamped diagnostic bursts. |
| `d5fe68b` | Shared resolver and recording identity, separate snapshot/scope dropdowns, stable completion status, clickable bounded timeline lanes, related-hit focus and scope-aware views. |
| `d683d24` | Controlled nested ranges compiled only into disposable plugins; real Unity scope/retention/layout scenarios; existing regression assertions adapted to Full session. |
| `0624aac` | Active-at-capture snapshot associations, related/global history groups, preserved tab, no completed-view association and unavailable duration for missing open recordings. |
| `bccfab8` | Correct inner-tab assertion; future rolling-history tests save aging-time evidence before the zero-loss assertion. |
| `5c6b733` | Keep reviewed snapshots within the unchanged eight-view bound; verify overflow does not change selection, tab or ruler. |
| `f1facd8` | Keep confirmation text aligned with compact scope captions. |
| `03f87ad` | Use real keyboard scope selection and require actual rendered recording identity. |

Production sources:
[ProfilerPanel](../../../src/components/panels/ProfilerPanel.tsx),
[scope resolver](../../../src/lib/profilingSelection.ts),
[profiling store](../../../src/store/profilingStore.ts),
[collector](../../../src-tauri/src/commands/profiling.rs),
and [compact styles](../../../src/assets/styles/index.css).
The [real scope scenario](../../../tests/ui/unity-scopes.test.mjs) drives the
production webview and real collector; store fixtures are separately labelled
unit evidence. Controlled ranges exist only in a disposable plugin copy, not
in the user's loaded native binary.

## Measurement and retention semantics

Process CPU/RSS within a selected recording still includes unrelated work on
other threads. CPU deltas are calculated before filtering; crossing intervals
are excluded. A short recording may have no process samples. RSS observations
near boundaries retain real baselines and show their age; they are not exact
source-hit RSS readings. Reusing one sample twice cannot prove zero change.

End cohort values are frozen. Later frees continue to update original ownership
and are shown separately as current observed survivors/freed after End. Window
activity includes accepted events on all provider threads, including frees of
older allocations. Full-session native totals count each allocation once rather
than summing overlapping owners. Cohorts remain inclusive. Unknown-size frees
are counted, not assigned invented bytes. Missing metrics show unavailable.

Detailed process history remains a 2,400-sample ring; a retained recording can
therefore have fixed boundary summaries but partial/unavailable chart history.
Capture limits remain 2,000 total and 128 ordinary completed hits per marker,
with Solo/open/live cohorts pinned. Allocation ownership remains capped at
20,000. Saved views remain capped at eight. The new ledger retains 256 diagnostic
bursts and coalesces nearby same-kind events; a crossing burst's count is labelled
as the whole burst count. Session counters stay explicitly global context.

A selected evicted hit stays unavailable with its identity visible and empty
charts; the app does not silently select a newer hit. Live restores the current
full session in one action. Graph subwindows can filter timed observations, but
exact arbitrary-subwindow allocation activity is unavailable without a journal;
whole-recording cohort totals are explicitly identified.

No per-event `/proc` polling, unbounded event journal or full-history copy per
recording was added. Existing publication outside the lock, batched transport,
Play generations, reconnect recovery, capacity safeguards and routing remain.
No native provider protocol, managed heap collector or automatic boundary
snapshot feature was introduced.

## Automated verification — Codex execution

These results are separate from Appendix A. All Unity execution uses newly
spawned disposable copies, explicit test namespaces and native builds inside
those copies. No attach, click, restart, signal or plugin build targeted the
user's live Editor. The original untracked
`workspaces/unity/ProjectSettings/PackageManagerSettings.asset` is preserved.
Its baseline SHA-256 is
`622993c5611db4016b72dbf12de4754a642fa96b071d2fd663cc40253db5764e`.

Commands executed from the repository root:

```sh
CRAIDD_PROFILE_NAMESPACE=scopes-all cargo test --offline --manifest-path src-tauri/Cargo.toml --lib
node --test tests/*.test.mjs
node tests/profiling.test.mjs
npx tsc --noEmit
npm run test:ui:build
CRAIDD_TEST_UNITY=1 node --test --test-reporter=tap tests/ui/unity-scopes.test.mjs
CRAIDD_TEST_UNITY=1 node --test tests/ui/unity-scopes.test.mjs
npm run test:ui:profiling
CRAIDD_TEST_UNITY=1 CRAIDD_TEST_LONG=1 node --test --test-name-pattern='uncapped fps' tests/ui/unity-profiling.test.mjs
```

| Check | Result |
| --- | --- |
| Rust library | 175 pass, 5 ignored, 0 fail. New tests cover frozen End versus late free, older-allocation frees within a new window, unique session totals under nested ownership and bounded diagnostics. |
| Frontend files | 14 pass, 0 fail. Scope/store/render tests include immutable saved moments, stable completion, independent selectors, unavailable history and CPU edge buckets. |
| Scope tests | 25 pass, 0 fail, including overlapping active associations, historical capture and no completed-view association. |
| TypeScript / embedded build | Pass. CSP configuration unchanged. |
| First real scope scenario | Pass: real nested ranges, fixed selected completion, separate snapshots, late free and all-tab compact widths. |
| Six native UI scenarios at `d683d24` | 6 pass, 0 fail (128.737 s): icons with/without file, graphical overlay, 60 fps, uncapped, recovery and shared scopes. Final snapshot-refinement rerun follows below. |
| Intermediate snapshot-refinement attempts | First 3/6 passed with an incorrect outer-tab assertion; corrected 5/6 passed, but option-level scope activation failed after history navigation. Both failed attempts are preserved below. |
| Final application `f1facd8`, harness `03f87ad` | **6 pass, 0 fail**, 124.755 s. Shared-scope scenario 32.908 s; includes related/global groups, overlapping associations, unchanged tabs, eight-view review, timeline/history focus, eviction, new Play and all-tab compact widths. |
| Uncapped rolling-history replication at `d683d24` | **FAIL**, 628.896 s: 15 missing source events at ~458.542 s; zero-loss assertion failed when sample aging was detected. Bound held (2,400 samples); post-roll allocation/clear/replay checks did not run. Native sources unchanged by UI-only `0624aac`. |

Raw local logs are under `/tmp/craidd-scopes-20261017/`; screenshots, source/plugin
hashes, historical copy PID/birth identities and scenario records are under
ignored `test-results/ui/<timestamp>/`. Portable evidence identifies the
qualified runs and hashes below. Real webview evidence is not substituted by
SSR fixtures. Manual test status is never inferred from an automated pass.

The first snapshot-refinement suite had three test failures because its new
unqualified `[role=tab]` selector read the outer **Profiler** tab instead of the
inner Summary/Gold/Memory/Events selection. Runtime assertion output showed
`Profiler` versus `Summary`; the selector was scoped to `.profiler-tabs` in
`bccfab8`, with no application patch for that test error. The failed log remains
`/tmp/craidd-scopes-20261017/ui-associations-final.log`. Subsequent evidence is
reported separately rather than erasing the failed attempt.

The next run passed five existing scenarios but its scope scenario read zero
related snapshots after returning from saved history. A stronger wait then
confirmed no rendered recording selection, even though the native select value
had changed. Real keyboard selection through the same control passed the full
scenario. The harness now waits for the rendered recording ID, not just the
select value. This identifies an option-level automation activation limitation;
it does not prove physical pointer behaviour. No association patch was inferred
from the zero-row symptom. The unit and real keyboard tests independently verify
the active-ID associations. Physical pointer use after history return still
needs human verification.

Failure logs remain `ui-associations-corrected.log` (5/6) and
`ui-scopes-state-wait.log` (0/1) in the same temporary log directory. The
keyboard-targeted pass is `ui-scopes-keyboard.log`.

## Portable final-run evidence

The final embedded application was built at `f1facd8`; the tests ran at
`03f87ad`. Subsequent documentation edits do not change that binary. Its SHA-256
is `3579f347c1e5f3e8eb1c29f35a01bedc105dfbd1d0344ab244143dc838924c5f`.
The [scope measurements](evidence/scope-measurements.json) include source,
plugin and binary hashes; the [native regression measurements](evidence/native-regression-measurements.json)
retain the other five scenarios' targets, counters and state transitions.
The disposable scope Editor PID was 160920 (birth identity is in the measurements),
Unity 6000.5.10f1. Viewport was 1280×800 at DPR 1. Requested panel widths
288/360/420 px measured 287/359/419 content px, each without horizontal overflow
in Summary, Gold, Memory and Events.

The controlled outer recording ran from 1,528.858886 to 3,449.722709 ms.
Its fixed End cohort retained 1,048,576 live bytes; later observed survivors
became 0 after Clear. Its process charts contained seven RSS observations and
six fully contained CPU intervals, not an invented per-function CPU total.
Two saved snapshot IDs were shared by both overlapping Gold recordings; the
global menu contained each identity once. Before retention overflow it had
four manual entries plus Current session, while Scope had six entries including
one scalar marker representing 128 retained hits. Saving eight more moments
kept the reviewed snapshot, tab and ruler unchanged at exactly eight saved
identities. These are automated measurements, not human UI acceptance.

- [Separate scope and snapshot history during recording](evidence/active-scope-separate-history.png).
- [Recorded Memory at 288 px](evidence/recorded-memory-288px.png).
- [Preserved historical review at the eight-view bound](evidence/bounded-history-review.png).

The exact final six-scenario log is
`/tmp/craidd-scopes-20261017/ui-final-qualified.log`. Scope screenshots and full
raw records remain under `test-results/ui/2026-10-17T16-13-08-621Z/unity-scopes/`.
The portable artifacts retain the useful evidence without committing scratch
homes, generated binaries or raw Editor logs.

## Acceptance mapping

| Brief requirement | Evidence type / status |
| --- | --- |
| 1–4: Full session, active Gold, completed End and completed selection | Shared resolver/store tests; real controlled Unity interval and stable selected ID/status. |
| 5–8: scoped CPU/RSS, Memory/Events, tab persistence and Live return | Resolver boundary tests; real charts checked against backend interval/sample count; all four tabs preserve selected ID; Live clears recording scope. |
| 9–12: independent manual snapshots, active recording snapshots, saving without navigation, immutable review/comparison | Store tests and real before-Play snapshot with no Gold, snapshot during nested Gold, saved review after free, one-click return, active overlapping associations and capture from a historical view without navigation. |
| 13–14: completed Solo and Play generations | Store test plus real automated Stop Play → next Play keeps old Solo ID and fixed ruler. Human manual status remains NOT EXPLICITLY VERIFIED. |
| 15: nested/overlapping attribution | Rust native-window/unique-total tests; real nested Gold/Solo receive 1 MiB each while Full session remains 1 MiB. |
| 16: missing/evicted measurements | Unit CPU/retention cases and real selected-hit eviction: identity stays visible, measurements are unavailable, no chart polyline falls back to Full session. |
| 17: existing native Unity flow | Existing short 60 fps, uncapped, recovery and overlay scenarios pass; the separate ten-minute uncapped zero-loss check fails as described below. |
| 18: compact layout | Real Summary/Gold/Memory/Events at requested 288/360/420 px widths and DPR 1; all four tabs have no horizontal overflow in the qualified scope run. |

## Newly observed sustained-load failure

The ten-minute uncapped check is **not a pass**. Its final collection retained
2,400 samples, 17 aged samples, 9,787,485 evicted ordinary hits, zero rejected
events, 15 source gaps and one disconnect. The diagnostic ledger places the
15-event burst at 458,541.600279 ms. The affected Solo closed as
`Incomplete: source events missing`; another Solo segment opened. A disconnect
at 620,720.039243 ms followed the failed assertion during disposable Editor
cleanup; that final counter alone does not establish an unexpected runtime
disconnect. Exact pre-cleanup counters at the first aging predicate were not
saved before assertion, which is an evidence limitation.

The provider uses nonblocking transport and reports missing sequences. That
explains what the counter measures, but it does not establish why this particular
burst was lost. No unproved transport patch or extra blocking on Unity's main
thread was introduced. Regression attribution versus the earlier collector
requires a controlled baseline comparison; a previous short zero-loss run cannot
settle it. Long-duration zero-loss acceptance remains open. The screenshot is
cleanup-time UI evidence, not proof of timely in-UI coverage notification.

See [trimmed measured record and source/plugin hashes](evidence/uncapped-rolling-history.json)
and [cleanup-time screenshot](evidence/uncapped-failure.png). Raw failing TAP
output is `/tmp/craidd-scopes-20261017/uncapped-long.log`.

## Remaining gaps and separate issues

Monaco CSP/style restrictions, explorer context-menu positioning and C# hover
remain separately tracked in the
[earlier report](../16-10-2026/unity-profiling-final-report.md). No CSP approval
or unrelated IDE repair is part of this scope change. The earlier general UI
suite's two failures are not represented as newly passing.

The earlier Unity master checklist remains open. Physical Inspector repaint,
every stale/ambiguous Attach state, remaining debugger qualification and a full
public release are not certified here. Rapid manual snapshots can share a displayed second-level timestamp; their
identities/data remain distinct, but finer display labels are a remaining UX
polish item. Managed heap objects, GC tracing,
allocation stacks, retention paths, GPU/hardware cycles and Unity managed LDI
remain unavailable/unqualified. A native interval is not proof of those features.

The compact timeline displays three non-overlapping lanes with a bounded render
set, always including the selected interval; dense additional hits remain in
history. No causal parent/child relationship is inferred from time overlap.
Shorter-than-polling ranges may correctly show native data with no process chart
samples. Historical summaries do not reconstruct evicted detailed samples.

## Appendix A — Human Manual Verification Report

**Date:** 17 October 2026. **Branch:** `feat/unity/profiling-a-to-p`.
**Environment:** Craidd Studio on Linux, attached to Unity Editor.
**Source:** The user's human-driven testing with screenshots, supplied before
Phase 2. This is separate from Codex's automated results above and does not
claim the new scope implementation was manually accepted.

| # | Human test | Status | Supplied observation |
| --- | --- | --- | --- |
| 1 | Unity Editor attach (Profile only) | PASS | Craidd attached to the running Unity Editor. |
| 2 | Unity Play Mode detection | PASS | Profiler detected Play and displayed active recording state. |
| 3 | Real-time native allocation tracking | PASS | Controlled allocation changed live bytes 0 B → 1.00 MiB; cumulative allocated increased 22.36 MiB → 23.38 MiB. |
| 4 | Manual snapshot creation and clear | PASS | Historical snapshots created; native values responded to allocation/clear. |
| 5 | Historical snapshot selection/comparison | PASS | Previous snapshots remained selectable with distinct historical measurements. |
| 6 | Stop Play → Play again without reattaching | NOT EXPLICITLY VERIFIED | Multiple batches in screenshots do not independently prove the complete sequence. |
| 7 | Profiler UI quality | PASS — INITIAL | Main controls/graphs/tabs/dropdown/segments usable; not acceptance of every UX requirement. |
| 8 | Gold execution and overview UX | PARTIAL | Recordings/segments work; expected unified interval-scoped experience still missing in the tested baseline. |

The user reported that Game-view Allocate 1 MiB gave immediate visible feedback;
native allocated/freed/live cohort values and cumulative Memory measurements
were visible. RSS did not always change immediately or by the same amount,
which is not independently evidence of a defect. Controlled manual testing
resolved the earlier native-allocation concern.

Manual Take Snapshot is useful and must remain independent of Gold. The user
confirmed saved-history access, historical RSS/native values and the exercised
creation/selection/comparison workflow. Gold/Solo segments contain measurements;
the remaining gap was information architecture/navigation, not proof that the
underlying recording mechanism was broken.

The user's remaining manual work includes the unverified Play restart sequence,
new shared-scope acceptance, interval measurement semantics, snapshot regressions
and real compact layouts. The prior 5/5 UI, 172 Rust/5 ignored, frontend passes,
16 proved/4 partial checklist and 2/2 general IDE results were Codex-reported
results, not independently reproduced by that human test.

**Acceptance boundary:** substantial existing native behaviour was manually
verified, but the complete profiler is not fully accepted. New automated scope
passes cannot change this human acceptance boundary.

---

*Last updated: Phase 3.5, 17 October 2026. Author: ShinkuKira21.*
*This document is a record.*
