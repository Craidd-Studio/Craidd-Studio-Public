# Unity profiling acceptance review — automated execution, 17 October 2026

> Source layout update, 17 November 2026: the historical `support/profiling`
> path below is now [`src-tauri/native/profiling/`](../../../src-tauri/native/profiling/README.md). The header contents and historical results are unchanged.

**Roadmap track:** Phase 3.5 profiling, composing with Phase 3.x debugging.

**Status:** Automated review and runtime test of `feat/unity/profiling-a-to-p` at
`f06c51e`. **No human (M-lane) check was performed.** Native/Core result:
**PARTIAL**. Gated Red/Blue/managed paths: **BLOCKED**. Nothing in this record
accepts the profiler on a human's behalf, and no product code was changed.

**Executed against:** the [Unity acceptance runbook](../../uiux/unity-profiling-manual-acceptance-checklist.md)
(IDs, lanes and result vocabulary), the [workspace milestone A record](../../handoffs/handoff-phase-3-5-profiler-workspace-a.md)
and the [17 October acceptance handoff](../../handoffs/handoff-profiling-acceptance-2026-10-17.md).
Historical baselines remain in the [scope report](profiler-scopes-report.md).

## 1. Reviewer and run identity

| Field | Value |
| --- | --- |
| Reviewer / operator | Claude Code agent, model **Claude Opus 5.5** (`claude-opus-5-5`, Anthropic), working in a detached git worktree. Every action below was automated or source-based. No human performed or observed any step in this run. |
| Execution time | 17 October 2026, 22:44–23:17 BST (Europe/London). Checklist authored earlier the same day. |
| Craidd revision | `f06c51e186d7848ec3f469cb25538039ef2858ab` (`feat/unity/profiling-a-to-p`, equal to `origin`). `f520203..f06c51e` changes documentation only; milestone A code is `913970c`. |
| Build mode | Embedded debug Tauri executable from `npm run test:ui:build`, built in the review worktree's own `src-tauri/target`. SHA-256 `2997b00a77ee08bd3412699a5bf0fcb6652cee0fd48098e66f9570c85c6e3751`. Not packaged, not `tauri dev`. |
| Toolchain | Node v24.21.0, rustc/cargo 1.99.1, g++ 16.2.1, CMake 4.4.4, webkit2gtk-4.1 2.54.1, installed `tauri-driver` and `WebKitWebDriver`. |
| Unity | 6000.5.10f1 (`3bd4f66ad299`), launched by the harness only in **batch mode** (`-batchmode -nographics`), except the separate graphical overlay case. No graphical Game-view clicks were possible. |
| Disposable projects | `/tmp/cui-*` copies of tracked `workspaces/unity` + `support/profiling` sources, plus the harness's `UnityProfilingHarness.cs` and `scoped_ranges.cpp`. Main review run: Editor PID **81127**, birth **81889**, profile `81127-81889-1792273947849106806`. |
| Plugin | Built fresh in each copy before its Editor loaded it. The SHA-256 differs per copy because the disposable path is embedded in the debug build: main review run `a7c4120e…a1817e`; long command run `34c5e347…cf8400`. Source hashes for `probe.cpp` `d861f4c6…`, `craidd_gold.hpp` `118ba38e…`, `ProbePlayLifecycle.cs` `5dee6ee3…`. |
| Namespaces | A unique `CRAIDD_PROFILE_NAMESPACE` and scratch HOME per launch, for example `review-46c2b7e0-2ec3-4083-b9fd-17cc858ea2b4`. |
| Display | Host: GNOME Wayland, DP-1 2560×1440 and HDMI-1 1920×1080. First suite run used the live display through XWayland. All later runs used **Xvfb 1920×1080×24** with `GDK_BACKEND=x11`. The WebDriver app window was 1280×800 at DPR 1. Fractional/high scaling was not tested. |
| User state | No Unity Editor was running when the run began (process scan at 22:44). Main checkout untracked `workspaces/unity/ProjectSettings/PackageManagerSettings.asset` (SHA-256 `622993c5…db5764e`, 1,242 bytes, mtime 16 Oct 18:05) was not touched. No branch was created and no `feat/profiling` exists. |

## 2. Commands executed

From the review worktree at `f06c51e`, in order:

```sh
npm ci --no-audit --no-fund                     # exit 0
npm run build                                   # exit 0 (existing chunk/plugin-timing warnings)
npm run test:ui:build                           # exit 0, Rust dev profile
node tests/profiling.test.mjs                   # 27/27 pass
npm run test:profiler-workspace                 # 4/4 pass
npm run test:ui:profiling                       # live display: 4 pass, 2 fail (see R-06, R-07)
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 CRAIDD_TEST_UNITY=1 xvfb-run -a -s "-screen 0 1920x1080x24" \
  node --test --test-concurrency=1 --test-name-pattern='60 fps|unified scopes' \
  tests/ui/unity-profiling.test.mjs tests/ui/unity-scopes.test.mjs   # scopes pass; 60 fps fail (R-06)
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 xvfb-run -a -s "-screen 0 1920x1080x24" \
  npm run test:ui:profiler-workspace           # pass (standalone native target, not Unity)
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 xvfb-run -a -s "-screen 0 1920x1080x24" \
  node <scratch>/review-unity.mjs <worktree>   # review scenario, section 4
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 xvfb-run -a -s "-screen 0 1920x1080x24" \
  node <scratch>/review-probe.mjs <worktree>   # K02 trace and UP-HOST-04 with scrolling
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 CRAIDD_TEST_UNITY=1 CRAIDD_TEST_LONG=1 xvfb-run -a -s "-screen 0 1920x1080x24" \
  node --test --test-name-pattern='uncapped fps' tests/ui/unity-profiling.test.mjs   # pass, 628.9 s
```

`review-unity.mjs` and `review-probe.mjs` are review-only scenarios kept outside
the repository. They import the repository's own `tests/ui/lib` harness, use
its disposable-copy and ownership checks, and record every step before
asserting. A failed step does not stop the scenario, so later checks (including
post-rollover tail checks) still run. Pointer steps use W3C WebDriver pointer
actions inside the webview. **They are A-lane automation, not physical pointer
or human evidence.** Unity Allocate/Clear/Play/Stop are file-signal commands that
run the Unity menu items or `EditorApplication` Play-mode calls, not Game-view clicks.

## 3. Evidence

Committed, trimmed evidence is in [`evidence/acceptance-review/`](evidence/acceptance-review/):

| File | Shows |
| --- | --- |
| [01-attach-dialog.png](evidence/acceptance-review/01-attach-dialog.png) | Our Editor preselected and labelled "Unity · this project". AssetImportWorker helpers are distinct, plus the Profile only / Attach debugger choice. |
| [02-expanded-profiling-1280x800.png](evidence/acceptance-review/02-expanded-profiling-1280x800.png) | Expanded Profiling in the Unity context at 1280×800. The results tabs are below the fold (R-04). |
| [03-expanded-gold-focus.png](evidence/acceptance-review/03-expanded-gold-focus.png) | Gold hits table and adjacent details after scrolling, then Focus recording. |
| [04-k02-same-benchmark-not-activated.png](evidence/acceptance-review/04-k02-same-benchmark-not-activated.png) | After History → Live, re-choosing `unity.solo` leaves "Full session · Live" (R-01). |
| [05-thread-filter.png](evidence/acceptance-review/05-thread-filter.png) | Native worker thread filter at 60 fps. |
| [06-play-cycle-3-recorded-solo.png](evidence/acceptance-review/06-play-cycle-3-recorded-solo.png) | Third Stop Play → Play. The selected old Solo B3 stays Recorded (13.48 s → 14.11 s) while the new Play runs. |
| [07-uncapped-rollover.png](evidence/acceptance-review/07-uncapped-rollover.png) | 615.96 s uncapped session at sample rollover, footer "Gold connected · Rolling history". |
| [08-post-rollover-snapshot-review.png](evidence/acceptance-review/08-post-rollover-snapshot-review.png) | Snapshot created and reviewed after rollover, still live 1.00 MiB. |
| [09-live-display-scopes-failure.png](evidence/acceptance-review/09-live-display-scopes-failure.png) | Final state of the live-display scopes failure (R-07). |
| [review-results-trimmed.json](evidence/acceptance-review/review-results-trimmed.json) | Per-step outcomes and values, a 15-second counter timeline across the long run, final diagnostics, the UP-HOST-04 probe and the K02 select-state trace. Home/worktree paths replaced with placeholders. |

Full raw evidence (screenshots, `record.json`, Unity logs, native build logs,
source manifests) remains in the ignored `test-results/ui/2026-10-17T21-46-49-942Z`
through `…T22-05-16-245Z` directories of the review worktree. Raw logs contain machine paths.

## 4. Requested explicit retests

