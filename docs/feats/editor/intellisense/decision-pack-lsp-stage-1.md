# Decision pack: LSP Stage 1 closeout

[Design](design-lsp-stage-1-rust.md) · [Results](results-lsp-stage-1.md) · [Delegated approvals](delegated-approvals-lsp-stage-1.md) · [1b summary](summary-lsp-stage-1b.md) · [1c summary](summary-lsp-stage-1c.md)

This pack is for the architect's review. Each item states what is asked and what follows from each answer. Every verification result in it is **harness-observed, pending user review** unless it says otherwise.

**State.**

- **`refs/heads/feat/intellisense-ws`, at `c0b7fb1`:** holds Stage 1b (merged under DA-10, *not accepted*) plus all the docs.
- **`refs/heads/feat/lsp-stage-1c`, at `14f37ca`:** holds every Stage 1c work package except step 7. Each package was independently re-checked. It is **not** merged into `feat/intellisense-ws`, and waits for your authorisation.
- **Remote:** nothing is pushed, and nothing is on `master`.

**The last fixes, now verified.**

- **`6c89f8f`:** the read-only tab's "not connected" note now persists for more than 30 s.
- **`9bb0805`:** the bounded wait in a flaky cleanup test. It passed 5 of 5 and then 3 of 3 runs. One earlier failure in about 38 runs means "fixed" is likely, not proven.
- **`7a2f814` and `704d9a6`:** navigating again rebinds the tab and clears the note, and a restarted session now reaches a terminal phase.
- **Record:** `838cb9e`.
- **One environmental failure:** `commands::linked_windows::tests::ldi_pair_requires_selected_managed_debug_and_library_build_slots` fails because `netcoredbg` is not installed. It fails the same way on `9bb0805`, so it is not caused by this work.

---

## 1. DA-15: F3, Craidd-owned completion acceptance (decision 56)

**Why it exists.** Decision 13 lists two routes to atomic acceptance, and both failed.

- **V10 Failed:** Monaco 0.56 applies the primary edit at once and does not wait for a pending resolve. A late `undo` can remove the user's own typing instead.
- **V18 Failed:** with `additionalTextEdits` *not* declared lazy, `rust-analyzer 1 (9074e9b4c6)` **omits auto-import items entirely**. The design's rule was then: "the completion part of Stage 1c does not ship".

**The exact decision proposed for you to adopt, in place of the stand-in.**

> **56. F3, Craidd-owned acceptance, is added to decision 13 as the route used when neither F1 nor F2 holds.**
>
> - Craidd declares lazy `additionalTextEdits`.
> - For an item that may still gain edits on resolve, Monaco receives a no-op primary edit: a range over the typed prefix whose text equals that prefix. It also receives a Monaco-local accept command (decision 54).
> - The command awaits Craidd's own resolve, bounded at ◇ 1.5 s (decision 43). It then re-checks the model version and the text over the completed range, validates the edits (decision 13 rules 1–8), and applies the primary and additional edits as **one** grouped edit between two undo stops.
> - Anything else rejects the **whole** item, with a notice on existing surfaces (decision 44) and no change to the document.
> - Items that need F3 are **not offered while several cursors are active**.
> - Decision 13's principle is unchanged: atomic or rejected, never primary-only.

**Evidence.**

- **Probes:** a headless probe passed all 7 cases and was reproduced independently, byte-identical.
- **In the IDE, harness-observed:**
  - **U22:** `HashM` → `HashMap` plus `use std::collections::HashMap;`. One undo restores the original, redo re-applies both, and no observed state has the symbol without the `use` line (3 runs).
  - **U23:** typing during the resolve leaves the document equal to the original plus the typing, and a timed-out resolve is rejected.
- **A defect found and fixed:** with two cursors, Monaco applied the no-op edit at the second cursor (`dfbddef` fixed it). It is now Verified in both orders.

**Consequences.**

| If you… | Then |
|---|---|
| Adopt 56 | Completion, including auto-import, ships in Stage 1c. Criterion 1's auto-import case is demonstrated. The design's "neither F1 nor F2" sentence is replaced by a pointer to F3. |
| Reject 56 | Revert `a0af31c` and `dfbddef` and set `lazy_additional_edits` back to false. Completion either ships **without auto-import items** (eager mode, which V18 shows omits them) or not at all. Criterion 1 is not met in either case, so Stage 1 cannot be accepted as designed. |

