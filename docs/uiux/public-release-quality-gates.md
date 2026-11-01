# Public-release quality gates

**Roadmap track:** Wider Linux IDE release gate, including Phase 3.x and selected Phase 3.5 capabilities.
**Status:** Release assessment and proposed exit checklist, 23 October 2026. Open boxes are requirements, not claimed results.
**Companion:** [Current assessment](../releases/public-release-readiness-2026-10-23.md).

## Evidence rules

Every result names the revision or working-file hashes, build mode/binary hash,
machine, workload, tool versions, display and reproduction command. Keep these
lanes separate:

- **D — source/automated checks:** build, parser, store, protocol and unit tests.
- **A — automated desktop:** actual embedded Tauri/WebKit, adapters and owned
  disposable targets. Xvfb covers that display, not GNOME shell integration.
- **M — human:** a person performs the task and judges clarity and usability.

Use PASS / FAIL / PARTIAL / BLOCKED / NOT TESTED per gate. A build, screenshot,
concept approval or merge cannot substitute for another lane. Retain failures,
skips and environmental blocks. Report per-operation distributions for latency;
do not pool unrelated operations or infer function cost from process CPU/RSS.

## Release checklist

| ID | Required outcome | Exit evidence |
| --- | --- | --- |
| PR-01 | One identified release candidate contains the chosen features. | Reviewed integration, clean source provenance, one release build and artifact hash; rerun affected/full checks on that candidate. Branch results remain branch results until then. |
| PR-02 | A new user installs/launches Craidd and understands tool requirements. | Clean supported Linux setup; missing tools yield actionable messages; packaged CSP/workers and ordinary desktop shell identity checked. |
| PR-03 | Create/open project → edit → language intelligence → build → run/debug works. | Fresh first-use journey for Rust + TypeScript + C++ or C#, as required by the roadmap. Distinguish Monaco language features from an external LSP client and backend debugging from browser debugging. |
| PR-04 | Creation is predictable and preserves existing work. | Template/configure/review; real desktop creation; new/empty destination checks; generated configs usable; unsaved buffers retained; planned templates unavailable. |
| PR-05 | Ordinary debugger inspection and controls are usable. | Selected thread/frame, stack, locals, Watch, hover, stepping, Continue, Stop and restart; errors and unsupported capabilities visible. No independent-thread claim without adapter evidence. |
| PR-06 | Linked windows and LDI have clear ownership and recovery. | Origin/partner identity, cancellation/rearm, close/reopen, hidden window and crash/exit matrix; no stale busy state, owned-child leaks or foreign-target termination. Unity managed/native/LDI remain separate cases. |
| PR-07 | Standard process/Gold profiling is legible and inspectable. | Charts/units/coverage readable; result controls reachable at short heights; rows remain deliberately inspectable during live collection; snapshot/scope/replay verified separately by A and M. |
| PR-08 | Imported metrics support a useful analysis workflow. | Chart-first editor, linked point/row/details, range/ranking, source/series search, exact original/companion values, issues/settings, immutable save/reopen. See the [refined concept](../feats/profiling/design-metric-inspection-editor.md). |
| PR-09 | Selected profiling features retain accurate semantics at scale. | Existing million-row fixture and accepted incremental-memory gate; release-build event-to-render p95 <100 ms for each measured operation; declared clocks/windows/joins; loss/retention/unknowns visible. Whole-IDE baseline assessed separately. |
| PR-10 | Menus, layout and keyboard work across supported sizes. | Ordinary 900/1280/1920 px windows, 100/125/150% text scaling, 288/360/420 px standard sidebar; no clipped primary controls; visible focus and keyboard alternatives; native pickers and accessibility reviewed separately. |
| PR-11 | Data survives errors and ownership changes safely. | Dirty close/save/conflict, failed import/retry/cancel, immutable reopen, owned window close and IDE exit; producer files unchanged; source/selection restored within the documented lifetime. |
| PR-12 | Release claims match tested scope. | README/setup/release notes reflect the selected candidate; experimental and Planned labels accurate; known limitations named; human task review and package install/upgrade/uninstall recorded. |

## First 15 minutes

Use a clean user/config profile and record elapsed times and friction without
requiring a developer console or a hand-edited internal configuration:

1. Launch the package and identify the required external tools.
2. Create a console project through template/configure/review; also open an
   existing project. Check that the user can explain what will be written.
3. Edit a symbol and exercise the advertised diagnostics/completion/navigation.
4. Build, understand an intentional compiler error, correct it and run.
5. Set a breakpoint, inspect a local/Watch, step, Continue and Stop.
6. Close/reopen with a dirty file and verify the chosen save/cancel behaviour.

Repeat the required language coverage. A successful Rust console does not pass
TypeScript editing, C# tooling or a native interop path. Keep dependency/network
restores visible; offline creation does not promise offline first compilation.

## Profiling task review

For standard Unity/native profiling, ask the reviewer to attach explicitly,
record Play, find a capture, inspect a thread/batch and memory observation,
return Live, and Stop Play → Play without reattaching. Assess the short-height
layout and moving live rows directly. Keep K01 intermittent loss open until
there is evidence of cause and resolution; a successful repeat only establishes
that repeat. Physical-pointer behaviour and automated native-select traces are
different evidence.

For imported metrics, ask the reviewer to open real project files, select useful
series, find a spike, commit a row, explain its unit/axis/coverage, inspect a
declared companion, change range, return from code, and save/reopen a snapshot.
Include bad/empty cells, unknown window duration, mixed units, unjoined rows,
missing files and a cancelled load. Do not coach the reviewer through obscure
controls and then call the workflow discoverable.

GR-002 timed sampling requires its own reviewed controls and top-down/bottom-up
tree workflow. Backend or IPC qualification does not pass tree interaction,
source opening, accessible controls or human interpretation. Keep the existing
.NET naming failure and bounded native/Mono coverage explicit. Flight recording
and CSV M2/M3 remain outside the current bounded slice.

## Work order

1. Identify the integration candidate and preserve each feature's source and
   evidence. Complete the detailed metric interaction/responsive design.
2. Implement paused target/frame-qualified hover and measured viewport-aware
   edge-menu placement, following the source/runtime diagnosis in the report.
   Review the bounded repairs and rerun the exact failing cases.
3. Deliver the metric analysis UI and standard profiler layout/inspection
   improvements as bounded reviewable slices; retain semantics and scale gates.
4. Qualify the wizard's actual desktop Create/open/build/run/debug journey and
   the wider language-intelligence gate.
5. Run the full candidate regression/harness, release performance and packaged
   clean-machine checks; finish M-lane review and publish only the tested claims.

This is the next-work sequence. It does not claim that all implementation work
is completed by the assessment or that every experimental feature must ship.
Any narrower public alpha scope must be chosen explicitly and documented.

---

*Last updated: 23 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
