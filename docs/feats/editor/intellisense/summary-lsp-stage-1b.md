# Summary: LSP Stage 1b

[Design](design-lsp-stage-1-rust.md) · [Results](results-lsp-stage-1.md) · [Delegated approvals](delegated-approvals-lsp-stage-1.md) · [Stage 1c plan](plan-lsp-stage-1c-providers.md) · [Stage 1c summary](summary-lsp-stage-1c.md)

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Record. A one-page comparison for the architect, kept current by the lead. It summarises; the [results record](results-lsp-stage-1.md) is the evidence and is authoritative. **Stage 1b is not accepted.** Every result from the Verification lane is **harness-observed, pending user review** unless this page says otherwise.

**State shown:** the results record on `refs/heads/feat/lsp-stage-1b` at `7bc8d2a` plus findings 13–19 (`1ab81d5` in `lead/lsp-1b-candidate`) and the updates to findings 14, 15, 16 and 18 (`dbe2d64`, `docs/lsp-1b-findings-3`), and the approvals file and Stage 1c monaco probe on `feat/intellisense-ws` at `6d27964`. Where the results record's own gate and verification tables lag the batch records beneath them, this page uses the table's word and says what the batches add.

**Verdict words (used strictly).** Gates: **Pass**, **Fail**, **Blocked**, **Unmeasured**. Checks: **Verified**, **Failed**, **Unverified**. A result a harness saw but the user has not looked at is "harness-observed, pending user review", and is never a gate Pass on the harness alone. "Partly" is the record's own qualifier, kept as written.

---

## Gates

| Gate | Subject | Verdict now | Evidence | Pending user review |
|---|---|---|---|---|
| G1 | No server during startup or parked-window restore; bounded deferral; startup apart from server cost | **Fail** | Results: U1 attempts 1–3 (`startupDone`, then the first-attach crash); "Job B, batch 1" (U1 reworded, 5 runs LSP on, 5 with `CRAIDD_LSP=0`) and "batch 3" (T3, T4). Both defects are fixed and verified. The record leaves the status at Fail: T3 is untrusted, T4 is missing and the parked-window case was not run. Whether it moves is for the lead and architect. | Yes |
| G2 | One `rust-analyzer` per shared Cargo workspace | **Unmeasured** | "Job B, batch 1" (U2, 3 runs): 1, 1, 2 servers for `alpha`, `beta`, `outside` of `fx-ws`, different roots for the two. The record says the count matches the pass condition. | Yes |
| G3 (incl. G3b) | Indexing never blocks interaction; separate target cost; Channel rate and size | **Unmeasured** | "Job B, batch 7" (U12) and "batch 9" (leftovers). Numbers recorded against the `CRAIDD_LSP=0` baseline; the record says no regression is shown, but 3 runs per mode on one machine under a software X server is small. First-check duration and the Channel size are missing or proxy. Completes in 1c. | Yes |
| G4 | Typing, file switching and a stalled consumer are bounded | **Unmeasured** | 1b fake-server and node evidence reproduced; completes in 1c under provider load. Typing observation: finding 15. | Yes |
| G5 | Diagnostics do not flood Monaco; store size | **Unmeasured** | "Job B, batch 4" (U7): about 7.2k push diagnostics through 213 deliveries and about 190 store writes; 22–25 `setModelMarkers` calls for 10 files. The "at most one store write per frame" condition is not separated. Memory: finding 16. | Yes |
| G6 | Closing a solution terminates servers and descendants | **Unmeasured** | "Job B, batch 1" (U8, 4 scenarios): nothing left after window close or after `kill -9` of the IDE. The record says the pass condition is met by these measurements; "close the solution" with the window open has no harness path (finding 13). | Yes |
| G7 | Sync correctness, document lifetimes, forced overflow | **Unmeasured** | "Job B, batch 5" (U9 steps run): server text equalled the model byte for byte after each step. Steps 8 and 9 in "batch 11"; step 9 is Unverified. Forced overflow comes from fake-server tests. | Yes |

No gate is **Pass**. Stage 1 acceptance (every gate Pass) stays with the architect.

## Verifications

