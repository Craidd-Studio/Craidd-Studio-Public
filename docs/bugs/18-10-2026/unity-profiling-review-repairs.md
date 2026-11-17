# Unity profiling acceptance-review repairs

**Branch:** `feat/unity/profiling-a-to-p`. **Baseline:** `2cf8bd9`.

This repair record follows the [17 October independent review](../17-10-2026/unity-profiling-acceptance-review.md). Its observations are attributed to that review until reproduced here. The user's live Unity Editor and its loaded plugin are excluded from testing. All new Unity execution uses disposable project copies and an isolated Xvfb display.

## Observed defects and verification plan

| Review ID | Previously reported observation | Repair / verification scope |
|---|---|---|
| R-06 | The 60 fps test closes a history group that is already open; a hot first hit can be evicted before clicking. | Reproduce the original failure, ensure expansion state deliberately, and identify the inspected hit. Retain thread/batch assertions. |
| R-02 | Multiple snapshots have identical second-resolution labels. | Distinct readable labels, including rapid captures; preserve global history, associations and eight-view bound. |
| R-03 | Startup/domain-reload notifications produce spurious Play-ended diagnostics. | Count actual lifecycle transitions, preserving generation recovery, late frees and rearming. |
| R-08 | Snapshot confirmation remains visible long after capture. | Expire transient feedback across compact/expanded rehosting without changing the selected view. |
| R-01 / K02 | Selecting the same native scope option after Live can fail to emit change. | Capture passive native input/change traces before proposing a targeted fix. Keyboard remains a separate control. |
| R-04 | Expanded results require excessive vertical scrolling at short window heights. | Record geometry and screenshots; assess a minimal layout proposal separately from measurement repairs. |
| R-05 | Hot hit rows can disappear between locating and clicking them. | Identify retention races explicitly; assess inspection behaviour without increasing retention or freezing live collection. |
| K01 | A prior long run lost source events intermittently. | Repeat sustained collection beyond sample rollover and exercise a post-rollover interaction tail. Keep open absent an established cause and resolution. |

## Evidence boundaries

- **M — human:** the existing manual report remains unchanged. No new human acceptance is implied, including Stop Play → Play without reattaching.
- **A — automated runtime:** results and commands will be appended after execution in the embedded Tauri application with disposable Unity copies.
- **D — source/unit:** regression checks will be listed separately from runtime evidence.

The original untracked `PackageManagerSettings.asset` is preserved; its baseline SHA-256 is `622993c5611db4016b72dbf12de4754a642fa96b071d2fd663cc40253db5764e`. No Monaco CSP relaxation, new language provider, or `feat/profiling` branch is included.

## Diagnosis and implemented repairs

**R-06, A:** the unmodified 60 fps scenario failed at `thread inspection filter`, with a selected native thread but hidden, empty `innerText` for the closed group. The repaired harness deliberately ensures expansion instead of toggling it; chooses a recent capture by identity; retries only an identity proved evicted; and focuses offscreen inspection selects before native keyboard selection. The 60 fps and short uncapped scenarios then passed. Thread filtering still requires nonempty matching rows and proves another native thread continues; batch filtering and coverage-limit assertions remain in place. Commit: `36e80f0`.

Two later full-suite runs exposed nested clipping and an immediate pre-toggle assertion. The final helper explicitly scrolls the control into view, waits up to 500 ms for that exact hit to open, records trusted click/toggle identities, and waits for a new publication before retrying a proved eviction. It never synthesizes profiler input/change events or retries a click proved to have landed on another row. The final 60 fps trace has a click on the chosen ID with `open:false`, followed by its trusted toggle with `open:true`. The final full suite passes 7/7. This synchronizes native UI completion; it does not close R-05's human moving-row concern.

**R-02, D → A:** the rapid-capture regression failed with second-resolution names before the change. Manual snapshots now receive a per-window monotonic number, also used by the Memory table. Numbers do not recycle when history evicts a snapshot. The snapshot identity, associations, selection and eight-view bound are unchanged. Tests exercise 24 captures while reviewing an old snapshot and check retained row numbers against history labels.

**R-03, D → A:** the new lifecycle regression initially failed on idle initialization. The original embedded build also produced two exit diagnostics at 39.34 ms and 874.06 ms before any Stop in our disposable copy. `finish_play` now emits an exit diagnostic only if Play was active or captures were open. Repeated inactive state, initial generation setup and legacy duplicate notifications remain idempotent. Lost-end generation recovery still closes prior recordings; late-free ownership and rearming are preserved. After the change, the runtime probe observed zero exit diagnostics before any Stop and exactly two for two actual exits, with zero source gaps/rejections/disconnects.

