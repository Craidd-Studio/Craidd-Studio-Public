# Craidd Studio — Profiler Workspace Modes

**Roadmap track:** Phase 3.5 profiling.

**Status:** Reconciled design contract, 17 October 2026. Milestone A is source-implemented with build, regression and automated native/Tauri evidence in the [milestone A record](../../handoffs/handoff-phase-3-5-profiler-workspace-a.md); human desktop acceptance remains separate. Linked viewing (B/C) is not implemented and remains gated on backend routing, shared retention and lifecycle prerequisites.

**Companions:** [Profiler scopes](design-profiler-scopes.md) governs inspection and snapshots; [Gold capture](design-gold-capture.md) and [attached profiling](design-attach-profiling.md) govern capture identity and target ownership. Use the dated [implementation record](implementation-attach-gold.md) for current capabilities. Older layout-only, automatic Solo-focus and snapshot wording in companion documents is historical where superseded by that record and the scope contract.

## 1. Purpose

Present the existing Profiler in the right sidebar or as a normal, first-class editor tab alongside source files, either in the current Craidd Studio window or in a normal linked Craidd window. The Profiler is a React view, not a Monaco document or another profiling engine.

**Design principle:** Preserve the full IDE shell in every mode. Reuse the existing tab strip, shell, window registry, startup flow and collector. Change the Profiler host and derive temporary right-panel suppression solely from the active primary editor tab, never keyboard focus.

## 2. Preimplementation baseline and implementation seams

This table records the source baseline before milestone A; it is not a description of its new typed-tab and host-routing code. Paths are repository-relative references, not runtime acceptance evidence.

| Area | Current implementation and consequence |
| --- | --- |
| IDE shell | `src/components/layout/AppShell.tsx` owns menu, toolbar, left navigation, central editor, lower panels, right panel, status bar and dialogs. Both new presentations must keep this root. |
| Editor tabs | `src/types/project.ts` defines file-only `EditorTab`; `src/store/solutionStore.ts` owns `tabs`, `activeFileId`, open/close/save and disk state. There is no general workspace-tab registration API. |
| Rendering | `src/components/editor/EditorPane.tsx` composes `EditorTabs`, `Breadcrumb`, `CodeView` and `SideEditor`. `CodeView.tsx` mounts Monaco for a file. Extend this content boundary, not the shell or a parallel tab manager. |
| Right panel | `src/components/panels/RightPanel.tsx` contains **both** Debugger and Profiler. Its selected tab is component state initialised from `craidd:right-panel-tab` in localStorage. `src/store/preferencesStore.ts` keeps `rightPanelVisible` in memory per webview; `layoutStore.ts` keeps its width. |
| Duplicate Window | `src/components/menu/MenuBar.tsx` calls `open_workspace_window` with the same `.cln` and configuration/build profile. `src/lib/duplicateWindowPolicy.ts` can create a hidden session and select its preview in the originating window. `selectedProfileName` means build profile, not profiling session. |
| Startup/context | `src-tauri/src/commands/window.rs`, `src/types/startup.ts` and `src/App.tsx` carry startup state, with no Profiler-view intent today. `src/store/linkedWindowsStore.ts` publishes code previews, output and debugger context, not profile samples/snapshots. Selecting a visible sibling focuses it; a hidden sibling uses `RemoteContext.tsx`, not an adopted editable IDE. |
| Collection | `src-tauri/src/commands/profiling.rs` stores profiles by owner window label, emits `craidd:profile` only to that label, and addresses query/Stop/Record again by the invoking window. It rejects another active collector for the same process incarnation. Duplicate Window does not share this profile. |
| Profiler state | `src/store/profilingStore.ts` creates manual snapshots and previous-session archives in frontend memory. Its single `profile` slot is replaced by each received profile. Selection is window-local; filters, results tab and graph range also use `ProfilerPanel.tsx` component state. Neither snapshots nor component state survive webview destruction today. |
| Debug-created profiles | `src-tauri/src/commands/debug.rs` calls `profiling::start` for attached targets and DAP process events, records `profile_id`, and later calls `stop_session`. A linked viewer may therefore receive its own local profile while displaying another owner. Receipt must not change its display binding. |
| Show routing | `src/components/dialogs/AttachProcessDialog.tsx` emits `craidd:show-profiler` after profile-only attachment; its only listener currently lives in conditionally mounted `RightPanel`. Move presentation routing to the always-mounted shell boundary. |
| Lifecycle | `src-tauri/src/commands/linked_windows.rs` parks hidden windows by destroying their webviews. Native CloseRequested in `src-tauri/src/lib.rs` explicitly stops that window's profile; tray/linked close uses a separate destroy path. Profiling cleanup is not uniform today. |