Words as in the results record's verification table. The "Job B adds" column names evidence recorded in the batches since.

| V | Item | Verdict now | Job B adds |
|---|---|---|---|
| V1 | Server-side file watching | **Verified** | — |
| V2 | Watcher failure surface | **Verified** (server); surfacing **Verified** at the backend | Chip and Output in the IDE are U6, not run |
| V3 | Unopened-file edit updates diagnostics | **Partly measured** (revised) | Batch 2 (U3): trigger to marker 0.31–0.36 s, n 5, one fixture; cross-document and focus-return **Unverified** |
| V4 | Separate target directory | **Partly verified** | Batch 7 (U12): `target/rust-analyzer` 961 MB cumulative; Build contention (G3b) not shown |
| V5 | Real `initialize` result | **Verified** | — |
| V6 | utf-16 only | **Verified** | — |
| V7 | rustup shim | **Partly verified**; shim case **Unverified** | A release qualification |
| V8 | `cargo metadata` and `Cargo.lock` | **Verified** | — |
| V9 | Monaco model URI and lifetime | **Unverified** (table) | Batch 8 (U11) recorded one run; models are not disposed on tab close (finding 17); split view **Unverified** |
| V10 | Monaco: does accept wait for a pending resolve | **Failed** | Stage 1c, headless probe (`experiments/lsp-1c-monaco`, merge `5975ef1`): Monaco does not wait for the resolve, so F1 cannot be atomic. Not a Stage 1b item |
| V11, V12 | Incomplete-list flag and context; one undo step | **Verified** | Stage 1c, headless probes (`experiments/lsp-1c-monaco`). Not a UI run |
| V18 | Server sends additional edits when not declared lazy | **Failed** | Stage 1c, opt-in test `e4da9b0` on `exp/lsp-1c-v18` against `rust-analyzer 1 (9074e9b4c6)`: with the edits not declared lazy, the `HashMap` auto-import item is absent from the list (116 items for 40 s); declared lazy, it is present and resolve adds the `use` line. One version, one case. Not a Stage 1b item |
| V13 | `showMessageRequest` | **Unverified** against the real server | Fake-server test passes; 1 of 4 edge cases built |
| V14 | Server child processes | **Verified** | — |
| V15 | Republish on open | **Verified**: no republish on open | Batch 4/10: whether an evicted file's rows return was examined; decision 22 stays open |
| V16 | Symlinked paths | **Partly verified** (server); open (decision 37) | Batch 11 (U10): finding 18; proposed wording is for the architect |
| V17 | Single owner resolver | Introduced (`ownership::owning_project`) | — |
| V19 | Preferences renders a new role | **Verified**: it does not | — |
| V20 | Diagnostic store size and memory | **Unmeasured** | Batch 4, 8, 10 record numbers; memory is finding 16 |
| V21 | Save-triggered check vs Build (G3b) | **Unmeasured** | Batch 9 "Build against the check" |
| V22 | `resultId` behaviour | **Verified** | — |
| V23 | Refresh timing | **Verified** (server) | — |
| V24 | Pull before workspace load | **Verified**; decision 20 holds | Batch 3 (U4): first pull 1 ms after `quiescent: true`; step 3 not run |
| V25 | Pull/push overlap | **Verified** on `fx-many` | — |
| V26 | Wave volume and effect | **Unmeasured** | Not measured in batch 7 |
| V27 | Server status lifecycle | **Verified** (real server) | Batch 6 (U5): recovery control missing for a ready session with error health (finding 14) |

## Fixes and their verification