**Costs and limits.**

- **Every acceptance of a resolvable item waits for a resolve,** which took 7–11 ms in V18.
- **Several cursors:** with several cursors, only completions that need no resolve are offered. Auto-import items are not.
- **Not seen in the IDE:**
  - snippet tab stops (no item offered one);
  - local filtering of a complete list (this server always returns incomplete lists).
- **Version scope:** the evidence covers one server version and one auto-import case.

**Recommendation:** adopt 56.

---

## 2. Decision 52: symlinked-vendor files (blocks plan step 7)

**Facts from U10, with V16 still open (decision 37).**

- **Ownership:** it rejects any path through a symlinked folder or file (`ownership.rs:6,107,111`). This matches the Explorer, which hides symlinked folders.
- **What the user sees:** a tab opened through a symlinked path is not routed ("no owning project"). It gets no language features **and shows no chip or reason**.
- **The real path:** opened directly, it is registered normally. In both open orders, only the canonical path ever reaches the server.
- **Consequence:** decision 12's symlinked alias tab can't be reached today. That is a conflict between decision 12 and the ownership rule.

**Options.**

| Option | What changes | Cost and risk |
|---|---|---|
| **A. Keep the current behaviour, and say why** | The symlinked-path tab stays unrouted, but its chip shows the reason: "opened through a symlink; open the real path for language features". | Smallest. Decision 12's symlink alias stays unreachable, and the user has to open the real path themselves. |
| **B. Route via the canonical path** | When the opened path canonicalises to an owned file, treat the tab as decision 12's **alias** of the holder: read-only, "Also open as …". Ownership rules are unchanged, and only the attach step canonicalises first. | Moderate. It makes decision 12 reachable and keeps rule 3 (one registration) without letting symlinks into ownership. Needs step 7's cases (a)–(d) and U24. |
| **C. The original candidate** | Ownership accepts symlinked paths, and the holder rule prefers the path inside the project tree. This changes file-identity rules 2 and 3. | Largest. It reverses "symlinks are never members", which the Explorer and project model rely on, so it ripples beyond LSP. |

**Recommendation: B**, plus A's reason text for any symlinked path that does *not* resolve to an owned file. It needs no change to ownership or to rules 2 and 3, so only decision 12's alias trigger is widened. V16 would be worded from U10's facts:

> The canonical path is the holder; a symlinked spelling of an owned file is an alias.

---

## 3. A6 and A7: philosophy amendments (needed before Stage 1 acceptance)

The exact proposals, from the design's amendment table:

| | Philosophy text | Proposed addition |
|---|---|---|
| **A6** | "**What if a language server crashes?** … A restart button" | "No automatic restart in Stage 1; diagnostics from a dead session are cleared." |
| **A7** | "How are server settings surfaced? Not in Phase 3." | "Defaults are held by the adapter and hashed into server identity. A configuration change is a new identity, not a live mutation." |

**Where the code and evidence stand.**

- **A6, no automatic restart:** true. Restart is manual only. Decisions 38 and 28 made ↻ Restart reachable for error health and for a watcher failure, both Verified.
- **A6, dead session's diagnostics cleared:** the design requires it (design lines 738 and 831: "both routes and markers are cleared"). **It has not been observed in the IDE.** U19 checked the tab note, not the markers. One harness step is needed before A6 is applied as fact.
- **A7:** implemented. `configuration_identity()` (`adapter.rs:67`) hashes `initializationOptions` plus environment overrides into `ServerIdentity`. No conflict.

**Remaining conflict, not part of A6 or A7.** The philosophy's open question says a hidden window's "diagnostics keep flowing" (`philosophy-intellisense.md`, "Does a hidden window's language server keep running?").

- With pull diagnostics, they continue only for open documents and on the server's refresh requests, because a hidden window has no focus.
- This is the stage 6 "keep flowing" wording, recorded under A4 as out of Stage 1's scope.
- It stays open and does not block Stage 1.

**Recommendation:** approve A7 as written. Approve A6 as written, subject to the one marker-clearing check.

---

## 4. G3 and G4: evidence and proposed verdicts

**G3: indexing never blocks interaction.**

The method is U12 and U25: a copy of `src-tauri`, about 400 crates, while it indexes. It runs 45 s of real keystrokes, scrolling and tab switches, with hover, definition, completion and references in flight. There were 3 runs with LSP on and 3 with `CRAIDD_LSP=0`.