The current panel supplies process RSS/CPU observations, native provider results, timeline, Summary / Gold / Memory / Events, independent snapshot history and scope selection. Rehosting retains these capabilities and their unavailable/coverage labels. Broader linked aggregation and external collectors in older designs do not establish implemented session sharing.

## 3. Three workspace presentations

### A. Sidebar — default

- Keep the existing right-side Profiler optimised for compact monitoring alongside source code.
- The sidebar Profiler offers **Open in Editor Panel** and, once milestone C is available, **Open in Linked Window**; Debugger and unrelated tabs offer neither. Hide the linked-window action everywhere until C is available. Central presentations keep only the applicable action described below. In a linked viewer, omit the redundant linked-window action for the capture it already views.
- Displaying a view never attaches, starts a recording or creates another collector.

### B. Editor Panel — current window

- Open or activate one **Profiling** tab in the existing primary editor tab strip. This is the visible title of the Profiler workspace tab; its internal typed-tab kind remains `profiler`. Repeated use focuses the same tab in that window.

  Example tab strip: `Profiling × | MyApp.cs × | AnotherFile.cpp ×`.

- When **Profiling** is active, render the expanded Profiler as a React view in the central editor content area at the `EditorPane` boundary. Source tabs remain available in the same strip; selecting one displays its file normally with Monaco and file breadcrumbs.
- Use the additional editor space for deeper analysis of the existing profiling data, while the sidebar supports compact monitoring alongside code. The milestone A layout below is approved by this design. Further capabilities or interactions beyond that baseline require separate approval; none are claimed as implemented.
- Temporarily hide the shared right Debugger/Profiler host **and its resize handle** whenever Profiler is the active **primary editor tab**, even while a split editor has keyboard focus. Keep menu, toolbar, left navigation, lower output area, status bar and dialogs, subject to existing user panel preferences.
- Selecting `MyApp.cs` or another primary source tab displays that file and restores the right sidebar according to the saved visibility preference. The **Profiling** tab stays open, retaining its session binding, snapshot selection, scope and other inspection state. Switching tabs itself resets none of this state; normal session lifecycle and retention rules still apply.
- Selecting **Profiling** again restores the expanded view and suppresses the right sidebar again. Focusing split code alone changes neither primary selection nor visibility.
- Closing **Profiling** removes it from the editor tab strip and restores normal sidebar behaviour according to the saved preference. Switching away, returning or closing the tab never stops profiling.
- Omit **Open in Editor Panel** here: the tab is already open. Once milestone C is available, retain **Open in Linked Window** for a local capture, but omit it when this window is already its linked viewer. Use ordinary tab close to return to sidebar presentation; no extra return/move button is needed.

**Milestone A wide-layout baseline:** Put the existing Summary figures in a compact row at the top, followed by the existing process CPU/RSS and Gold timeline tracks spanning the full content width on their common time ruler. Keep the separate Scope and Snapshot history selectors and the Summary / Gold / Memory / Events navigation. In Gold, show retained hits in a readable table with the selected hit's existing details beside it; row selection opens those details, while the explicit **Focus recording** action retains responsibility for changing panel scope. Use existing recorded fields, units, coverage and unavailable states throughout. At narrow widths, wrap the figures and stack table/details so controls remain accessible. This baseline rearranges existing observations and approves no new metrics or analysis engine; simply stretching the compact sidebar layout does not satisfy milestone A.

