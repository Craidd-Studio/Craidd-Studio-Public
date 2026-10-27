# Results: LSP Stage 1 — Rust foundation

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Placeholder. No measurements have been taken. Every gate is **Unmeasured**. This document becomes a record once real measurements exist.

**Design:** [design-lsp-stage-1-rust.md](design-lsp-stage-1-rust.md), revised after the [comparison review](review-lsp-stage-1-comparison.md) and the [independent review](review-lsp-stage-1-independent-reconciliation.md). Items from the independent review are approved. The revision added measurements and test evidence below; it added no numeric budget and no pass claim. The gates, pass conditions and acceptance criteria are defined there and are authoritative. This file records evidence against them; it does not redefine them.

---

## Statuses

| Status | Meaning |
|---|---|
| **Unmeasured** | No evidence has been collected. This is the initial and default state. |
| **Blocked** | The gate cannot currently be measured (missing tool, environment, or an unmet dependency). The blocker is stated. |
| **Fail** | Measured, and the pass condition in the design is not met. The raw numbers are recorded. |
| **Pass** | Measured, the pass condition is met, and the evidence below supports it. |

Rules:

- A required gate is never accepted as passed without evidence recorded here. Absence of a result is **Unmeasured**, not Pass.
- A status changes only together with the evidence that justifies it.
- A **Fail** is recorded as plainly as a Pass. It is not removed, rewritten or reworded when a later run passes; the later run is added beside it.
- Nothing here is estimated, projected or copied from another machine's results.
- Stage 1 is accepted only when every required gate is **Pass**, or has a recorded, reviewed reason it cannot be (a **Blocked** gate is not a pass).

---

## Gate summary

| Gate | Subject | Status | Evidence |
|---|---|---|---|
| G1 | No server during startup or restore; bounded deferral; startup measured apart from server cost | Unmeasured | — |
| G2 | One `rust-analyzer` per shared Cargo workspace | Unmeasured | — |
| G3 | Indexing never blocks interaction; separate target directory cost; Channel message rate and size | Unmeasured | — |
| G4 | Rapid typing, file switching and a stalled consumer are bounded | Unmeasured | — |
| G5 | Diagnostics do not flood Monaco; diagnostic store size | Unmeasured | — |
| G6 | Closing a solution terminates its servers and their descendants | Unmeasured | — |
| G7 | Synchronisation correctness, document lifetimes and forced overflow | Unmeasured | — |

---

## Milestone evidence

The three-stage plan is approved, so evidence is also recorded per stage. A stage's evidence never accepts a gate: a gate is accepted only when its own evidence is complete and Pass, and Stage 1 acceptance still needs every gate G1–G7 Pass.

| Gate | 1a evidence | 1b evidence | 1c evidence | Accepted |
|---|---|---|---|---|
| G1 | Unmeasured | Unmeasured | n/a | Unmeasured |
| G2 | Unmeasured | Unmeasured | n/a | Unmeasured |
| G3 (including G3b) | n/a | Unmeasured | Unmeasured | Unmeasured |
| G4 | Unmeasured | n/a | Unmeasured | Unmeasured |
| G5 | n/a | Unmeasured | n/a | Unmeasured |
| G6 | Unmeasured | Unmeasured | n/a | Unmeasured |
| G7 | n/a | Unmeasured | n/a | Unmeasured |

Stage exit evidence (not gates):

| Stage | Exit evidence required | Status |
|---|---|---|
| 1a | Fake-server tests (framing, transport, delivery classes, overflow, pending table, capability validation, terminate table, process tree); DAP suite unchanged; verifications V1, V5, V6, V7, V8 recorded before the Rust adapter merges | Unmeasured |
| 1b | Real-server diagnostics, document lifetimes and file identity; G1, G2, G5, G6, G7 evidence; first G3 and G3b measurements; verifications V2–V4, V9, V13–V16 | Unmeasured |
| 1c | Completion and atomic-acceptance tests; G3 and G4 under provider load; verifications V10–V12 and V18; acceptance criterion 1 | Unmeasured |

---

## Test environment

Recorded once per measurement session, and repeated per entry if it changes. Left blank until a session happens.

| Field | Value |
|---|---|
| Date | — |
| Craidd commit | — |
| Machine (CPU, RAM, disk type) | — |
| OS and kernel | — |
| `rust-analyzer` version and how it was installed | — |
| Rust toolchain version | — |
| Monaco version | — |
| `fs.inotify.max_user_watches` | — |
| Build profile of Craidd (dev / release) | — |
| Workspace(s) measured (name, source, size) | — |
| Baseline configuration (`CRAIDD_LSP=0`, or other) | — |

