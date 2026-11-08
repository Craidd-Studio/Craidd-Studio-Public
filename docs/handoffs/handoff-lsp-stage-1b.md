# Handoff: LSP Stage 1b coordination checkpoint

You are taking over the coordination of Craidd Studio's Rust language-server work (Phase 3, Stage 1b). The user is the architect and decides; you coordinate three lanes, relay the user's decisions in their own words, and check results before you report them.

Work as far down the job list as the rules below allow. Report to the user at the end, with what is verified and what is not.

## Read first

1. [Philosophy](../philosophies/ide_editor/intellisense/philosophy-intellisense.md): amendments A1-A5 applied; A6 and A7 are still waiting for the user.
2. [Design, Stage 1 Rust](../feats/editor/intellisense/design-lsp-stage-1-rust.md): the authority. Decisions 1-38 are recorded. Open decisions are at the end.
3. [Results](../feats/editor/intellisense/results-lsp-stage-1.md): gates (G1-G7), verification rows (V) and the manual UI review.
4. [Member-root limitation](../future/future-lsp-member-root-recovery.md): a known, accepted gap (decision 38).
5. [Working protocol](../working-protocol.md) and the doc footer rule (below).

The results doc on `feat/intellisense-ws` is behind the one on `feat/lsp-stage-1b`. The newest record is on `feat/lsp-stage-1b`.

## Standing rules (from the user; do not relax)

- Do not push or merge to `master`.
- Do not begin Stage 1c.
- Do not mark Stage 1b or any gate Pass without the required evidence. G1 stays **Fail** until the crash is demonstrably resolved and the gate measurements pass.
- Do not merge `verify/lsp-stage-1b` (the verification tooling) into `feat/intellisense-ws` without the user's approval.
- Do not merge `feat/lsp-stage-1b` into `feat/intellisense-ws` without the user's approval. Stage 1b is not accepted.
- Craidd never installs tools. The user installed `rust-analyzer` with pacman.
- No subagents. Split work into separate sessions (the lanes below).
- Doc footer, on every file in `docs/`: `*Last updated: {phase or date}. Author(s): ShinkuKira21*` then `*This document is a {design | philosophy | plan | record | placeholder}.*`. The author is never an agent.
- Verdict words. Gates: Pass, Fail, Blocked, Unmeasured. Checks: Verified, Failed, Unverified. A result a harness saw but the user has not looked at is "harness-observed, pending user review".
- Port **1420 is the user's AgentIShip server**. Craidd runs use **1440**. Stop only processes you started, by pid, after checking the command line and working directory. Never `pkill -f`, and never kill whatever is listening on a port.
- Relay the user's decisions to lanes with their words quoted. Do not paraphrase an approval into a wider one.

## Branches

| Branch | Tip | Role |
|---|---|---|
| `feat/intellisense-ws` | this commit | Docs integration branch. Everything docs-side merges here. Nothing is pushed. |
| `feat/lsp-stage-1b` | `39f4e89` | Stage 1b implementation, plus the results records fast-forwarded onto it. Not merged into `feat/intellisense-ws`. |
| `verify/lsp-stage-1b` | `cb90bc2` | Verification tooling: wrapper, sampler, harness, cold-start check, U1-U13 pack. Stays isolated. |
| `verify/lsp-stage-1b-r6a-results` | `267ad8e` | Verification record branch (already contained in `feat/lsp-stage-1b`). |

Edits to files in the main checkout are blocked by a hook. Work in your own worktree, commit there, then fast-forward `feat/intellisense-ws` in the main checkout with `git merge --ff-only`.

## Lanes

| Lane | Session | Does |
|---|---|---|
| Implementation | `local_9f91bcf9-d072-43b7-a0b7-36bb861d05a6` | Code and tests on `feat/lsp-stage-1b`. Never marks a gate. |
| Verification | `local_dca4f848-1143-4973-9ed5-9dad3b83505b` | Re-runs suites independently, drives the real IDE with the harness, records results. Never fixes a defect it finds; it records it. |
| Documentation and Planning | `local_d7cc5457-8c99-4c9c-ae79-1e6e7557a05f` | Design, philosophy and results prose. Proposes first; edits only after approval. |