| Retest | Lane | Result | Measured identities / values |
| --- | --- | --- | --- |
| History → Live → scope selection with a **physical** pointer | M | **NOT RUN** | No human operator. NOT VERIFIED. |
| Same, with WebDriver pointer/option actions | A | **FAIL (narrowed)** | Choosing a *different* scope after History → Live works: snapshot `2bc30840…` → Live → `unity.solo` activated `solo:unity.solo:1:1`. Re-choosing the **previously chosen** benchmark after Live fails deterministically (R-01). Pointer-open plus keyboard works in every case. |
| Stop Play → Play again without reattaching, **human** | M | **NOT RUN** | NOT VERIFIED (K03 stays open). |
| Same, automated, three cycles plus one after rollover | A | **PASS** | Same profile `81127-81889-…806` throughout. Batch/generation 1→2, 2→3, 3→4, and 6→7 / 5→6 after rollover. The selected Solo stays Recorded with an unchanged ruler (`solo:unity.solo:1:1`, `:2:2`, `:3:3`), and a new Solo opens each time (`:2:2`, `:3:3`, `:4:4`). Counters: 0 gaps, 0 rejected, 0 disconnects. |
| Ten-minute uncapped run through sample rollover (K01) | A | **PASS ×2 (K01 not reproduced; still open)** | Review run: 602.2 s, 9,716,209 Unity frames (about 16,100 frames/s), 2,400 samples, `agedSamples` 8, 9,718,375 evicted ordinary hits, **sourceGaps 0, rejectedEvents 0, disconnects 0, dropped 0**. Counters were saved every 15 s before any assertion. Repository long command: 617.1 s observed, 9,157,806 frames, `agedSamples` 1, all loss counters 0. |
| Post-rollover tail: allocate / free / snapshot / Record again / Play | A | **PASS** | Allocate: Unity 0→1,048,576 B, Solo cohort 1,048,576 B. Snapshot `11373dd0…` created and reviewed ("Still live 1.00 MiB"). Clear: 0 B. Record again: batch 5→6. Stop Play → Play: batch 6→7, generation 5→6. Stop profiling: Editor still playing. |

## 5. Defects and observations

Severity reflects user impact on the native Unity workflow. "Probable cause"
marks source reading, not a verified fix.

### R-01 — Re-choosing the same scope after Live does nothing (K02) — Medium, product-probable

- **Steps (A):** Attach (Profile only) → Play → choose Scope `unity.solo` → click **Live** → choose `unity.solo` again from the Scope select.
- **Expected:** Scope changes to the Solo recording, and the caption shows its ID.
- **Actual:** The scope stays "Full session · Live". The DOM is consistent after Live (`selectedIndex` 0, `session` selected, `unity.solo` not selected), and the option click fires no change. Choosing a *different* marker (`unity.native.mix`) works. Reaching the same marker by pointer-opening the select and moving with the keyboard works (`unity.native.mix:89442:264`). Reproduced 2/2 (review run and probe trace).
- **Probable cause (hypothesis):** WebKit menu-list selects compare a user's choice with the last *user-chosen* index before firing `change`. The Live button resets the React-controlled value from script, which does not update that index. A real mouse user re-choosing the same benchmark from the popup may therefore see nothing happen.
- **Impact:** This is exactly the History/Live/scope navigation the runbook calls out. Workaround: choose another entry first, or use the keyboard. **Needs physical-pointer confirmation** before it is classified as a product failure.
- **Evidence:** [04](evidence/acceptance-review/04-k02-same-benchmark-not-activated.png), `probeK02Trace` in the trimmed JSON.

### R-02 — Snapshot names collide at one-second resolution (K05) — Low, UX

Three rapid snapshots had unique IDs (`015b182b…`, `0136c691…`, `ad962a6e…`)
and were each selectable, but all three read "Snapshot · Unity Editor · 22:52:35".
Two snapshots 0.26 s apart in the first journey also shared "22:52:30", even
though the Memory table distinguishes them as "#1 · 2.50 s" and "#2 · 2.76 s".
The history dropdown gives the user no way to tell them apart. UP-UI-09 FAIL.

### R-03 — "Unity Play ended" diagnostics are recorded at Play entry — Low, fixture/provider lifecycle

The final profile held **12** "Unity Play ended" diagnostics. The run had only
**5** real Play exits (three cycles, the stop before the uncapped run, and the
post-rollover stop). The first two are at 0.89 s and 1.65 s, before any Stop
Play was issued. Batches and generations stayed correct.

- **Probable cause:** `ProbePlayLifecycle`'s static constructor republishes the inactive state on each domain reload. Entering Play reloads the domain, so `play-end` is sent before the new generation starts. Craidd's `finish_play` records a diagnostic even when already waiting for Play.
- **Impact:** Noise in Events. Window-filtered diagnostics can attribute a "Play ended" burst to the start of a new recording (UP-FAIL-06).