### C. Linked Window — normal IDE window

- Reuse `open_workspace_window`, `App` bootstrap, `AppShell` and the linked-window registry for a complete duplicated Craidd Studio IDE on the same solution. Initialise its **Profiling** tab from the originating Profiler's displayed session and selection. It uses exactly the editor-tab behaviour in section B: source tabs coexist, selecting code leaves Profiling open with inspection intact, returning restores the expanded view, and closing only the tab does not stop profiling.
- This explicit **Open in Linked Window** action requests a **visible** window. Do not use the ordinary menu handler's hidden-session fallback, which changes the originating window's viewed context. File → Duplicate Window preferences remain unchanged; this action's visibility exception is intentional.
- Keep ordinary identity, titles, tray membership, file editing, launch controls and close prompts. A normal duplicate can participate in linked launch actions under existing eligibility rules; opening this view launches nothing.
- The linked Profiler subscribes to the existing capture owner. Its other IDE actions keep their normal targets; a profiling link does not retarget Build/Run/Debug or adopt the owner's code buffers.
- Selecting a primary code tab restores that window's right panel. Its sidebar Profiler inspects the same linked capture as its central Profiler, rather than silently reverting to its empty local profile.
- Opening/closing this viewer leaves the originating window's active tab, viewed-window selection and panel preference alone. Viewer close does not stop the originating capture; ordinary cleanup of work launched in the viewer still applies.

**Availability and reuse:** Editor Panel supports an empty Profiler. Before milestone C is available, omit Open in Linked Window entirely. Once available, Linked Window requires an open `.cln` and retained profile; otherwise explain why it is disabled. Repeated linked actions focus/show the existing viewer for that owner/profile identity and activate its Profiler tab, preserving its independent inspection state, using existing readiness/focus helpers. Coalesce clicks during startup. If that viewer has changed profiling targets, leave it alone and open another viewer; never replace an independent attachment.

## 4. Primary-tab visibility and presentation routing

Visibility is per physical IDE window. Keep `rightPanelVisible` as the user's explicit preference; effective visibility is **preference enabled AND active primary tab kind is not Profiler**. Never write that preference or localStorage merely to enter/leave Profiler.

| Primary editor selection | Right Debugger/Profiler host |
| --- | --- |
| Profiler, with focus anywhere, including split code | Suppressed, including resize handle |
| Source tab, other workspace tab, or no active primary tab | User's normal preference |

The primary tab kind is the only automatic suppression input. `useSplit.sideFocused`, Monaco focus, menu/toolbar focus and remote-preview overlays must not enter this expression. A hidden-session preview does not silently override primary selection; if a navigation command explicitly selects primary source, that selection restores the panel normally. Keep Profiler in the primary group for this slice; side-group code retains normal focus/commands without resizing the shell or causing flicker.

“Restore” means restore preference, prior Debugger/Profiler selection and width, not force open a manually collapsed panel. Keep right-panel tab selection above conditional unmounts so remount cannot substitute another window's localStorage selection. Switching between sidebar and central hosts preserves inspection state.

**Panel toggle:** Disable View → Toggle Debugger & Profiler Panel while the primary Profiler tab suppresses the host, with the explanation “Select another primary tab or close Profiler to show this panel.” Any equivalent command uses the same availability rule and leaves the saved preference untouched. Outside suppression, toggle behaves normally. Do not silently change a preference behind an invisible panel or make toggle select a different editor tab.

