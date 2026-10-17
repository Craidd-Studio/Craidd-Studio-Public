# Profiler workspace milestone A

**Status:** Source implemented and automated checks passed, 17 October 2026.
Linked-view backend and Linked Window milestones B/C are not implemented.

## Scope and architecture

Craidd remains a polyglot IDE with its complete existing shell. This slice
implements the independently deliverable Editor Panel milestone from the
[workspace modes design](../feats/profiling/design-profiler-workspace-modes.md).

- The existing tab list now holds typed file and Profiler variants. One
  `activeTabId` governs primary selection; `activeFileId` is its file-only
  projection. File save, disk, dirty prompts, search and linked previews
  exclude the non-file variant. No synthetic filesystem document is created.
- Open in Editor Panel activates the singleton **Profiling** tab. Source tabs
  remain open and editable. Primary Profiler selection suppresses the existing
  right panel and resize handle; split focus never enters that calculation.
  Closing the tab restores the saved panel preference without stopping capture.
- The existing Profiler supplies both presentations. Its result tab, graph
  range, filters, expansion, selected-hit and results-scroll state now live
  alongside existing inspection state in `profilingStore`, surviving host
  switches. Source preparation uses a valid remembered file, not the workspace
  key. Open-file Monaco models survive rehosting and are released on tab close.
- Expanded presentation has Summary figures across the top, full-width aligned
  timeline tracks and a Gold table with adjacent hit details. Row inspection
  leaves scope unchanged; Focus recording explicitly changes scope. Narrow
  widths stack the table/details. Existing metric and snapshot semantics remain.
- Right-panel tab selection lives above its conditional host. The shell handles
  `craidd:show-profiler` while that host is absent. The panel toggle is disabled
  during primary Profiler suppression. Linked Window actions are hidden.

## Observed regression and correction

The first live split regression opened side code beside Profiling, then Ctrl+W
closed the primary tab instead of the side group. The side editor's existing
Monaco text-focus listener alone did not reliably establish group focus during
initial mounting. The final implementation tracks DOM focus at the side-group
boundary and checks already-focused Monaco on mount. Primary tab activation
clears stale side/editor focus. Split opening reads the file without an
intermediate primary selection, preventing sidebar flicker.

The rerun recorded `sideFocused: true`, `flickered: false`, and Ctrl+W closing
only the side group. No profiler collection/backend change was needed.

## Validation and evidence

- Production TypeScript/Vite build and embedded debug Tauri build passed.
  Existing chunk-size/dynamic-import warnings remain.
- Direct execution of all 15 top-level regression files passed **107 tests**,
  including four workspace-store tests and 27 profiling tests. Local transcript:
  `test-results/profiler-workspace-a/direct-regressions.log`. The repeated
  production build is recorded in the adjacent `frontend-build.log`.
- The new real Tauri scenario passed with a separately compiled, disposable
  instrumented C++ target using the existing provider. It checks real live
  collection, snapshot and recording identity through source/Profiler switches,
  dirty source retention and save, split open/focus/close without flicker,
  remembered manual panel collapse, disabled toggle, shell reveal after host
  unmount, and Profiler-tab close leaving the same capture active.
- The narrow scenario used a 900 px IDE window: the expanded content measured
  564 px client width and 564 px scroll width, with one stacked Gold column.
- The existing embedded Profiler SVG regression passed with no source file
  open and with Monaco open. CSP was not changed.

Local ignored evidence directories:

```
test-results/ui/2026-10-17T18-55-33-117Z/profiler-workspace/
test-results/ui/2026-10-17T18-56-23-469Z/profiler-icons/
```

The first contains `record.json`, `01-expanded-gold.png`,
`02-narrow-expanded.png`, `02-source-and-compact.png` and final-state capture.
Earlier runs retain the original focus failure and harness assertion/scrolling
corrections; the dated final run above is the passing source revision.

## Remaining gates and next task

This is automated native-fixture/webview evidence, not a human desktop
acceptance report, a new Unity qualification or a public-release gate.
Existing broader profiling/Unity stress and Monaco CSP questions retain their
separate status. Snapshot persistence through Hide/Show is not delivered by A.

The current delivery ends at A. Users can use ordinary Duplicate Window and
open its Profiling tab for a separate profiling context; no dedicated Profiler
new-window action is required. Shared-session viewing in B/C is deferred.

If shared-session viewing is commissioned later, B must add validated owner/view routing, shared bounded saved views, isolation
from Debug-created local profiles and uniform native/tray/linked/parked-owner
cleanup before C enables a linked viewer. At B's start, extract detailed
backend mechanics into the implementation plan required by the workspace
modes design, preserving its UX, retention and lifecycle guarantees.

To repeat the relevant checks:

```sh
npm run build
npm run test:profiler-workspace
node tests/profiling.test.mjs
npm run test:ui:build
npm run test:ui:profiler-workspace
node tests/ui/profiler-icons.test.mjs
```

The UI harness requires the installed Linux WebDriver tools/display and local
socket access; it uses isolated application state and disposable target/source
files. It does not operate the user's live Unity Editor. The pre-existing
untracked `workspaces/unity/ProjectSettings/PackageManagerSettings.asset` was
left untouched.

For human acceptance, run `npm run tauri dev`: open Profiler in the editor,
switch between Profiling and a dirty source tab, inspect Gold/snapshots, focus
split code, and close Profiling. Confirm the saved sidebar preference and
inspection state remain intact and collection continues. Linked Window should
remain absent.

---

*Last updated: Phase 3.5, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
