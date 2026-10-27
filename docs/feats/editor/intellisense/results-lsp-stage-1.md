# Results: LSP Stage 1 — Rust foundation

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Record. Stage 1a is implemented and its fake-server evidence is recorded in [Stage 1a record](#stage-1a-record). Every gate is still **Unmeasured**: no gate's own evidence is complete, and nothing here was measured against a real `rust-analyzer`.

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
| G1 | Partial: backend revalidation tests only (see Stage 1a record) | Unmeasured | n/a | Unmeasured |
| G2 | Recorded: identity tests against real `cargo` workspaces | Unmeasured | n/a | Unmeasured |
| G3 (including G3b) | n/a | Unmeasured | Unmeasured | Unmeasured |
| G4 | Recorded: stalled consumer against the fake server | n/a | Unmeasured | Unmeasured |
| G5 | n/a | Unmeasured | n/a | Unmeasured |
| G6 | Recorded: fake-server process tree, including a detached descendant | Unmeasured | n/a | Unmeasured |
| G7 | n/a | Unmeasured | n/a | Unmeasured |

Stage exit evidence (not gates):

| Stage | Exit evidence required | Status |
|---|---|---|
| 1a | Fake-server tests (framing, transport, delivery classes, overflow, pending table, capability validation, terminate table, process tree); DAP suite unchanged; verifications V1, V5, V6, V7, V8 recorded before the Rust adapter merges | **Partial.** Tests recorded and DAP suite unchanged; V8 recorded. V1, V5, V6 and V7 are Unverified, so the Rust adapter commit may not merge. |
| 1b | Real-server diagnostics, document lifetimes and file identity; G1, G2, G5, G6, G7 evidence; first G3 and G3b measurements; verifications V2–V4, V9, V13–V16 | Unmeasured |
| 1c | Completion and atomic-acceptance tests; G3 and G4 under provider load; verifications V10–V12 and V18; acceptance criterion 1 | Unmeasured |

---

## Test environment

Recorded once per measurement session, and repeated per entry if it changes. Left blank until a session happens.

| Field | Value |
|---|---|
| Date | 2026-10-27 (Stage 1a session) |
| Craidd commit | `0d110f1` (foundation), `8f7801f` (Rust adapter), on top of `e44d824` |
| Machine (CPU, RAM, disk type) | 32 logical CPUs, 60 GiB RAM, mixed SSD and HDD |
| OS and kernel | Arch Linux, kernel 7.2.11-arch1-1 |
| `rust-analyzer` version and how it was installed | **Not installed.** No rustup either: Rust is Arch's packaged toolchain. |
| Rust toolchain version | cargo 1.99.1 (5f94df478 2026-08-27), Arch Linux rust 1:1.99.1-1 |
| Monaco version | not exercised in 1a |
| `fs.inotify.max_user_watches` | 524288 |
| Build profile of Craidd (dev / release) | `cargo test` (unoptimised, debug info) |
| Workspace(s) measured (name, source, size) | Generated temporary crates and workspaces (see V8 and the adapter tests) |
| Baseline configuration (`CRAIDD_LSP=0`, or other) | n/a in 1a (no gate measured); `CRAIDD_LSP` is not implemented yet |

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

Deterministic tests specified in the design. They are not gates, but a required item is not accepted without a recorded run. "Run" means the tests exist and passed in the run recorded under [Stage 1a record](#stage-1a-record); it is evidence for that item only, not a gate result.

| Item | Specified in | Status |
|---|---|---|
| Delivery classes with a stalled consumer (R, Q, S, L guarantees; class T terminal phase absorbing and pullable) | Testing → Rust | Run (1a), fake server |
| `terminate()` table over every cause | Testing → Rust | Run (1a), fake server. Solution close is covered by the registry test. |
| Diagnostic retention: open sets never evicted, visible eviction, per-file cap | Testing → Frontend | Unmeasured |
| Atomic completion acceptance: no primary-only result in any failure case | Testing → Frontend | Unmeasured |
| File identity: alias tabs, holder precedence, navigation focuses the holder, four symlinked-vendor cases | Testing → Frontend | Unmeasured |
| Writer-queue overflow recovery: no replay, atomic resync, no double application | Testing → Rust | Partial (1a): a full writer returns `Full` to the caller, never silence, and requests are refused before sync traffic. Desync, resync and replay rules need the document table (1b). |
| Pending table: cancelled entries, unknown ids, eviction, terminal resolution | Testing → Rust | Run (1a) |
| Capability validation table, including resolve gating and malformed values | Testing → Rust | Run (1a) |
| Framing error versus bad body | Testing → Rust | Run (1a), unit and fake server |
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
| V7 | The rustup shim when the component is missing; the usable check treats a non-zero exit as failure | Toolchain role (1a) | Probe by another method | Unverified against a real shim: this machine has no rustup. The usable check is implemented for the `language_server` role and tested against scripted stand-ins (exit 0 is offered, exit 1 is not). Existing roles still ignore the exit status. |
| V8 | `cargo metadata --no-deps` never creates or rewrites `Cargo.lock`; its failure modes and typical duration | Rust adapter merge (1a) | Workspace root discovery must change (breaches the no-silent-mutation rule) | **Verified** for cargo 1.99.1. Stop condition not triggered. See [V8 evidence](#v8-evidence). |
| V9 | The model URI from `@monaco-editor/react` for `path={fileId}`; what happens to a model when a view unmounts or `path` changes; which model events fire | Document lifetimes (1b) | Adjust the bridge's model observation | Unverified. `SideEditor` is confirmed to use `keepCurrentModel`. |
| V10 | Monaco: whether accept waits for a pending resolve; behaviour when resolve fails; whether a post-accept command can revert | Atomic acceptance (1c) | Use eager mode (F2); if V18 also fails, completion cannot ship | Unverified |
| V11 | Monaco's incomplete-list flag name and re-request behaviour on 0.56.x; the completion context fields available | Completion requests (1c) | Document the limitation; no `isIncomplete` benefit | Unverified |
| V12 | Primary and additional edits undo as one step | Atomic acceptance (1c) | Apply them as one grouped edit | Unverified |
| V13 | `window/showMessageRequest` answered with no selection | Server-to-client requests (1b) | Different handling for that request | Unverified |
| V14 | Names and number of child processes the server starts (for the G6 process-tree check) | G6 | Adjust the tree assertion | Unverified; inferred from the server's design, not checked |
| V15 | Whether the server republishes diagnostics on open, after a retention eviction | Retention policy (1b) | Evicted diagnostics cannot be recovered; tighten the policy | Unverified |
| V16 | How the server reports locations for symlinked paths; the four symlinked-vendor navigation cases | File identity (1b) | Revisit the holder and navigation rules | Unverified |
| V17 | A single file-to-owning-project resolver exists or is introduced | Router (1a) | Introduce it as the first 1a task | **Introduced:** `crate::ownership::owning_project`. Frontend callers are not migrated yet (see the Stage 1a record). |
| V18 | When the client does not declare lazy `additionalTextEdits`, the server sends them in the completion list | Eager mode fallback (1c) | Fallback F2 is unavailable | Unverified |
| V19 | Whether Preferences renders a new catalog role automatically | Toolchain role (1a) | Add the row | **Verified: it does not.** `PreferencesDialog.tsx` has a hardcoded role list; `language_server` was added to Rust's. |
| V20 | Diagnostic store size and memory under a large check (this is a G5 measurement) | Retention limits (1b) | n/a | Unmeasured |
| V21 | Save-triggered check responsiveness and CPU contention with a concurrent Build (this is G3b) | None | Consider CPU priority or withholding `didSave` | Unmeasured |

Deferred and not tracked as blockers: bounded automatic restart, pull diagnostics, a missing standard-library-source message, a Craidd-native file watcher (unless V1 or V3 fails), and any new UI surface.

---

## Stage 1a record

### What was built

| Design item | Where | Commit |
|---|---|---|
| Shared framing (DAP keeps its policy and error strings; the size cap is a parameter) | `src-tauri/src/lsp/framing.rs`, `commands/debug.rs`, `commands/debug_transport.rs` | `0d110f1` |
| Message classes R, Q, S, L, T | `lsp/protocol.rs`, `lsp/delivery.rs` | `0d110f1` |
| Pending table with cancelled entries | `lsp/pending.rs` | `0d110f1` |
| Capability advertisement and validation | `lsp/caps.rs` | `0d110f1` |
| Session state machine, transport threads, server-request table, `terminate()`, graceful stop, containment | `lsp/session.rs` | `0d110f1` |
| Server identity, adapter trait, router, registry | `lsp/adapter.rs`, `lsp/router.rs`, `lsp/registry.rs` | `0d110f1` |
| Single file-to-owning-project resolver | `src-tauri/src/ownership.rs`; the membership rule is now shared with the Explorer's `filter_tree` | `0d110f1` |
| Refreshable process-tree ownership | `process_supervisor::OwnedTree` | `0d110f1` |
| Rust adapter with supervised `cargo metadata` | `lsp/rust_adapter.rs` | `8f7801f` (merge-gated) |
| `language_server` role, usable check, Preferences row | `commands/toolchain.rs`, `PreferencesDialog.tsx` | `8f7801f` (merge-gated) |

Nothing calls the registry yet, so no server can start from the IDE. The Tauri commands, the editor bridge and the deferred launch are Stage 1b.

### Runs

- **Before any change** (`e44d824`): `cargo test --lib`, 145 passed, 0 failed, 4 ignored.
- **After** (working tree of `8f7801f`): `cargo test`, 195 passed, 0 failed, 5 ignored (lib); 7 passed, 1 ignored (`process_cleanup`). The extra ignored test is the fake server's own entry point.
- **Foundation alone** (`0d110f1` in a clean checkout, without the adapter commit): `cargo test --lib`, 189 passed, 0 failed, 5 ignored. It can therefore merge independently of `8f7801f`.
- **DAP suite unchanged:** all 145 baseline tests pass by name after the extraction, including the 26 `commands::debug*` tests. No DAP test was edited.
- **Repeatability:** the 42 LSP tests ran 25 times in a row with no failure, after the race noted below was fixed. Before the fix, 1 run in 6 failed.
- **Frontend:** `tsc --noEmit` clean. No frontend tests were added; no frontend LSP code exists yet.
- No stray `sleep` or fake-server processes remained after any run.

How the fake server works: the test binary re-executes itself in a scripted server mode. libtest's own output goes to `/dev/null`, and the protocol travels on fd 3. So sessions talk to a real child process over real pipes, through `process_supervisor::spawn` (which, in unit tests, spawns directly rather than through the supervisor process). The scripts cover a normal handshake, a server that never answers `initialize`, an initialize error, a non-utf-16 encoding, ignored `shutdown`/`exit`/`SIGTERM`, exit code 3, `SIGSEGV`, broken framing, bad bodies, a flood, server-to-client requests, late replies, a stalled reader, and a detached descendant process.

### V8 evidence

cargo 1.99.1, run directly, and also by the adapter tests:

| Case | Exit | Time | `Cargo.lock` |
|---|---|---|---|
| Standalone crate with a registry dependency, no lockfile (`--offline`) | 0 | 9 ms | not created |
| Same crate, network allowed | 0 | 8 ms | not created |
| Two-member workspace, no lockfile, run from a member | 0 | 9 ms | not created; `workspace_root` is the workspace |
| Workspace with an existing lockfile | 0 | 8 ms | content and modification time unchanged |
| Workspace whose lockfile is stale (a dependency added after it was written) | 0 | — | content and modification time unchanged |
| Contrast: plain `cargo metadata` (without `--no-deps`) on the stale lockfile | 0 | — | **rewritten** |
| Malformed manifest | 101 | — | not created; first error line is usable as the note |
| No manifest anywhere up the tree | 101 | — | "could not find `Cargo.toml`" |

`--no-deps` is therefore required, not just faster, and the adapter always passes it.

### Findings from implementation (for review)

These are behaviours the design did not spell out, or found to need. They are implemented as described. Each needs the architect's decision before the design text is changed.

1. **The process tree must be tracked before the server can exit.** A first version captured the tree at teardown, after closing the server's stdin. The fake server exited on that EOF, and its detached child was reparented to the session subreaper before the capture, so it survived. rust-analyzer exits on EOF and on `exit` too, and its `cargo check` or proc-macro children would escape the same way. The session now holds an `OwnedTree` from spawn onwards. It refreshes the tree every 500 ms ◇, again right before `exit`, and at teardown before stdin closes. This affects G6, and the design's [Containment](design-lsp-stage-1-rust.md#containment) section could say so.
2. **A stop can race the handshake.** A stop that arrived between `Initializing` and sending `initialize` was recorded as `Failed: could not send initialize` instead of `Exited`. The launcher now defers to a stop that is already in progress. The terminate table covers this case.
3. **A server-request reply that cannot be written fails the session.** Replies may use the writer's reserve. If even the reserve is full, the session goes to `Failed` instead of leaving the request unanswered. This keeps "every server request gets exactly one response" true, at the cost of ending a session that is badly backed up.
4. **Crash detection relies on the server's stdout closing.** A descendant that inherits the server's stdout would delay crash detection until the tree is cleaned. rust-analyzer pipes its children's output, so this is unverified for the real server (see V14).
5. **Ownership precedence.** When several projects claim a file: an explicit include beats default membership; then the deepest project folder wins; then a project's main tree beats its config facet. Any remaining tie is reported as ambiguous, never guessed. The resolver receives the per-language extension tables from its caller (the frontend's `languageMeta`), so the backend holds no second copy. One test compares its single-path answers with the Explorer tree on disk for every file in a fixture. The existing frontend ownership lookups (for example `saveRestartPolicy.ts`) still use their own prefix logic. Moving them onto this resolver is 1b work.
6. **Routing needs a document filter.** Project membership includes `Cargo.toml`, `Cargo.lock` and explicitly included files. The router sends a file to the server only if the adapter's document extensions match (`rs` for Rust). The language still comes from `.craidd`; the extension only filters within the project.
7. **G1 in 1a is backend-only.** `LspRegistry::revalidate_and_ensure` covers "solution closing", "project no longer resolves", "attach to an existing identity" and "a changed toolchain or root is a new identity". The visible-and-active document check and the idle deferral are frontend work (1b).
8. **rust-analyzer defaults are provisional.** `files.watcher = "server"` (V1) and `cargo.targetDir = true` (V4) are written in the adapter but unverified.

### Merge gate

- `0d110f1` (foundation) needs no real server.
- `8f7801f` must not merge into `feat/intellisense-ws` until V1, V5, V6 and V7 are recorded against an installed `rust-analyzer` (the user installs it; Craidd never does). V8 is recorded.
- Stop and revisit the design if V1 shows rust-analyzer cannot watch files itself.

---

*Last updated: Phase 3 (Stage 1a). Author: ShinkuKira21.*
*This document is a record.*
