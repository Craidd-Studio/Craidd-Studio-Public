# Unity profiling — detailed UI/UX acceptance runbook

**Roadmap track:** Phase 3.5 profiling, composing with Phase 3.x debugging.

**Status:** New execution plan, 17 October 2026. **Not run. No item below is pre-accepted.**
Prepared against `feat/unity/profiling-a-to-p` at `f520203` after workspace milestone A.
Record the actual tested revision; this baseline is not a promise about later builds.

**Purpose:** Let a human and an automated reviewer work through the real Unity
workflow, identify unusable interactions and prove measurement/ownership behaviour
before reviewing the proposed `feat/profiling` language extension. Creating this
runbook does not create that branch or commission linked-profiler milestones B/C.

## 1. Contracts and current boundary

Read the [workspace modes design](../feats/profiling/design-profiler-workspace-modes.md),
[milestone A record](../handoffs/handoff-phase-3-5-profiler-workspace-a.md),
[scope/snapshot contract](../feats/profiling/design-profiler-scopes.md),
[Gold contract](../feats/profiling/design-gold-capture.md),
[Unity fixture instructions](../../workspaces/unity/README.md), and
[earlier automated harness checklist](unity-profiling-harness-checklist.md).
Historical results remain evidence for their exact revision, not checks in this run.
The [execution handoff](../handoffs/handoff-profiling-acceptance-2026-10-17.md)
records the next session boundary. The [language extension plan](profiling-language-extension-plan.md) defines the next layer.

| Surface | Meaning to verify |
| --- | --- |
| Gold Solo / Start / End | Non-stopping recording intent, requiring a matching prepared provider. One Solo per recording context; other ranges are pairs. No separate Record ranges prerequisite. |
| Red breakpoint | Debugger stop in the real debuggee, with adapter-reported stop/continue scope. Profile-only attachment does not activate a debugger. |
| Blue Native Breakpoint | Linked native-debugging intent, using the qualified execution provider. Unity managed/LDI support is a separate gate. |
| Gold Linked Debug toolbar action | Linked debugger orchestration; not a Gold profiling marker, collector, or proof that Gold source instrumentation exists. |
| Full session | Current process overview within retained process history, plus correctly labelled session totals. |
| Gold/Solo scope | One selected recording window, shared by charts and detail views. Live becomes Recorded on the same ID with fixed End. |
| Manual snapshot | One immutable saved observation from the current live process, associated with all recordings active at capture time, regardless of viewed history. |
| Internal boundary observation | Sampled RSS/native End summary. Not a manual snapshot or heap dump. |
| Profiling tab | The existing Profiler rehosted in the normal IDE. Opening/closing it does not start/stop a collector. |
| Another IDE window | Independent profiling context today. Ordinary Duplicate Window does not subscribe it to the original capture. |

Current native support uses Linux process CPU/RSS and prepared C++ hooks. The
source exporter rejects non-C++ sources; arbitrary C#/Rust gutter placement,
managed heap objects/GC, allocation stacks, hardware cycles and GPU collection
are not established by this fixture. Unsupported-state clarity is mandatory;
unsupported end-to-end capability is not a pass.

### Known issues that must survive the handoff

