# Proposal: diagnostics memory budget

[Design: Flood control](design-lsp-stage-1-rust.md#flood-control) · [Results](results-lsp-stage-1.md) · [Decision pack](decision-pack-lsp-stage-1.md) · [1b summary](summary-lsp-stage-1b.md)

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Plan, for the architect. Nothing here is implemented, and **no numeric budget is proposed**. The architect asked for a proposal "based on measured peak, retained and post-clear memory, with explicit behaviour for truncation or eviction", and not to invent a number. This answers decision 22's open question (do complete diagnostic sets fit a measured budget) with the evidence so far and a method for setting the number later. Every measurement is **harness-observed, pending user review**.

**Applies to:** the diagnostics path only: the backend's pushed and pulled sets, `lspStore`, the Problems panel and Monaco markers.

---

## 1. What was measured

All figures are webview **VmRSS** (the app's `WebKitWebProcess`, from `/proc/<pid>/status`) on the generated `fx-big` fixture, recorded by the Verification lane. The primary source is the results record "Merge verification at `b403fb7`" (`e5258d6`, item 4); the earlier "Job B, batch 8" and "batch 10" records agree in shape.

| Stage | LSP on (3 runs) | `CRAIDD_LSP=0` (2 runs) |
|---|---|---|
| Solution open | 545–546 MB | 549–556 MB |
| **Peak** during the flood (2 s sampling) | 1429–1648 MB | 758–770 MB |
| **Settled** (60 s after the last delivery; baseline: 20 s idle) | 1309–1510 MB | 687–699 MB |
| After the Problems panel opens | 1382–1609 MB | 740–750 MB |
| **Post-clear** (server killed, session ended) | 1305–1502 MB | not applicable |
| After closing the solution | 1322–1518 MB | 711–726 MB |

Store at settled, LSP on: about 20,980 Problems rows (500 pull, about 20,480 push); **1446–1450 evicted files**; **1801 diagnostics not retained**; about 66–71 MB of Channel bytes cumulative. After the session ends the store reads 0 rows, 0 evicted, 0 not retained (A6 confirmed for the store).

The language-server path therefore costs about **620–810 MB** of webview memory at settled against the baseline, the Problems panel adds about 53–99 MB, and the post-clear figure is **not** lower than the settled one.

**Limits of this evidence**

- **One machine, one fixture.** `fx-big` is generated (about 21k diagnostics from many small files); a real workspace may differ in file count, message length and the share of related-information entries.
- **Under a software X server (Xvfb).** Compositing and rendering memory is not representative; only the on/off comparison is meaningful, not the absolute figure.
- **RSS, not heap.** VmRSS includes the allocator's retained pages, shared libraries and WebKit's own caches. It does not separate the JavaScript heap, the DOM, Monaco's model and marker storage, and Craidd's store.
- **A development build** (Vite, dev-mode React). Development builds retain more than production ones; a production-build comparison was not run (U13 is unrun). How much of the figure that explains is **unmeasured**.
- **Small samples** (3 runs on, 2 off) and runs vary by tens of MB; the settled range is wide (1309–1510 MB).
- The measurements do not separate store, markers and panel arrays. No heap snapshot was taken.

## 2. Why post-clear memory stays high

**Known (measured).** When the session ends, the store reads zero rows, yet the webview stays at 1305–1502 MB, within about 4 MB of the settled value in each run's own pairing (for example 1309 to 1305, 1510 to 1502, 1343 to 1354). A cleared store does not mean a smaller process.

**Known (code reading, not profiling; Implementation, finding 16).** Retained data is about 100 MB: stored items 30–60 MB, store rows about 9 MB, and two derived panel copies about 18 MB (`BottomPanel.tsx:32`, `58`, `61`, `64`). Each of about 194 frame writes rebuilds every Problems row and both panel arrays, **even with the Problems tab closed**, and the row objects keep every server field. No unintended retention was found.

**Inferred, not measured.**

- The gap between about 100 MB retained and 620–810 MB is **allocation churn**: each rebuild creates new arrays and objects that the garbage collector can free, but the engine and the allocator keep the pages (a **high-water mark**).
- That would explain why RSS stays at the peak after the store is cleared: freed JavaScript memory is not necessarily returned to the operating system, and WebKit does not shrink promptly.
- It would also mean the peak is a better guide to the budget than the retained size, because the peak is what the machine must hold.

**What would settle it** (not done): a heap snapshot or allocation timeline at settled and post-clear, to separate live objects from freed-but-held pages; and a run on a production build. Until then "churn plus high-water mark" is a hypothesis, and "no unintended retention" rests on a code reading.

## 3. Options to reduce churn and retained size

None is implemented or chosen. Each states what it would change, what it would cost and what would show it worked. They compose.

| Option | What changes | Cost or risk | Evidence it works |
|---|---|---|---|
| **A. Build rows only while the panel is visible** | The Problems rows and the two panel arrays are derived when the diagnostics view is shown or changes while shown, not on every frame write | The first open of the panel pays the build; a hidden panel's counts must still come from cheap totals kept in the store | Settled and peak memory with the Problems tab never opened; the 194 frame writes stop producing panel arrays |
| **B. Reuse rows per set** | Memoise the rows for a (session, uri, route) set and rebuild only for sets that changed in a frame | Needs a stable identity per set; the store already compares sets by hash, so the key exists | Fewer allocations per frame; flatter peak against settled |
| **C. Keep only the fields the UI uses** | Store the server fields the panel, the markers and the "related information" display need; drop the rest (or keep the original only for open files) | Loses data the UI does not show today; a later feature may want it; must be decided per field, not by guess | Stored-item size (30–60 MB today by reading) falls |
| **D. Count bytes, not rows** | The retention limits (per file, closed files, closed total) are expressed in an estimated byte size of what is held, not row counts | An estimate, not a measurement; must be cheap to maintain; the ◇ values change meaning | The same budget protects against few huge diagnostics and many small ones |

Rough ordering by risk, not by value: A and B change when and how rows are built and touch no stored data; C changes what is stored; D changes how the limits are defined and is the one that makes a numeric budget possible.

## 4. Truncation and eviction behaviour the budget implies

These restate and tighten the design's [flood control](design-lsp-stage-1-rust.md#flood-control) rules for a byte-based budget. They need no new surface (decision 15).

- **Open documents are never evicted** and never truncated below the per-file limit's visible summary; their markers stay.
- **What is evicted first.** Closed documents' **push** sets, least recently published first (the existing rule). Pull sets are cleared on close and need no eviction. Build problems are never touched.
- **Truncation within a file.** The excess over the per-file limit is summarised as "+N not retained", visible in the panel header and the chip detail, as now.
- **What the user is told.** The Problems header says that diagnostics for N files are not retained and that counts are **"at least"**; nothing claims a complete set unless the measurement shows nothing was truncated or evicted. If a byte budget is introduced, the wording says what is limited ("results held in memory"), not a number the user did not choose.
- **"At least" wording.** Every total shown while anything is truncated or evicted keeps "at least"; it is dropped only when both counters are zero. With a byte budget the counters are unchanged (files evicted, diagnostics not retained); a byte figure is not shown to the user.
- **How an evicted file returns.** Only when the server publishes for it again. The server does not republish on `didOpen` (V15), so an evicted push set comes back with the next check (startup or save), and the notice says so. Opening the file brings back its **pull** diagnostics (measured: a reopened evicted file showed its live pull markers and no push markers).
- **Markers.** Markers exist only for open models (design). Evicting a closed file's set removes nothing from Monaco; an open file's markers are never removed by eviction. When a file opens, its markers are built from what the store holds then; if its push set was evicted, only pull markers appear until the next push, and the notice covers that. Nothing is shown as current that was dropped.
- **Session end.** Both routes and markers are cleared (A6, store verified). This does not reduce webview memory by itself (section 2).
- **No silent loss.** Truncation and eviction are never silent, and counters are reset only by the end of the session or a server publish that replaces the set.

**Open (for the architect):** whether the Problems panel should offer a way to see an evicted file's last-known set (it is gone, by design); and whether a byte budget should apply to open documents' sets as a last resort (today they are exempt).

## 5. How a numeric budget would be set, without proposing one

1. **Fix the measurement.** Use the same procedure on each run: webview VmRSS at solution open, peak, settled, post-clear, with LSP on and `CRAIDD_LSP=0`, on more than one fixture (a small crate, `fx-many`, `fx-big`, and at least one real workspace) and on a production build as well as the development build.
2. **Separate the parts.** Add a heap snapshot or allocation timeline at settled and post-clear, so live objects, churn and engine overhead are measured and not inferred (section 2). Record store size in estimated bytes beside rows.
3. **Apply options A and B first** (they change no stored data), re-measure peak and post-clear, and see how much of the gap closes. The remaining gap is the true cost of the stored data.
4. **Choose what to protect.** The budget protects a stated outcome (for example "the editor stays responsive on this class of machine"), measured by the G3 and G4 methods, not a memory figure on its own. The architect names the outcome and the machine class.
5. **Derive the limit from the curve.** Plot responsiveness and memory against the stored size across fixtures; the budget is the point where the architect's outcome is still met, with a margin the architect sets. The per-file, closed-files and closed-total limits (500, 2,000, 20,000 today, all provisional ◇ values) are then re-expressed in the budget's unit (decision 22, option D).
6. **Record it.** The number, the machine class, the fixtures and the raw measurements go in the results record, with the provisional values superseded and the old figures kept.

Until step 5 is done, the provisional limits remain a safety net, and the design's statement stands: Craidd never claims a set is complete unless nothing was truncated or evicted.

---

*Last updated: Phase 3 (Stage 1 closeout, 14 November 2026). Author(s): ShinkuKira21*
*This document is a plan.*