**`craidd:show-profiler`:** Handle the presentation request once at the always-mounted `AppShell` boundary; `RightPanel` must not be its sole listener. It selects no profiling target and creates no attachment. If a Profiler editor tab is open, activate/focus that tab without changing the saved right-panel preference; otherwise select sidebar Profiler and explicitly show the panel, since this is a user-requested reveal. If primary Profiler is already active, focus it and keep the right panel suppressed. Activating/revealing the primary Profiler also reveals the local `EditorPane` through the existing local-view/remote-preview switch if necessary; do not change `viewedWindowLabel`, launch-control targets or the profiling binding merely to make the view visible. A successful explicit Attach commits its display binding before requesting this reveal; a failed Attach preserves the previous binding/inspection. Debug-created profile updates alone request neither a reveal nor a host/session switch.

## 5. State ownership and linking

### One collector, explicitly routed viewers

Retain `ProfileManager` and the existing per-owner collector. Add the minimum owner/profile-to-viewer binding and query/event routing there, using the linked-window registry for same-solution validation and lifecycle. Do not create another session manager, broker, per-view sampling timer or reference-counted collector lifetime.

Qualify a binding by owner identity, profile ID and process incarnation (`pid` plus birth identity); validate solution membership where applicable. PID, project name, `.cln` or build profile alone cannot identify the capture. The originating Profiler's displayed binding is authoritative; `viewedWindowLabel` describes another subsystem and is not a substitute.

A late viewer needs bounded initial hydration plus updates. “No historical copy” means no second retained collector history, not zero serialisation. Subscribe/query without an event gap; order baseline and updates so an old baseline cannot overwrite newer data, and discard responses from superseded bindings. Reuse bounded `Profile::view` payloads and publish outside collector locks. Stop/Record again resolve the bound owner **and expected profile ID**, validate membership and reject stale commands. Existing generic linked dispatch has no profiling commands today.

Within one IDE, sidebar and editor hosts share inspection state so switching preserves snapshot/recording selection, results tab, benchmark, filters and graph range. A linked viewer starts from that state, then browses independently. Shared Stop/Record again affects the capture everywhere without retargeting another viewer's inspection. Attach is an explicit new-target action; it never silently replaces the linked owner's target or duplicates its attachment.

### Debug-created local sessions do not replace a linked display

Separate **local collector ownership** from the **displayed profile binding** in the existing profiling store/routing. A local DAP attach/process event can start a local profile while this IDE displays another owner's profile. Route and cache each payload by validated owner/profile identity; do not pass both streams through the current unconditional single-slot `receiveProfile` replacement path. A local baseline query, late event or Debug completion cannot overwrite the linked view, its scope, saved selection or saved-view catalogue.

Keep Debug's internal `profiling::start`, `debug_pause` and `stop_session` tied to its own owner and recorded profile ID, regardless of what Profiler displays. Profiler Stop/Record again/Snapshot instead address the displayed binding. Neither path is redirected through the other by accident. Preserve the backend rule against duplicate collectors for one process incarnation; an automatic local profiling refusal is reported, not resolved by another attach.

When a different local profile becomes available during linked inspection, show a contextual notice with **View local session**. Only that explicit action, a successful explicit Attach, or another explicit session selection changes the display binding. Switching display does not stop either owner; restore any retained inspection state for the chosen identity. Ordinary local mode can continue following its own session lifecycle, but a linked binding stays on its exact session even after that owner ends or replaces it. There is no automatic fallback to the viewer's local session. If the bound result is no longer retained, show its identity as Unavailable.

### Shared saved data, local inspection

Shared data includes samples, capture/batch identities, lifecycle/coverage and immutable snapshots/previous-session archives. Local state includes active workspace tab, panel preference, selected saved-view/recording identity, filters, results tab, scroll and expansion state.

Frontend-only saved views cannot satisfy shared identity or survive owner Hide. Linked mode therefore needs the existing saved-view representation and bounded catalogue retained with the backend owner context, alongside profile state. Reuse snapshot fields and retention rules; no database or new recording model. Generate each saved identity once, publish catalogue changes and fetch frozen payloads on demand. Do not transmit all snapshots every sampling tick or recreate archives separately in each renderer.

