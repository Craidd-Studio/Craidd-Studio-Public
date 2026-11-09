# Delegated approvals: LSP Stage 1 (Rust)

[Design](design-lsp-stage-1-rust.md) · [Results](results-lsp-stage-1.md) · [Handoff](../../../handoffs/handoff-lsp-stage-1b.md)

The architect is away. On 8 November 2026 they wrote, in their own words:

> "I won't be at the system, so please make educated guesses, and try to keep within philosophy. If you do approve, make it known in docs, add feat/intellisense/*.md or whatever document to enforce a rule, so that I can change the document later, and we can we fine. Keep working til you get through getting Rust IntelliSense to fully work."

Under that instruction the lead session makes stand-in approvals. **This file is the only place they exist.** A stand-in approval is valid only if it is listed here. The architect can change or revoke any entry by editing this file.

## How lanes use this file

- Read this file before acting on any item that the handoff or design marks "needs user".
- If an entry here covers the item, act on it. Quote the entry ID (for example "DA-4") in your commit message and in your report.
- If no entry covers the item, it still needs the architect. Stop and report it to the lead. Do not stretch an entry to cover more than it says.
- If the lead's message and this file disagree, this file wins. Report the disagreement.
- When the architect edits an entry, the edited text applies from then on. Work already committed under the old text is reported to them, not undone silently.

## Rules that stay in force (not delegable)

The handoff's standing rules apply unchanged. In particular:

- Nothing is pushed. Nothing is merged to `master`.
- Craidd never installs tools. The user's preferences file (`~/.craidd-studio/user_preferences.toml`) is never edited by an agent.
- A gate is Pass only with its full required evidence. A result a harness saw but the user has not looked at is **harness-observed, pending user review**. That result is never Pass for a gate that needs the user's eyes.
- Port 1420 is AgentIShip's. Craidd runs use 1440. Stop only your own pids, checked by command line and working directory.
- Philosophy amendments A6 and A7 and the stage 6 "keep flowing" sentence stay with the architect (DA-9).
- Stage 1 acceptance, meaning every gate G1–G7 Pass, stays with the architect.
- No subagents. The doc footer rule holds, and the author is ShinkuKira21.

## Entries