| Defect | Fix | Verification record | Verdict |
|---|---|---|---|
| `startupDone` never set; no server ever attached | `700b59d` | "Start-up fix `700b59d`, verified" | **Verified**, pending user review |
| Window crash on first attach (partial session view); `ChipBoundary` added | `ead1a68`, tests `39f4e89` | "Chip-crash fix `ead1a68` + `39f4e89`, verified" and "Second independent reproduction" (10 cold starts, no crash, partial-view fault contained) | **Verified**, pending user review. One unexplained harness disconnect is noted in the record |
| `lsp_open` failed: missing `languageId` (attach reply keys) | `ab52d83` (`rename_all_fields = "camelCase"` on `AttachReply`, plus a key-pinning test) | "`lsp_open` fix `ab52d83`, independent re-check": 3 of 3 runs, no `document operation failed`, markers appear | **Verified**, pending user review |
| Finding 9 (usable check accepts any binary), finding 10 (no rescan), chip hover while spawning | `fix/lsp-1b-toolchain-2`: `6cfcf7a`, `3346a72`, `345eb37`; merged as `e62474d` | "Toolchain fixes for findings 9 and 10 and the chip hover, independent re-check" (record commit `7a18133`) | Items 1–3 **Verified** as far as stated; chip hover **Unverified** for the targeted window (no failure seen). Native file dialog (Choose Path…) not driven |
| Finding 14: `↻ Restart` not offered for a ready session with error health | `51ad0d9` (`restartOffered`) | Not yet re-checked | Pending Verification's independent re-check; no verdict |
| Finding 15: `didChange` stuck (`DocumentTracker`'s default scheduler was `queueMicrotask` assigned as a field, `documents.ts:78`, so the browser threw "Illegal invocation" and `flushQueued` stuck) | `a203c10` | Not yet re-checked | Pending Verification's re-check; no verdict |

Decisions: 39 records the first two fixes (DA-5). Findings 9 and 10 carried DA-8 proposals.

## Open defects and investigations

| Item | State | Route |
|---|---|---|
| Finding 14: `↻ Restart` not offered for a ready session with error health (`StatusBar.tsx:47`); decision 38's recovery unreachable from the status bar | Fixed in `51ad0d9`; pending Verification's re-check | DA-7 |
| Finding 15: `didChange` held back during continuous typing (36 s with no `didChange`, then one with 663 changes) | Cause found (`documents.ts:78`); fixed in `a203c10`, pending re-check. The 0.31 s marker lag is separate: the designed 300 ms pull debounce | DA-7 |
| Finding 16: about 620–690 MB extra webview memory for about 21k diagnostics on `fx-big` | Code reading, not profiling: retained data about 100 MB (stored items 30–60 MB, rows about 9 MB, two panel copies about 18 MB, `BottomPanel.tsx:32,58,61,64`); the rest is likely allocation churn from about 194 frame writes rebuilding all rows and both arrays even with the Problems tab closed, with WebKit keeping the high-water mark. No unintended retention found. Churn explanation unmeasured | Cheaper shapes are the architect's under decision 22 |
| Finding 17: Monaco models never disposed on tab close | Recorded, no verdict | Open; split view untested |
| Finding 18 / V16 (U10): only the canonical path is registered; symlinked tab shows no chip or alias note | Cause found: ownership rejects any path through a symlinked folder or file (`ownership.rs:107,111`; header `ownership.rs:6`), so the symlinked tab is `NotRouted` and renders no chip (`StatusBar.tsx:16`). Decision 12's symlinked alias is unreachable while that holds: a design conflict. Also a UX gap: a `NotRouted` tab shows no reason | V16 stays open (decision 37, DA-13); decisions 12 and 52 for the architect |
| Finding 13: "File > Get Started" does not close the solution | Recorded | No harness-reachable close short of closing the window |
| Finding 8: progress before a view exists is dropped | Implementation to check the backend's first batch | DA-6, DA-7 |
| U9 step 9: edit on disk while the model is disposed — model returned with old content | **Unverified** | Open |
| Finding 19: EOL finding retracted (tooling error) | Closed | Recorded for the trail |

## Needs the user's eyes

The harness cannot do these. Each stays "harness-observed, pending user review" at best, and no gate becomes Pass without it.

- **Parked-window hide and restore** (U1 steps 4 and 6): the WebDriver cannot hide and restore a window. Not run.
- **Split view** (V9, model reuse across views): not tested.
- **Native dialogs:** Preferences "Choose Path…" opens a native file dialog; the command it calls was exercised, the button was not.
- **Real focus change** (V3 focus-return, decision 19 in the IDE): not exercised.
- **U6** (V2: watcher-limit chip and Output text in the IDE): not run.
- **U13** (optional: hooks on and off on the IDE's wire): not run.
- **Everything marked pending user review above**, including the G1 start-up part that "looks right" and the G6 counts.

## Waiting for the architect

From the [approvals file](delegated-approvals-lsp-stage-1.md) and the findings:

- **A6, A7 and the stage 6 "keep flowing" sentence** (DA-9).
- **Stage 1b acceptance, and Stage 1 acceptance** (every gate G1–G7 Pass).
- **Review of the most consequential stand-ins:** DA-4 (philosophy A2 wording), DA-11 (starting Stage 1c), DA-14 (decisions 49 and 54), and above all **DA-15** (F3, Craidd-owned completion acceptance, decision 56), which goes beyond DA-12 and should be reviewed first.
- **Decision 52 and the ownership conflict:** the symlinked-vendor holder rule (changes file-identity rules 2 and 3), now with finding 18's cause: ownership rejects symlinks, so decision 12's alias is unreachable. Whether ownership or the design changes is the architect's; step 7 of the 1c plan waits.
- **Stage 1c route after V10 and V18 Failed:** neither F1 nor F2 gives atomic acceptance, so the design's rule applies (the completion part of 1c does not ship). DA-15 approves **F3, Craidd-owned acceptance, as a probe first** (decision 56, probe pending): step 9 uses it only if the headless probe passes. If the probe fails, completion does not ship and that goes to the architect. Hover, symbols, definition, references and navigation proceed regardless.
- **Decision 22's memory budget**, now with finding 16's numbers.
- **V16 wording** (decision 37) from the U10 facts.
- **V7's rustup shim** as a release qualification.
- **Whether G1 moves**, given the unrun parked-window case.
- **Merge of `feat/lsp-stage-1b` into `feat/intellisense-ws`:** permitted locally by DA-10 once the harness-measurable 1b gates are settled and no 1b defect is open. As of this page, the fixes for findings 14 (`51ad0d9`) and 15 (`a203c10`) are pending Verification's re-check, so DA-10's condition is not yet shown to be met.

## Roster

For `docs/local/agents/lanes.md` (sessions cannot edit `docs/local`; the lead copies it).

| Branch | Worktree | Session | Id | Specialty |
|---|---|---|---|---|
| `claude/experiment-lead-worker-setup-7ea1c3` | `experiment-lead-worker-setup-7ea1c3` | Lead (Experiment lead setup with worker lanes) | `local_8a1eba58-1fcd-4a8a-a444-fc4003b8f020` | Coordination, approvals, merges into `feat/intellisense-ws` |
| `feat/intellisense-ws` | main checkout | Docs integration branch | — | Everything docs-side merges here; nothing pushed |
| `feat/lsp-stage-1b` | — | Stage 1b implementation and results records | — | Not merged into `feat/intellisense-ws` |
| `claude/intellisense-impl-f2ed97` | `intellisense-impl-f2ed97` | Implementation lane (`is-impl`) | `local_4784a563-2d97-468e-98a4-0131fa9c05bc` | Code and tests; never marks a gate |
| `claude/intellisense-verify-0b263b` | `intellisense-verify-0b263b` | Verification lane (`is-verify`) | `local_7b6d6dfc-1e7e-4251-9729-daca747effb7` | Suites, harness runs on port 1440, results records |
| `claude/intellisense-plan-008da2` (docs branches `docs/lsp-1b-wording`, `docs/lsp-1b-findings`, `docs/lsp-1c-plan`, `docs/lsp-1c-decisions`, `docs/lsp-1b-findings-2`, `docs/lsp-1b-summary`) | `intellisense-plan-008da2` | Documentation and planning lane | id not available to this lane; the lead holds it | Design, results findings, plans, this summary |
| `fix/lsp-1b-attach-keys`, `fix/lsp-1b-toolchain-2` | — | Implementation fix branches | — | `ab52d83`; `6cfcf7a`, `3346a72`, `345eb37` |
| `verify/lsp-stage-1b`, `verify/lsp-stage-1b-jobb` | — | Verification tooling and Job B scripts | — | Stay isolated (decision 27) |

---

*Last updated: Phase 3 (Stage 1b, 8 November 2026). Author(s): ShinkuKira21*
*This document is a record.*
