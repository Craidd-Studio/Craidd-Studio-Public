# Summary: LSP Stage 1c

[Stage 1b summary](summary-lsp-stage-1b.md) · [Plan](plan-lsp-stage-1c-providers.md) · [Design](design-lsp-stage-1-rust.md#stage-1c--providers) · [Results](results-lsp-stage-1.md) · [Delegated approvals](delegated-approvals-lsp-stage-1.md)

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Record. A one-page comparison for the architect, kept current by the lead. It summarises; the [results record](results-lsp-stage-1.md) is the evidence and is authoritative. **Stage 1c is not complete and not accepted.** No gate moves because of 1c so far. Every Verification result is **harness-observed, pending user review** unless this page says otherwise.

**State shown:** the 1c implementation and Verification records on `refs/heads/feat/lsp-stage-1c` at `f20a31e`; the F3 probe reproduction on `feat/intellisense-ws` at `fbe59f2`. Anything the results record does not contain is marked "no record" and not filled in.

**Verdict words (used strictly).** Gates: **Pass**, **Fail**, **Blocked**, **Unmeasured**. Checks: **Verified**, **Failed**, **Unverified**.

---

## Work packages

Steps from the [plan](plan-lsp-stage-1c-providers.md). "Commit" is Implementation's; "Record" is the Verification section in the results doc.

| Step | Work package | Commit | Verification record | Verdict |
|---|---|---|---|---|
| 0 | Frontend provider capability summary | `410750e` | "Stage 1c steps 0 to 2 (hover)" (check of `feat/lsp-1c-step2` at `36c4ba0`; record `fa7fb40`) | **Verified** (with step 2) |
| 1 | Request plumbing and registration (decisions 40, 41) | `ee2766d` | Same record | **Verified** (with step 2) |
| 2 | Hover (decision 45) | `36c4ba0` | Same record | **Verified** for U14, the security spot-check and the 1b smoke; stale-hover counter **Unverified** in the IDE (U15) |
| 3 | Document symbols; every `command:` URI dropped from hover text | `2be3b90` | "Stage 1c steps 3 and 4" (at `97cc915`; record `7750ea8`) | **Verified** (U16) |
| 4 | Definition and the editor opener for owned files (decision 46) | `97cc915` | Same record | **Verified** for cases (a)–(c); the standard-library case opened nothing, as step 4 intended |
| 5 | Unowned targets as read-only tabs, lock glyph (decisions 49–51) | `e0538ca` | "Stage 1c steps 5 and 6" (at `867ba5c`; record `d2856d9`) | **Verified** (U18 and the `lsp_read_target` refusals); U19's "unbound" note was **Unverified** there, see Defects |
| 6 | References with a visible cap (decision 47) | `867ba5c` | Same record | **Verified** (U20 and the 500-row cap, with `+105 more` in Output) |
| 6+ | Truncation shown in the chip detail (decisions 44, 47) | `6ff9afb` | No separate record found | No record |
| 7 | Symlinked-vendor cases (a)–(d) | not started | — | Waits for U10 and the architect (decision 52) |
| 8–9 | Completion with Craidd-owned acceptance, F3 (decisions 13, 43, 44; DA-15) | `a0af31c` (probe `2cd17be`) | "Re-check of the multi-cursor fix and steps 10 prep" (at `195dfed`; record `f20a31e`) covers U22, U23b and U23c. No record of Verification's first-pass check of steps 8–9 is in the results doc | One-cursor accept **Verified** (U22, no regression); multi-cursor **Verified** after the fix |
| 10 | Provider-load measurement (decision 53): prep only | `195dfed` | Same re-check record | Prep recorded; the measurement itself is U25, running |

## Verifications

| V | Item | Verdict | Evidence |
|---|---|---|---|
| V10 | Does accept wait for a pending resolve | **Failed** | Headless Monaco probe, reproduced independently twice with byte-identical output ("Harness disconnects, and independent reproduction of V10 to V12") |
| V11 | Incomplete-list flag and context | **Verified** | Same record |
| V12 | One undo step for primary and additional edits | **Verified** | Same record |
| V18 | Server sends additional edits when not declared lazy | **Failed** | Implementation's opt-in test `e4da9b0`; [recorded](results-lsp-stage-1.md#v18-stage-1c-failed-implementation-test). One version, one case |

Because V10 and V18 both Failed, neither F1 nor F2 works; F3 (decision 56, [DA-15](delegated-approvals-lsp-stage-1.md)) is the route.

**F3 probe, independently reproduced** (on `feat/intellisense-ws`, `fbe59f2`; headless Monaco 0.56.0, twice, byte-identical): the `prefixRange` variant is **Verified** for cases 1–7 (idle accept is atomic and one undo; typing during the resolve rejects; a failed or never-settling resolve applies nothing; overlap rejects the whole item; Monaco never applies a partial edit; the list still filters; the accept-time prefix is replaced). The `emptyRange` variant **Failed** case 6 (list unfiltered) and is not usable. Limits: plain Monaco, a test provider, synthetic timing, one item shape. This is the probe; the product-level check is U22/U23 below. The condition in DA-15 is a probe pass; the record's probe pass is for `prefixRange`.

## U-steps

Numbering from the plan's outline. All are harness-observed, pending user review unless "no record".

| Step | Subject | Verdict | Notes |
|---|---|---|---|
| U14 | Hover on a known symbol | **Verified** (positive case) | Negative case (no request when the server lacks `hover`) covered by tests, not run in the IDE |
| U15 | Stale hover | **Unverified** in the IDE | Window not reached (the server replies in milliseconds); covered by node tests |
| U16 | Outline | **Verified** | 9 symbols, nesting matches; the visual look is for the user |
| U17 | Definition (a)–(d) | **Verified** (a)–(c) | (d) std symbol: nothing opened at step 4; superseded by U18 at step 5 |
| U18 | Definition to std and registry: read-only tab, lock glyph | **Verified** | Typing and `Ctrl+S` change nothing; file hash unchanged; hover works in the tab; `lsp_read_target` refuses unreturned, relative and dead-session paths |
| U19 | Restart with a read-only tab open | No crash **Verified**; "unbound with a note" **Unverified** at step 6; re-check: the note shows for a few seconds, then is gone | Hover after restart: the earlier "still answered" was a leftover widget, **Verified**. See Defects |
| U20 | References and the cap | **Verified** | 5 results across files; 600-call fixture shows 500 and `+105 more` in Output (not in the peek). Reachable by Shift+F12; `editor.action.goToReferences` through `editor.trigger` sent no request |
| U21 | Completion list refresh on typing | No record | Complete-list filtering is **Unverified** (below) |
| U22 | Accept the auto-import (`HashMap`) | **Verified** | One cursor: symbol and `use` line together, no partial state, one undo, one redo |
| U23 | Rejection paths | U23b and U23c **Verified** | Two cursors: no owned item offered, document byte-identical; second cursor added after the list opened closes the widget, byte-identical. The earlier failure this repairs is not in the results doc. The other rejection paths (stale, failed resolve, overlap) are shown by the F3 probe, not by an IDE run on this record |
| U24 | Symlinked-vendor (a)–(d) | Waits | Decision 52 and U10; the architect |
| U25 | G3 and G4 under provider load | Running | No result yet. G3 and G4 stay **Unmeasured** |
| U26 | Stalled consumer with providers active | Rust test passed in all runs | Test `a_stalled_consumer_with_providers_active_loses_no_reply_and_stalls_nothing`; no IDE run recorded |

## Defects found and fixed

| Defect | Fix | State |
|---|---|---|
| With several cursors, accepting an owned completion item mutated the document (F3 applies the edit from one cursor's view) | `dfbddef`: owned items are not offered with several cursors; a guard closes the suggest widget when a cursor is added while it is open. Output logs once that such completion is not offered | **Verified** (U23b, U23c byte-identical; U22 no regression) |
| A read-only tab gave no sign when its session ended (decision 51 note) | `68638be`: a muted "not connected" note in the status bar | Shows at +1 s (`language server: not connected; navigate from a live session to reconnect`) and is **gone by +4 s** while the tab, lock and content stay. Whether that persistence is intended is for the lead. A "sticky" fix is pending (`fix/lsp-1c-ended-sticky`, no commits beyond `f20a31e` yet). The session view stays `shuttingDown` in the store (finding 11) |

## Still open

- **U25:** G3 and G4 under provider load, running. Both gates stay **Unmeasured**.
- **A flaky Rust test:** `lsp::tests::every_terminal_cause_leaves_the_same_invariants` (`tests.rs:62`, "no pending entry left, left: 1, right: 0") failed once in 38 full `cargo test --lib` runs, not reproduced in 10 more full runs or 25 isolated runs. Recorded as an unreproduced flake, not a verdict.
- **Complete-list filtering:** **Unverified**.
- **Snippet tab stops:** **Unverified**.
- **Hooks on and off (decision 35) in the IDE:** **Unverified**; the node tests pass.
- **U15** (stale hover in the IDE), **U19's** intended persistence, **step 7 and U24** (decision 52).
- **No record** of: U21, Verification's first-pass check of steps 8–9, a separate record for `6ff9afb`. Raised to the lead rather than inferred.
- The Stage 1b open items in the [1b summary](summary-lsp-stage-1b.md) are unchanged by 1c.

## Needs the user's eyes

The look of the hover, outline and breadcrumbs; the lock glyph and the "not connected" note; the references peek; the suggest widget during accept, undo and redo; the multi-cursor behaviour; the visual feel of completion latency. All remain "harness-observed, pending user review" at best.

## Waiting for the architect

In this order:

1. **DA-15 (F3, decision 56):** Craidd-owned completion acceptance. It goes beyond DA-12, was approved as a probe first, and is the most consequential stand-in. The probe is reproduced for `prefixRange`; the product still needs the architect's review.
2. **Decision 52:** the symlinked-vendor holder rule and the ownership conflict (finding 18). Step 7 and U24 wait.
3. **A6, A7 and the stage 6 "keep flowing" sentence** (DA-9).
4. **Stage 1 acceptance** (every gate G1–G7 Pass) and Stage 1b acceptance. No gate is Pass.

---

*Last updated: Phase 3 (Stage 1c, 9 November 2026). Author(s): ShinkuKira21*
*This document is a record.*