| ID | Item | Stand-in decision | Why it fits the philosophy |
|---|---|---|---|
| DA-1 | Lanes | The three lanes started on 8 November 2026 (`is-impl`, `is-verify`, `is-docs`) replace the handoff's lanes, which no longer exist. Each lane's earlier plan doc (a Stage 1c plan on `feat/intellisense-impl`, a clangd plan on `docs/intellisense-plan`, and a verification plan on `feat/intellisense-verify`) is **withdrawn** and not merged. | Those plans were written before the handoff. Rust Stage 1 is the active work. |
| DA-2 | Job A: crash-fix verification | Approved as the handoff describes. Verification re-runs the suites at `39f4e89` and runs several cold starts on 1440 with the harness from `verify/lsp-stage-1b`. The lead fast-forwards Verification's record commits onto `feat/lsp-stage-1b` after reading the diff. | The architect already authorised testing this fix. |
| DA-3 | Job B: U2–U13 and gate measurement | Approved once A is Verified, exactly as the handoff's job B describes. Each U-step is marked harness-observed, pending user review. A defect found here is recorded first. It goes to Implementation as a fix request only under DA-7. | This is the architect's own sequencing, unchanged. |
| DA-4 | Job D: tab-restore wording | **Approved as proposed** in the handoff (design launch trigger, G1 name and method, acceptance criteria 2 and 12, review-table entry 1, and U1 on `verify/lsp-stage-1b`). This includes philosophy **A2**, from "after startup and session restore have completed" to "after startup and any parked-window restore have completed". The pass criteria do not change. | Craidd restores intent, not state. The architect said not to build tab restore to satisfy a test. The edit corrects a factual error and does not widen anything. A2 is an applied amendment, so this is the entry the architect is most likely to want to review. |
| DA-5 | Job E: decision 39 | Approved. Record the two UI-review defects (`startupDone` never set, fixed in `700b59d`; first-attach chip crash, fixed in `ead1a68` and `39f4e89`, with `ChipBoundary`) as decision 39 in the design. Record them in the results doc too. | The record matches the code. The local error boundary contains a failure and hides nothing, because the chip shows that it failed. |
| DA-6 | Findings 8, 11, 12 | Record them as findings, with no verdict. Implementation checks finding 8 (does the backend's first batch always carry a status?) and reports. If the answer is no, the fix goes through DA-7. | No silent mutation. Findings are written down, not hidden. |
| DA-7 | Defect fixes found during A and B, and finding 8 | Approved when **all** of these hold: the defect is inside Stage 1b's scope as the design defines it; the fix does not change a design decision; it ships with a regression test; Verification re-checks it independently. Anything else waits for the architect. | This is narrower than a general fix approval. It keeps the "Implementation never marks a gate" split. |
| DA-8 | Finding 9 (usable check accepts any binary) and finding 10 (discovery never rescans) | **Finding 9, approved:** the toolchain table entry for a role declares how a binary identifies itself (for rust-analyzer, `--version` output beginning `rust-analyzer`). The usable check requires that identity. A mismatch shows "Not usable: this looks like a different tool", with the version line shown. The identity comes from data, not from a rule hardcoded at runtime. **Finding 10, approved:** when a role's binary is missing from the stored scan, Craidd re-probes on read and shows what it found. It writes that result to preferences **only** when the user presses the existing Rescan or Save action. Nothing is installed, and the user's file is not edited by an agent. Both fixes go through DA-7's test and re-check rules. | Detection confidence is never blurred, nothing changes silently, no tool is bundled, and Craidd stays table-driven. |
| DA-9 | A6, A7, stage 6 "keep flowing" | **Not approved. These stay with the architect.** Work that does not depend on them continues. | Philosophy text belongs to the architect. |
| DA-10 | Merging `verify/lsp-stage-1b` and `feat/lsp-stage-1b` | `feat/lsp-stage-1b` **may** be merged into `feat/intellisense-ws` (locally, no push) once every 1b gate that the harness can measure is Pass or harness-observed, and no Stage 1b defect is open. `verify/lsp-stage-1b` stays isolated. Its record commits reach `feat/intellisense-ws` only through `feat/lsp-stage-1b`. **Stage 1b is not "accepted".** It is "merged pending architect review". | This keeps decision 27 and the "not accepted" status visible, while letting Stage 1c build on 1b. |
| DA-11 | Starting Stage 1c (providers) | Approved **after DA-10's merge**, on `feat/lsp-stage-1c`, cut from `feat/intellisense-ws`. The scope is exactly the design's Stage 1c: completion with resolve and atomic acceptance (decision 13; primary-only application is never acceptable), hover, definition, references, document symbols, navigation to unowned files with the read-only lock glyph (decision 29), and the symlinked-vendor cases. It follows doc-first: Docs writes the Stage 1c plan section, the lead checks it against the design and records any new choice as a decision under DA-12, and then Implementation builds. | The architect's goal is "Rust IntelliSense fully working". Stage 1c is the design's own route to it. Nothing outside Stage 1c's scope is started. |
| DA-12 | New design choices inside Stage 1c | The lead may approve a choice that the design leaves open (a ◇ value, a test method, an ordering) if it does not contradict an existing decision or the philosophy. Each one is recorded as a numbered design decision marked "Stand-in approval (DA-12)". A choice that would change an existing decision or the philosophy waits for the architect. | This keeps every approval visible and revocable. |
| DA-13 | V7, V16 | V7 (rustup shim) stays Unverified, as a release qualification. V16 is decided only from U10's facts. If U10 is harness-observed, V16 gets a proposed wording, not a decision. | No change from the handoff. |

| DA-14 | Stage 1c plan ([plan-lsp-stage-1c-providers.md](plan-lsp-stage-1c-providers.md)) and its proposed decisions 40–55 | **The plan's order of work, tests and exit evidence are approved.** Decisions **40, 41, 42, 43, 45, 46, 47, 48, 50, 51, 53 and 55** are approved as proposed, under DA-12. **44** is approved as "existing surfaces only" (an Output line plus the chip detail). If that turns out not to work, a new surface still needs the architect. **49** is approved: unowned reads are restricted to paths the session returned. It adds a restriction, not a permission, so it narrows risk. The architect should still see it. **54** is approved with this clarification: F1's compensating revert is a **Monaco-local** command that Craidd attaches to the item. It is not a server `workspace/executeCommand`, and server item commands are still not executed. **52 is not approved.** It changes design file-identity rules 2 and 3 and stays with the architect, so step 7 waits for U10 and for the architect. The approved decisions are added to the design's open-decisions list marked "Stand-in approval (DA-14)". | Every approved choice fills a gap the design leaves open, and none changes an existing decision. 45 and 49 tighten security around text and paths from an external process. |

| DA-15 | Completion acceptance after V10 **Failed** (Monaco does not wait for a pending resolve) and V18 **Failed** (with lazy `additionalTextEdits` not declared, `rust-analyzer 1 (9074e9b4c6)` omits auto-import items entirely) | **This goes beyond DA-12**, because it adds a route to decision 13's fallback list. The architect's instruction to keep working until Rust IntelliSense works is the authority for it. **F3, Craidd-owned acceptance**, is approved **as a probe first**. Craidd declares lazy `additionalTextEdits` (as F1 does). For an item that may still gain edits on resolve, Craidd gives Monaco a no-op primary edit and a Monaco-local accept command (decision 54's mechanism). That command awaits the resolve (with the ◇ bound of decision 43), validates primary plus additional edits (decision 13, rules 1–8), and applies them as **one** grouped edit with one undo stop. It **rejects the whole item**, with no change to the document, if the model's version moved since accept, if the resolve fails or times out, or if the edits overlap. F3 becomes the route for plan step 9 **only if** a headless probe (`experiments/lsp-1c-monaco`) shows all of these: idle accept is atomic and undoes in one step; typing during the resolve rejects with the document unchanged apart from the user's typing; a failed or late resolve applies nothing; and Monaco itself never applies a partial edit. If the probe fails, the design's rule stands: the completion part of 1c does not ship. Every other provider (hover, symbols, definition, references, navigation) proceeds regardless. | Decision 13's principle is unchanged: atomic or rejected, never primary-only. The user sees nothing until the whole edit can be applied, and nothing changes silently. **This is the most consequential stand-in. The architect should review it first.** |

## Still waiting for the architect

- DA-9 items: A6, A7, the stage 6 wording.
- Stage 1b acceptance, and Stage 1 acceptance.
- Every U-step and gate marked harness-observed, pending user review.
- Decision 52 (symlinked-vendor holder rule), which waits for U10/V16 facts.
- Any entry above that the architect wants to change. DA-15 (F3, Craidd-owned completion acceptance) is the most consequential, then DA-4 (A2), DA-11 (starting 1c) and DA-14 (decisions 49 and 54).

---

*Last updated: Phase 3 (Stage 1b and 1c prep, 9 November 2026). Author(s): ShinkuKira21*
*This document is a record.*