### R-04 — Expanded Profiling hides its results tabs below the fold at 1280×800 — Low/Medium, UX

With the default bottom panel, the expanded host is 419 px tall for 687 px of
content. The Gold tab's top sits at 612 px of an 800 px viewport, so the summary
row and two charts fill the visible area. Summary/Gold/Memory/Events and the
hits table need scrolling. The auto-closing "Toolchain found" banner reduces
the height further when shown. The milestone A narrow test (900 px wide) checks
horizontal overflow, not vertical reachability. A human should judge whether
this meets UP-HOST-02/03. With scrolling, row inspection and Focus recording
worked (UP-HOST-04 PASS).

### R-05 — Live Gold history rows move under the pointer — Low, UX (needs human)

At 60 fps the expanded hit list re-renders as hits arrive. In the Xvfb rerun,
WebDriver found the first hit summary and the element was replaced before the
click landed ("stale element reference", `tests/ui/unity-profiling.test.mjs:106`).
A person may click a different hit than intended. Not observed by a human.

### R-06 — `unity-profiling` 60 fps test is stale after milestone A — harness, Medium for process

Neither run reached the test's worker, thread/batch filter and coverage-limits
assertions:

1. **Live display:** "Timed out: thread inspection filter" with empty hit summaries. Milestone A persists Gold-history expansion per scope and benchmark in `profilingStore`, so the test's click on the already-open group *closed* it, hiding the hits.
2. **Xvfb:** the R-05 stale-element race.

The milestone A record reran only the icons and profiler-workspace UI tests,
not `test:ui:profiling`. The review scenario covered the skipped thread-filter
behaviour separately (UP-MT-01/03 PASS), but the repository test still needs
updating. No test file was changed in this review.

### R-07 — Harness on the live desktop picks up the user's mouse — environment

In the live-display run, `unity-scopes` failed at "panel width 288". The page
logged `pointermove` events with `buttons:0` from (500, 720) to (1289, 204)
between the harness's pointer-down and pointer-up. That was a physical mouse
crossing the test window, and the resize followed it to the 180 px minimum.
The same test **passed on Xvfb**. Run A-lane suites on an isolated display, or
keep the pointer away. This is not a product defect.

### R-08 — Snapshot status caption never clears — Low, UX

"Snapshot saved from live process · View preserved" was still shown 10 minutes
after the last snapshot (rollover screenshot). It no longer describes a recent
action.

### Notes that are not defects

- The attach dialog lists processes by kernel short name ("AssetImportWork"), but the Editor row carries "Unity · this project" and helpers say "Mono/Unity · native LLDB; managed unqualified". The match is not ambiguous.
- Process RSS around 501–521 MiB stays process-wide and is not presented as the 1 MiB cohort, as the contract requires.

## 6. Per-ID results

The default runbook lane is M. **Every ID's M row is NOT RUN** in this review,
because no human executed anything. The table gives this run's A (real embedded
Tauri plus disposable Unity) and D (source/unit) rows. "Sidebar only" means the
runbook also requires the editor host. A PASS row means only that the stated
automation passed, not human acceptance.