**Retention decision:** Keep the existing rule: evict the oldest **unreviewed** saved view within the eight-entry bound, including previous-session archives. An unconditional oldest-first eviction policy is simpler, but can remove another viewer's explicitly reviewed snapshot; clearing its selection or switching it to Live would contradict the scope contract. Keeping private frozen copies after eviction would move the memory bound outside the shared catalogue and complicate shared identity. Neither alternative is adopted.

For linked mode, derive the protected IDs from the currently registered viewers' selected saved-view IDs in the existing owner/view binding state. No separate pin service or lease system is needed. Serialise selection acknowledgement, creation and eviction in authoritative backend state so concurrent requests cannot evict an acknowledged selection or generate different identities for one snapshot. Remove protection on selection change, explicit display rebinding, Hide, close or renderer retirement; a restored viewer whose old selection has expired shows Unavailable, never an automatic replacement. One frozen saved record can be selected by several viewers without another retained copy per viewer.

If all eight entries are protected, reject a new saved view visibly while collection continues. If an automatic archive cannot be admitted, report that retention loss without delaying session finalisation or the next session. Never grow unbounded. Preserve terminal results only in the existing bounded current/saved data; once unavailable, keep the old binding identity and explain the missing data. Replacement sessions cannot inherit old capture IDs or silently replace an old linked selection. Milestone A keeps today's frontend retention; the shared catalogue/protection extension belongs to milestone B.

Take Snapshot freezes the current **live bound process** and active capture associations even during historical inspection, preserving the current view. Full session remains the default; Scope and manual snapshot history stay separate selectors. Reuse `src/lib/profilingSelection.ts` in every host. End values, late frees, Play generations, missing history and process-wide CPU/RSS retain the [scope contract](design-profiler-scopes.md); a wider host does not imply heap dumps or function-exclusive metrics.

## 6. Actions and lifecycle

| Trigger | Required result |
| --- | --- |
| Open/focus central Profiler | Keep the session, select the typed primary tab and suppress only this window's right panel, independent of split focus. |
| Select a primary source tab | Display the file and restore panel preference; keep Profiling open with its session, snapshot selection, scope and inspection state intact. |
| Return to Profiling | Restore expanded Profiler content and suppress the right panel again, retaining inspection state. |
| Close Profiling tab | Remove the tab from the strip and restore normal sidebar behaviour without stopping profiling. Keep capture/saved views; closing the last tab leaves the existing empty-editor state. |
| Open linked view | Resolve the displayed capture, create/show a visible normal IDE, hydrate and subscribe; preserve originating content selection. |
| Close linked viewer window | Remove its subscriptions/protection; keep the linked owner/other views. Also finalise any separate local profile this viewer owns, including one created by Debug. Closing just its Profiler tab restores sidebar presentation with the same binding/inspection. Existing dirty-file/exit-scope handling applies; solution/application exit can also close the owner. |
| Hide either IDE | Park bounded primary-tab/presentation/binding intent before GUI teardown. Keep owned collectors and discovery registrations alive; remove only retired renderer subscriptions/protection. Show rehydrates and resubscribes without another collector; expired selection stays Unavailable. Never run owner-close finalisation merely because Hide calls `destroy()`. |
| Shared Stop / target exit / owner closes | Finalise the bound capture and notify every viewer. Retain inspectable results within bounds; never kill a foreign target. Owner close does not transfer ownership. |
| Owner replaces session / PID reused | Keep the old linked identity ended or unavailable. Require explicit selection/linking of a new session; reject stale commands. |
| Viewer selects its own profiling target | Use the existing attach flow and commit a new display binding only on success; do not stop the linked owner or overwrite another viewer's state. Failure leaves current inspection intact. |
| Debug creates/ends a local profile in a linked viewer | Update only the local owner context/cache and the availability notice; keep the linked display binding and its history unchanged. |
| Solution changes / restore fails / link lost | Invalidate affected bindings and commands, show error/ended state and keep normal shell navigation. No automatic attach or collector retry. |
| Application exit | Existing exit scope and unsaved-file handling govern; owned collectors end. Restart never silently reattaches a historical PID. |

