# Public-release readiness: 23 October 2026

**Roadmap track:** Wider Linux IDE gate, Phase 3.x and selected Phase 3.5 work.
**Status:** Assessment complete, 23 October 2026. Not ready for the current public-release gate: failed collection/UI checks and unrun integration/language/package/human gates remain.
**Scope:** Documentation/concept refinement, source inventory, automated builds,
regressions and real desktop harness checks. No feature integration, UI redesign,
commit, push, package publication or new human acceptance is claimed.

## Release judgement

The project has useful implemented capabilities and substantial scoped test
evidence, but no single qualified release candidate. The CSV inspector's
existing human usability failure remains open. Its visual concept passes as a
direction; the chart-first replacement still requires implementation and
interaction/layout acceptance. The current roadmap's external language-server
gate remains unmet. General desktop hover and Explorer-edge checks fail on the
tested Unity/debugger baseline.

Use the [release quality gates](../uiux/public-release-quality-gates.md) and
[refined metric inspection design](../feats/profiling/design-metric-inspection-editor.md)
as the actionable follow-up. No completion percentage is assigned: passing
overlapping tests on different branches is not a combined product result.

## Source and build provenance

These are local observations, not a refreshed GitHub/remote release inventory.
Other worktrees were read or copied; their source and pre-existing dirty files
were not edited. Builds/tests of feature work ran in disposable copies.

| Inspected source | Identity | Meaning |
| --- | --- | --- |
| This checkout / Unity-debugger baseline | `8bac01edf9bf1f0a0b84b55441b5638bc1233a29` | Source includes merged Unity support and standard profiler. Initial index/worktree clean; detached HEAD. |
| Local `master` and `feat/create-project` refs | `ac78384c8ecf7cc83a4a4f2acdf4caa171e07e01` | These refs do not contain the new template wizard. Their existing New Project dialog is the older blank-project flow. |
| Actual wizard working copy | `/home/skira24/.codex/worktrees/d667/Craidd-Studio`, base `ac78384` plus dirty/untracked files | Copied with per-file SHA-256 manifest; results apply to that exact working-file snapshot, not the named branch or an integrated release. |
| CSV M1 | `codex/profiling-metric-csv-m1`, `3059ea1cef1a053ed678ba9aae6b6734a6a691ee` | Includes latest program-shaped unit/bulk/key fixes. Original dirty result/UIUX records preserved separately. |
| Timed perf | `codex/profiling-perf-timed`, `464e40748877e6a775c0deba0e770acc1adbb533` | Backend/qualification branch; one metrics-fix commit is outside this branch. UI delivery remains open. |
| Local `public/master` tracking ref | `cd6a8bb9e8ff5865cc3458919528ac1579d59e93` | Cached local reference only; no fetch or public synchronization performed. |

Baseline is 44 commits ahead of local master and 45 ahead of cached public/master.
CSV M1 is two commits ahead of baseline. CSV and timed-perf branches diverge
(one CSV-only, three perf-only commits). The uncommitted wizard additionally
needs reviewed integration. Do not merge these records' PASS rows into a claim
that all capabilities coexist in one binary.

The machine is `sk27`, AMD Ryzen 9 9950X3D, 32 logical CPUs, approximately
60 GiB total RAM, Arch Linux x86-64. Exact kernel, runtime,
dependency versions, build commands and timings are retained in the evidence.
The existing installed npm dependencies were copied to a writable temporary
directory; no dependency install or build mutated another source checkout.
The generated Tauri scaffold was additionally tested with its own declared
TypeScript 5.8 / Vite 7 dependency range.

## Fresh automated results

Test counts are per revision, with repeated/common tests deliberately not
summed. The completed sustained Unity run is recorded separately below.