| ID | Lane | Result | Actual behaviour / values, evidence |
| --- | --- | --- | --- |
| UP-RUN-01 | A | PASS | Section 1: branch/HEAD, dirty baseline hash, embedded debug build. |
| UP-RUN-02 | A | PARTIAL | Unity/OS/toolchain/plugin/source hashes recorded. DPR 1 only; panel width only at harness defaults; no adapter used. |
| UP-RUN-03 | A | PASS | All Unity work in `/tmp/cui-*` copies of tracked sources; controller PID equals the spawned child; no user Editor running. |
| UP-RUN-04 | A | PASS | Plugin built in each copy before Editor launch (`native-build.log`). The original plugin was never built. |
| UP-RUN-05 | A | PARTIAL | Unique namespace and scratch HOME per launch. Runs were sequential; simultaneous isolation not exercised. |
| UP-RUN-06 | A | PASS | Disposable `unity.cln` opened. The scene was loaded by the batch-mode harness, not a graphical Editor. |
| UP-RUN-07 | A | PARTIAL | Direct native baseline 0 B before Allocate. Worker/periodic settings came from harness defaults and were not independently recorded. |
| UP-RUN-08 | A | PASS | Unity log oracle: "Allocate retained native 1 MiB: 0 -> 1048576 bytes" and harness status `nativeLiveBytes`, compared with Craidd cohort values. |
| UP-RUN-09 | A | PASS | Section 3. |
| UP-RUN-10 | A | PASS | `get_profile` null after opening the solution; nothing attached. |
| UP-JNY-01 | A | NOT RUN | Discoverability needs human judgement. |
| UP-JNY-02 | A | PASS | Profile only → provider ready, waiting for Play, `unityEditor` true, 0 captures, no pause. [01](evidence/acceptance-review/01-attach-dialog.png) |
| UP-JNY-03 | A | PASS | Solo opened at batch 1 / generation 1; scope `session`. |
| UP-JNY-04 | A | PARTIAL | Exact 0 → 1,048,576 B; Solo and `unity.native.alloc` cohorts 1,048,576 B; "1.00 MiB" rendered. Triggered by menu command, not a Game-view click. |
| UP-JNY-05 | A | PASS | One snapshot (`2bc30840…`); Live, scope `session` and Summary tab unchanged. |
| UP-JNY-06 | A | PARTIAL | Clear → 0 B, freed ≥ 1 MiB, snapshot row 1 keeps 1.00 MiB. Menu command, not a Game-view click. |
| UP-JNY-07 | A | PASS | Snapshots `2bc30840…` and `85fdfe88…`; rows "1.00 MiB" vs "0 B"; review then one Live returns `live`/`session`. |
| UP-JNY-08 | A | PASS | Selected live `solo:unity.solo:1:1` became Recorded on Stop Play with the same ID. |
| UP-JNY-09 | A | PASS | New batch/generation and new Solo `:2:2`; old selection unchanged. |
| UP-JNY-10 | A | PARTIAL | Profile inactive, Editor still playing. Chart freezing and discovery disarm not checked. |
| UP-ATT-01 | A | PASS | Icons test (no file and Monaco open) plus the cold sidebar and expanded host screenshots. |
| UP-ATT-02 | A | PASS | Helpers distinct and not preselected. [01](evidence/acceptance-review/01-attach-dialog.png) |
| UP-ATT-03 | A | PARTIAL | Single match preselected. Search, Refresh and multiple Editors not exercised. |
| UP-ATT-04 | A | NOT RUN | |
| UP-ATT-05 | A | PASS | Profile only separate from Attach debugger; hint says Unity C# needs a separately qualified adapter. |
| UP-ATT-06 | A | NOT RUN | No provider-absent run. |
| UP-ATT-07 | A | NOT RUN | |
| UP-ATT-08 | A | NOT RUN | |
| UP-ATT-09 | A | NOT RUN | Single IDE per run. |
| UP-ATT-10 | A | PASS | Recovery test: the replacement host attached while Unity was playing, without an Editor restart. |
| UP-UI-01 | A | PARTIAL | Summary/Memory (live run) and all four tabs (Xvfb scopes) at 288/360/420 px with no horizontal overflow. Settings view not measured. |
| UP-UI-02 | A | NOT RUN | DPR 1 only. |
| UP-UI-03 | A | PARTIAL | Resized while data arrived (scopes). Not during snapshot review. |
| UP-UI-04 | A | PARTIAL | Tab reached "Snapshot and record again" (live 60 fps run, before its failure). Other tab stops not checked. |
| UP-UI-05 | A | NOT RUN | State clarity needs a human. States observed: Ready for Play, Live, Recording, Recorded, Snapshot, Unavailable. |
| UP-UI-06 | A | NOT RUN | |
| UP-UI-07 | A | FAIL | R-01. Keyboard path passes; physical pointer NOT VERIFIED. |
| UP-UI-08 | A | PASS | Scopes test: snapshot menu holds saved moments only, and each marker appears once in Scope. |
| UP-UI-09 | A | FAIL | R-02. |
| UP-UI-10 | A | PARTIAL | Expansion and thread filter persisted while hits arrived. Rows move under the pointer (R-05). |
| UP-UI-11 | A | NOT RUN | |
| UP-UI-12 | A | NOT RUN | Monaco opened `probe.cpp`; styling, hover and Explorer menu not assessed. |
| UP-HOST-01 | A | PASS | Unity context: exactly one Profiling tab, also after repeating the action from the sidebar. |
| UP-HOST-01 | D | PASS | `profilerWorkspace.test`: one typed tab beside dirty files. |
| UP-HOST-02 | A | PASS | Full shell, summary row, shared ruler and Gold table in the Unity context. Vertical reachability: R-04. |
| UP-HOST-03 | A | PARTIAL | 900 px stacking passes in the native workspace test; Unity context at 1280×800 needs vertical scrolling (R-04). |
| UP-HOST-04 | A | PASS | After scrolling: row inspection left scope `session`; Focus recording set `solo:unity.solo:1:1`. [03](evidence/acceptance-review/03-expanded-gold-focus.png) |
| UP-HOST-04 | D | PASS | `profiling.test`: expanded Gold does not change shared scope. |
| UP-HOST-05 | A | PARTIAL | Unity: result tab/view preserved across a source switch (weak: no recording was focused at that point). Dirty-source preservation only in the native workspace test. |
| UP-HOST-05 | D | PASS | `profiling.test`: presentation state independent of snapshot data. |
| UP-HOST-06 | A | PASS | Right host absent on Profiling and restored on `probe.cpp`. |
| UP-HOST-07 | A | PARTIAL | Native workspace test only. |
| UP-HOST-08 | A | PARTIAL | Native workspace test only (no flicker, side focus). |
| UP-HOST-08 | D | PASS | `profilerWorkspace.test`: no intermediate primary selection. |
| UP-HOST-09 | A | PARTIAL | Side-group Ctrl+W in native workspace test only; tab close button used in the Unity context; middle-click not tested. |
| UP-HOST-10 | A | NOT RUN | |
| UP-HOST-10 | D | PASS | `profilerWorkspace.test`: disk/save paths exclude the workspace tab. |
| UP-HOST-11 | A | NOT RUN | |
| UP-HOST-12 | A | PARTIAL | Native workspace test only. |
| UP-HOST-13 | A | PARTIAL | Native workspace test only. |
| UP-HOST-13 | D | PASS | `profilerWorkspace.test`: show routing. |
| UP-HOST-14 | A | PARTIAL | Closed during recording: same profile ID, active, sidebar back. Not tried during snapshot review. |
| UP-HOST-15 | A | PASS | No Open in Editor Panel in the central view; no Open in Linked Window anywhere. |
| UP-GOLD-01 … UP-GOLD-10 | A | NOT RUN | No gutter authoring, condition, preparation or rebuild exercised. |
| UP-GOLD-11 | A | BLOCKED | Fixture F4 (no Solo / recursion / unwind) does not exist. |
| UP-GOLD-12 | A | NOT RUN | F2 exists; not exercised for recursion. |
| UP-GOLD-13 | A | BLOCKED | F4 absent. |
| UP-GOLD-14 | A | NOT RUN | |
| UP-SCOPE-01 | A | PARTIAL | Full session initial in every run (sidebar only). |
| UP-SCOPE-02 | A | PARTIAL | Scopes test, sidebar only. |
| UP-SCOPE-03 | A | PARTIAL | Scopes test history Focus recording; editor host only via UP-HOST-04. |
| UP-SCOPE-04 | A | PARTIAL | Scopes test timeline/history identity, sidebar only. |
| UP-SCOPE-04 | D | PASS | `profiling.test`: three overlapping lanes. |
| UP-SCOPE-05 | A | PARTIAL | Scopes test: same ID Recorded, tab kept. Sidebar only. |
| UP-SCOPE-06 | A | PARTIAL | Solo at Stop Play across 4 cycles (sidebar). Record again completion while selected not checked. |
| UP-SCOPE-07 | A | PARTIAL | Scopes test: all four tabs share the recording ID. Host switch with a selected recording not checked. |
| UP-SCOPE-08 | A | NOT RUN | |
| UP-SCOPE-09 | A | NOT RUN | |
| UP-SCOPE-10 | A | PARTIAL | Scopes test: evicted selected hit stays Unavailable with empty charts (sidebar). |
| UP-SCOPE-11 | A | NOT RUN | |
| UP-SCOPE-11 | D | PASS | `profiling.test`: unknown End/duration, not zero. |
| UP-SCOPE-12 | A | PARTIAL | Live returns `session`/`live` repeatedly; sidebar only. |
| UP-MET-01 … UP-MET-08 | A | NOT RUN | No numerical comparison against host observations. |
| UP-MEM-01 | A | PASS | Exact 0 → 1,048,576 B; unique observed total "1.00 MiB" with outer, inner and Solo overlapping (scopes). |
| UP-MEM-02 | A | PASS | Clear → live 0, freed ≥ 1 MiB; RSS not required to fall. |
| UP-MEM-03 | A | NOT RUN | |
| UP-MEM-04 | A | PASS | Scopes test: three owners, unique total counted once. |
| UP-MEM-05 | A | PASS | Scopes test: Still live at End 1.00 MiB fixed; current survivors 0 B after free. |
| UP-MEM-06 | A | NOT RUN | |
| UP-MEM-07 | A | BLOCKED | No cross-thread-free variant. |
| UP-MEM-08 | A | NOT RUN | |
| UP-MEM-09 | A | NOT RUN | |
| UP-MEM-10 | A | NOT RUN | The 60 fps test's coverage-limits step was not reached (R-06). |
| UP-MEM-10 | D | PASS | Source: settings state Managed heap / GC and heap objects Unavailable, GPU Planned. |
| UP-SNAP-01 | A | PASS | Scopes test: manual snapshot without Gold. |
| UP-SNAP-02 | A | PARTIAL | Two snapshots during one active interval (scopes); not via that recording's list in the editor host. |
| UP-SNAP-03 | A | PASS | Scopes test: the same two IDs in outer and inner groups. |
| UP-SNAP-03 | D | PASS | `profiling.test`: one live snapshot belongs to all active overlaps. |
| UP-SNAP-04 | A | PASS | Scopes test: snapshot while viewing completed outer not associated with it. |
| UP-SNAP-05 | A | PASS | Scopes test (from older snapshot) and JNY-05 (from Full session). |
| UP-SNAP-06 | A | PASS | Scopes test: associations unchanged after End and free. |
| UP-SNAP-07 | A | PARTIAL | Previous-session archives not exercised. |
| UP-SNAP-08 | A | PASS | Scopes test: "Open at snapshot" and frozen ruler. |
| UP-SNAP-09 | A | PARTIAL | Rows 1.00 MiB / 0 B and Δ RSS "—" for the first row seen in values; not fully compared. |
| UP-SNAP-10 | A | PASS | Scopes test: eight retained, reviewed ID/tab/ruler kept. |
| UP-SNAP-11 | A | NOT RUN | |
| UP-SNAP-12 | A | NOT RUN | |
| UP-SNAP-13 | A | PASS | Uncapped tests: older segment keeps 1 MiB across Record again and sees the late free. |
| UP-SNAP-14 | A | NOT RUN | |
| UP-SNAP-15 | A | NOT RUN | |
| UP-MT-01 | A | PASS | TIDs 81127, 83351, 83352 distinct. [05](evidence/acceptance-review/05-thread-filter.png) |
| UP-MT-02 | A | NOT RUN | |
| UP-MT-03 | A | PASS | Filter on 83351: every visible hit is that thread; other threads kept producing new hits. |
| UP-MT-04 | A | PARTIAL | Filter and expansion persisted while hits arrived; not across host switches. |
| UP-MT-05 … UP-MT-08 | A | NOT RUN | |
| UP-RED-01 … UP-RED-10 | A | BLOCKED | Gated. `ptrace_scope` is 1. A qualified native attach needs Unity launched under the debugger or a disposable player, and neither was prepared. No policy change was made. |
| UP-BLUE-01 … UP-BLUE-10 | A | BLOCKED | No qualified Unity managed adapter or Blue binding. netcoredbg/LLDB presence does not qualify Unity Mono. |
| UP-LIFE-01 | A | PASS | Section 4. |
| UP-LIFE-02 | A | PASS | Three cycles plus one post-rollover; unique IDs. Human steps NOT RUN. |
| UP-LIFE-03 | A | PASS | Pre-selected Recorded Solo held through each next Play. [06](evidence/acceptance-review/06-play-cycle-3-recorded-solo.png) |
| UP-LIFE-04 … UP-LIFE-07 | A | NOT RUN | |
| UP-LIFE-08 | A | PARTIAL | Closing Profiling and switching source tabs never stopped capture. Cancelled window-close not tested. |
| UP-LIFE-09 … UP-LIFE-11 | A | NOT RUN | |
| UP-FAIL-01 | A | PARTIAL | Recovery test: forced disconnect closes the Solo and opens a new one. Incomplete label and paired range not checked. |
| UP-FAIL-02 | A | PASS | Recovery test: reconnect, fresh Solo, late free reaches pinned cohort. |
| UP-FAIL-03 … UP-FAIL-06 | A | NOT RUN | No loss occurred to observe in-UI notification (FAIL-05). |
| UP-FAIL-07 | A | PASS | Recovery test: harness-owned host SIGKILLed after ownership proof; route/socket removed; Editor kept playing; replacement attached. |
| UP-FAIL-08 … UP-FAIL-10 | A | NOT RUN | |
| UP-LOAD-01 | A | PARTIAL | 60 fps flow with workers on/off in the review run with 0 loss counters. Full sequence with Record again under workers not run. |
| UP-LOAD-02 | A | PASS | Uncapped: more than 2,000 evicted hits with loss counters 0 (short run 31,226; long runs about 9.7 M). |
| UP-LOAD-03 | A | PASS | Section 4; two runs. K01 still open. |
| UP-LOAD-04 | A | PASS | Section 4 tail. |
| UP-LOAD-05 | A | PARTIAL | 2,400-sample window and "128 hits" per marker observed; 2,000-capture bound not directly measured. |
| UP-LOAD-06 | A | NOT RUN | |
| UP-LOAD-07 | A | NOT RUN | |
| UP-LOAD-08 | A | PARTIAL | Page round-trip 1–43 ms throughout the uncapped run; Open in Editor Panel rendered in 111 ms at 60 fps. Host switches and Stop under uncapped load not timed. |
| UP-LOAD-09 | A | NOT RUN | |
| UP-LOAD-10 | A | NOT RUN | No loss occurred. |
| UP-EXIT-01 | A | PARTIAL | This record (A/D only; no M lane). |
| UP-EXIT-02 | A | PASS | Section 5. |
| UP-EXIT-03 | A | N/A | No repair was made in this review. |
| UP-EXIT-04 | M | NOT RUN | Named human review pending. |
| UP-EXIT-05 | A | PASS | Section 7. |
| UP-EXIT-06 | M | NOT RUN | User decision. |
| UP-EXIT-07 | M | NOT RUN | User decision; `feat/profiling` not created. |