---

## Entry template

Copy one block per gate per run. Do not delete earlier runs.

```
### G? — run N

- Status: Unmeasured | Blocked | Fail | Pass
- Date / commit:
- Environment: (see table above, or note differences)
- Workspace:
- Method: (exact steps or script, so it can be repeated)
- Baseline: (what was compared against, and its own raw numbers)
- Raw measurements: (numbers, not summaries)
- Result against the design's pass condition:
- Notes / anomalies:
- If Blocked: the blocker:
```

---

## G1 — Startup and deferred launch

Pass condition: see the design, Performance gates, G1.

Required measurements, reported as separate numbers and never combined:

1. startup to interactive editor, compared with the `CRAIDD_LSP=0` baseline;
2. scheduling delay: the active document becoming eligible to the process being spawned;
3. spawn to `initialize` response;
4. `initialize` response to the end of initial indexing progress.

Also required: server process count over time; a never-idle startup showing the bounded deferral still launches; a mid-deferral file switch showing revalidation; an active non-Rust tab with background Rust tabs showing no server.

Status: **Unmeasured**. No runs recorded.

## G2 — One server per shared workspace

Status: **Unmeasured**. No runs recorded.

## G3 — Indexing does not block interaction

Required, in addition to the main-thread and keystroke measurements: extra disk use, first-check time, and whether a Build issued during a check waits on the lock, with the separate target directory **on and off**. Also required: Channel message rate and bytes per second during initial indexing.

Status: **Unmeasured**. No runs recorded.

## G4 — Bounded typing, file switching and a stalled consumer

Required: the scripted typing and tab-switching runs; and a run with the frontend consumer stalled during a diagnostics and progress flood, recording that the server's stdout kept draining, every response was delivered exactly once, every server request was answered, and the terminal status and each progress `end` were delivered after the consumer resumed.

Status: **Unmeasured**. No runs recorded.

## G5 — Diagnostics flood control

Required in addition: the stored diagnostic count and approximate store memory after a large check.

Status: **Unmeasured**. No runs recorded.

## G6 — Solution close terminates servers and descendants

Required: the server's full process tree listed before and after, including `cargo` check processes and any proc-macro server it started. A surviving descendant is a Fail even if the main server process exited.

Status: **Unmeasured**. No runs recorded.

## G7 — Synchronisation correctness, document lifetimes and forced overflow

Required in addition to the editing cases: tab switching, model disposal and recreation with the tab open, reload from disk while the model is disposed, and a forced writer overflow during typing, each compared against the server's view of the text.

Status: **Unmeasured**. No runs recorded.

---

## Required test evidence

Deterministic tests specified in the design. They are not gates, but a required item is not accepted without a recorded run. None has been written or run.

| Item | Specified in | Status |
|---|---|---|
| Delivery classes with a stalled consumer (R, Q, S, L guarantees; class T terminal phase absorbing and pullable) | Testing → Rust | Unmeasured |
| `terminate()` table over every cause | Testing → Rust | Unmeasured |
| Diagnostic retention: open sets never evicted, visible eviction, per-file cap | Testing → Frontend | Unmeasured |
| Atomic completion acceptance: no primary-only result in any failure case | Testing → Frontend | Unmeasured |
| File identity: alias tabs, holder precedence, navigation focuses the holder, four symlinked-vendor cases | Testing → Frontend | Unmeasured |
| Writer-queue overflow recovery: no replay, atomic resync, no double application | Testing → Rust | Unmeasured |
| Pending table: cancelled entries, unknown ids, eviction, terminal resolution | Testing → Rust | Unmeasured |
| Capability validation table, including resolve gating and malformed values | Testing → Rust | Unmeasured |
| Framing error versus bad body | Testing → Rust | Unmeasured |
| Document lifetimes: Pending, Open, Suspended, Resume, Closed | Testing → Frontend | Unmeasured |
| Diagnostics kept on document close; markers restored from the store | Testing → Frontend | Unmeasured |
| Completion context and `isIncomplete` mapping | Testing → Frontend | Unmeasured |
| Canonical identity with a symlinked directory | Testing → Frontend | Unmeasured |
| Accepting a completion with `additionalTextEdits` | Testing → Frontend | Unmeasured |
| Real-server smoke test, including the unopened-file change | Testing → Real server | Unmeasured |

