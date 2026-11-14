# Ratification pack: stand-in approvals DA-4, DA-8, DA-11 and DA-14

[Delegated approvals](delegated-approvals-lsp-stage-1.md) · [Decision pack](decision-pack-lsp-stage-1.md) · [Design](design-lsp-stage-1-rust.md) · [Results](results-lsp-stage-1.md) · [1b summary](summary-lsp-stage-1b.md) · [1c summary](summary-lsp-stage-1c.md)

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** For the architect's ratification. **Stage 1 is not accepted.** Each entry below gives its exact text from the approvals file, what it permitted, what was done under it, the evidence, and any open caveat, so each can be ratified or revised. DA-15 is already ratified as decision 56. Every verification result is **harness-observed, pending user review** unless stated; verdict words are the results record's own.

**How to answer.** For each entry write *ratify*, or *revise* with the changed wording. A ratified entry stops being a stand-in and is recorded in the design as an architect decision; a revised one is applied as you word it, and work already done under the old wording is reported, not silently undone (approvals file, "How lanes use this file").

---

## DA-4: tab-restore wording (philosophy A2)

**Exact text (approvals file).**

> **Item:** Job D: tab-restore wording  
> **Stand-in decision:** **Approved as proposed** in the handoff (design launch trigger, G1 name and method, acceptance criteria 2 and 12, review-table entry 1, and U1 on `verify/lsp-stage-1b`). This includes philosophy **A2**, from "after startup and session restore have completed" to "after startup and any parked-window restore have completed". The pass criteria do not change.  
> **Why it fits the philosophy:** Craidd restores intent, not state. The architect said not to build tab restore to satisfy a test. The edit corrects a factual error and does not widen anything. A2 is an applied amendment, so this is the entry the architect is most likely to want to review.

**What it permitted.** Changing "session restore" to "parked-window restore" in the design (launch trigger, the G1 name and method, acceptance criteria 2 and 12, review-table entry 1), and the same change to philosophy amendment A2, with no change to any pass criterion. U1 in `UI-STEPS.md` was left to the Verification lane.

**What was done.**