Each lane keeps its own worktree. Ask a lane to detach its worktree when it finishes, so the user can check the branch out.

## Where things stand

**Stage 1a** is integrated and independently reproduced. **Stage 1b** (pull diagnostics, workspace reload, server health, watch-limit warning, the wave scheduler) was implemented, repaired (decisions 28-37) and independently verified at the suite and real-server level. The manual UI review then found two defects, each fixed:

1. **`startupDone` was never set**, so no server ever attached. Fixed in `700b59d` (the start-up gate moved into `LaunchGate`). Verified by Verification at `700b59d`: no server before a Rust tab is active, one bounded launch.
2. **The IDE window crashed when rust-analyzer first connected.** A status batch created a partial session view before the attach reply, so the chip read `view.server` and threw. Fixed in `ead1a68` (merge the attach reply into an early view), tests in `39f4e89`, and a local `ChipBoundary` around `LanguageServerChip`. Implementation reports: node 120, `tsc` clean, `vite build` ok, cargo lib 228 passed / 9 ignored, `process_cleanup` 7 passed / 1 ignored, DAP 26 unchanged. **Not yet independently verified.** The commit has been sent to Verification, which is verifying it now (several cold starts on port 1440, a successful connection each time, the store trace, and a contained chip failure if it can be triggered).

G1 is **Fail** and G2-G7 are **Unmeasured** until the UI review passes.

**Tab restore is not a requirement.** The Docs lane found that Craidd restores intent, not state: a plain launch opens no tabs. The design and philosophy wording that assumed a "session restore" is wrong. Only a parked (hidden) linked window is restored with its tabs. The user said not to implement tab restore to satisfy a test script. The Docs lane has proposed wording changes (below). The user has not approved them.

## Job list

Do these in order. "Needs user" means stop and report; do not proceed on your own judgment.

### A. Finish the crash-fix verification (Verification)

1. Wait for Verification's report on `ead1a68` / `39f4e89`. Check its record commit yourself (`git show --stat`, read the diff) before you accept it.
2. If it finds another defect, send it to Implementation as a fix request with the evidence, quoting the user's standing approval only if it still applies. A defect outside the crash-fix scope **needs the user**.
3. Fast-forward Verification's record commits onto `feat/lsp-stage-1b` (by ref, not by name guess).

### B. Run the UI review (Verification), once A is verified

The user: "Do not start U1-U13 acceptance testing until the crash fix is independently verified." When A is complete:

4. Verification runs U2-U13 with the harness, marking each "harness-observed, pending user review". It stops and reports when a decision is needed or a defect appears.
5. U1 steps 2, 3 and 5 assume tab restore. **Hold U1's rewrite until the user approves the wording** (job D). Until then U1 stays as recorded (attempt 3, by hand-open).
6. Measure what the harness can: G2 (one server per workspace), G3/G3b (indexing, Channel rate), G5 (diagnostic flood, store size), G6 (descendants gone on close), G7 (sync and overflow), V3, V4, V9, V20, V25, V26, and the decision 22 budget. Record each as Verified, Failed or Unverified with the evidence path. A gate becomes Pass only with its full required evidence; if a gate needs the user's eyes (U-steps marked so in `UI-STEPS.md`), leave it for the user.
7. V16 is open until U10. V7 (the rustup shim) is a release qualification and stays Unverified.

### C. Findings to write up (Implementation reads, Docs records; no fixes)

Each needs a short entry in the results doc under findings, not a verdict:

8. **Progress events before a view exists are dropped** if a batch carries progress but no status. Implementation did not check whether the backend's first batch always carries a status. Have Implementation check the backend and report; do not change code without the user.
9. **The language-server "usable" check accepts any binary that exits 0 on `--version`.** This let `lldb-dap` be accepted as the Rust language server. `src-tauri/src/commands/toolchain.rs`.
10. **Toolchain discovery never rescans.** `~/.craidd-studio/user_preferences.toml` holds a stale `[toolchains.rust] scanned = true` with only cargo and rustc, so rust-analyzer showed "Not found". Do not edit the user's preferences file.
11. A status batch arriving after the solution closes creates a view for an old session. Harmless; mention only.
12. The `codicon.ttf` console message is a Vite allow-list artifact of the nested run checkout using the parent `node_modules`. Not a product defect.

For 9 and 10, draft a proposal (what the fix would be, its risk) for the user to decide. Do not implement.

### D. Tab-restore wording (Docs proposes; needs user)

The Docs lane's proposed changes, all docs only:

- Design, Launch trigger (around lines 255-261): replace the "Session restore opens tabs at solution open" sentence with "Craidd restores intent, not state, so a normal launch opens no tabs. Tabs arrive after startup in two ways: the user opens them, or a parked linked window is restored with its tabs (`restoredFromHidden`)." Also "startup/restore sequence" becomes "startup, including any parked-window tab restore", and "restored background tabs" becomes "background tabs from a parked-window restore".
- Design, G1 (around line 897): name "No server during startup or parked-window restore"; method "launch and open a Rust solution with no tabs, then hide and restore a linked window holding Rust tabs, with a Rust and then a non-Rust tab active". Pass criteria unchanged.
- Philosophy A2 (around line 126): "after startup and session restore have completed" becomes "after startup and any parked-window restore have completed". This is an applied amendment, so it **needs the user's approval** before it is edited.
- UI-STEPS U1 (on `verify/lsp-stage-1b`, owned by Verification): open `main.rs` and a second `.rs` file by hand; make a non-Rust tab active by hand, then hide and restore the window; restore the same parked window; state that no tabs are expected after a plain relaunch or "Previously Opened Windows".
- Design acceptance criteria 2 and 12 and review-table entry 1: "parked-window restore" in place of "session restore".

Docs may prepare these edits in its own worktree. It must not commit them to `feat/intellisense-ws` until the user approves. Follow the doc-first rule: the doc is the thing the user reads.

### E. Record keeping (Docs)

13. Record the two UI-review defects, their fixes and the `ChipBoundary` in the design doc and results doc, as a decision if the design calls for one (the next free decision number is 39). Propose first.
14. Keep the open-decisions list current.

### F. Waiting on the user (do not act)

- A6 and A7 amendments.
- The stage 6 "keep flowing" wording.
- Whether to accept Stage 1b once the UI review is done, and whether to merge `feat/lsp-stage-1b` into `feat/intellisense-ws`.
- The tab-restore wording (job D).
- Fixes for findings 9 and 10.
- V16 (U10) and the V7 rustup shim as a release qualification.

## Traps seen so far

- **Wrong server path.** The user once selected `/usr/bin/lldb-dap` as the Rust language server, which made U1 attempt 1 invalid. The correct path is `/bin/rust-analyzer` (it links to `/usr/bin`).
- **The user's old IDE instance** may still be running when the harness starts. Verification closes it cleanly before launching its own.
- **Usage limits.** A lane can hit a session or weekly limit and stop. If a lane goes quiet, check its state with `list_events` and resume it with a message, not a new session.
- **A lane's report is not proof.** Read the commit and the diff before telling the user a thing is done.
- **Do not run the UI harness unprompted.** The user verifies by eye; the harness runs when the user has asked for it or the testing stage is active. It is active now for the crash-fix verification and the U-steps.
- **The `CRAIDD_LSP=0` baseline** disables the whole path; the gate stays closed there.

## What to report at the end

Give the user, in this order: what is verified (with commit hashes and test counts), what is "harness-observed, pending user review", what failed, what is still Unmeasured, and the decisions waiting for them. Name each branch by its full ref. Say plainly if a lane stopped early.

---

*Last updated: Phase 3 (Stage 1b, crash fix awaiting verification). Author: ShinkuKira21.*
*This document is a record.*