---

## Pending verifications

Facts the design depends on but has not confirmed. They are not gates, but none may be assumed. Each is recorded with its evidence when checked. **Blocks** names what may not proceed until the item is recorded. `rust-analyzer` is not installed on the machine used to write the design, so every item that needs it also needs a user to install it first (Craidd never installs it).

| ID | Item | Blocks | Flip condition if it fails | Status |
|---|---|---|---|---|
| V1 | `rust-analyzer.files.watcher`: accepted values, and self-watching when the client registers no watchers; pinned version recorded | Rust adapter merge (1a) | The server cannot self-watch: watcher ownership must be redesigned and a Craidd watcher with `didChangeWatchedFiles` moves into Stage 1 | Unverified |
| V2 | Watcher failure (for example the inotify limit): whether and how the server reports it | "Watcher failure surfaced" claim (1b) | The claim must be reworded | Unverified |
| V3 | A change to an unopened file updates the server's diagnostics | Real-server smoke test (1b) | As V1 | Unverified |
| V4 | `cargo.targetDir` set to use a subdirectory of `target/` behaves as documented | Adapter options (1b) | Revert to the shared directory or find another isolation | Unverified |
| V5 | The real `initialize` result (sync kind, save, `resolveProvider`, trigger characters) against the validation table | Rust adapter merge (1a) | Adjust the validation table | Unverified |
| V6 | The server accepts `utf-16` as the only offered position encoding | Rust adapter merge (1a) | Offer more encodings and re-encode | Unverified |
| V7 | The rustup shim when the component is missing; the usable check treats a non-zero exit as failure | Toolchain role (1a) | Probe by another method | Unverified. The current `probe()` is confirmed to ignore the exit status. |
| V8 | `cargo metadata --no-deps` never creates or rewrites `Cargo.lock`; its failure modes and typical duration | Rust adapter merge (1a) | Workspace root discovery must change (breaches the no-silent-mutation rule) | Unverified |
| V9 | The model URI from `@monaco-editor/react` for `path={fileId}`; what happens to a model when a view unmounts or `path` changes; which model events fire | Document lifetimes (1b) | Adjust the bridge's model observation | Unverified. `SideEditor` is confirmed to use `keepCurrentModel`. |
| V10 | Monaco: whether accept waits for a pending resolve; behaviour when resolve fails; whether a post-accept command can revert | Atomic acceptance (1c) | Use eager mode (F2); if V18 also fails, completion cannot ship | Unverified |
| V11 | Monaco's incomplete-list flag name and re-request behaviour on 0.56.x; the completion context fields available | Completion requests (1c) | Document the limitation; no `isIncomplete` benefit | Unverified |
| V12 | Primary and additional edits undo as one step | Atomic acceptance (1c) | Apply them as one grouped edit | Unverified |
| V13 | `window/showMessageRequest` answered with no selection | Server-to-client requests (1b) | Different handling for that request | Unverified |
| V14 | Names and number of child processes the server starts (for the G6 process-tree check) | G6 | Adjust the tree assertion | Unverified; inferred from the server's design, not checked |
| V15 | Whether the server republishes diagnostics on open, after a retention eviction | Retention policy (1b) | Evicted diagnostics cannot be recovered; tighten the policy | Unverified |
| V16 | How the server reports locations for symlinked paths; the four symlinked-vendor navigation cases | File identity (1b) | Revisit the holder and navigation rules | Unverified |
| V17 | A single file-to-owning-project resolver exists or is introduced | Router (1a) | Introduce it as the first 1a task | Not found in current source |
| V18 | When the client does not declare lazy `additionalTextEdits`, the server sends them in the completion list | Eager mode fallback (1c) | Fallback F2 is unavailable | Unverified |
| V19 | Whether Preferences renders a new catalog role automatically | Toolchain role (1a) | Add the row | Unverified |
| V20 | Diagnostic store size and memory under a large check (this is a G5 measurement) | Retention limits (1b) | n/a | Unmeasured |
| V21 | Save-triggered check responsiveness and CPU contention with a concurrent Build (this is G3b) | None | Consider CPU priority or withholding `didSave` | Unmeasured |

Deferred and not tracked as blockers: bounded automatic restart, pull diagnostics, a missing standard-library-source message, a Craidd-native file watcher (unless V1 or V3 fails), and any new UI surface.

---

---

*Last updated: Phase 3 (Stage 1 proposal). Author: ShinkuKira21.*
*This document is a placeholder.*