Require one idempotent profiling finalisation/release operation within the existing profiling module, invoked for every actual owner-close path: approved native CloseRequested, tray/linked close of visible or parked contexts, solution/application close and forced exit. Capture the owner/profile and subscriber identities before removing registry membership, then complete backend invalidation, collector stop, matching discovery-route release and terminal-result publication without depending on a closing frontend to acknowledge. Repeated Debug/session/close callbacks are harmless and expected profile IDs prevent an old callback from ending a replacement. Never signal a foreign target.

Keep renderer destruction separate from owner-context destruction. Hide/Show, initial hidden duplicate parking and failed parked restoration retire subscriptions and preserve ownership; they must not call the owner-close operation. Actual linked-viewer closure releases its subscription, not the remote owner. If the same window also owns a local Debug-created profile, close cleans up that local profile independently. Cancelled close/unsaved prompts perform no profiling finalisation.

Today `lib.rs` stops profiling on CloseRequested, while both visible and hidden branches of `close_linked_window_inner` lack equivalent explicit profiling cleanup. Integrate the operation into those existing paths, not a competing window lifecycle system. Process exit, Debug end and source disconnect retain their existing distinct meanings; provider disconnect/Unity Play end need not end the armed profiling context. On unexpected webview loss, retire its renderer state; stop its owned collector only when the registry actually retires the owner context. Full host exit uses existing profiling shutdown/discovery cleanup. Verify native close, tray close, linked/parked close, Hide/Show, failed restore and abrupt host exit separately. Capture survives **viewer** close, not closure of its owner context.

An ungraceful host death cannot guarantee final notifications or in-process cleanup. Use existing discovery incarnation checks and dead-owner reclamation on subsequent startup/connection to reject stale routes; do not report a graceful final result or automatically reattach. This recovery case is distinct from ordinary close acceptance.

## 7. Component and routing constraints

**Architecture decision: extend the existing typed tab model.** Evolve the current file-only `EditorTab` into a discriminated file/Profiler workspace-tab union in the existing store, tab strip and `EditorPane`. Keep the current file payload and filesystem identity on the file variant; the Profiler variant carries a workspace identity without dummy file content or disk fields. One primary active-tab identity governs selection, close fallback and sidebar suppression. Keep `activeFileId` as a file-only projection (null for primary Profiler), with remembered source-preparation context separate from it. File open/reveal actions select their typed file tab; split-open restores the preceding primary workspace selection, including Profiler, without exposing a transient source-tab selection to layout.

A separate Profiler slot/boolean could avoid widening file-only consumers initially, but would split tab membership, primary selection, close/keyboard handling, publication and restore across two mechanisms. Every future non-text view would need more exceptions. The typed union costs a deliberate file-consumer audit now and gives future non-text views one extension point without a new docking system or plugin registry. Choose that architecture, not a Profiler-only slot or a fake source file. Migrate selection/file projections coherently; do not leave two writable sources of primary selection truth.