| Source / check | D result | A result / limitation |
| --- | --- | --- |
| Unity/debugger baseline | 117 frontend tests; 181 Rust library + 7 cleanup integration tests pass, 7 ignored; production frontend and embedded debug build pass | Initial full harness: 8 PASS, 4 FAIL. Quiet targeted Unity repeat: 2/2 PASS. Six opt-in library probes subsequently pass, including real LLDB and disposable Editor discovery/endpoint checks. Standalone sustained run: FAIL with 155 missing events at rollover. Details below. |
| Wizard working-file snapshot | 87 frontend tests; 151 Rust library + 7 cleanup tests pass, 6 ignored; frontend and embedded build pass | Disposable desktop Rust Create/review/open/Run, source breakpoint, Continue and completion PASS after audit-driver focus/readiness corrections. Human judgement and language intelligence remain open. |
| CSV M1 snapshot | 123 frontend tests; 185 Rust library + 7 cleanup tests pass, 7 ignored; 18 production-parser fixture tests pass; frontend and optimized embedded release build pass | 4/4 serial desktop checks PASS on optimized release/Xvfb: import/integrity/join/snapshot/cancel/scale, scoped UX/navigation, 120 operation observations and owning-window recovery. Human usability FAIL remains open. |
| Timed-perf snapshot | 120 frontend tests; 204 Rust library + 7 cleanup tests pass, 7 ignored; frontend build pass | Earlier bounded backend/native/IPC qualification reviewed, not rerun as a complete desktop feature. |

The baseline's six normally ignored library probes were exercised explicitly:
build-order real tools, production CMake/LDI driver, recognition latency, real
Rust/native LLDB stacks, disposable Unity discovery and its owned managed
endpoint all pass. These are supplemental baseline results, not extra passes
for every branch. The ignored integration helper is exercised by its parent
cleanup tests; it is not an independently claimed application test.

Node's ordinary isolated test invocation reports file-level totals on this
installed runtime. A separate direct invocation of each test file records
individual test counts and outcomes. UI files also run directly and serially,
with their real opt-ins, to avoid mistaking a skipped/file-level run for a
completed scenario. Exact commands and logs remain in local evidence.

## Desktop failures and investigation boundary

All new UI runs use a private Xvfb X11 display and actual embedded Tauri/WebKit.
Drivers use scratch user/config/cache/data state and namespaces. Unity tests
create disposable tracked-fixture copies and their own native plugins; the
user's active Editor and IDE are not selected, attached or stopped. Initial
functional runs overlapped compilation; subsequent repeats identify that
boundary explicitly. No ordinary-display or human acceptance is inferred.

| Case | Fresh observation | Consequence |
| --- | --- | --- |
| Debugger hover | C# breakpoint and Watch succeed; Show Hover yields no value before timeout. No debugger `registerHoverProvider`/`provideHover` integration exists in inspected `src`; only Watch calls the expression evaluator. | General debugger UI gate FAIL. Wire paused target/frame-qualified hover, then validate it. Later F10/Stop assertions in this scenario are not reached and cannot be reported as passes. |
| Explorer edge menu | In a 900×600 viewport, recorded menu rectangle is left 897, top 597, right 1117, bottom 832.86. `FileDiscovery` renders fixed `left: ctxMenu.x, top: ctxMenu.y` without viewport clamping. | Source and runtime agree on missing edge placement. Add measured menu-size-aware placement, including late-loaded items, then rerun every corner. No product fix was implemented in this assessment. |
| Unity 60 fps hit inspection | Chosen-hit expansion did not commit during the initial run. The post-build quiet repeat passes. | Intermittent inspection/harness synchronization remains unresolved; do not infer a product root cause solely from this assertion. |
| Unity uncapped | At the sustained assertion, source-gap count was 1,251 instead of zero; final cleanup can add counters and is kept separate. | Collection gate FAIL for this run. K01 intermittent loss remains open. The quiet repeat passes with zero source gaps at the assertion, but the initial loss remains evidence. |

Passing baseline scenarios: Exit including hidden window, canonical titles,
profiler icons, expanded workspace/rehosting with source editing, graphical
Unity overlay, recovery/replacement, scope/snapshot review regressions and
unified scope navigation. Their assertions do not close short-height visual
usability, moving-row inspection or physical-pointer human gates.

The earlier 18 October review still identifies R-04 short-height layout,
R-05 moving live rows, K01 intermittent loss and K03 manual replay as open.
A successful repeat is evidence for that repeat, not proof of an intermittent
failure's root cause or resolution.

## Standalone sustained Unity result

The uncapped long gate ran alone after audit builds, benchmark jobs and the
fixture server ended, with a fresh disposable Unity Editor. It completed in
**633.267 seconds**. At the actual rollover observation:

| Observation before cleanup | Value |
| --- | ---: |
| Profile span observed | 614.855 s |
| Retained / aged process samples | 2,400 / 1 |
| Retained captures / rolled capture evictions | 134 / 9,862,208 |
| Missing source events | **155** |
| Rejected events / disconnects | 0 / 0 |
| Compatibility dropped count | 155 |
| Counter checkpoints | 41 |

