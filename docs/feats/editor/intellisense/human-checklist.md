# Human checklist: LSP Stage 1

> Checkpoint, 17 November 2026: the original findings below predate repair
> `e6927b4`. Its independent re-check is recorded in `f22844e` in the
> [results record](results-lsp-stage-1.md#re-check-of-the-buffer-identity-repair-fixlsp-buffer-identity-at-e6927b4-2026-11-16-harness-observed-pending-user-review).
> The reproduction no longer occurred in the automated runs; human re-check
> and Stage 1 acceptance remain open. See the
> [Phase 3 checkpoint](checkpoint-phase-3-stage-1-2026-11-17.md) for current status.

[Results](results-lsp-stage-1.md) · [Decision pack](decision-pack-lsp-stage-1.md) · [Ratification pack](ratification-lsp-stage-1.md)

These are the checks the harness cannot do. The harness has already seen every other result, and recorded each as "harness-observed, pending user review". Tick each box, then note what you saw in the **Saw** line. Wherever you see something different from **Expect**, write it down and don't fix it yourself. Hand the file back, and the lanes will record your results.


## Human session status — 16 November 2026

**BLOCKED by critical cross-document buffer replacement.** Only checked items
below are scoped passes; unchecked items may be partial, failed or untested as
explained in their Saw lines. The checklist and stage gates are not complete.

See [human findings and evidence](human-findings-2026-11-16.md) and the
[Claude repair handoff](claude-handoff-human-checklist-2026-11-16.md).
Initial read-only success under C.3 was reopened after the later corruption
report. Do not promote harness results or screenshots to unobserved human passes.

## Before you start

- **Build.** Use `feat/intellisense-ws` at `e62587f` or later, which contains Stage 1b and 1c.
  - Step 7 (symlink aliases) is **not** in it. Checks marked *(step 7)* need `refs/heads/feat/lsp-1c-step7`.
- **Server.** In Preferences, set the Rust language server to `/usr/bin/rust-analyzer`, not `lldb-dap`.
- **Fixtures.** They are in the Verification lane's worktree:
  `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/fixtures/`
  Copy one somewhere else first if you'd rather not edit it in place.
- **Seeing the server process.** Keep a terminal open with:
  ```bash
  watch -n 0.5 'pgrep -a rust-analyzer'
  ```
- **Ports.** Leave port 1420 alone; it belongs to AgentIShip.

---

## G1: no server during startup or parked-window restore

Fixture: a solution with a linked-window Power Config of two windows. Any Rust solution where you can park (hide) one linked window will do.

- [ ] **1.1** Launch Craidd and open the solution with **no tabs** open.
  - **Expect:** no `rust-analyzer` process.
  - Saw: PARTIAL. fx-small opened with no tabs and no Craidd-owned rust-analyzer in the initial sampler; the existing VS Code server was excluded. Cold launch and the two-window Power Config sequence were not verified.
- [ ] **1.2** In one linked window, open a `.rs` file and make it active. Then park (hide) that window.
  - **Expect:** one server starts when the Rust tab first becomes active, and no second one starts.
  - Saw: NOT TESTED. Three linked fx-many windows were seen, but launch count and explicit park sequence were not verified.
- [ ] **1.3** With a **non-Rust** tab active in the parked window (for example the `.cln` or a `.md` file), quit, relaunch and restore the parked window.
  - **Expect:** no server until you click a Rust tab, and exactly one launch then.
  - Saw: NOT TESTED.
- [ ] **1.4** Repeat 1.3 with the Rust tab active at the moment you park. While restoring, switch to the non-Rust tab and back within about one second.
  - **Expect:** one start, not two.
  - Saw: NOT TESTED.

## G2: one server per Cargo workspace (by eye)

Fixture: `fx-ws`.

- [ ] **2.1** Open `alpha/src/main.rs`, then `beta/src/main.rs`, then `outside/src/main.rs`.
  - **Expect:** the process count goes 1, 1, 2. The chip reads `rust-analyzer` in each, and its hover shows the right root: the workspace root for alpha and beta, and `outside` for the last.
  - Saw: NOT TESTED with fx-ws; workspace process-count sequence remains open.
- [ ] **2.2** Add an error in each file, for example `let x: u32 = "a";`.
  - **Expect:** a red marker in each file, with its row in Problems.
  - Saw: NOT TESTED with fx-ws.

## G5: diagnostics across files, and the Problems panel

Fixture: `fx-small`.

- [ ] **5.1** Open `src/util.rs` **beside** `src/main.rs` in split view. Change `pub fn ok()` to `pub fn ok(x: u32)` **without saving**.
  - **Expect:** `main.rs` shows an error at its call to `ok()` within about half a second, with no edit to `main.rs`.
  - Saw: PARTIAL. Unsaved util.rs signature edit produced argument errors at both main.rs calls. Human confirmed no save for edit or undo. Half-second timing and split-view requirement were not verified; update delays were reported.
- [x] **5.2** Undo the change.
  - **Expect:** the marker in `main.rs` clears.
  - Saw: PASS (human report/screenshots). Unsaved undo cleared the errors to zero.
- [x] **5.3** Open `fx-many`, or `fx-big` for a heavy run.
  - **Expect:** the Problems header shows "showing 500 of N". With `fx-big` it also shows "counts are at least…". The IDE stays responsive.
  - Saw: PASS for fx-many (human report). Problems showed 500 of 7314 entries and typing/tab switching seemed fine. Save-time recount and later cross-window count differences are separate open findings. fx-big was not tested.

## G6: closing the solution ends its servers

- [x] **6.1** With a Rust file open and a server running, close the solution **from the app's own menu**, if there is such an item. "Get Started" does not close the solution.
  - **Expect:** within a second or two, no `rust-analyzer`, `cargo`, `rustc` or proc-macro process is left.
  - Saw (and which menu item you used): PASS for cleanup (human report/process output). File → Exit → This Solution closed all three linked solution windows. Subsequent pgrep showed only known VS Code rust-analyzer PID 1799171 and helpers 1799643/1799644; exact one-to-two-second latency was not measured. Missing Getting Started after last-solution close is a separate Alpha UX requirement.
- [ ] **6.2** Re-open the same file afterwards.
  - **Expect:** no stale error markers from the old session.
  - Saw: UNVERIFIED. A retry did not crash, but no observation established whether old markers appeared before reconnection. The earlier apparent crash was confounded by the assistant editing watched docs and triggering a Tauri rebuild; do not report it as a confirmed application crash.

## G7: sync with real focus and disk changes

Fixture: `fx-small`.

- [ ] **7.1** Close the `util.rs` tab and keep `main.rs` open. In **another editor**, change `util.rs` on disk so that `main.rs` breaks. Then click back into the Craidd window.
  - **Expect:** `main.rs` shows the new error without being edited.
  - Saw: PARTIAL / SETUP CONFLICT. External signature change produced main.rs errors, but util.rs was open/dirty and a disk conflict dialog appeared. The closed-tab condition was not verified.
- [ ] **7.2** Revert `util.rs` on disk while Craidd keeps focus, and wait up to 30 s.
  - **Expect:** the error clears.
  - Saw: DID NOT MEET intended behaviour in the observed run. Restored ok() with no dirty dot still showed old errors; selecting main.rs cleared them. Exact 30-second interval was not independently measured; earlier conflict complicates reproduction.
- [ ] **7.3** Open `util.rs`, switch to another tab, then edit `util.rs` on disk. Switch back.
  - **Expect:** the tab shows the **new** text, and errors match it.
  - Saw: UNRESOLVED. Later external edit did not appear in the displayed util.rs buffer/diagnostics; a dirty dot was present and its origin unknown. Clean-tab reload remains unverified. User separately reports Run silently replacing a dirty older buffer with disk content.
- [ ] **7.4** Type normally for a minute in `main.rs`, using undo, redo, paste and a multi-line paste.
  - **Expect:** errors track what you see, with nothing stale and no "desynced" note.
  - Saw: QUALIFIED / NOT PASSED. Initial typed/pasted errors appeared quickly and undo/redo worked. After corrections, older LIVE · RUSTC diagnostics remained until save, which cleared them. Do not label this a proven failure of all rust-analyzer in-memory sync. Multiline paste indentation issue also observed; no desynced message was reported.

## Stage 1c features (by eye)

Fixture: `fx-1c`.

- [ ] **C.1** Hover `HashMap`.
  - **Expect:** the struct signature and docs, readable, with no raw HTML.
  - Saw: PARTIAL VISUAL EVIDENCE. Screenshot shows HashMap signature and rendered docs without obvious raw HTML. Explicit readability acceptance remains open; a persistent Documentation Browser enhancement was proposed.
- [x] **C.2** Press Ctrl+Shift+O, the outline.
  - **Expect:** the symbols of `shapes.rs` in their nesting.
  - Saw: PASS (human screenshots/confirmation). Nine shapes.rs symbols with parent-context labels; Enter navigates to circumference. Arrow-key movement previews/highlights locations. Nesting is presented through labels rather than a tree.
- [ ] **C.3** Press F12 on `shared_value`, then on `Circle`, then on `HashMap`.
  - **Expect:** same-file and cross-file jumps work, and an already-open file's tab is focused with no second tab. For `HashMap`, a **read-only** tab opens, with a lock glyph and the reason shown on hover. Typing does nothing there.
  - Saw: REOPENED / CRITICAL SAFETY BLOCKER. shared_value and Circle definition jumps worked and existing tabs were reused. HashMap initially had lock/reason tooltip and rejected typing. Later navigation/reference/editing produced HashMap source under dirty main.rs plus locked-and-dirty map.rs and a save-conflict dialog. Initial read-only pass is insufficient; see findings section 11 and final recovery addendum.
- [ ] **C.4** Press Shift+F12 on `shared_value`, and also try the right-click menu, "Go to References" and "Peek → Peek References".
  - **Expect:** 5 results across files.
  - Saw: BLOCKED. Circle references showed 4 results after F12 on the declaration; this is not the required shared_value 5-result check. Required Shift+F12 and both context-menu routes not completed due to document-replacement bug.
- [ ] **C.5** In a function without the import, type `HashM` and accept `HashMap`.
  - **Expect:** `HashMap` plus a `use std::collections::HashMap;` line. One Ctrl+Z removes **both**.
  - Saw: NOT TESTED.
- [ ] **C.6** Make two cursors (Alt+click), type `HashM`, and open completion.
  - **Expect:** no auto-import item is offered, and the document doesn't change. Output says why, once.
  - Saw: NOT TESTED.
- [ ] **C.7** With the read-only `HashMap` tab open, press ↻ Restart on the chip, or kill the server.
  - **Expect:** the tab stays, with the note "language server: not connected; navigate from a live session to reconnect". Pressing F12 on `HashMap` again from `main.rs` clears the note.
  - Saw: NOT TESTED.
- [ ] **C.8** *(step 7, on `feat/lsp-1c-step7`)* Using `fx-symlink`, open the file through the symlinked path, then through the real path.
  - **Expect:** the symlinked tab is read-only with an "alias" chip ("Also open as …"). A symlinked path that is not in a project shows "opened through a symlink; open the real path for language features".
  - Saw: NOT TESTED; branch-specific symlink check remains open.

## Visual judgement

- [ ] **V.1** Chip colours and states (indexing, ready, ⚠ warning, error, not connected). Do they read clearly?
  - Saw: PARTIAL only: ordinary rust-analyzer chip, counts and root tooltip seen; all states and explicit visual judgement not completed.
- [ ] **V.2** The lock glyph and the "not connected" note. Do they look right beside the tab and status bar?
  - Saw: PARTIAL only: external source lock/reason tooltip seen; disconnected note not tested. Read-only lifecycle safety reopened under C.3.
- [ ] **V.3** The hover widget and outline. Do they look right?
  - Saw: PARTIAL only: hover and outline shown; no full explicit visual acceptance. Documentation Browser and read-only References preview UX proposals recorded.

## Optional: needs a second inotify hold (V2, U6)

Do this only if you are happy to let your file watches be used up for 120 s. Editors and other apps may miss file changes during that time.

- [ ] **W.1** Tell the lead to run U6 again with a real hold, or do it yourself. During the hold you should see a ⚠ chip with "File watching failed …". After it, ↻ Restart should be offered and should clear the warning.
  - Saw: NOT TESTED; optional inotify exhaustion was not requested or performed.

---

**When you're done:** tell the lead which items passed and which differed. The gate verdicts for G1, G2, G5, G6 and G7 move only with your results.

---

*Last updated: Phase 3 (Stage 1 closeout, 16 November 2026). Author(s): ShinkuKira21.*
*This document is a plan.*
