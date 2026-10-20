# Unity profiling UI/UX — Opus review handoff

**Roadmap track:** Phase 3.x / 3.5, usable native Unity attach and profiling.

**Status:** Historical brief prepared on 16 October 2026. The user later
supplied an independent Claude Opus 5.5 review, followed by the
[repair and runtime report](../bugs/16-10-2026/unity-profiling-final-report.md).
The following execution constraints describe the original handoff session.

Prepared on 16 October 2026 for the user-requested Opus 5.5 review.
Execution pending. The locally bundled Claude Code reports `loggedIn: false`;
no Opus model invocation or response has been obtained. Availability of the
requested model has not been verified. Do not silently substitute a reviewer.

## Task

Bring the existing Unity attach/Gold Profiler implementation up to a usable
standard through the real UI/UX harness, complete the
[Unity acceptance checklist](../uiux/unity-profiling-harness-checklist.md),
repair evidenced problems, and return a report with screenshots and runtime
proof. Keep the user's compact VS 2019 / Rider / VS Code direction. Work on
`feat/unity/profiling-a-to-p`, preserving all dirty/untracked state.

Read `AGENT.md` and its required documents first. Review
[initial findings](../bugs/16-10-2026/unity-profiling-uiux-report.md) before edits.
Baseline is `af2af04`; the checklist/report commit follows it.

## Start with the user's failures

1. Profiler toolbar buttons are blank in the Tauri desktop screenshot. The
   browser fixture currently renders them through Monaco's codicon styles, so
   that fixture does not reproduce the desktop problem. Diagnose actual asset,
   font and style loading; then prove visible controls in the real build.
2. The user clicked Unity's enabled Craidd → Probe → Allocate retained native
   1 MiB action and reported no effect and no Console message. Native Live
   Bytes stayed 0; Craidd showed only small periodic allocate/free cohorts.
   Updated C# assemblies contain the menu and diagnostics and were rebuilt
   after the edits. Root cause remains unconfirmed. A separate native process
   allocates 1 MiB and clears it successfully; that does not prove the live
   Unity callback executed.
3. The footer reports thousands dropped/incomplete. Source currently uses one
   counter for sample aging, capture eviction and source errors. Establish
   which happened; do not call the observed retained-allocation failure an
   event-loss bug without correlation.

## Harness integration

The real desktop harness exists in the separate, clean, detached checkout
`.claude/worktrees/project-context-docs-fd25e7` at `280b1d8`:

- `docs/uiux/design-ui-test-harness.md`
- `tests/ui/README.md`, `tests/ui/lib/harness.mjs`, `tests/ui/lib/webdriver.mjs`
- `tests/ui/{titles,menus,debug,exit}.test.mjs`
- package scripts `test:ui:build` and `test:ui`

Those files/scripts are not integrated into this branch. Inspect and bring over
the applicable harness with deliberate compatibility review; do not merge
unrelated work or edit that checkout in place. Add a Unity scenario and record
its exact command. Build this branch's current app; testing the older harness
checkout's binary misses the profiling implementation.

`tests/ui/profiling.html` is a separate browser-only presentation fixture. Its
data and IPC are mocked. Use it for layout/interaction checks, and the real
Tauri/native/Unity path for allocation and lifecycle acceptance. Isolate test
owners/settings; do not take over the user's already attached Unity Editor.
Unity has no Pipeline connection exposed in the checked session. That limits
automated Editor control; document the boundary rather than silently replacing
live actions with mock events or installing packages without need.

## Relevant implementation

| Area | Source |
| --- | --- |
| Profiler layout, controls, snapshots and collapsibles | `src/components/panels/ProfilerPanel.tsx`, `src/assets/styles/index.css` |
| Profiler state and benchmark selection | `src/store/profilingStore.ts`, `src/lib/profilingSelection.ts` |
| Attach, target identity and Editor detection | `src/components/dialogs/AttachProcessDialog.tsx`, `src-tauri/src/commands/processes.rs` |
| Source socket, captures, cohort accounting and limits | `src-tauri/src/commands/profiling.rs`, `profiling_discovery.rs` |
| Prepared native provider | `support/profiling/craidd_gold.hpp` |
| Unity actions, native code and lifecycle | `workspaces/unity/Assets/Scripts/NativeProbe.cs`, `Assets/Editor/ProbeProject.cs`, `Assets/Editor/ProbePlayLifecycle.cs`, `Native/probe.cpp` |
| Design and existing evidence | `docs/feats/profiling/design-gold-capture.md`, `implementation-attach-gold.md`, `workspaces/unity/README.md` |

The last two Unity source cells abbreviate paths relative to `workspaces/unity`;
the backend discovery filename is beside `profiling.rs`.

## Deliver

Check only evidenced checklist items. Put the completed report under
`docs/bugs/16-10-2026/`, distinguish reviewer observations from the user's
screenshots, and retain evidence in portable paths. Record actual model/reviewer,
revision, commands, failures, repairs, before/after screenshots and remaining
limits. Validate a short path the user can actually follow: Attach → Play →
allocate → snapshot → clear → compare → next Play. Commit coherent fixes and
the final report. Do not claim managed C# attach, Unity LDI, full heap capture
or GPU support from this native fixture.

---

*Last updated: Phase 3.x / 3.5, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