**R-08, A:** snapshot feedback now expires after four seconds. Its deadline travels with the existing presentation state; compact/expanded rehosting cannot restart it, and an expired hidden note does not reappear. Capturing from a historical view still captures the live process and preserves that historical selection.

**R-01/K02, A diagnosis:** with R-01 still unmodified, a passive trace recorded trusted `input` and `change` for the first Solo selection. After Live, the DOM correctly showed `session`, index 0. Re-choosing Solo generated neither event and left the recording unset, even after another publication. A different marker and native keyboard navigation worked. This reproduces the WebKit menu-list behaviour reported independently; its internal implementation remains an inference. The workaround recreates the native scope select only when its controlled value changes externally. User keyboard changes retain the node and focus; incoming captures do not remount it. Physical-pointer human acceptance remains unverified.

**Additional R-01 history path, A:** a follow-up probe reproduced the same suppression in the unchanged manual snapshot picker. After Snapshot → Live → the same Snapshot, its native DOM value briefly showed the snapshot ID without a second trusted change event, while the actual rendered view remained Live. The next capture assertion caught the mismatch. The same external-reset component now serves both selectors; the regression waits for another publication and asserts the historical presentation as well as the option identity. This preserves the two separate dropdowns and the one-click Live action.

The `scope-before` trace was collected after the naming, feedback and lifecycle repairs but before the scope workaround. It is before/after evidence specifically for R-01, not a pristine baseline for the other repairs. Product commits are `cc2e7f0` and `032aec2`; harness synchronization is `36e80f0` followed by `45771d6`.

## Layout assessment and proposals, not implemented redesigns

**R-04 remains open.** The new 1280×800 probe measured a 476 px expanded host and 737 px content; the tabs ended at y=638.5 while the host ended at y=580. They were below the fold. A horizontal-overflow pass does not resolve this. A minimal next proposal is to keep the result tabs visible, reserve a usable results viewport, and cap the upper chart/summary region with its own scrolling only at short heights. This needs a compact-height visual review before changing the approved layout. Reducing chart height alone would not recover the entire missing space.

**R-05 remains open for human assessment.** Ordinary marker history retains 128 eligible hits. An oldest-first row can therefore be evicted between locating and clicking it, especially with workers or uncapped frames. Acquiring a recent identity repairs the automation race; it does not prove human row stability. A minimal follow-up proposal is a bounded, explicitly paused inspection list while collection continues, with a visible Resume Live action; it must not change scope, pin unlimited history, or disguise evicted data. This is a proposal requiring design review, not a shipped feature.

Two additional cosmetic observations remain for the UX pass: Full-session snapshot status currently reads `Snapshot · Snapshot`, and the automated splitter drag can leave text selected across the document (visible in the screenshots). Neither is reported as a repaired behaviour or used to claim visual acceptance. No product layout/CSS changes were made in this pass.

## Execution incidents kept separate from profiling results

- Running `cargo test` replaced the shared debug executable with its development-server variant. Subsequent UI attempts failed before attachment with `Origin header is not a valid URL`. Rebuilding with `test:ui:build` restored `tauri://localhost`. The harness now waits for a loaded frontend before IPC and fails with a build instruction instead of retrying window creation.
- GitHub Desktop temporarily stashed all edits and switched the checkout to `perf/arch-studio`. A test started during that interval ran the original harness and was not accepted as repair evidence. The user restored the branch and edits; a subsequent clean serial run was used. An attempted isolated worktree stopped because the restored branch was already in use. No other branch was modified.
- Restoration staged the pre-existing Unity settings file. Its contents and staging are preserved separately from repair commits. The agent did not apply or drop the GitHub Desktop stash; the user restored it.
- The first Rust profiling run lacked sandbox permission to bind Unix sockets (18 passed, 3 environment failures). The authorized rerun with socket access passed; those failures were not product fixes.

## Verification and exact commands

All GUI commands below use a separate X server. `CRAIDD_TEST_UNITY=1` opts into the existing disposable-copy harness; it does not authorize operating another Editor.