Retention rollover occurred, but the zero-loss assertion **FAILS** (`155 !== 0`).
The footer reads **Coverage interrupted**. This demonstrates collection loss
without concurrent audit compilation; its root cause is not established. The
post-rollover snapshot/Record again/free/replay tail follows that assertion and
was **NOT REACHED** in this run. Earlier passing short-run checks remain scoped
to their own runs. Final cleanup counters are excluded from this table.

See the [rollover screenshot](evidence/2026-10-23/unity-long-rollover.png) and
[portable counter history](evidence/2026-10-23/results.json). The SDK's deliberate
nonblocking-send gap mechanism is a source-backed investigation lead; exact
send return/errno and reader-drain correlation are still needed before a repair.

## Supplemental checks and harness repairs

The Markdown browser fixture seeded the old file-tab structure. Current
`FileEditorTab` requires `kind: "file"`, `id` and `activeTabId`; `findFileTab`
filters by kind. The stale fixture therefore rendered no document and both
browser scenarios timed out at their first heading. The only tracked test-code
repair in this audit updates that fixture to the current model. Both existing
browser scenarios then pass: source-preserving edits/undo/save/conflicts/links,
and keyboard/selection/block switching/touch double-tap. IPC remains mocked;
these passes do not establish native desktop Markdown acceptance. Vite also
reported an external-symlink font allow-list warning in this fixture setup;
no product CSP or server access policy was relaxed.

The real Rust/native DAP probe initially failed because it hardcodes a
fixture-local executable path while the audit exported `CARGO_TARGET_DIR`.
Rerunning the same compiled test without that override builds at its expected
path and passes real LLDB stack/module binding. This is an audit-environment
incident, not a product binding repair. Socket tests likewise pass after the
sandbox-only bind refusal is removed. Initial shared-dependency Vite writes
failed on the read-only source; writable temporary dependencies resolve that
environmental failure without changing product code.

## CSV release performance, Xvfb

The real optimized release build passes the existing million-row gates with
warm filesystem cache. Each operation has 20 observations. Timing is the
scripted application event through UI mutation plus two animation frames,
including scrolling the result into view; it is not hardware-input latency.

| Operation | p50, ms | p95, ms | Maximum, ms |
| --- | ---: | ---: | ---: |
| Zoom in | 30 | 31 | 31 |
| Pan right | 29 | 31 | 31 |
| Pan left | 30 | 31 | 31 |
| Zoom out | 30 | 31 | 39 |
| Series toggle | 30 | 31 | 31 |
| Row inspection | 21 | 29 | 30 |

All six pass p95 <100 ms. First visible graph took 1,539.44 ms on this workload.
Peak incremental process-tree RSS/input bytes is 1.952, below the accepted 3×
gate: 300,388,352 incremental RSS bytes for a 153,890,865-byte input. Shared RSS
pages may be counted more than once; PSS is retained separately.
First-view/progress assertions pass. Owning
window Close during loading releases the reader/storage and a replacement
window can import again. The sampled whole-IDE baseline remains a separate
issue (the two-window pre-import process tree was around 1.3 GB RSS / 593 MB
PSS; one-window startup was 823 MB RSS / 396 MB PSS); incremental-memory
success does not close it. Ordinary-display, native-picker, screen-reader and
human chart-first usability gates are not passed by Xvfb.

## Creation and first-use checks

The copied wizard passes planned-template refusal, empty search recovery,
900 px primary-control containment, native review of generated files/configs,
Rust-console creation into a disposable directory, opening that solution and
running it through the ordinary toolbar. The greeting is visible in Output.
The initial audit probe used an incorrect/immediate startup selector and later
a quick-input readiness assumption. Waiting for available controls and using
native editor focus/line keys corrected the driver. The final probe also waits
for Run completion, pauses on generated `main.rs:2` under LLDB, Continues and
observes re-enabled Debug controls. Failed driver attempts remain retained.

Generated Rust and C++ consoles compile and print their greetings. The Tauri
frontend builds with its declared dependencies; its native backend passes
`cargo check --offline`. Reusing the IDE's TypeScript 6/Vite 8 dependencies
initially failed; that run did not match the scaffold's declared ranges and
is not a template regression. No scaffold manifest was changed to force a pass.