| Measure | LSP on | Baseline |
|---|---|---|
| Frame gap p50 / p95 | 16 / 17 ms | 16 / 17 ms |
| Frame gap max | 88–98 ms | 82–95 ms |
| Input to paint p50 | 28–29 ms | 27–28 ms |
| Input to paint p95 | 50, 37, 36 ms | 35, 34, 35 ms |
| Startup to interactive | 2961–2963 ms | 2959–2965 ms |
| Webview memory | 771–790 MB | 736–741 MB |

Further measurements:

- **Separate target directory (V4):** 961 MB, beside 4.5 GB in `target/debug`.
- **Build against the check (G3b):** the build did not wait on the server's check. Only 1 of the 2 runs was truly concurrent.
- **First-check time:** 0.1 s warm. The **cold** first-check duration was not captured.
- **Channel:** p50 175–182 B, max 64 KB, 2.9 MB in total per run.

Limits:

- It ran under a software X server, so only the on/off comparison counts, not the absolute times.
- The browser's long-task API is unavailable, so the approved substitutes are used (decisions 24 and 36).
- There are 3 runs per mode, and one on-run had a p95 of 50 ms.

**Proposed verdict: G3 Pass, pending user review,** if you accept the warm-only first-check figure. Otherwise G3 stays **Unmeasured** until one cold first-check run is done.

**G4: rapid typing, file switching and a stalled consumer are bounded.**

- **In-flight requests:** at most one pull in flight per document, and 0.14–0.23 pulls per keystroke (V26), never one per keystroke. No request was busy or cancelled under provider load.
- **Typing:** after the `a203c10` fix, `didChange` is sent per keystroke.
- **Stalled consumer:** fake-server tests `a_stalled_consumer_with_providers_active_loses_no_reply_and_stalls_nothing` and `a_stalled_consumer_never_stalls_the_server_or_loses_replaceable_state` pass on every run. The IDE cannot stall its own consumer, so this part is test evidence only.
- **Processes:** exactly one process per identity (U2).

**Proposed verdict: G4 Pass, pending user review.**

---

## 5. Remaining Stage 1 acceptance blockers

Stage 1 is accepted only when every gate G1–G7 is Pass (design).

### Decisions (yours)

1. DA-15 / decision 56 (§1).
2. Decision 52 (§2), which unblocks step 7.
3. A6 and A7 (§3).
4. Ratify or revise the other stand-ins: DA-4 (the A2 wording), DA-11, DA-14 (especially 49 and 54) and DA-8.
5. Decision 22's diagnostics memory budget. About 21k diagnostics cost about 650 MB of webview memory. By code reading, about 100 MB is retained, and the rest is rebuild churn (finding 16).
6. Gate verdicts G3 and G4 (§4), and whether G2, G5, G6 and G7 move from Unmeasured to Pass on the recorded harness evidence.

### Verification (needs your eyes, or a run)

1. **G1:** the parked-window hide and restore (U1 steps 4 and 6). The harness cannot hide a window.
2. **Split view (V9), real focus change (V3 focus-return, U9 step 9) and the native "Choose Path…" dialog.**
3. **A6:** markers and diagnostics cleared on session end, one harness step.
4. **G3:** a cold first-check duration, if you require it.
5. **Step 7 / U24:** the symlinked-vendor cases (a)–(d), after decision 52.
6. **U13** (optional) and **V7's rustup shim** (a release qualification). No rustup is installed.
7. **Your visual review** of everything marked "harness-observed, pending user review".

### Integration (needs your authorisation)

1. **Merge `refs/heads/feat/lsp-stage-1c` (`14f37ca`) into `feat/intellisense-ws`.** It is clean as far as checked. Its results-doc record merged with one simple conflict, resolved by keeping both sections.
2. **Step 7, if B or C is chosen:** one more implementation package after decision 52.
3. **Apply the approved A6 and A7** to the philosophy, and update the design's open-decisions list and the summaries.
4. **Anything toward `master`, and any push.**

**Open findings that are not acceptance blockers unless you say so:**

- 13: "File > Get Started" doesn't close the solution.
- 17: Monaco models are not disposed on tab close.
- The `tauri-driver` harness disconnects, which are test tooling, not the app.

---

*Last updated: Phase 3 (Stage 1 closeout, 14 November 2026). Author(s): ShinkuKira21*
*This document is a plan.*