- Preserve file identities, dirty buffers, Monaco models/view state and the current close fallback. Closing an inactive tab never changes primary selection. Profiler is a singleton tab per window, initially restricted to the primary group.
- Audit file-only consumers of `activeFileId`/`EditorTab`: save/save-as, disk refresh/watchers, close/dirty prompts, breadcrumbs, recent-file state, linked previews and parked restore. Profiler has no filesystem content, disk state or Monaco model.
- Close button, middle-click and primary-group Ctrl+W close Profiler without save prompts. Existing side-focused Ctrl+W closes the side group. Save/Save As/F9/Undo/Redo cannot target stale hidden Monaco while Profiler owns focus. Focused side code keeps normal commands without changing primary selection or sidebar visibility. Explicit primary source/debugger navigation selects code and restores panel preference.
- Preserve source preparation context separately from workspace-tab identity. `ProfilerPanel` currently reads `activeFileId` and dirty state to prepare a file: use a valid selected/remembered source with dirty validation, or disable preparation with an explanation. Never pass a workspace key as a file path.
- Lift only existing presentation state needed across primary-tab activation/deactivation and host switches. Unmounting inactive central content must not reset the session binding, snapshot selection, scope or inspection state. Keep profiling listeners in `AppShell`, not each mounted host. Avoid two simultaneously active panel copies, duplicate DOM IDs or duplicated listeners.
- Extend existing `WorkspaceEntry`/parked state with bounded view intent. Do not persist samples or ephemeral attachments in recent workspaces. Ordinary duplicate bootstrap changes only when explicit Profiler intent is present.

## 8. Acceptance criteria

- [ ] Milestone A hides Open in Linked Window; once C is available, sidebar offers both actions and central/linked presentations omit redundant promotion buttons. Repeated Editor Panel actions focus one typed primary tab.
- [ ] Milestone A provides the Summary figures row, full-width aligned timeline tracks and Gold hits table with adjacent selected-hit details from section 3B, with a usable narrow-width fallback and unchanged measurement/scope semantics.
- [ ] Both modes retain real `AppShell`, editable code, navigation, toolbar/menu, lower panels, status and dialogs.
- [ ] `Profiling → MyApp.cs → Profiling` keeps both tabs open, displays the selected content, preserves session/snapshot/scope/inspection state and restores or suppresses the sidebar as specified, identically in current and linked IDE windows.
- [ ] Closing Profiling removes only its editor tab, restores normal sidebar behaviour and leaves profiling running.
- [ ] Primary Profiler selection alone suppresses right host/resize handle; primary code/other/empty selection and close restore preference, width and panel tab.
- [ ] Split focus, split-open, menu/toolbar focus and remote overlays do not flicker or override suppression. Panel toggle is disabled with an explanation during suppression.
- [ ] `craidd:show-profiler` works when the right host is unmounted: activates an existing editor tab or explicitly shows sidebar Profiler, without implicit session changes.
- [ ] File commands, shortcuts and disk/dirty handling cannot mistake Profiler for a file or affect hidden code; dirty buffers survive host changes.
- [ ] Linked action opens/shows a visible normal IDE under all Duplicate Window preferences without changing origin tab/panel/viewed context; repeated startup and failure are handled.
- [ ] One incarnation has one collector/discovery registration/history. Late join hydrates retained data; viewing creates no attach or sampling timer.
- [ ] Sidebar/central hosts preserve inspection; linked viewers initially match then browse independently. Shared commands validate owner/profile identity.
- [ ] Debug-created local attach/process events, local baseline queries and Debug completion cannot replace a linked display, its selection or history. View local session/explicit Attach switches deliberately; stale owner/Debug commands cannot affect another profile.
- [ ] Snapshots/archives have shared immutable identities and bounded retention; concurrent selection/creation, oldest-unreviewed eviction, all-eight-protected capacity and retired-renderer cleanup are exercised.
- [ ] Tab close, viewer close, owner native/tray/hidden close, Hide/Show, process exit, Stop, PID reuse, replacement session and application exit have distinct section 6 outcomes.
- [ ] Scope/history selectors, live/completed Gold/Solo, Snapshot/Record again, Play/reconnect, End versus late free and coverage match existing contracts in all hosts.
- [ ] Narrow sidebar and large central layouts retain controls and unavailable labels without overflow.

These are acceptance gates, not checked evidence. Source review and automated fixtures do not replace real multi-window Tauri verification. Existing native Unity qualification does not qualify these workspace modes.