| ID | Baseline evidence | Retest / acceptance consequence |
| --- | --- | --- |
| K01 | [Scope report](../bugs/17-10-2026/profiler-scopes-report.md#newly-observed-sustained-load-failure): ten-minute uncapped run lost 15 source events; bounded history held. | Retest loss-free operation and coverage notification separately. Short passes do not close this. Root cause/regression attribution remains open. |
| K02 | Scope report: option-level WebDriver selection did not activate a scope after returning from history; real keyboard input passed. | Physical pointer navigation and rendered recording identity require direct verification. Do not merely assert the select's DOM value. |
| K03 | [Human Appendix A](../bugs/17-10-2026/profiler-scopes-report.md#appendix-a--human-manual-verification-report) did not explicitly verify Stop Play → Play again without reattaching. | Perform and record this exact human sequence; do not inherit an automated result. |
| K04 | Scope/repair reports keep Monaco CSP, Explorer menu and debugger-hover issues separate. | Record whether each affects this run. SVG icons passing does not prove Monaco styles work. Do not silently change CSP to obtain a pass. |
| K05 | Rapid manual snapshots can share a second-level display timestamp. | Verify the user can distinguish/select them; retain unique IDs and record any label ambiguity as UX debt. |
| K06 | Workspace milestone A does not provide shared-session Profiler viewers or saved-history survival through webview destruction. | Do not turn B/C into a hidden prerequisite for A. Record close/Hide behaviour and its limits honestly. |

## 2. How to execute and mark results

Every task box starts unchecked. Check it only when the entire stated outcome is
proved for the identified run. A box is an acceptance result, not a reminder that
source exists. Keep one result row per ID per execution lane:

- **M:** human action in actual Unity and Craidd, including physical pointer work.
- **A:** real embedded Tauri/disposable Unity automation. Record exactly what it drives.
- **D:** source, unit, protocol or synthetic evidence. Useful support; never substitutes for M/A.

Default lane below is **M**. A reviewer may add A or D rows but cannot overwrite
an unrun human row. A script invoking `ExecuteMenuItem` is not a mouse click;
a batch-mode process is not a graphical Game view.

**Core** items govern the current native/UX gate. **Gated** items qualify a
specific extra provider, debugger or runtime path. A Gated end-to-end test whose
prerequisite is missing is BLOCKED, not PASS. It need not block an explicitly
limited native-fixture result, but it blocks a claim that that extra path works.

Use PASS / FAIL / PARTIAL / BLOCKED / NOT RUN / N/A. PARTIAL and BLOCKED leave the
box unchecked. N/A needs a reason and a scope exclusion; never use it for a
promised feature that fails. Record failures before changing code, preserve
before evidence, and rerun affected cases on the repaired revision.

| Run | Item ID | Lane | Result | Actual behaviour / values | Evidence | Defect / retest |
| --- | --- | --- | --- | --- | --- | --- |
| To fill | UP-… | M/A/D | NOT RUN | To fill | Screenshot/log/time interval | To fill |

For each evidence entry record the application/provider revision, PID plus birth
identity, profile ID, batch/generation, marker/capture IDs, snapshot IDs and
thread namespace where relevant. Capture both the whole IDE layout and the
specific interaction state. A value without its process/scope identity is insufficient.

### Execution order and checkpoints

1. Preparation and cold UI; do not attach during setup discovery.
2. Native attach → Play → controlled allocation/snapshots → Stop Play → Play again.
3. Scope navigation and sidebar/editor rehosting, first with pointer then keyboard.
4. Gold authoring, repeated/nested ranges and memory semantics.
5. Native MT, then native debugger composition; managed/Blue checks only with prerequisites.
6. Failure/recovery, retention and sustained runs on disposable instances.
7. Review defects, scope the result and decide whether to start the language extension.

Save a run record after each checkpoint. A failed later stress run does not erase
earlier UI observations, nor does an earlier pass make the stress result green.

## 3. Preparation and reproducibility — Core

- [ ] **UP-RUN-01** Record branch/HEAD, dirty/untracked baseline and whether the app is development, embedded debug or packaged release. Preserve unrelated work byte-for-byte.
- [ ] **UP-RUN-02** Record Unity version, OS/session/display scaling, viewport, panel widths, C++ toolchain, adapter path/version when used, plugin path/hash and source hash. Identify loaded-plugin provenance; source presence is insufficient.
- [ ] **UP-RUN-03** Run automation and destructive/fault scenarios only against a new disposable copy of tracked Unity sources. Exclude Library, Temp, UserSettings, old builds and the user's live Editor. Verify target PID, project path and ownership before control.
- [ ] **UP-RUN-04** Build the disposable plugin before its Editor loads it. Never overwrite a loaded original `.so`; record the reload/restart of the disposable instance when rebuilding.
- [ ] **UP-RUN-05** Give each harness run isolated app settings and discovery namespace/runtime paths. Two simultaneous disposable runs must not discover or attach to each other's target.
- [ ] **UP-RUN-06** Open the disposable `unity.cln` and `DebugProbe` scene. The fixture runs C# calling a C++ plugin in the Editor process; the `.so` is not itself a process to attach to.
- [ ] **UP-RUN-07** For exact memory checks, disable periodic allocations and workers, clear native allocations, and confirm direct native live bytes = 0. Record these settings rather than assuming fixture defaults.
- [ ] **UP-RUN-08** Establish an independent oracle: Unity before/after logs and overlay/direct native bytes, plus accepted provider/host records. Craidd displaying the number it generated is not an independent numerical check.
- [ ] **UP-RUN-09** Choose an evidence directory before testing. Retain failure screenshots, commands, stderr, counter baselines and exit reasons; exclude credentials/settings caches from committed evidence.
- [ ] **UP-RUN-10** Verify that opening the solution, opening source and discovering Unity do not themselves attach, pause, launch, or change the user's other window/session.

### Fixture inventory

| Variant | Setup and oracle | Availability / use |
| --- | --- | --- |
| F0 exact allocation | Ordinary disposable DebugProbe; periodic allocation/workers off; Allocate 1 MiB and Clear; native bytes 0 → 1,048,576 → 0. | Tracked fixture; first manual journey. |
| F1 workers | Enable fixture workers, record real native TIDs and known allocation ownership; repeat after stopping workers. | Tracked fixture; MT checks. |
| F2 overlapping intervals | Long outer/inner ranges plus Solo, controlled allocate/free and explicit End. | `tests/fixtures/attach-profiling/scoped_ranges.cpp` is compiled into harness copies only. Existing `unity-scopes` test drives it; there is no implied user menu in the ordinary fixture. |
| F3 prepared gutter anchors | Copy/rebuild `Native/anchored.cpp` using explicit Gold Start/End/Solo anchors and matching source/condition metadata. | Preparation must target a disposable project; original/loaded source stays unchanged. |
| F4 no Solo / recursion / early unwind / cross-thread free | Deterministic fixture with known event order and supported hooks. | Review/create missing disposable variants first. Missing fixture means BLOCKED, not a fabricated menu/test result. |
| F5 failure/long run | Authenticated test namespace, counters saved before cleanup, 60 fps target setting and uncapped setting, controlled disconnect/host death. | Existing harness covers parts; record actual observed frame progress/rate and which fault was intentional. |
| F6 managed/Blue | Qualified Unity managed adapter plus supported value-only native binding/reproduction and provider coverage per process. | Not established by native fixtures. Gate separately. |

## 4. First complete user journey — Core, human

Use F0, sidebar, a fresh collector, Unity started before Craidd and no explicit
socket environment variable. This is the first checkpoint to run together.

- [ ] **UP-JNY-01** From a cold workspace, locate Run → Attach to Process without external instructions about environment variables or an invisible recording prerequisite. Record unclear labels/clicks.
- [ ] **UP-JNY-02** Select the actual matching Editor, explicitly choose Profile only, and see its name/PID and connection/readiness. Unity remains responsive and no debugger pause occurs.
- [ ] **UP-JNY-03** Press Unity Play. See active recording/Gold coverage and changing CPU/RSS. Full session is the initial scope; automatic Solo creation does not steal focus.
- [ ] **UP-JNY-04** Physically click Game-view Allocate 1 MiB. Verify frame progress, action feedback/log and 0 → 1,048,576 direct bytes; the appropriate native cohort becomes 1.00 MiB. Editing an Inspector number must not be needed.
- [ ] **UP-JNY-05** Take a manual snapshot once. Capture continues and current source/scope/tab remain selected. The saved moment is easy to find in its own history control.
- [ ] **UP-JNY-06** Physically click Clear. Verify direct live bytes return to 0 and native freed observations rise; the earlier snapshot still contains 1.00 MiB. Do not require process RSS to fall by 1 MiB.
- [ ] **UP-JNY-07** Save a second moment, select both snapshots and compare values. Use one Live action to restore the current full-session view. Record the selected snapshot IDs, not only their names.
- [ ] **UP-JNY-08** Select live Solo. Stop Play in Unity and observe the same selected ID become Recorded with fixed boundaries. Results remain inspectable.
- [ ] **UP-JNY-09** Press Play again without reattaching. Record a new batch/generation and new Solo ID while the old selected Solo stays Recorded. Explicitly switch to Full session/new Solo to inspect the new run.
- [ ] **UP-JNY-10** Click Stop profiling. The same Editor remains alive and playing; charts/captures stop advancing for that session, results remain and discovery is disarmed.

## 5. Attach, identity and action clarity — Core

- [ ] **UP-ATT-01** With no target selected, Attach text and all SVG toolbar glyphs are visible with no file open, with Monaco open, and in the editor-host presentation. No icon depends on a runtime icon font/style injection succeeding.
- [ ] **UP-ATT-02** Main Unity Editor and AssetImportWorker/helper processes are distinguishable. A helper is never preselected as the matching Editor just because its executable is hard-linked to Unity.
- [ ] **UP-ATT-03** A single verified project match may be preselected; multiple matching Editors require deliberate choice. Search by visible name, executable and PID works; Refresh updates the list without silently attaching.
- [ ] **UP-ATT-04** Cancel/escape leaves collector, target and prior inspection unchanged. Failed attachment also preserves the prior valid view rather than showing a half-selected replacement.
- [ ] **UP-ATT-05** Profile only is distinct from Attach debugger and available under the documented process-metrics conditions. Adapter hints do not claim a qualified Unity C# adapter.
- [ ] **UP-ATT-06** Source-provider absence still permits supported process gauges. UI explains how prepared hooks differ from ordinary gutter intent; no source events is not a measured zero-allocation result.
- [ ] **UP-ATT-07** Attempt a stale PID/birth identity in a controlled fixture. Reject it clearly; no attachment or stale command transfers to a replacement process.
- [ ] **UP-ATT-08** Already-owned target, exited target and permissions failure each produce a useful reason and recovery action. No host-wide ptrace/security setting is silently changed.
- [ ] **UP-ATT-09** Attempt a second collector for the same process incarnation from another disposable IDE. Duplicate ownership is refused; independent targets still work.
- [ ] **UP-ATT-10** Repeat attachment with Unity already playing. Provider discovery and active-generation state converge without restarting Unity or inventing an extra Solo per context.

## 6. Sidebar layout, accessibility and ordinary IDE use — Core

- [ ] **UP-UI-01** At 288, 360 and 420 px outer sidebar widths, inspect Summary, Gold, Memory, Events and settings: labels, dropdowns, tooltips, buttons and vertical scrolling remain usable without panel-level horizontal overflow.
- [ ] **UP-UI-02** Measure real client/scroll widths, viewport and DPR. Test 100% plus available fractional/high scaling; do not infer a scaling pass from one 1280×800/DPR-1 screenshot.
- [ ] **UP-UI-03** Resize while data arrives and while reviewing a snapshot. Graphs track the available width; controls do not cover the timeline, footer, tabs or each other.
- [ ] **UP-UI-04** Every toolbar action has a distinguishable icon, tooltip/accessibility name, enabled/disabled state and keyboard focus indicator. Tab order reaches Snapshot, Record again, Stop and settings predictably.
- [ ] **UP-UI-05** Idle, Ready for Play, Live, Recording, Recorded, Snapshot, Stopped, Incomplete and Unavailable are understandable as different states. Text supplements colour, and connection alone never means an old Solo is recording.
- [ ] **UP-UI-06** Hover controls/gutters at top, bottom and right edges. Menus/tooltips remain readable and selectable rather than clipped, offscreen or covering their own actions.
- [ ] **UP-UI-07** Use physical pointer and keyboard to change scope after Live → snapshot → Live, including repeated selection of the same benchmark. Assert the actual caption/capture ID and chart window, not just dropdown value. Retest K02 explicitly.
- [ ] **UP-UI-08** Scope and snapshot controls have different purposes and labels. Neither mixes periodic Gold invocations into global manual history; one-click Live return is discoverable.
- [ ] **UP-UI-09** Rapid snapshots remain independently selectable even if timestamps collide. Record ambiguity, truncated names and whether identity/time detail can be discovered; do not accept unique hidden IDs as sufficient UX.
- [ ] **UP-UI-10** Opening/closing menus, changing tabs and expanding recorded hits do not change recording, steal keyboard focus on incoming samples or collapse the user's inspection unexpectedly.
- [ ] **UP-UI-11** Native bytes, process RSS, milliseconds and CPU-thread measurements have consistent units/precision. Missing values read unavailable/—, never fabricated zero; empty graphs explain their state.
- [ ] **UP-UI-12** Keep source editing, project navigation, output, diagnostics and status bar usable alongside monitoring. Record Monaco styling, Explorer menu and hover failures under separate defect IDs instead of treating profiler icons as proof of all IDE styling.

## 7. Profiling editor tab and host switching — Core

Run the [milestone A](../handoffs/handoff-phase-3-5-profiler-workspace-a.md)
journey in the Unity context as well as its earlier standalone native fixture.

- [ ] **UP-HOST-01** Open in Editor Panel creates/focuses exactly one typed **Profiling** primary tab beside source files. Repeating the action does not duplicate tabs, listeners, samples or collectors.
- [ ] **UP-HOST-02** The expanded presentation keeps the full IDE shell. Summary figures form a compact row, CPU/RSS/Gold tracks share the width/ruler, and Gold offers a readable hits table with adjacent details.
- [ ] **UP-HOST-03** At a 900 px application window and other practical widths, figures wrap and table/details stack as necessary. Measure expanded content width; controls and essential labels remain accessible.
- [ ] **UP-HOST-04** Selecting a Gold table row changes inspected details only. Focus recording explicitly changes the shared scope. Inspecting another hit must not silently alter all charts.
- [ ] **UP-HOST-05** Profiling → dirty source → Profiling preserves file contents/undo/view state, process/profile/capture/snapshot IDs, result tab, filters, range, expansion, selected hit and relevant scroll position.
- [ ] **UP-HOST-06** Active primary Profiling suppresses both the right host and resize handle. Selecting primary source restores the saved sidebar preference, width and Debugger/Profiler tab rather than forcing it open.
- [ ] **UP-HOST-07** With the sidebar manually collapsed before opening Profiling, switching back to source leaves it collapsed. Suppression never rewrites the saved preference.
- [ ] **UP-HOST-08** Open/focus split source beside primary Profiling. No sidebar flicker occurs. Keyboard focus in split code does not change primary tab selection or suppression.
- [ ] **UP-HOST-09** Ctrl+W in split source closes the side group; primary-focused Ctrl+W, tab close and middle-click close Profiling only. Closing an inactive source/Profiling tab does not retarget another active primary tab.
- [ ] **UP-HOST-10** Save/Save As/F9/Undo/Redo while Profiling owns focus do not alter hidden code or try to read/save a synthetic profiler path. With split source focused, normal file commands still address that source.
- [ ] **UP-HOST-11** Prepare source copy uses a valid saved remembered source file, with dirty validation. A workspace-tab key is never passed as a filesystem path.
- [ ] **UP-HOST-12** Panel toggle is disabled with its explanation while primary Profiling suppresses the host. Menu/toolbar focus does not change suppression or silently change preference.
- [ ] **UP-HOST-13** Trigger the ordinary show-profiler reveal while the right host is unmounted. An existing Profiling tab is activated; otherwise sidebar Profiler is explicitly shown, without attachment or control-target changes.
- [ ] **UP-HOST-14** Close Profiling during active recording and during snapshot review. Collection continues in the same owner; sidebar inspection is restored. No unintended Stop/Record again/snapshot occurs.
- [ ] **UP-HOST-15** No redundant Open in Editor Panel action appears in the central view. Open in Linked Window remains absent in milestone A, and ordinary Duplicate Window does not claim to share this capture.

## 8. Gold authoring, provider preparation and gutter UX — Core

Boundary variants that need new fixture support must record that prerequisite;
inventing source execution is not an acceptable workaround. A missing fixture
leaves the case BLOCKED until it is deliberately prepared and executed.

- [ ] **UP-GOLD-01** Ordinary source gutter offers Red and nested Profiling actions with clear Start, End and Solo meaning. Clicking an existing Gold marker exposes Remove breakpoint (or Remove breakpoints (Start + End)) and Add Condition to Profile Breakpoint / Edit Condition on Profile Breakpoint in a reachable menu.
- [ ] **UP-GOLD-02** Filled/hollow/solo Gold markers and paired ranges are distinguishable without being painted as red stop breakpoints. Test hover, selection, disabled/unbound state and nearby/overlapping Red/Blue intent.
- [ ] **UP-GOLD-03** At most one Solo is allowed per context; all other recordings are paired. Creating a second Solo produces a clear resolution rather than silently accepting two independent forever recordings.
- [ ] **UP-GOLD-04** Start/End must belong to the intended source, lexical block and order. Invalid End-before-Start, missing endpoint or wrong-file pairing is rejected or visibly incomplete, never silently re-paired.
- [ ] **UP-GOLD-05** Removing/editing a paired marker updates the intended pair/condition consistently; Red/Blue markers and their conditions are not removed as collateral damage.
- [ ] **UP-GOLD-06** A supported scalar condition can be prepared and rebuilt; false hits create no matching recording and true hits pair correctly. Capture metadata reflects the compiled condition, not a later gutter edit. Editing from End explains that evaluation occurs at Start.
- [ ] **UP-GOLD-07** Unsupported member access, calls/getters or expressions are rejected before arming with an explanation. No debugger-evaluated stop/continue is used to fake non-stopping Gold recording.
- [ ] **UP-GOLD-08** Save intent, prepare a source copy and inspect its output/build instructions. Original source/hash stays unchanged. No loaded library is patched and no arbitrary line is claimed instrumented.
- [ ] **UP-GOLD-09** With a dirty or changed source, stale artifact, edited marker or stale prepared binding, show the required save/review/rebuild/reload path. Old recorded names/IDs remain historical, not relabelled to new intent.
- [ ] **UP-GOLD-10** The C++ anchor path actually emits matching events after rebuilding/reloading the disposable plugin. C#/Rust preparation attempts explain unsupported export rather than pretending instrumentation succeeded.
- [ ] **UP-GOLD-11** Run ranges-only/no-Solo fixture F4: Full session remains useful, paired measurements record automatically and no Solo is fabricated as a prerequisite.
- [ ] **UP-GOLD-12** With F2/F4, nested, repeated and recursive invocation endpoints pair by marker/thread/invocation. Overlap does not turn one completion into another recording's End.
- [ ] **UP-GOLD-13** Controlled return/throw/unwind/missing End produces the provider's truthful completion/incomplete status; it does not invent normal End, CPU, or memory data.
- [ ] **UP-GOLD-14** A Solo entered in a short function continues until the defined Play/session/batch boundary, not implicitly until function exit. A paired block ends at its actual compiled End/destructor path.

## 9. Scope navigation, history and focused graphs — Core

Use F2 for long active intervals; very short scalar hits alone cannot exercise
manual selection during Recording. Run these checks in sidebar and editor hosts.

- [ ] **UP-SCOPE-01** Full session starts as the current overview; all prepared markers record regardless of displayed scope. New Solo, marker hits or batches do not hijack explicit inspection.
- [ ] **UP-SCOPE-02** Scope lists each benchmark once, even with 128 retained scalar hits. Choosing it focuses a defined retained invocation once; the caption identifies the actual batch/thread/time/status.
- [ ] **UP-SCOPE-03** Browse individual retained hits/segments through collapsibles/table and Focus recording. Expand several, inspect long labels and verify chronological/capture identity without making the menu a periodic-hit dump.
- [ ] **UP-SCOPE-04** Timeline click and Focus recording select the same recording identity and window. Nested intervals use distinguishable lanes; dense extra intervals remain accessible in retained history.
- [ ] **UP-SCOPE-05** Select an active Gold interval. Observe growing right boundary, then End: the same ID visibly becomes Recorded, boundaries freeze and the selected result tab remains unchanged.
- [ ] **UP-SCOPE-06** Repeat the completion check for Solo at Stop Play and Record again. Subsequent Play and incoming hits do not move the old recorded interval or change the selected view.
- [ ] **UP-SCOPE-07** Switch Summary/Gold/Memory/Events and sidebar/editor presentation. Each uses the same selected window, with no hidden benchmark filter overriding process charts.
- [ ] **UP-SCOPE-08** Graph drag/range controls stay inside the recording bounds and reset deliberately. Arbitrary subwindow native activity is unavailable when no event journal exists; whole-recording cohort totals remain labelled.
- [ ] **UP-SCOPE-09** A retained recording with aged process samples shows partial/unavailable history while preserving available End summaries. No synthetic historical graph is reconstructed.
- [ ] **UP-SCOPE-10** Evict a selected ordinary completed hit. Its descriptor remains Unavailable with empty scoped charts; it does not silently select a later hit or fall back to Full session.
- [ ] **UP-SCOPE-11** A missing open recording whose End was never observed does not display zero duration as a measurement. Unknown end/duration and process samples remain unavailable.
- [ ] **UP-SCOPE-12** One Live action clears historical snapshot/recording selection and returns to the current full-session overview without starting another collector or changing Play.

## 10. CPU, RSS, clocks and numerical interpretation — Core

- [ ] **UP-MET-01** CPU labels distinguish whole-process CPU time per polling interval, recording-thread CPU, wall duration and planned hardware cycles. Solo CPU is unavailable when not measured.
- [ ] **UP-MET-02** Compare the displayed window and sample counts against accepted host observations. CPU buckets are formed before filtering; crossing Start/End buckets are not wholly charged to the recording.
- [ ] **UP-MET-03** A sub-poll interval with no contained process observations still shows supported native data and unavailable CPU/RSS samples, not a fake zero workload.
- [ ] **UP-MET-04** RSS is labelled process-wide and retains its real baseline. A Gold interval does not convert it into function-exclusive allocation or managed heap size.
- [ ] **UP-MET-05** Start/End RSS summaries identify real observation timestamps/offsets. The same old sample at both ends is not presented as proof of zero RSS change.
- [ ] **UP-MET-06** When CPU activity or a deliberate sleep differs, charts/interval labels remain consistent with the oracle. Do not require exact wall/CPU equality or exact polling interval scheduling.
- [ ] **UP-MET-07** Whole-process observations can include other threads and work outside an instrumented function. Nested capture CPU/cohort totals are not summed into an invented unique process total.
- [ ] **UP-MET-08** Clock/order anomalies, incomplete coverage and missing metadata stay explicit. Negative time, NaN, huge guessed durations and line-zero/source guesses do not become valid plotted measurements.

## 11. Native memory, ownership and End semantics — Core

- [ ] **UP-MEM-01** With exact F0 baseline, Allocate 1 MiB changes direct native live bytes 0 → 1,048,576 and the relevant inclusive cohort by exactly 1 MiB. The whole-process unique observed native total counts the allocation once.
- [ ] **UP-MEM-02** Clear reports the corresponding free and live 0. RSS may remain elevated. No wording claims that a live cohort is necessarily leaked or that a stable RSS proves a failed free.
- [ ] **UP-MEM-03** Allocate twice while retaining both allocations, then Clear. Record native and displayed deltas/counts, guarding against address reuse and stale-allocation attribution.
- [ ] **UP-MEM-04** In overlapping outer/inner/Solo intervals, each owning cohort may contain the same allocation, but Full-session unique observed totals do not multiply it by the number of owners.
- [ ] **UP-MEM-05** End a recording with 1 MiB live, then free it later. End allocated/freed/live stay fixed; current survivors become 0 and Freed after End rises separately.
- [ ] **UP-MEM-06** Free an allocation created before a new interval begins. Window free activity may rise without attributing the old allocation to that interval's newly allocated cohort.
- [ ] **UP-MEM-07** With an appropriate disposable variant, allocate on one native worker and free on another. Ownership follows the actual allocation, not the thread selected in the UI.
- [ ] **UP-MEM-08** Unknown-size/unmatched frees and lost coverage show counts/unavailable data, not invented byte sizes or negative live memory. Partial tracking is visibly distinguished from complete heap capture.
- [ ] **UP-MEM-09** Component disable, Play stop and application quit free fixture-owned allocations as documented; logs identify automatic cleanup. Do not misattribute it to the user pressing Clear.
- [ ] **UP-MEM-10** Native cohorts, process RSS/virtual memory, managed heap/GC, heap objects/stacks and GPU each state their actual capability. An unsupported managed allocation action cannot produce a fake managed lifetime trace.

## 12. Manual snapshots and active associations — Core

Use several saved moments and F2 with simultaneously active outer/inner/Solo.
A snapshot saves the latest collected live observations; it is not a new exact
heap census. Record observation timestamps as well as the user action time.

- [ ] **UP-SNAP-01** Capture with no Gold recording. A manual moment is saved globally; selection and collection continue. Gold is not a prerequisite for supported process observation capture.
- [ ] **UP-SNAP-02** Capture multiple moments during one active Gold interval. Each has a unique identity and remains independently selectable from global history and that recording's associated list.
- [ ] **UP-SNAP-03** During overlap, one capture identity belongs to every relevant active recording. Inspect both associated groups and global history; the underlying saved payload is not duplicated per owner.
- [ ] **UP-SNAP-04** View a completed Gold interval while a different live interval runs; Take Snapshot stays enabled and saves current live data. It associates only with currently active recordings, never the completed selected one.
- [ ] **UP-SNAP-05** Repeat from an older saved snapshot and from Full session. New saved data follows the live process, not the old viewed measurement; current source/scope/tab/ruler remain selected after capture.
- [ ] **UP-SNAP-06** Complete an associated Gold interval and inspect its saved moments again. Associations and immutable historical values survive completion and later frees within the retention bound.
- [ ] **UP-SNAP-07** Global history always exposes other manual moments and separately labelled previous-session archives. Related grouping neither hides unrelated snapshots nor duplicates entries in the menu.
- [ ] **UP-SNAP-08** Explicitly selecting a snapshot shows its frozen process/captures/context. An interval open then reads Open at snapshot; later live End/Play/free events do not rewrite that copy.
- [ ] **UP-SNAP-09** Compare retained-before-clear and released-after-clear snapshots. RSS/native columns and deltas use actual saved observations; a first row with no baseline shows — rather than an invented delta.
- [ ] **UP-SNAP-10** Save beyond eight views while reviewing an old snapshot. Keep that selected ID, tab and window; evict the oldest other view, stay at eight, and do not change to Live as a side effect.
- [ ] **UP-SNAP-11** After eviction, only retained associations are promised. Recording detail/global history must not display dangling selectable saved identities or silently recreate evicted data.
- [ ] **UP-SNAP-12** After process replacement, previous-session archive labels and process incarnations stay distinct. A snapshot from the old process is never associated with active IDs in a new profile.
- [ ] **UP-SNAP-13** Snapshot and record again saves one manual observation and starts the defined new batch/Solo segment. It preserves inspection of an older view and does not delete allocations still owned by the old segment.
- [ ] **UP-SNAP-14** Start/End internal observations do not flood manual history. Unsupported heap dumps remain unavailable, and no manual capture claims an instantaneous managed heap census.
- [ ] **UP-SNAP-15** With no supported live process/samples, capture controls explain their disabled state. Historical review remains usable; stopped data is not silently reclassified as a new live snapshot.

## 13. Native multithreaded profiling — Core

Use F1/F4 with deliberate names and a recorded worker lifecycle. Native provider
TIDs and adapter DAP IDs are separate unless a mapping is explicitly verified.

- [ ] **UP-MT-01** Main thread and multiple active workers produce distinguishable capture thread IDs/known labels. Unknown names remain unknown; no guessed name/identity is assigned.
- [ ] **UP-MT-02** Concurrent invocations of the same marker pair independently by thread/invocation; one worker's End cannot close another's interval.
- [ ] **UP-MT-03** Select a thread and batch in Gold. Visible retained hits change as documented; other workers keep progressing and whole-process CPU/RSS do not become selected-thread graphs.
- [ ] **UP-MT-04** Preserve filters/details/expanded history as new hits arrive and across host switches. If a thread has no hits in the chosen window, empty-state behaviour is clear rather than borrowing another thread's data.
- [ ] **UP-MT-05** End workers, create a new cohort and change Play generation. Old history remains owner-qualified; reused numeric IDs do not relabel old captures as new workers.
- [ ] **UP-MT-06** Start/stop workers while viewing a completed recording and a snapshot. The old selection remains fixed while current worker membership changes.
- [ ] **UP-MT-07** Exercise a waiting worker and a CPU worker. Captured wall/CPU meanings and UI labels stay truthful; a thread row's elapsed counter is not offered as an allocation trace or hardware-cycle metric.
- [ ] **UP-MT-08** Selection alone never promises execution isolation. Any explicit per-thread execution mode needs separate adapter/control-mode evidence; a conditional Red breakpoint does not freeze unrelated workers and no universal `thread.id` predicate is invented.

## 14. Native Red breakpoint + Gold composition — Gated debugger path

Qualify the actual installed native adapter first. Use a disposable development
player or an explicitly authorised disposable Editor under permitted attach
conditions. Do not change the machine's ptrace policy or attach to the user's Editor.

- [ ] **UP-RED-01** Record target identity, adapter/version/capabilities and a verified native source breakpoint. Profile only alone never pretends Red is active.
- [ ] **UP-RED-02** Start profiling with Gold while the real debugger is attached. The declared compatible combination works, or coexistence is refused with a useful reason; no second conflicting tracer is silently injected.
- [ ] **UP-RED-03** Stop at Red before Gold Start, between Start/End and after End in separate runs. Inspect stack/locals and correlate actual DAP stop/continue with profiler pause records.
- [ ] **UP-RED-04** Keep the process paused for a measured interval. Wall time includes that pause; CPU does not pretend to be wall time, and no missing process sample is invented to fill the pause.
- [ ] **UP-RED-05** Step/Continue uses the adapter's true all-threads/single-thread scope. Compare worker progress and reported stopped/continued flags; selection does not itself suspend a worker.
- [ ] **UP-RED-06** While stopped, browse snapshots and completed/live scopes without resuming execution. Capture remains available only to the extent live observations are supported, with actual timestamps visible.
- [ ] **UP-RED-07** Disable/remove a Red breakpoint and edit its supported condition. Profiling markers, prepared Gold pairing and historical captures remain independent.
- [ ] **UP-RED-08** Pause or interrupt before a paired End and then stop debugging/exit the target. Open records finish with the truthful terminal/incomplete status rather than a false normal completion.
- [ ] **UP-RED-09** Test debugger Detach/Stop and Profiler Stop separately, recording which component created/owns the profiling session. Behaviour follows that ownership and leaves foreign Unity alive; no assumption that all debugger exits preserve all collectors.
- [ ] **UP-RED-10** Reattach/restart under a new debug generation. Old frames/thread IDs and old capture identities cannot drive commands against the replacement session.

## 15. Unity managed, Blue and LDI boundaries — Gated

First verify truthful unsupported states (UP-MEM-10/UP-GOLD-10/UP-ATT-05).
The remaining end-to-end cases require a qualified Unity runtime/adapter and
supported binding. Native LLDB attachment or CoreCLR netcoredbg success is not
proof of Unity Mono/IL2CPP debugging. Record a separate row per runtime/backend.

- [ ] **UP-BLUE-01** Inventory available Unity managed adapter/runtime support and provider coverage. If absent, mark this integration BLOCKED with the missing component; do not turn a C++ stop into a C# breakpoint pass.
- [ ] **UP-BLUE-02** In a qualified configuration, verify actual C# source stop/stack/locals and caller identity before exercising Blue. Native and managed thread IDs stay in their own session namespaces.
- [ ] **UP-BLUE-03** Arm a supported scalar/value-only C#→C++ Blue binding. Clearly identify original held process A, native reproduction B and the invocation token; no `.so` is represented as an independent running target.
- [ ] **UP-BLUE-04** Place Gold and, where supported, Red in B. B records only if its actual built artifact emits hooks; it never inherits A's marker/provider coverage just from pairing.
- [ ] **UP-BLUE-05** A and B retain separate process/heap/clock/capture histories. Do not add replay CPU/allocations to the original Unity workload or associate snapshots across independent process contexts.
- [ ] **UP-BLUE-06** Continue/cancel/Stop/close during reproduction, then hit Blue again. Old tokens/holds/frames clear and eligible prepared bindings rearm according to their contract; no stranded origin or stale control routing remains.
- [ ] **UP-BLUE-07** Reject stateful/global/unsupported copied-input calls as value-only reproduction where required. Neither invocation order nor pointer values establish a safe copied heap/state context.
- [ ] **UP-BLUE-08** MT origin selection remains fixed for the reproduction even when inspecting another thread/window. An ordered fixture is not reported as arbitrary simultaneous held-call support.
- [ ] **UP-BLUE-09** All-three Red + Gold + Blue composition has separate proof for stop scope, non-stopping capture and correct hold/release. The Gold Linked Debug control is not confused with Gold profiling markers.
- [ ] **UP-BLUE-10** Failure/unsupported UI offers an accurate next action without mutating user source/runtime settings or making new Unity managed/heap claims. No full Unity managed/LDI acceptance is recorded while prerequisites remain blocked.

## 16. Play, batch, lifetime and ordinary ownership — Core

- [ ] **UP-LIFE-01** Cold Editor → attach → Play → Stop Play → Play again follows real Play generations. Stopping Play keeps the armed context Ready for Play; each next Play opens the correct new recording batch.
- [ ] **UP-LIFE-02** Repeat that complete sequence at least three times without reattaching; capture identities stay unique and manual history remains retained within bounds. Record physical human steps separately from automation.
- [ ] **UP-LIFE-03** Enter Play with a preselected completed Solo/Gold/snapshot. Starting new work does not steal the old view; the user can deliberately return Live or select the new recording.
- [ ] **UP-LIFE-04** Test the fixture's supported domain-reload setting combinations on disposable copies. Record actual settings, reinitialisation/cleanup and unsupported combinations; never infer all Unity lifecycle modes from the default.
- [ ] **UP-LIFE-05** Disable/re-enable the component during Play. Worker/allocation cleanup and resumed native coverage are visible; no orphan open ranges masquerade as complete.
- [ ] **UP-LIFE-06** Stop profiling during Play, then attach the same still-running Editor again. Disarm/rearm is explicit and old results are not relabelled as the new owner session.
- [ ] **UP-LIFE-07** A disposable development player exits normally and abnormally in separate runs. Final results/status match the actual exit, while the Editor workflow remains separately qualified.
- [ ] **UP-LIFE-08** Closing only Profiling or switching source tabs never stops capture. Cancelled window-close/dirty prompts do not finalise the owner prematurely.
- [ ] **UP-LIFE-09** Native window close, tray/linked close and application exit each leave foreign Unity alive and eventually revoke/reject obsolete routes. Record current cleanup defects by path; a pass on one path does not certify another.
- [ ] **UP-LIFE-10** Observe Hide/Show on a disposable owner and record whether capture/history/presentation survive. Do not claim milestone B/C parked/shared restoration guarantees from A or promise persistence across application restart.
- [ ] **UP-LIFE-11** Ordinary Duplicate Window retains its own IDE/configuration behaviour and independent profiler context. It neither controls the origin's collector nor pretends to display shared snapshots; no second collector may seize the same target.

## 17. Disconnect, failure feedback and recovery — Core with disposable faults

Use harness-owned PID/birth/ancestry checks for any injected failure. Record
counter values **before assertion and before cleanup**. A cleanup disconnect is
not evidence of a spontaneous transport failure, nor a reason to erase a gap.

- [ ] **UP-FAIL-01** Simulate a provider disconnect during Solo and during a paired range. Affected records become Incomplete with frozen boundaries; connected/readiness text does not falsely leave them Recording.
- [ ] **UP-FAIL-02** Reconnect the same permitted target. A fresh Solo can open; old completed/incomplete segments and outstanding owned allocations survive with truthful late-free observations.
- [ ] **UP-FAIL-03** Introduce an intentional missing sequence/End in a controlled fixture. Source-gap counters and affected coverage status change; a future End cannot silently complete the wrong invocation.
- [ ] **UP-FAIL-04** Inject malformed/rejected events separately. Rejections, missing source events, disconnects, aged samples and evicted captures remain distinguishable in labels, counters and diagnostics.
- [ ] **UP-FAIL-05** Observe an interruption while inspecting the relevant window. Verify the warning actually renders promptly/readably in UI; a backend counter alone is not a coverage-notification pass.
- [ ] **UP-FAIL-06** Retained timestamped diagnostics are filtered to overlapping windows; global counters stay labelled session context. A pre-existing gap is not newly attributed to every later recording.
- [ ] **UP-FAIL-07** Kill only the harness-owned host, preserving before evidence. Stale sockets/routes are rejected/reclaimed, the foreign Editor survives, and a new host explicitly reconnects without restarting that Editor.
- [ ] **UP-FAIL-08** Wrong/stale/private namespace or PID identity cannot redirect events to another profile. Missing runtime path, unwritable path and malformed discovery data produce recoverable errors.
- [ ] **UP-FAIL-09** Compare XDG runtime discovery and the documented HOME fallback in disposable environments. Do not modify system paths/global environment or leak another run's route.
- [ ] **UP-FAIL-10** Dismiss an error and retry through normal UI. Error recovery does not silently attach a different target, reset a historical selection, or manufacture a successful complete record.

## 18. Retention, load and responsiveness — Core

Record requested and observed frame/work rates, elapsed time, counters before/after,
process/provider versions, memory trend and user-action latency. Run normal and
fault-injected sessions separately; anticipated capacity/cleanup events are not
excuses for unexplained source loss in a nominal zero-loss test.

- [ ] **UP-LOAD-01** At the fixture's 60 fps setting, run allocate → snapshots → clear → Record again → repeated Play with workers off, then on. All expected native events are accounted for; collect runtime gap/rejection/disconnect deltas separately from teardown.
- [ ] **UP-LOAD-02** Repeat at uncapped setting beyond 2,000 raw captures. The hot scalar marker cannot consume all retained history or evict Solo/open/live-cohort records.
- [ ] **UP-LOAD-03** Run at least ten minutes **and until agedSamples > 0**. Save the actual aging-time profile/counters and rendered warning before assertions/cleanup. Retest K01: nominal source loss/rejection/disconnect deltas must be zero for a zero-loss pass.
- [ ] **UP-LOAD-04** After real sample rollover, allocate/clear again, create/review a snapshot, Record again and Stop Play → Play. Do not stop the test at the first aged sample or count unexecuted tail checks as passed.
- [ ] **UP-LOAD-05** Verify 2,400 process samples, 2,000 total captures and 128 ordinary completed hits per marker are respected with documented pinning. Rare/live cohorts remain available while hot ordinary history rolls.
- [ ] **UP-LOAD-06** Reach controlled allocation-tracking/storage capacity where the fixture supports it. The 20,000-allocation/256-diagnostic-burst bounds stay bounded and capacity/loss is visible instead of presenting a complete heap trace.
- [ ] **UP-LOAD-07** Retain an old selected recording during history rollover. Detailed samples may age out, but fixed available End summaries remain; unavailable details are never reconstructed from current data.
- [ ] **UP-LOAD-08** During sustained load, resize, switch hosts/tabs, select history and click Stop. Record response times and freezes; monitoring must not make basic inspection/control unusable.
- [ ] **UP-LOAD-09** Observe host/target memory after repeated batches/Play cycles. Separate retained-window plateau, intentional target allocations and unexplained growth; do not declare a leak from RSS alone.
- [ ] **UP-LOAD-10** Fault and capacity reports distinguish intentional event loss, unexpected loss and ordinary aging. Do not relabel source loss as sample eviction to make the run pass or block Unity's main thread to hide backpressure.

## 19. Existing automated commands and their proof limits

Run from the repository root with the installed desktop/socket prerequisites.
Read the scripts before execution; a missing prerequisite is recorded as BLOCKED.
These are existing commands, not results of creating this document:

```sh
npm run build
node tests/profiling.test.mjs
npm run test:profiler-workspace
npm run test:ui:build
npm run test:ui:profiler-workspace
npm run test:ui:profiling
npm run test:ui:profiling:long
```

For only the existing rolling-history uncapped case:

```sh
CRAIDD_TEST_UNITY=1 CRAIDD_TEST_LONG=1 node --test --test-name-pattern='uncapped fps' tests/ui/unity-profiling.test.mjs
```

`test:ui:profiling` drives disposable batch-mode Unity menus with file signals
and separately tests the graphical overlay. Its scope case uses real keyboard
selection. `test:ui:profiler-workspace` currently uses a standalone disposable
native target, not Unity; it supports host-regression evidence, not a Unity-wide
pass. The synthetic `tests/ui/profiling.html` and store tests are D evidence.
Do not infer physical button clicks, Inspector repaint, packaged deployment,
qualified Unity C# or LDI from those passes. Long-run failure evidence and all
post-roll tail checks must be retained, even when the command exits nonzero.

## 20. Report, defect triage and branch decision

- [ ] **UP-EXIT-01** Publish per-ID results separated by M/A/D with PASS/FAIL/PARTIAL/BLOCKED/NOT RUN/N/A totals, exact commands/revisions and links to screenshots/raw bounded evidence. Preserve the human Appendix A as its original dated observation.
- [ ] **UP-EXIT-02** For each defect record severity, repeatable steps, actual/expected state and measurement identities, before evidence, ownership impact, proposed fix and retest status. Distinguish product failure, harness failure and environment failure with evidence.
- [ ] **UP-EXIT-03** Any repaired case is rerun on the named repair build, plus relevant regressions. Do not report the whole matrix green because one new targeted test passed.
- [ ] **UP-EXIT-04** Core native workflow, pointer navigation, host switching, snapshots and loss/coverage results receive a named human review. Gated Unity managed/Blue/heap/GPU limitations are listed without broadening the result.
- [ ] **UP-EXIT-05** Review K01–K06 explicitly: fixed with proof, still open, or documented scope limitation. Untested failures are not silently dropped when changing branches.
- [ ] **UP-EXIT-06** Decide together whether the baseline is accepted, needs repair, or is suitable only for experimental continuation with named open defects. Record the exact checkpoint commit to carry forward.
- [ ] **UP-EXIT-07** Only after that review, decide whether to create `feat/profiling` and execute the language extension. Do not require deferred shared-view B/C to finish native milestone A, and do not label experimental branch creation full profiler acceptance.

### Result form for the next execution

```text
Run ID / date / operator:
Craidd branch, source SHA, binary hash, build mode:
Unity version, disposable project path, PID/birth, plugin/source hash:
Provider/adapter versions, namespace and preparation:
Window/panel sizes, DPR/scaling, F0–F6 variants/settings:

Native/Core result: PASS / FAIL / PARTIAL / BLOCKED / NOT RUN
Gated managed/Blue/runtime results (separate):
M counts: pass __ fail __ partial __ blocked __ not-run __ n/a __
A counts: pass __ fail __ partial __ blocked __ not-run __ n/a __
D counts: pass __ fail __ partial __ blocked __ not-run __ n/a __
Per-ID results and artifacts:
K01–K06 disposition:
Regression/remaining defects and severity:
Human Play restart without reattach: explicitly verified / NOT VERIFIED
Pointer history → Live → scope change: verified / NOT VERIFIED
Sustained uncapped zero-loss: pass / fail / NOT RUN
Tail allocation/free/Play after sample aging: pass / fail / NOT RUN
Approved scope, exclusions, checkpoint commit and next branch decision:
```

Suggested report location: a new dated entry under `docs/bugs/<execution-date>/`.
Identify the actual operator/reviewer and tool/model if used; do not attribute
local checks to an independent reviewer without their report. Record actual execution time/date in Europe/London and distinguish it from the
checklist authoring date. Do not overwrite historical reports to simulate a retest.

---

*Last updated: Phase 3.5 / 3.x, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a plan.*