```bash
# D: backend (run before rebuilding the embedded executable)
cargo test --manifest-path src-tauri/Cargo.toml

# D: store/resolver/presentation and workspace regressions
node --test tests/profiling.test.mjs tests/profilerWorkspace.test.mjs

# Embedded build, also checks TypeScript
npm run test:ui:build

# A: the original failing 60 fps gate, also used for focused repair verification
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 CRAIDD_TEST_UNITY=1 \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  node --test --test-name-pattern='60 fps' tests/ui/unity-profiling.test.mjs

# A: the standalone passive scope/history regression probe
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 CRAIDD_TEST_UNITY=1 \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  node --test tests/ui/unity-review-regressions.test.mjs

# A: full profiler suite; now includes unity-review-regressions.test.mjs
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 \
  xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui:profiling

# A: expanded workspace, editable source and rehosting
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 \
  xvfb-run -a -s '-screen 0 1920x1080x24' npm run test:ui:profiler-workspace

# A: sustained uncapped run and post-rollover interaction tail
env -u WAYLAND_DISPLAY GDK_BACKEND=x11 CRAIDD_TEST_UNITY=1 CRAIDD_TEST_LONG=1 \
  xvfb-run -a -s '-screen 0 1920x1080x24' \
  node --test --test-name-pattern='uncapped fps' tests/ui/unity-profiling.test.mjs
```

The sustained gate records counters every 15 seconds, before its final loss assertion. After sample aging begins, it allocates 1 MiB, captures a manual snapshot, performs Snapshot and record again, reviews the retained snapshot, clears memory, takes another live-process snapshot while that history remains selected, verifies retained/released observations, and exercises Stop Play → Play without reattaching. The final lifecycle action is automated evidence only.

**D results:** 176 Rust library tests passed, 5 ignored; 7 integration tests passed, 1 ignored; no Rust failures on the authorized run (183 passed, 6 ignored total). Both frontend regression files passed. Embedded builds passed TypeScript and compilation, with the existing Vite large-chunk/dynamic-import warnings. No CSP relaxation was applied.

The profiler remains partially accepted while the named layout, live-row, intermittent-loss and human gates are open. Passing results below do not close those gates.

## Runtime evidence available before the sustained gate

The final short suite passed **7/7**, and the expanded workspace scenario passed **1/1**. Earlier full-suite attempts were **6/7** and remain in the retained logs. Passing a scenario means its stated assertions passed, not that every UX requirement is accepted: the review scenario deliberately records R-04's failing vertical geometry rather than disguising it as a layout pass.

| A scenario | Result and practical limit |
|---|---|
| Embedded icons | PASS, with no file and with Monaco open. SVG paths have measurable size/stroke. Monaco CSP remains unchanged. |
| Graphical Unity overlay | PASS, Game-view overlay repaints with 1,048,576 native live bytes; menu-driven Clear returns to zero. Physical overlay-button clicks are not newly qualified. |
| 60 fps native flow | PASS, allocation/free, frozen manual observations, Record again, late frees, exact hit expansion, thread/batch inspection, coverage labels and automated replay. 288/360/420 px horizontal bounds passed. |
| Short uncapped flow | PASS, more than 2,000 ordinary captures evicted without missing/rejected events or disconnects before cleanup. |
| Recovery/cleanup | PASS, intentional owned-provider disconnect, new Solo, late free, owned-host abrupt exit, route/socket cleanup and replacement attachment. Its intentional interruption is not a zero-loss run. |
| Review regressions | PASS, native same-scope and same-snapshot reselection, successive keyboard focus, three distinct same-second snapshot labels, historical capture preserving selection, initially visible then expired feedback across rehosting, and exactly two diagnostics for two real Play exits. |
| Unified scopes | PASS, selected active recordings complete without retargeting, boundaries freeze, scopes constrain existing views, manual snapshots stay separate and overlapping active associations remain correct. |
| Expanded workspace | PASS, real native collection beside editable source, dirty edit/save, selected snapshot/recording and inspector surviving rehosting, no sidebar flicker, explicit collapsed preference and 900 px window stacking. At that window width the profiler was 564 px wide, with 564 px scroll width and one 548 px Gold column. This is not a vertical-usability pass. |

Portable evidence is in [results.json](evidence/profiler-review-repairs/results.json). It records per-run source/plugin hashes, target identities, viewport measurements, native event traces, measurements and command output. Raw run directories remain in ignored `test-results/ui/` and are identified in the JSON. Final cleanup profiles are excluded from the portable counter comparisons because shutting down the disposable Editor can add a disconnect after the assertions.

Useful images: [scope before](evidence/profiler-review-repairs/01-scope-before.png), [scope after](evidence/profiler-review-repairs/02-scope-after.png), [historical snapshot after feedback expiry](evidence/profiler-review-repairs/03-snapshots-after.png), [vertical layout still open](evidence/profiler-review-repairs/04-expanded-layout-open.png), [thread/batch inspection](evidence/profiler-review-repairs/05-thread-batch-inspection.png), [narrow workspace](evidence/profiler-review-repairs/08-narrow-workspace.png), and [Unity Game-view overlay](evidence/profiler-review-repairs/09-unity-overlay.png).

