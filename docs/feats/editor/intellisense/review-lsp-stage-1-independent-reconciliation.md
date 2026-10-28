# Review: independent pre-implementation reconciliation

**Roadmap track:** Phase 3 language intelligence, Stage 1 pre-implementation. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Approved by the architect (the class T record, the three-identity file model, atomic completion acceptance, the 1a/1b/1c split and the existing-surfaces UI plan). Philosophy amendments A1, A2, A3, A4 and A5 and their added wording are **approved and applied** (A2 and A4 in the revised form after F3 and the pull-diagnostics decisions); A6 and A7 remain **pending approval**. Nothing is implemented.

**Subject:** [design-lsp-stage-1-rust.md](design-lsp-stage-1-rust.md), [results-lsp-stage-1.md](results-lsp-stage-1.md). Earlier review: [review-lsp-stage-1-comparison.md](review-lsp-stage-1-comparison.md).

**Scope:** A reconciliation, not a redesign. The architecture stands: message classes, server identity, tab-owned registration, deterministic resync, capability validation, deferred launch.

---

## Evidence handling

The independent review was supplied as pasted text, not a file. Its statements about the code were checked against this branch before being relied on.

**Confirmed in the source**

- `toolchain.rs` `probe()` reports the first line of stderr as the "version" when a tool exits non-zero; it never inspects the exit status. A rustup shim for a missing component would therefore show as "found".
- `SideEditor` uses `keepCurrentModel`, so a Monaco model can outlive the view that created it.
- The solution store keys tabs by the exact absolute-path string given to `openFile`; `updateTabContent` mirrors every edit into the tab and computes `dirty` as `content !== originalContent`.
- The tab status dot precedence is deleted, then newer, then dirty (`EditorTabs.tsx`).
- `StatusBar.tsx` exists; the Problems/Output tabs exist in `BottomPanel.tsx`.

**Not confirmed, or wrong**

- "`[craidd-debug]` output already flows into Output." It does not: those are `eprintln!` lines to the process's stderr (`tauri_dev.rs`). The Output tab shows a single stream chosen from build or debug output and has no channel concept, so a per-channel filter is not a one-line change.
- "`openFile` uses `resolveRelPath` + `stat_files`." It calls `read_file` and `stat_files` on the given path, with no canonicalisation at all. That strengthens the point that two path forms are today two independent tabs and models.
- The claim that G1 cannot be accepted until the provider stage. G1 concerns launch behaviour, which exists once documents register; see the stage mapping in the design.

Everything else in the review about Monaco 0.56.x, `rust-analyzer` and `cargo` was stated by the reviewer as assumed. It is carried forward as a verification, not as a fact.

---

## Disposition of every proposed amendment

| Status | Meaning |
|---|---|
| **Accepted** | Incorporated as proposed. |
| **Modified** | Incorporated with changes; reason given. |
| **Rejected** | Not incorporated; reason given. |
| **Deferred** | Left to a runtime verification or a later stage. |

### Amendments the reviewer required before implementation