## 9. Out of scope

- A standalone/reduced-shell Profiler, general docking or rewritten editor framework.
- Another collector, debugger attach, recording model, persistent profile database or automatic owner handover.
- New metrics, managed heap capture, flame graphs, cross-process aggregation or cross-run comparison.
- Changing ordinary Duplicate Window, linked launch eligibility, debugger ownership or foreign-target teardown semantics.

## 10. Milestones and readiness

**Current delivery decision:** Milestone A is the intended current UX. For another IDE window, use ordinary Duplicate Window and open its Profiling tab; no dedicated Profiler new-window action is required. This does not share the original window's ongoing capture. B/C below remain a deferred shared-session proposal, not required follow-on implementation or acceptance gates for A.

### A. Editor Panel — independently deliverable

Extend the typed primary-tab model and existing editor boundary; retain `AppShell`, file behaviour and side editor. Rehost the existing Profiler with shared per-window inspection state. Implement primary-selection-only suppression, disabled panel toggle, shell-level show routing and nonredundant actions. Keep existing local collector ownership and frontend snapshot retention; no cross-window session binding, backend snapshot migration or new collector is needed for this milestone.

Hide Open in Linked Window until B and C pass; do not ship a disabled placeholder in A. A must deliver the wide-layout baseline in section 3B, not a stretched sidebar. Acceptance also requires file/dirty/shortcut/split regressions, stable scope/snapshot inspection across hosts and real shell visibility checks. A does not claim shared snapshot or Hide/Show restoration guarantees. Existing cleanup defects remain explicitly recorded in section 6; A does not certify them.

### B. Linked-view backend prerequisites — before enabling Linked Window

At the start of B, extract implementation-level routing, hydration, retention coordination and close/park mechanics from sections 5–6 into a dedicated backend implementation plan. Keep this document as the UX contract, retaining user-visible ownership/retention guarantees and a concise lifecycle table, with links to the plan for backend detail. Preserve every existing requirement and its acceptance coverage during that move; until the plan exists, sections 5–6 remain authoritative. Extraction belongs to milestone B and does not block milestone A.

Extend the existing profiling owner context and linked registry with validated display bindings, ordered query/subscription hydration, stale-command rejection and independent local-versus-linked routing, including Debug-created sessions. Move the existing bounded saved-view catalogue into that owner context, preserving identities and reviewed selections with oldest-unreviewed eviction. Retain bounded parked presentation intent and integrate idempotent owner finalisation into every native/tray/linked/hidden/exit path from section 6.

Prove late join, concurrent retention, all-eight-protected capacity, owner/viewer dual roles, process incarnation/replacement, source disconnect versus session end, Hide/Show/failed restore and actual owner cleanup. These are required backend work, not existing guarantees and not prerequisites for implementing A's editor host. B is a prerequisite for shipping linked viewing.

### C. Linked Window — gated on B

Use existing normal visible-window creation, bootstrap, identity, tray, focus and reuse paths. Add explicit Profiler startup/binding intent; do not adopt the origin's viewed-window context or use the ordinary duplicate hidden fallback. Verify a full editable IDE with independently navigable Profiler inspection, explicit local-session switching, no duplicate collector and correct close/Hide/Show behaviour in real multi-window Tauri runs. Keep ordinary Duplicate Window semantics and all three presentations intact.

**Readiness verdict:** Ready for staged implementation; no unresolved UX or architecture choice blocks A. Backend work in B and end-to-end evidence in C remain blockers to enabling Linked Window, not reasons to replace the existing architecture. The acceptance list spans these milestones; A alone cannot mark linked requirements complete. The original reconciliation was documentation-only; subsequent milestone A implementation and its evidence are recorded separately in the linked record.

**Core rule:** One bound Profiler capture; three places to view it. Independent process contexts stay independent. The normal IDE remains available throughout.

---

*Last updated: Phase 3.5, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a design.*
