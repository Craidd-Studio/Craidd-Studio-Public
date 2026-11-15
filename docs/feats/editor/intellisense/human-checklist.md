# Human checklist: LSP Stage 1

[Results](results-lsp-stage-1.md) · [Decision pack](decision-pack-lsp-stage-1.md) · [Ratification pack](ratification-lsp-stage-1.md)

These are the checks the harness cannot do. The harness has already seen every other result, and recorded each as "harness-observed, pending user review". Tick each box, then note what you saw in the **Saw** line. Wherever you see something different from **Expect**, write it down and don't fix it yourself. Hand the file back, and the lanes will record your results.

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
  - Saw:
- [ ] **1.2** In one linked window, open a `.rs` file and make it active. Then park (hide) that window.
  - **Expect:** one server starts when the Rust tab first becomes active, and no second one starts.
  - Saw:
- [ ] **1.3** With a **non-Rust** tab active in the parked window (for example the `.cln` or a `.md` file), quit, relaunch and restore the parked window.
  - **Expect:** no server until you click a Rust tab, and exactly one launch then.
  - Saw:
- [ ] **1.4** Repeat 1.3 with the Rust tab active at the moment you park. While restoring, switch to the non-Rust tab and back within about one second.
  - **Expect:** one start, not two.
  - Saw:

## G2: one server per Cargo workspace (by eye)

Fixture: `fx-ws`.

- [ ] **2.1** Open `alpha/src/main.rs`, then `beta/src/main.rs`, then `outside/src/main.rs`.
  - **Expect:** the process count goes 1, 1, 2. The chip reads `rust-analyzer` in each, and its hover shows the right root: the workspace root for alpha and beta, and `outside` for the last.
  - Saw:
- [ ] **2.2** Add an error in each file, for example `let x: u32 = "a";`.
  - **Expect:** a red marker in each file, with its row in Problems.
  - Saw:

## G5: diagnostics across files, and the Problems panel

Fixture: `fx-small`.

- [ ] **5.1** Open `src/util.rs` **beside** `src/main.rs` in split view. Change `pub fn ok()` to `pub fn ok(x: u32)` **without saving**.
  - **Expect:** `main.rs` shows an error at its call to `ok()` within about half a second, with no edit to `main.rs`.
  - Saw:
- [ ] **5.2** Undo the change.
  - **Expect:** the marker in `main.rs` clears.
  - Saw:
- [ ] **5.3** Open `fx-many`, or `fx-big` for a heavy run.
  - **Expect:** the Problems header shows "showing 500 of N". With `fx-big` it also shows "counts are at least…". The IDE stays responsive.
  - Saw:

## G6: closing the solution ends its servers

- [ ] **6.1** With a Rust file open and a server running, close the solution **from the app's own menu**, if there is such an item. "Get Started" does not close the solution.
  - **Expect:** within a second or two, no `rust-analyzer`, `cargo`, `rustc` or proc-macro process is left.
  - Saw (and which menu item you used):
- [ ] **6.2** Re-open the same file afterwards.
  - **Expect:** no stale error markers from the old session.
  - Saw:

## G7: sync with real focus and disk changes

Fixture: `fx-small`.

- [ ] **7.1** Close the `util.rs` tab and keep `main.rs` open. In **another editor**, change `util.rs` on disk so that `main.rs` breaks. Then click back into the Craidd window.
  - **Expect:** `main.rs` shows the new error without being edited.
  - Saw:
- [ ] **7.2** Revert `util.rs` on disk while Craidd keeps focus, and wait up to 30 s.
  - **Expect:** the error clears.
  - Saw:
- [ ] **7.3** Open `util.rs`, switch to another tab, then edit `util.rs` on disk. Switch back.
  - **Expect:** the tab shows the **new** text, and errors match it.
  - Saw:
- [ ] **7.4** Type normally for a minute in `main.rs`, using undo, redo, paste and a multi-line paste.
  - **Expect:** errors track what you see, with nothing stale and no "desynced" note.
  - Saw:

## Stage 1c features (by eye)

Fixture: `fx-1c`.

- [ ] **C.1** Hover `HashMap`.
  - **Expect:** the struct signature and docs, readable, with no raw HTML.
  - Saw:
- [ ] **C.2** Press Ctrl+Shift+O, the outline.
  - **Expect:** the symbols of `shapes.rs` in their nesting.
  - Saw:
- [ ] **C.3** Press F12 on `shared_value`, then on `Circle`, then on `HashMap`.
  - **Expect:** same-file and cross-file jumps work, and an already-open file's tab is focused with no second tab. For `HashMap`, a **read-only** tab opens, with a lock glyph and the reason shown on hover. Typing does nothing there.
  - Saw:
- [ ] **C.4** Press Shift+F12 on `shared_value`, and also try the right-click menu, "Go to References" and "Peek → Peek References".
  - **Expect:** 5 results across files.
  - Saw:
- [ ] **C.5** In a function without the import, type `HashM` and accept `HashMap`.
  - **Expect:** `HashMap` plus a `use std::collections::HashMap;` line. One Ctrl+Z removes **both**.
  - Saw:
- [ ] **C.6** Make two cursors (Alt+click), type `HashM`, and open completion.
  - **Expect:** no auto-import item is offered, and the document doesn't change. Output says why, once.
  - Saw:
- [ ] **C.7** With the read-only `HashMap` tab open, press ↻ Restart on the chip, or kill the server.
  - **Expect:** the tab stays, with the note "language server: not connected; navigate from a live session to reconnect". Pressing F12 on `HashMap` again from `main.rs` clears the note.
  - Saw:
- [ ] **C.8** *(step 7, on `feat/lsp-1c-step7`)* Using `fx-symlink`, open the file through the symlinked path, then through the real path.
  - **Expect:** the symlinked tab is read-only with an "alias" chip ("Also open as …"). A symlinked path that is not in a project shows "opened through a symlink; open the real path for language features".
  - Saw:

## Visual judgement

- [ ] **V.1** Chip colours and states (indexing, ready, ⚠ warning, error, not connected). Do they read clearly?
  - Saw:
- [ ] **V.2** The lock glyph and the "not connected" note. Do they look right beside the tab and status bar?
  - Saw:
- [ ] **V.3** The hover widget and outline. Do they look right?
  - Saw:

## Optional: needs a second inotify hold (V2, U6)

Do this only if you are happy to let your file watches be used up for 120 s. Editors and other apps may miss file changes during that time.

- [ ] **W.1** Tell the lead to run U6 again with a real hold, or do it yourself. During the hold you should see a ⚠ chip with "File watching failed …". After it, ↻ Restart should be offered and should clear the warning.
  - Saw:

---

**When you're done:** tell the lead which items passed and which differed. The gate verdicts for G1, G2, G5, G6 and G7 move only with your results.

---

*Last updated: Phase 3 (Stage 1 closeout, 15 November 2026). Author(s): ShinkuKira21*
*This document is a plan.*