The embedded executable SHA-256 is `e846fb8b8bdf1a115904dbfea7b3b6cba78a261f5335791545248c4a55e88dcf`. Its product sources match `032aec2`; subsequent changes affect tests/evidence only. The JSON includes exact source-file SHA-256 values rather than treating a Git base revision with dirty tests as a fully clean build identity. Unity is `6000.5.10f1`; each disposable plugin's hash is recorded separately because the Debug builds include their distinct copy paths.

No new human checks were performed. The prior human allocation/snapshot successes stand; Stop Play → Play without reattaching remains **NOT EXPLICITLY VERIFIED** manually. Monaco CSP, Explorer/menu and debugger-hover issues remain separately tracked and were not repaired or broadly requalified here. Managed Unity C#, managed heap/GC, LDI, GPU/hardware-cycle capture and new language providers are outside this native fixture acceptance.

## Sustained gate and final disposition

The new uncapped run passed **1/1** in 629.35 seconds (631.83 seconds including the test runner). At the rollover observation:

- Profile time: **616.406 s**; Unity frames: **10,013,223**.
- Retained process samples: **2,400**; aged samples: **1**; retained captures: **132**.
- Ordinary capture evictions: **10,014,304**, including the intended 128-hit bound for `unity.native.mix`.
- Missing source events, rejected events, disconnects and `dropped`: **0 each**.
- Footer: **◆ Gold connected / Rolling history**; no diagnostics at that point.
- **41 counter checkpoints** were retained at approximately 15-second intervals before the loss assertion.

The post-rollover tail passed: allocation reached 1 MiB; a manual snapshot retained it; Record again advanced batch 2 → 3 with the older Solo still owning that cohort; Clear freed it; a new snapshot captured zero live bytes while the earlier snapshot stayed selected. The UI assertions verified a retained 1.00 MiB observation and the newest 0 B observation. Stop Play returned to Ready for Play; the next Play opened generation 2 / batch 4 without another attach. At replay, all loss counters and `dropped` remained zero, with 2,400 samples and 9 aged samples. Explicit Stop left our disposable Editor playing before teardown.

See [rollover](evidence/profiler-review-repairs/06-rolling-history.png), [capture from historical review after rollover](evidence/profiler-review-repairs/07-post-rollover-snapshot.png), and `unity-uncapped` in [results.json](evidence/profiler-review-repairs/results.json). The last snapshot row can require scrolling in this compact view; the DOM assertion is not a claim that every row fits in the screenshot.

**Final automated executions: 9 passed, 0 failed** (7 profiler scenarios, 1 expanded workspace scenario, 1 sustained repeat). These supersede the failed harness iterations as verification of the final changes, while retaining those earlier failures as diagnosis evidence. D results remain separately counted above. New M results: none.

| Item | Final status |
|---|---|
| R-01 / K02 native control behaviour | Fixed and verified by A, for Scope and manual history; physical-pointer M remains open. |
| R-02 / K05 snapshot labels | Fixed, A+D. Numbers remain stable after bounded eviction. |
| R-03 lifecycle diagnostics | Fixed, A+D; zero startup exits, correct real exit count. |
| R-06 harness | Fixed; final full suite 7/7, with assertions preserved and trusted native traces retained. |
| R-08 feedback | Fixed, A; expiration and rehosting verified. |
| R-04 expanded vertical layout | Open; measured failure and minimal proposal above. |
| R-05 moving live rows | Open for design/human assessment; automated synchronization is not a usability fix. |
| R-07 desktop input interference | Isolated for these A runs with Xvfb; no live-desktop or product fix claim. |
| K01 intermittent loss | **Open.** Not reproduced in this repeat; root cause/resolution not established. |
| K03 manual replay | **NOT EXPLICITLY VERIFIED** by the human; automated replay does not close it. |

No `feat/profiling` branch or new language support was created. The original settings file is excluded from all repair commits and remains staged as restored by the user, with unchanged SHA-256. The user's live Editor was not attached to, operated, restarted or rebuilt.

For the next human pass, relaunch Craidd to load the rebuilt executable; on a disposable Unity copy, verify Scope Solo → Live → the same Solo, Snapshot → Live → the same Snapshot, and capture from history without changing the reviewed view. Then independently perform Stop Play → Play without reattaching while watching the selected recording become Recorded and retain its identity. Keep those results in the human lane, alongside a short-height expanded-layout and moving-row review.

*Last updated: Phase 3.5, 18 October 2026. Author(s): ShinkuKira21.*
*This document is a record.*