- `77627c2` (branch `docs/lsp-1b-wording`, fast-forwarded onto `feat/intellisense-ws`): the listed design edits, the philosophy A2 sentence (marked in the philosophy and in the design's A2 row as made under DA-4), and decision 39 (DA-5).
- Edits beyond the handoff's list, for consistency: the design's "Decision (approved)" line, the A2 row's rationale and resolved open-decision 6 now also say "parked-window restore". They are easy to revert.

**Evidence.**

- The premise: "Craidd restores intent, not state"; the main window starts on the welcome screen and only a parked linked window is restored with its tabs (results, U1 attempt 3).
- Reworded U1 on the final 1b code, 5 runs with LSP on and 5 with `CRAIDD_LSP=0` (results, "Job B, batch 1"): the start-up conditions the harness can reach held.

**Open caveats.**

- **G1 is still Fail** in the results table; the parked-window hide and restore (U1 steps 4 and 6) cannot be driven by the harness and were not run, and T3 is untrusted and T4 missing.
- A2 is an applied amendment; the architect asked to see it first.

**Your answer:** ratify / revise.

---

## DA-8: findings 9 and 10 (toolchain usable check and rescan)

**Exact text (approvals file).**

> **Item:** Finding 9 (usable check accepts any binary) and finding 10 (discovery never rescans)  
> **Stand-in decision:** **Finding 9, approved:** the toolchain table entry for a role declares how a binary identifies itself (for rust-analyzer, `--version` output beginning `rust-analyzer`). The usable check requires that identity. A mismatch shows "Not usable: this looks like a different tool", with the version line shown. The identity comes from data, not from a rule hardcoded at runtime. **Finding 10, approved:** when a role's binary is missing from the stored scan, Craidd re-probes on read and shows what it found. It writes that result to preferences **only** when the user presses the existing Rescan or Save action. Nothing is installed, and the user's file is not edited by an agent. Both fixes go through DA-7's test and re-check rules.  
> **Why it fits the philosophy:** Detection confidence is never blurred, nothing changes silently, no tool is bundled, and Craidd stays table-driven.

**What it permitted.** Two fixes, each through DA-7's regression-test and independent re-check rules: (9) the toolchain table entry declares how a binary identifies itself and the usable check requires it; (10) a re-probe on read when a role is missing from the stored scan, written to preferences only on the user's Rescan or Save.

**What was done.**

- `6cfcf7a` (identity check), `3346a72` (re-probe on read), `345eb37` (chip hover while spawning), on `fix/lsp-1b-toolchain-2`, merged as `e62474d`. Record commit `7a18133`.
- The user's preferences file was not edited by an agent.

**Evidence** (results, "Toolchain fixes for findings 9 and 10 and the chip hover, independent re-check").

- Suites: `node --test` 120 passed; `tsc` and `vite build` 0; `cargo test --lib` run 5 times, 236 passed each; no flaky test seen.
- `lldb-dap` as the Rust language server: refused with "Not usable: this looks like a different tool", preferences file hash unchanged. **Verified**, as far as the limit states.
- Stale preferences (`scanned = true`, only `cargo` and `rustc`): a Rust file launched the server, Preferences showed the found `rust-analyzer` with the notice that nothing is saved until Rescan, file hash unchanged. **Verified.**

**Open caveats.**

- The Preferences "Choose Path…" button opens a native dialog the harness cannot drive; the command it calls was exercised, the button was not.
- The chip hover fix (`345eb37`) is **Unverified** for the targeted window (about 1–2 ms; no failure seen). It is not named in DA-8's text; it was a defect fix under DA-7. Ratify it with DA-8 or separately.
- V7's rustup-shim case stays **Unverified** (no rustup on this machine); the declared `rust-analyzer` identity has not been checked against a shim's output.

**Your answer:** ratify / revise.

---

## DA-11: starting Stage 1c

**Exact text (approvals file).**

> **Item:** Starting Stage 1c (providers)  
> **Stand-in decision:** Approved **after DA-10's merge**, on `feat/lsp-stage-1c`, cut from `feat/intellisense-ws`. The scope is exactly the design's Stage 1c: completion with resolve and atomic acceptance (decision 13; primary-only application is never acceptable), hover, definition, references, document symbols, navigation to unowned files with the read-only lock glyph (decision 29), and the symlinked-vendor cases. It follows doc-first: Docs writes the Stage 1c plan section, the lead checks it against the design and records any new choice as a decision under DA-12, and then Implementation builds.  
> **Why it fits the philosophy:** The architect's goal is "Rust IntelliSense fully working". Stage 1c is the design's own route to it. Nothing outside Stage 1c's scope is started.

**What it permitted.** Starting Stage 1c on `feat/lsp-stage-1c`, scope exactly the design's Stage 1c, doc-first.

**What was done** (on `feat/lsp-stage-1c`, merged into `feat/intellisense-ws` as `b403fb7`, which the merge commit records as authorised by the architect):

| Step | Commit |
|---|---|
| 0 capability summary | `410750e` |
| 1 request plumbing | `ee2766d` |
| 2 hover | `36c4ba0` |
| 3 symbols (and `command:` URIs dropped from hover) | `2be3b90` |
| 4 definition and opener | `97cc915` |
| 5 read-only navigation tabs | `e0538ca` |
| 6 references with a cap (and chip truncation detail) | `867ba5c`, `6ff9afb` |
| 8–9 completion, F3 | `a0af31c` (probe `2cd17be`) |
| Fixes | `dfbddef` (multi-cursor), `68638be`, `7a2f814`, `704d9a6`, `6c89f8f` (decision 51 and restart rebind), `9bb0805` (cleanup-test wait) |
| 10 prep | `195dfed` |

Step 7 had not started; decision 52 now authorises it.

**Evidence.** Per-step independent re-checks in the results doc; the [1c summary](summary-lsp-stage-1c.md) lists U14–U26. The Stage 1c verifications: V10 **Failed**, V11 and V12 **Verified**, V18 **Failed**; G4 now **Pass** by your decision.

**Open caveats.**

- Step 7 and U24 (decision 52 authorised, not yet done).
- **Unverified:** snippet tab stops, local filtering of a complete list (this server returns incomplete lists), hooks on/off in the IDE.
- **No record in the results doc** of U21 and of Verification's first-pass check of steps 8–9.
- G3 is kept pending for a cold first-check run.
- One environmental failure unrelated to this work (`ldi_pair_requires_selected_managed_debug_and_library_build_slots`, `netcoredbg` not installed).

**Your answer:** ratify / revise.

---

## DA-14: Stage 1c plan and decisions 40–55

**Exact text (approvals file).**

> **Item:** Stage 1c plan ([plan-lsp-stage-1c-providers.md](plan-lsp-stage-1c-providers.md)) and its proposed decisions 40–55  
> **Stand-in decision:** **The plan's order of work, tests and exit evidence are approved.** Decisions **40, 41, 42, 43, 45, 46, 47, 48, 50, 51, 53 and 55** are approved as proposed, under DA-12. **44** is approved as "existing surfaces only" (an Output line plus the chip detail). If that turns out not to work, a new surface still needs the architect. **49** is approved: unowned reads are restricted to paths the session returned. It adds a restriction, not a permission, so it narrows risk. The architect should still see it. **54** is approved with this clarification: F1's compensating revert is a **Monaco-local** command that Craidd attaches to the item. It is not a server `workspace/executeCommand`, and server item commands are still not executed. **52 is not approved.** It changes design file-identity rules 2 and 3 and stays with the architect, so step 7 waits for U10 and for the architect. The approved decisions are added to the design's open-decisions list marked "Stand-in approval (DA-14)".  
> **Why it fits the philosophy:** Every approved choice fills a gap the design leaves open, and none changes an existing decision. 45 and 49 tighten security around text and paths from an external process.

**What it permitted.** The plan's order of work, tests and exit evidence, and the decisions below as stand-ins. Decision 52 was not approved then and is now your decision (Option B); decision 56 is yours.

Commits are from the commit subjects; where a decision is not named in a subject the mapping is marked "inferred".

| Decision | What it says | Commit(s) | Evidence |
|---|---|---|---|
| 40 | One typed command per provider kind | `ee2766d` | Step 0–2 re-check: tests pass; a kind the server did not negotiate is never requested |
| 41 | Per-kind timeouts and table share (◇) | `ee2766d` | Same |
| 42 | Completion trigger context and `isIncomplete` | `a0af31c` (inferred) | V11 **Verified** (probe); complete-list filtering **Unverified** |
| 43 | Resolve policy and the ◇ bound | `a0af31c` | U22, U23 (timed-out resolve rejected) |
| 44 | Notices on existing surfaces only | `a0af31c`, `6ff9afb` | Output lines and chip detail seen (U20 cap, multi-cursor notice) |
| 45 | Hover rendering, no command links or raw HTML | `36c4ba0`, `2be3b90` | Security spot-check **Verified** (no anchor for `command:`, no `<b>` or `<img>`, `onerror` did not run) |
| 46 | Editor opener through Craidd's tabs | `97cc915` | U17 (a)–(c) **Verified** |
| 47 | Result caps with a visible "+N" | `867ba5c`, `6ff9afb` | U20: 600 calls gave 500 and "+105 more" in Output (not in the peek) |
| 48 | Symbol shapes | `2be3b90` (inferred) | U16 **Verified** |
| 50 | Read-only is a property of the tab's path view | `e0538ca` | U18 **Verified** |
| 51 | Binding of an unowned tab, "not connected" note | `e0538ca`, `68638be`, `7a2f814`, `704d9a6`, `6c89f8f` | Rebind and persistence re-check `838cb9e`; the note persists beyond 30 s |
| 53 | Provider-load measurement, no new switch | `195dfed` | Hooks counted; hooks on/off in the IDE **Unverified**; U25 recorded in the G3 evidence |
| 55 | When Stage 1c is done | doc only | G3 kept pending; Stage 1 not accepted |

### Decision 49, on its own line

**Text:** unowned reads are restricted to paths the session returned. It adds a restriction, not a permission, and the architect was to see it.

- **Commit:** `e0538ca` (`lsp_read_target`).
- **Evidence (U18, "Security of `lsp_read_target`", **Verified**):** a scratch file the server never returned, a project file never returned by a navigation reply, a relative path and a dead session id were all refused; no real user file content was read or recorded. Typing and `Ctrl+S` changed nothing and the target's hash was identical before and after.
- **Caveat:** a size cap and text-only check were proposed; the record does not separately show them.

**Your answer:** ratify / revise.

### Decision 54, on its own line

**Text:** F1's compensating revert is a **Monaco-local** command that Craidd attaches to the item. It is not a server `workspace/executeCommand`, and server item commands are still not executed.

- **Commit:** the Monaco-local accept command is F3's mechanism in `a0af31c` (inferred; the subject names decisions 13, 43 and 44). F1 itself was not built, because V10 Failed.
- **Evidence:** F3 probe reproduced independently (`prefixRange` variant Verified; `emptyRange` variant Failed one case and is not used); U22 and U23 in the IDE.
- **Caveats:** decision 54 now matters only through F3 (decision 56, yours). The second half, that server item commands are not run, was not tested against a real server item that carries a command, and the record does not show the Output line the plan proposed for it.

**Your answer:** ratify / revise.

---

*Last updated: Phase 3 (Stage 1 closeout, 14 November 2026). Author(s): ShinkuKira21*
*This document is a plan.*