**Totals over the 182 IDs (one A/other-lane result per ID, D rows excluded):**
PASS 47 · FAIL 2 · PARTIAL 38 · BLOCKED 23 · NOT RUN 71 · N/A 1.
**D rows:** 10 PASS (supporting only). **M lane:** 182 NOT RUN.

## 7. K01–K06 disposition

| ID | Disposition |
| --- | --- |
| K01 | **Open.** Not reproduced in 2/2 runs (602 s and 617 s uncapped, zero loss, tail passing). The original 15-event loss was intermittent, at 458 s, on the live desktop under different load. Two isolated passes do not establish zero-loss operation or a root cause. Repeat on the live display and under load, and qualify the in-UI loss notification (UP-FAIL-05) with a controlled loss. |
| K02 | **Open, narrowed** (R-01). Option-level selection of a *different* scope after History → Live passes (A). Re-choosing the previously chosen scope fails deterministically (A). Keyboard passes. Physical pointer NOT VERIFIED. |
| K03 | **Open.** Human Stop Play → Play without reattaching NOT VERIFIED. Automated equivalent PASS (4 transitions). |
| K04 | **Unassessed.** Monaco rendered source; CSP styling, Explorer menu and hover not examined. No CSP change. |
| K05 | **Open** (R-02). IDs unique and selectable; labels identical. |
| K06 | **Scope limitation, unchanged.** Hide/Show and shared viewers not tested (UP-LIFE-10 NOT RUN). Ordinary Duplicate Window still gives an independent context. |