| # | Proposal | Disposition | Reasoning and result |
|---|---|---|---|
| 1 | One atomic `Session::terminate()` | **Accepted** | A real gap: four state structures with no single terminal transition. Added as a normative rule with a fixed order, compare-and-set so the first cause wins, and a table-driven test. Process teardown stays the existing graceful-stop sequence that it starts. |
| 2 | Class T: unbounded T-critical queue that panics on internal overflow, plus a bounded T-lifeline that drops oldest | **Modified** | Both extremes are unsafe: an unbounded queue is the memory growth to avoid, and a panic can take down the process. Class T becomes a per-session status **record**, not a queue. See [Class T](#1-class-t-state-not-a-queue). |
| 3 | `cargo metadata` via `process_supervisor::spawn`, cached including failures, bounded timeout | **Accepted, extended** | Caching is keyed on manifest stamps rather than a bare TTL; single-flight per project; and a new verification that `cargo metadata --no-deps` never creates or rewrites `Cargo.lock`, because that would breach Craidd's no-silent-mutation rule. |
| 4 | State the completion-accept fallback; fallback B applies the primary edit and drops additional edits | **Modified, B rejected** | Primary-only can produce wrong code. Replaced with atomic-or-rejected acceptance and a fixed fallback order. See [Completion acceptance](#3-completion-acceptance). |
| 5 | Diagnostic store cap: LRU over closed models, `N_URI_MAX` about 5000 | **Modified** | Policy accepted; the number is not. Eviction is visible, never touches open models or build problems, per-file caps added, and cap values are set from G5 evidence. Whether the server republishes after eviction is a verification. |
| 6 | Canonical-path helper in `solutionStore`, used by `openFile`, `revealFile`, `movePath` and LSP | **Rejected as stated; Modified** | Store-wide canonicalisation would change tab, breakpoint, tree and session identity for every feature, to serve one subsystem. Replaced with an LSP-only filesystem identity. See [Canonical paths](#2-canonical-paths-three-identities). |
| 7 | Toolchain probe: non-zero exit means "tool reported failure" | **Accepted, scoped** | Bug confirmed. Applied to the new `language_server` role in Stage 1; changing the display of existing roles is a separate change. |

### Stage split and milestones

| Proposal | Disposition | Reasoning and result |
|---|---|---|
| Stage 1a plumbing, 1b documents and diagnostics, 1c providers | **Accepted, with corrections** | The split is sound. Corrections: capability validation belongs in 1a, because a session reaches Ready only through it. G1 completes in 1b, not 1c. Class T tests change with the redesign. |
| Independent milestone evidence; final G1–G7 acceptance unchanged | **Accepted** | Results record gains per-stage evidence; no gate is accepted earlier than its evidence exists; Stage 1 acceptance still needs every gate Pass. |
| Zero user-visible change in 1a except the Preferences role | **Accepted** | |
| Test file layout (`lsp_transport.rs` and similar) | **Deferred** | A naming choice for implementation; each stage lands with its own tests. |

### Verifications and measurements

| Proposal | Disposition |
|---|---|
| Watcher: option values, self-watch with no client registration, unopened-file change, inotify-limit reporting; block the Rust adapter merge if it fails | **Accepted.** Verifications V1–V3, with a stated flip condition. |
| `cargo.targetDir` subdirectory behaviour | **Accepted** (V4). |
| Real `initialize` result against the validation table; utf-16-only offer | **Accepted** (V5, V6). |
| rustup shim and probe behaviour | **Accepted** (V7). |
| Monaco: model URI, model lifetime, resolve/accept order, incomplete flag, trigger kind, undo grouping | **Accepted** (V9–V12). |
| Editable vendored file versus read-only registry file (navigation cases) | **Accepted** (V16), with the case table in the design. |
| Save-triggered check responsiveness | **Accepted** as sub-case G3b of G3, not a new gate. |
| Lower server CPU priority; skipping `didSave` | **Deferred.** Considered only if G3b measures contention. |
| Deferral knob and debug log of why the launch fired | **Accepted.** One named constants location and a debug-only reason log. |

### UI surfaces

| Proposal | Disposition | Reasoning and result |
|---|---|---|
| Status chip in the existing status bar | **Accepted** | |
| LSP lines in Output with an `[lsp:rust-analyzer]` prefix, following `[craidd-debug]` | **Modified** | The precedent is stderr, not Output. Output needs a small extension to show a further source in the existing tab. Per-source filtering is deferred. No new tab. |
| Problems: source badge per row, per-source counts | **Accepted** | |
| Lock glyph beside the file icon, not in the status-dot column | **Accepted** | |
| Preferences: `language_server` role in the existing Toolchain loop | **Accepted** | |
| No new sidebar, tab, preferences page or toolbar button | **Accepted** | |

### Philosophy amendments A1–A7

Reviewer verdict: accept A1–A7, with one added sentence on each of A1, A2, A3, A5, A6 and A7. All are **Accepted as proposed wording**. A1, A2, A3 and A5 are approved and applied (A4 was reworded and applied separately); A6 and A7 are pending your approval. The wording is under [Proposed additions to amendment text](#proposed-additions-to-amendment-text).

---

## The three judgement items

### 1. Class T: state, not a queue

The reviewer's concern is correct: a bounded event queue that fails the session on overflow can lose a terminal event or kill a healthy session because the frontend stalled. The proposed cure is not.

- **Unbounded queue:** reintroduces the unbounded growth the design set out to avoid.
- **Panic on overflow:** a process-wide failure for a per-session condition. Threads are wrapped by `containment::guard` precisely so a panic never takes the IDE down.

**Decision.** Class T has no queue to overflow.

- It is a per-session **status record**: session generation, phase, terminal reason, the negotiated-capability summary (set once), and a **set** of document URIs needing resync.
- **Terminal state is absorbing.** Once set it cannot be overwritten or discarded, by compare-and-set inside `terminate()`.
- Intermediate transitions may collapse. The frontend needs the current state, not the history. Anything that seems to need "exactly once" (registering documents when Ready) is derived idempotently from `(generation, phase)`.
- The resync set is bounded by the number of open documents and is idempotent. This is the reviewer's "drop oldest and re-mark Desynced" achieved by construction.
- The frontend can also **pull** the current record, so a window reload or a missed batch loses nothing.
- Memory is O(1) plus open documents. Nothing in it can overflow, so there is neither a failure-on-overflow rule nor a panic path. A violated internal invariant terminates that one session through `terminate("internal error")`.

Result: no unbounded growth, no process-wide panic, a terminal state that cannot be lost, and a stalled frontend can no longer fail a session. **Modified.**

### 2. Canonical paths: three identities

Three different questions were being treated as one.

| Question | Identity | Owner | Stage 1 change |
|---|---|---|---|
| Which **tab** is this? | The absolute path string the store keys it by | Solution store | **None.** Two path forms remain two tabs. |
| Which **underlying file** is this? | Canonical filesystem path (symlinks resolved) | LSP layer only | New, LSP-only. |
| Which **project** owns it? | Project membership by path, as the solution model defines | Solution model | **None.** |

Rules (full text in the design):

- LSP registration is keyed by `(session, filesystem identity)`. Nothing outside LSP uses it.
- If two open tabs share a filesystem identity, exactly one holds the registration; the others are **aliases** with language features off and a visible note. Alias tabs never send text, so the server cannot see two diverging models of one file. An owned, editable tab beats an unowned read-only one; otherwise the earlier-activated tab holds.
- **Navigation** from the server never creates a second tab for a file that is already open: it focuses the holder. This is not a collapse of path views, because explicit opens by path still behave exactly as today.
- Read-only remains a property of the *path view* with no owning project.

**The symlinked-vendor test.** The apparent tension is that one underlying file seems both owned (through the vendored path) and unowned (through the registry path). It disappears once ownership and registration are separate: ownership is judged on the path the user or server presented, registration on the file. If the two paths are genuinely different files, there is no conflict. If they are one file reached by two paths, the owned editable tab holds the registration and the unowned view is a read-only alias; and a navigation request to either focuses the holder instead of creating a second tab. Test cases are in the design. **Modified; store-wide canonicalisation rejected.**

### 3. Completion acceptance

The reviewer's fallback B (apply the primary edit, drop unresolved additional edits) **can produce incorrect code**:

- An auto-import completion would insert the name without its `use`. If another item with that name is in scope, the code compiles and means something different.
- Servers also use additional edits for completions that change surrounding text (for example removing a receiver). Dropping them leaves garbled or duplicated code. [I: inferred from how such completions are commonly built; verify against the real server.]
- The same hazard exists in two of the design's own earlier rules: "overlapping edits → apply the primary only" and "dead session → apply only what the item holds". Both are revised.

**Decision.** Acceptance is atomic or rejected, never primary-only when required edits exist.

1. Preferred: Monaco waits for resolve before applying, then primary and additional edits apply together as one undo step.
2. If resolve fails, times out, is stale, or returns invalid edits, a partial result must not remain. A compensating revert after accept (via the item's post-accept command) restores the document, with a visible notice. Whether this is feasible is verification V10.
3. If that is not feasible: **eager mode**. Craidd stops declaring lazy `additionalTextEdits`, so any edits arrive complete in the list and an item is either whole or absent. This costs completion latency, measured under G3. Whether the server then sends them eagerly is verification V18.
4. Never: apply the primary edit alone.

Acceptance criterion 1 is not weakened. If neither 1–2 nor 3 can be verified, that is a No-Go condition for the completion part of Stage 1c, not a reason to ship partial edits. **Modified; fallback B rejected.**

---

## Proposed additions to amendment text

A1, A2, A3 and A5 are approved and applied to the philosophy; A2 in its revised form below. A6 and A7 are for your approval.

| # | Proposed addition |
|---|---|
| A1 | "Which server analyses which project is an implementation detail; which project owns which file is not." |
| A2 | "A failure to start (missing tool, bad version, handshake timeout) or to load the workspace is visible to the user, through the server's own status where it reports one and through bounded server output otherwise, and never gates the editor." *(Revised after F3 and decision 17. Approved and applied.)* |
| A3 | "The frontend cannot cause a server request to go unanswered. The backend answers every server request from a static table without waiting on the frontend." |
| A5 | "The DAP test suite must pass unchanged after extraction. A behaviour change is a regression." |
| A6 | "Automatic restart is revisitable only with recorded crash-frequency evidence, and not before Stage 1 is accepted." |
| A7 | "`initializationOptions` do not change during a session; a change is a new identity and a restart on next use." |

---

## Remaining blockers before Stage 1a

**No design blocker remains**, assuming you approve this reconciliation. What is left:

1. **Your approval** of the three judgement decisions (class T record, three identities, atomic completion) and the stage mapping.
2. **A user action:** `rust-analyzer` is not installed on this machine. The transport, session, delivery and terminate work in 1a uses a fake server and is not blocked. The Rust adapter merge in 1a is gated on V1, V5, V6, V7 and V8, which need the real binary.
3. **A task, not a blocker:** there is no single file-to-owning-project resolver today. The router in 1a must introduce one over the loaded solution model, which is its first piece of work.
4. **Philosophy amendments** are needed before the parts they govern are merged (A1, A3, A5 touch 1a). A1, A3 and A5 are approved and applied, and so are A2 and A4 (which govern 1b); A6 and A7 remain pending.

## Sign-off

**Recommendation: Conditional Go.**

- **Conditions:** your approval of the items above; `rust-analyzer` installed before the adapter merge; the three flip conditions below treated as stop points.
- **Stop conditions V1 and V8 confirmed by the architect.**
- **Flip to No-Go for the affected part** if: V1 shows the server cannot self-watch (the watcher ownership design must be revisited); V10 and V18 both fail (Stage 1c completion cannot satisfy atomic acceptance); V8 shows `cargo metadata --no-deps` writes `Cargo.lock` with no safe alternative (workspace root discovery must change).

**What changed:** class T is a status record; one `terminate()`; `cargo metadata` supervision and caching; a diagnostic retention policy; atomic completion acceptance; LSP-only filesystem identity with alias tabs; G3b; the existing-surfaces UI plan; stages 1a/1b/1c with per-stage evidence.

**What remains unverified:** every Monaco 0.56.x behaviour, every `rust-analyzer` behaviour, and every measurement. All gates and verifications are Unmeasured or Unverified.

---

*Last updated: Phase 3 (Stage 1 pre-implementation; A2 and A4 applied). Author: ShinkuKira21.*
*This document is a record.*