.NET SDK/runtime now match at 10.0.113/10.0.13, clearing the older runtime
version mismatch. Generated C# Console initially could not reach NuGet in the sandbox; its
standard restore with permitted network access uses a disposable package cache
and the unchanged console now builds/runs and prints its greeting. ASP.NET
still fails with NETSDK1226; the installed pack list has no ASP.NET reference
pack. That generated API path is not passed. No package-pruning override, SDK
installation or system-policy change was used.

The full first-15-minutes release journey remains incomplete: external LSP
support is absent in inspected source, TypeScript/Tauri frontend debugging is
not established, and generated-project debugger coverage beyond the tested Rust console plus
human first-use acceptance is still required. Monaco syntax/completion and a backend debug session are
not evidence of every required language workflow.

## Retained feature-branch evidence

CSV M1's 21 October human review is FAIL: forms dominate, the plot/rows are hard
to reach, axes/marks are weak and manual row-number entry replaces direct
inspection. Scoped parser, latency and navigation results remain valid in their
stated lanes. The new screenshot passes concept review only. The refined design
keeps chart/series/row/details linked, corrects percentile summary semantics,
retains the IDE shell and defines collapsed/drawer states.

Timed perf has later evidence beyond its original qualification: native FP and
DWARF, weighted trees, positive loss accounting, bounded retention, target-safe
Stop, measured overhead, Mono maps, debugger refusal, substituted-file guards,
200k-symbol inventory and existing-IPC responsiveness. These are scoped native
or IPC results, not delivered capture controls/trees or human acceptance.
Normal .NET perf-map naming remains FAIL. The separate W^X-off diagnostic does
not approve a product workaround. Live PID reuse remains BLOCKED under the
accepted ordinary-user constraints. Flight recording is excluded; CSV live
follow/alignment M2/M3 remain separately reviewed future work.

## Required work before public release

| Priority | Work | Evidence needed to close it |
| --- | --- | --- |
| P0 | Choose and integrate one reviewed candidate, including any selected wizard/CSV/perf work. | One source revision and packaged artifact containing the selected features, followed by complete relevant retest. |
| P0 | Finish and implement the reviewed metric inspection UI. | Readable chart-first editor; linked selection; responsive/accessibility/recovery checks; real-project human usability PASS. |
| P0 | Resolve the reproduced general UI and Unity collection/inspection failures. | Correlated diagnosis, bounded repairs, failing-case regression and full harness evidence; retain unresolved/intermittent cases. |
| P0 | Complete the roadmap language-intelligence / first-use gate. | Rust + TypeScript + C++ or C# editing, real advertised language intelligence, build and debug on the release candidate. |
| P1 | Complete standard profiler vertical layout and stable inspection design. | Short-height review, inspectable live history and explicit collection/inspection state; human Unity replay/select checks. |
| P1 | Qualify remaining wizard templates and real desktop debug flows. | Valid supported toolchain, Create/open/Build/Run/Debug, missing-tool behaviour and clean-user journey. |
| P1 | Deliver/review the selected perf desktop surface, or explicitly defer it. | Capture/tree/filter/source/recovery workflow and human acceptance; scope known .NET/coverage limits accurately. |
| P1 | Package and qualify supported Linux installation. | Clean-machine install/launch, CSP/editor workers, native dialogs, ordinary GNOME identity/input, save/close/crash/process ownership and upgrade/uninstall. |
| P1 | Reconcile README/release claims and finish human task review. | Known limitations and Planned/experimental labels match the candidate; named M-lane results recorded. |

A narrower public alpha can be scoped explicitly, with honest limitations, but
that decision does not pass the current wider Linux IDE release gate. This
assessment makes no publication recommendation until the chosen scope and its
required failed/unrun gates are resolved.

## Evidence and reproduction

Local raw audit records live at
`test-results/release/2026-10-23/` in this checkout; desktop screenshots/records
are under `test-results/ui/<timestamp>/<scenario>/`. Commands, exit codes,
durations, binary/source hashes, environment boundaries and failures are
retained. These ignored local paths are not durable repository evidence.
The [portable evidence index](evidence/2026-10-23/README.md) links bounded
results, exact commands and selected images. Raw Unity logs are not published.

No user-source edits, dependency installation or build occurred in the original
wizard/CSV/perf worktrees. The two pre-existing dirty CSV documentation files
and the wizard's copied file set are checked against their initial hashes.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