## 8. Remaining blockers

1. **Human lane:** the whole M lane, including physical Game-view Allocate/Clear, physical pointer scope navigation (K02/R-01) and Stop Play → Play (K03).
2. **K01 zero-loss:** needs repeated long runs including the live desktop, plus a controlled-loss notification check.
3. **Repository UI test:** update the 60 fps test for persisted expansion and live re-rendering (R-06), then rerun `test:ui:profiling` on an isolated display.
4. **Fixtures:** F4 (no Solo / recursion / early unwind / cross-thread free) is missing (UP-GOLD-11/13, UP-MEM-07).
5. **Gated paths:** native debugger composition needs a debugger-launched disposable Editor or player under the existing ptrace policy. Unity managed/Blue/LDI needs a qualified adapter and binding.
6. **Untested Core areas:** Gold authoring and preparation (UP-GOLD-01–10), numerical CPU/RSS interpretation (UP-MET), failure injection beyond disconnect/host death (UP-FAIL-03–06, 08–10), lifecycle variants (UP-LIFE-04–07, 09–11), capacity limits (UP-LOAD-06/07/09/10), scaling (UP-UI-02).

**Recommendation:** milestone A and the native capture/snapshot/Play-cycle
behaviour performed as specified in automation. The baseline is suitable only
for **experimental continuation** with R-01, R-02, K01 and K03 named open until
a human run and further long runs close them. The decision to create
`feat/profiling` belongs to the user after reviewing this record.

---

*Last updated: Phase 3.5, 17 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
