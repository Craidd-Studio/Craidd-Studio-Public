# Results: LSP Stage 1 — Rust foundation

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Record. Stage 1a is implemented and its fake-server evidence is recorded in [Stage 1a record](#stage-1a-record). Every gate is still **Unmeasured**: no gate's own evidence is complete. V1, V5 and V6 are verified against a real `rust-analyzer`; V7 is verified for the real binary only (see [V1, V5, V6 and V7 evidence](#v1-v5-v6-and-v7-evidence)).

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
| G1 | No server during startup or restore; bounded deferral; startup measured apart from server cost | **Fail** | U1, 2026-11-03: attempt 2, no server ever launched (`startupDone`, fixed in `700b59d`); attempt 3, the window crashes on the first attach (`view.server` undefined; fixed in `ead1a68`, verified 2026-11-08); gate measurements not yet rerun |
| G2 | One `rust-analyzer` per shared Cargo workspace | Unmeasured | Fake-server registry test reproduced; the real count needs U2 |
| G3 | Indexing never blocks interaction; separate target directory cost; Channel message rate and size | Unmeasured | Needs U12; completes in 1c |
| G4 | Rapid typing, file switching and a stalled consumer are bounded | Unmeasured | 1b fake and node evidence reproduced; completes in 1c |
| G5 | Diagnostics do not flood Monaco; diagnostic store size | Unmeasured | Needs U7 (hooks) |
| G6 | Closing a solution terminates its servers and their descendants | Unmeasured | The real tree is known (V14); Craidd-managed close and kill need U8 |
| G7 | Synchronisation correctness, document lifetimes and forced overflow | Unmeasured | Forced overflow and resync tests reproduced; UI cases need U9 |

---

## Milestone evidence

The three-stage plan is approved, so evidence is also recorded per stage. A stage's evidence never accepts a gate: a gate is accepted only when its own evidence is complete and Pass, and Stage 1 acceptance still needs every gate G1–G7 Pass.

| Gate | 1a evidence | 1b evidence | 1c evidence | Accepted |
|---|---|---|---|---|
| G1 | Partial: backend revalidation tests only (see Stage 1a record) | **Fail** (U1, 2026-11-03: attempt 2, no attach; attempt 3 at `700b59d`, the window crashes on the first attach) | n/a | Unmeasured |
| G2 | Recorded: identity tests against real `cargo` workspaces | Partial: `registry_shares_one_server_per_identity_and_solution_close_stops_all` reproduced; real count Unmeasured (U2) | n/a | Unmeasured |
| G3 (including G3b) | n/a | Unmeasured | Unmeasured | Unmeasured |
| G4 | Recorded: stalled consumer against the fake server | n/a | Unmeasured | Unmeasured |
| G5 | n/a | Unmeasured (U7 pending) | n/a | Unmeasured |
| G6 | Recorded: fake-server process tree, including a detached descendant | Partial: real descendants identified (V14) and none left after a protocol shutdown; Craidd close/kill Unmeasured (U8) | n/a | Unmeasured |
| G7 | n/a | Partial: `a_forced_writer_overflow_desyncs_then_resyncs_to_the_model_text_exactly_once` and the node sync tests reproduced; UI cases Unmeasured (U9) | n/a | Unmeasured |

Stage exit evidence (not gates):

| Stage | Exit evidence required | Status |
|---|---|---|
| 1a | Fake-server tests (framing, transport, delivery classes, overflow, pending table, capability validation, terminate table, process tree); DAP suite unchanged; verifications V1, V5, V6, V7, V8 recorded before the Rust adapter merges | **Partial.** Tests recorded and DAP suite unchanged; V1, V5, V6 and V8 verified. V7 is verified for the installed binary, but the rustup-shim case is Unverified (no rustup on this machine); whether that blocks the adapter merge is the architect's decision. |
| 1b | Real-server diagnostics through push and pull, document lifetimes and file identity; G1, G2, G5, G6, G7 evidence; first G3 and G3b measurements; verifications V2–V4 (V3 revised), V9, V13–V16, V22–V27 | **Held.** The repair pass and the decision 33 follow-up are verified. The manual UI review found that the IDE never attached a language server (`startupDone`, fixed in `700b59d` and verified). It then found that the IDE window crashes on the first attach (a status batch creates a partial session view before the attach reply). G1 is **Fail**, and every other UI-level item is held. See [Manual UI review](#manual-ui-review-2026-11-03-in-progress-held). |
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
| `rust-analyzer` version and how it was installed | 1a: **not installed**. Verification session (2026-10-27): `rust-analyzer 1 (9074e9b4c6 2026-09-06)`, Arch package `rust-analyzer 20260907-1` at `/usr/bin/rust-analyzer`, installed by the user with pacman. No rustup: Rust is Arch's packaged toolchain. |
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

Method (decision 23): the four timings and the process counts use the development-only hooks' timestamps; the `CRAIDD_LSP=0` baseline must exist in the 1b build. Without the hooks the timings stay **Unmeasured**.

Status: **Unmeasured**. No runs recorded.

## G2 — One server per shared workspace

Status: **Unmeasured**. No runs recorded.

## G3 — Indexing does not block interaction

Required, in addition to the main-thread and keystroke measurements: extra disk use, first-check time, and whether a Build issued during a check waits on the lock, with the separate target directory **on and off**. Also required: Channel message rate and bytes per second during initial indexing, and pull-request and wave volume with waves active (V26).

Method (decision 24): long-task counts if the WebKitGTK runtime exposes them; otherwise frame-gap and input-to-paint latency, recorded and labelled as substitutes with the method and limits. UI steps follow the scripted manual method (decision 25).

Status: **Unmeasured**. No runs recorded.

## G4 — Bounded typing, file switching and a stalled consumer

Required: the scripted typing and tab-switching runs, with at most one pull in flight per document and no pull per keystroke; and a run with the frontend consumer stalled during a diagnostics and progress flood, recording that the server's stdout kept draining, every response was delivered exactly once, every server request was answered, and the terminal status and each progress `end` were delivered after the consumer resumed.

Status: **Unmeasured**. No runs recorded.

## G5 — Diagnostics flood control

Required in addition: the stored diagnostic count (per route) and approximate store memory after a large check, and the `unchanged` to `full` ratio and wave volume (V26).

Method (decisions 22, 23): store writes and marker calls come from the development-only hooks. Also required: whether the default retention limits kept the complete `fx-many` set (about 2,400 pushed diagnostics), and if not, the limitation reported rather than a completeness claim.

Status: **Unmeasured**. No runs recorded.

## G6 — Solution close terminates servers and descendants

Required: the server's full process tree listed before and after, including `cargo` check processes and any proc-macro server it started. A surviving descendant is a Fail even if the main server process exited.

Status: **Unmeasured**. No runs recorded.

## G7 — Synchronisation correctness, document lifetimes and forced overflow

Required in addition to the editing cases: tab switching, model disposal and recreation with the tab open, reload from disk while the model is disposed, and a forced writer overflow during typing, each compared against the server's view of the text.

Method (decision 25): UI-level cases use the scripted manual method with the user's review; the server's text is rebuilt from the sync events Craidd sent.

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
| Diagnostics on document close: push set kept and markers restored from the store; pull set cleared (decision 18, approved) | Testing → Frontend | Unmeasured |
| **F2 regression:** `workspace/diagnostic/refresh` answered with `result: null`, exactly once, with pull enabled and disabled, with a stalled consumer, with a string id echoed; with pull enabled a bounded wave follows, with pull disabled no pull is sent | Testing → Rust (fake server, `asks` script) | Unmeasured (decision 16 approved) |
| Pull scheduling: debounce, one in flight per document, wave coalescing, visible-first order, concurrency cap, per-wave maximum, pull-needed on activation, no wave without an event | Testing → Rust and Frontend | Unmeasured (decision 19 approved) |
| **V24 regression:** no pull before readiness; an empty report before ready is discarded and never rendered as "no problems"; ready seeds one wave; empties after ready are authoritative; health `error` keeps reports non-authoritative; a reload re-arms the gate | Testing → Rust and Frontend (fake server) | Unmeasured (decision 20 approved) |
| **Workspace reload:** one bounded, coalesced `rust-analyzer/reloadWorkspace` after a successful affected `Cargo.toml` change; none when redundant, not Ready, failed save or identity change; timeout not fatal; manual restart intact. Recovery from a broken manifest against the real server | Testing → Rust (fake server) and Real server | Unmeasured (decision 21 approved conditionally) |
| **Retention wording and bounds:** truncation and eviction visible, next-check wording, no completeness claim without measurement | Testing → Frontend | Unmeasured (decision 22) |
| **Hooks off:** identical behaviour with the measurement hooks disabled; hooks never write to store, writer queue or pending table | Testing → Rust and Frontend | Unmeasured (decision 23) |
| **Silent failures:** `experimental/serverStatus` health `ok`, `warning`, `error` reaches the T record and the status chip; unknown or malformed bodies ignored and logged; message length bounded; health does not alter the session phase | Testing → Rust and Frontend | Unmeasured (decision 17 approved) |
| **Bounded stderr in Output:** stderr and `logMessage` stay in the bounded ring with the dropped-lines counter and error severity preferred | Testing → Rust | Unmeasured (decision 17 approved) |
| Completion context and `isIncomplete` mapping | Testing → Frontend | Unmeasured |
| Canonical identity with a symlinked directory | Testing → Frontend | Unmeasured |
| Accepting a completion with `additionalTextEdits` | Testing → Frontend | Unmeasured |
| Real-server smoke test, including the unopened-file change | Testing → Real server | Unmeasured |

---

## Pending verifications

Facts the design depends on but has not confirmed. They are not gates, but none may be assumed. Each is recorded with its evidence when checked. **Blocks** names what may not proceed until the item is recorded. `rust-analyzer` is not installed on the machine used to write the design, so every item that needs it also needs a user to install it first (Craidd never installs it).

| ID | Item | Blocks | Flip condition if it fails | Status |
|---|---|---|---|---|
| V1 | `rust-analyzer.files.watcher`: accepted values, and self-watching when the client registers no watchers; pinned version recorded | Rust adapter merge (1a) | The server cannot self-watch: watcher ownership must be redesigned and a Craidd watcher with `didChangeWatchedFiles` moves into Stage 1 | **Verified.** Accepted values are `client` (default) and `server`. With `server` and no registered watchers, the server picked up edits to an unopened file by itself. Stop condition not triggered. See [evidence](#v1-v5-v6-and-v7-evidence). |
| V2 | Watcher failure (for example the inotify limit): whether and how the server reports it | "Watcher failure surfaced" claim (1b) | The claim must be reworded | **Verified (server); surfacing Verified at the backend after the repair pass.** With watches exhausted, the server is silent on the protocol and writes only the stderr WARN (measured, 2026-10-29). In the repaired build, with `RA_LOG` unset as Craidd launches it, that line set the watcher warning 129 ms after start; health stayed `ok`, the phase stayed Ready, and two raw lines were kept for Output (2026-10-30). The chip and the Output display are confirmed only in U6 (see [Repair-pass verification](#repair-pass-verification)) |
| V3 | A change to an unopened file updates the server's diagnostics | Real-server smoke test (1b) | As V1 | **Partly measured.** The server-side intervals are measured; the interval to the store needs the scripted UI run U3. The server sends `workspace/diagnostic/refresh` about 40 ms after an external edit to an unopened file, within 1 ms of a `didChange`, and about 90 ms after a `didSave` (5 runs each). The store-side interval and whether the save seed adds anything are **Unmeasured** (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V4 | `cargo.targetDir` set to use a subdirectory of `target/` behaves as documented | Adapter options (1b) | Revert to the shared directory or find another isolation | **Partly verified.** `cargo.targetDir = true` makes the server use `target/rust-analyzer` (208 KiB on `fx-small`). Whether a user Build waits on the lock during a check is **Unmeasured**: a tiny crate cannot show it, so it moves to G3b on `src-tauri` (U12) (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V5 | The real `initialize` result (sync kind, save, `resolveProvider`, trigger characters) against the validation table | Rust adapter merge (1a) | Adjust the validation table | **Verified.** The real result passes the adapter's unchanged `caps::validate`: sync incremental, save plain, completion with resolve and 4 trigger characters, all four providers on. No table change needed. |
| V6 | The server accepts `utf-16` as the only offered position encoding | Rust adapter merge (1a) | Offer more encodings and re-encode | **Verified.** The server answers `positionEncoding: "utf-16"`, and a hover after a non-BMP character resolves at the UTF-16 column but not at the code-point column. |
| V7 | The rustup shim when the component is missing; the usable check treats a non-zero exit as failure | Toolchain role (1a) | Probe by another method | **Partly verified.** The real pacman binary exits 0 from `--version` with a usable first line, so the usable check offers it. The rustup-shim case is **Unverified**: this machine has no rustup, and a pacman install has no shim. The shim shape is covered only by the scripted stand-in test. Existing roles still ignore the exit status. **Architect decision:** the installed-binary case is accepted as passed for the current environment; the shim case stays Unverified and is a release qualification requirement (see [Architect decision on V7](#architect-decision-on-v7)). |
| V8 | `cargo metadata --no-deps` never creates or rewrites `Cargo.lock`; its failure modes and typical duration | Rust adapter merge (1a) | Workspace root discovery must change (breaches the no-silent-mutation rule) | **Verified** for cargo 1.99.1. Stop condition not triggered. See [V8 evidence](#v8-evidence). |
| V9 | The model URI from `@monaco-editor/react` for `path={fileId}`; what happens to a model when a view unmounts or `path` changes; which model events fire | Document lifetimes (1b) | Adjust the bridge's model observation | **Unverified.** Needs the scripted UI run U11. The node tests on document lifetimes pass (23 new), but they do not show Monaco's real model URI or its events |
| V10 | Monaco: whether accept waits for a pending resolve; behaviour when resolve fails; whether a post-accept command can revert | Atomic acceptance (1c) | Use eager mode (F2); if V18 also fails, completion cannot ship | Unverified |
| V11 | Monaco's incomplete-list flag name and re-request behaviour on 0.56.x; the completion context fields available | Completion requests (1c) | Document the limitation; no `isIncomplete` benefit | Unverified |
| V12 | Primary and additional edits undo as one step | Atomic acceptance (1c) | Apply them as one grouped edit | Unverified |
| V13 | `window/showMessageRequest` answered with no selection | Server-to-client requests (1b) | Different handling for that request | **Unverified against the real server** (still not provocable). The fake-server test `f3_show_message_request_before_initialize_reply_is_answered_once` passes. Of the four F3 edge cases proposed, one is built: before the `initialize` reply. Still missing: no `type` and no actions, a stalled consumer, and a string id |
| V14 | Names and number of child processes the server starts (for the G6 process-tree check) | G6 | Adjust the tree assertion | **Verified.** Descendants seen across runs: `cargo`, `rustc`, `collect2`, `ld.lld`, `x86_64-linux-gnu-gcc` and `/usr/lib/rust-analyzer-proc-macro-srv`, at most 7 at once. None remained after `shutdown`/`exit`. The G6 tree assertion must allow for linkers and the proc-macro server (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V15 | Whether the server republishes diagnostics on open, after a retention eviction | Retention policy (1b) | Evicted diagnostics cannot be recovered; tighten the policy | **Verified: no republish on open.** `didOpen` and a re-open after `didClose` publish nothing. Push is cargo-check only, at startup and after `didSave`. An evicted push set returns only with the next check. Whether complete sets fit a measured budget (decision 22) is **Unmeasured** (G5, U7) (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V16 | How the server reports locations for symlinked paths; the four symlinked-vendor navigation cases | File identity (1b) | Revisit the holder and navigation rules | **Partly verified (server).** Go-to-definition returns locations in the path form the server was given (`src/linked/deep.rs`, `vendor/vend/src/lib.rs`), not canonicalised. A hover in the same file opened through its canonical path (`real_mods/deep.rs`) returned nothing. The build sends the opened path as the URI and uses the canonical path only to choose the holder, so a canonical-path holder may get no server features (inferred; U10). The navigation cases (a)–(d) move to 1c with go-to-definition (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V17 | A single file-to-owning-project resolver exists or is introduced | Router (1a) | Introduce it as the first 1a task | **Introduced:** `crate::ownership::owning_project`. Frontend callers are not migrated yet (see the Stage 1a record). |
| V18 | When the client does not declare lazy `additionalTextEdits`, the server sends them in the completion list | Eager mode fallback (1c) | Fallback F2 is unavailable | Unverified |
| V19 | Whether Preferences renders a new catalog role automatically | Toolchain role (1a) | Add the row | **Verified: it does not.** `PreferencesDialog.tsx` has a hardcoded role list; `language_server` was added to Rust's. |
| V20 | Diagnostic store size and memory under a large check (this is a G5 measurement) | Retention limits (1b) | n/a | Unmeasured |
| V21 | Save-triggered check responsiveness and CPU contention with a concurrent Build (this is G3b) | None | Consider CPU priority or withholding `didSave` | Unmeasured |
| V22 | Whether the server returns a `resultId` and answers `unchanged`; its `retriggerRequest` data on cancellation; its answer to `$/cancelRequest` on a pull | Pull request handling (1b) | Send no `previousResultId`; every pull is full | **Verified.** `resultId` is always `"rust-analyzer"`, and the server never answers `unchanged`, even with a matching `previousResultId`. `$/cancelRequest` on a pull gets `-32800 "canceled by client"`. A pull overtaken by a `didChange` gets `-32802` with `{"retriggerRequest": true}`. The opt-in tests reproduce the `full`-again behaviour (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V23 | With `refreshSupport` advertised: when the server sends `workspace/diagnostic/refresh` | Refresh trigger (1b) | Refresh is not a sufficient trigger; rely on the others | **Verified (server).** 5 runs, identical pattern. Refresh arrives: twice at about 0.5 s, before the workspace is ready, and once about 90 ms after `quiescent: true`; about 40 ms after an external edit to an unopened file; within 1 ms of `didChange`; about 90 ms after `didSave`; twice around a `Cargo.toml` change. Refresh is therefore a sufficient trigger for the "edited while Craidd stays focused" case at the server. Whether Craidd's wave reacts is U3 step 5 (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V24 | What a pull returns before the workspace has loaded | Pull on open (1b) | Gate the first pull on readiness | **Verified, and decision 20 holds against the real server.** A pull 2 ms after `didOpen` returned `{"kind":"full","items":[]}` while status said `quiescent:false`. After readiness (2.6 s) the same file reported 2 × E0061. In 3 opt-in runs of the build, the gate refused the early pull and the first pull after readiness carried E0061 (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V25 | How often pull and cargo-check report the same error | None (informs a later dedup) | n/a | **Verified** on `fx-many` (10 files): each file had 20 pull diagnostics (`rust-analyzer` E0061) and 61 push diagnostics (`rustc`). Every pulled error is also reported by cargo check. The 61 include rustc's sub-diagnostics, so `fx-many` pushes about 7320 in total, not about 2400 (see [Stage 1b verification record](#stage-1b-verification-record)) |
| V26 | Wave request volume and performance effect (a G3/G3b and G5 measurement) | G3, G5 (1b) | Tighten the wave bounds | **Unmeasured.** It needs the wire tap plus hooks during scripted editing (U3, U7, U12) |
| V27 | `experimental/serverStatus` lifecycle with Craidd's advertisement: values, return to `ok`, `quiescent`, message length; recovery from a broken manifest | Server health surfacing and workspace reload (1b) | Rely on bounded log reporting alone; narrow or drop the reload | **Verified (real server), with the decision 21 narrowing confirmed.** Values seen: healthy: `ok`/false, then `ok`/true; failed load: `error` "Failed to load workspaces."; missing proc-macro server: `warning` (392 characters, including an absolute path). Recovery: **Broken mid-session:** `error` 0.19 s after the break, `ok` 0.26 s after the fix, no reload (probe). Also reproduced in 3 opt-in runs of the build. **Broken from the start:** no recovery without a reload (90 s probe, 15 s in the build); one reload recovered in 94–108 ms (3 runs). The trigger path (a `Cargo.toml` save in Craidd) is **Unverified** until U5 (see [Stage 1b verification record](#stage-1b-verification-record)) |

Pull diagnostics are no longer deferred: they moved into Stage 1b ([design](design-lsp-stage-1-rust.md#pull-and-push-diagnostics)).

Methods for the 1b verifications are fixed by the architect's decisions 23–27: development-only read-only hooks and `CRAIDD_LSP=0`; frame-gap and input-to-paint substitutes where WebKitGTK exposes no long tasks (recorded as substitutes); scripted manual UI verification reviewed by the user (recorded as "manual, scripted"); a helper process for the file-watch-limit test (V2). The verification tooling stays on `verify/lsp-stage-1b` and is not merged. Definitions of V22–V27 are in the design's [verifications for pull diagnostics](design-lsp-stage-1-rust.md#verifications-for-pull-diagnostics).

Deferred and not tracked as blockers: bounded automatic restart, a missing standard-library-source message, a Craidd-native file watcher (unless V1 or V3 fails), and any new UI surface.

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

### V1, V5, V6 and V7 evidence

Verification session, 2026-10-27. The probe was a Python LSP client in the verification lane's scratch directory. It sent the adapter's exact `initialize` params from `8f7801f`: `caps::client_capabilities(false)`, the `session::handshake` fields and `rust_adapter::default_init_options()`. It answered server requests with the same table as `session::answer_server_request`, and the configuration answer was `{"rust-analyzer": <init options>}`. The test crate is a binary with `src/main.rs` and `src/util.rs`. `main.rs` imports and calls `util::ok()`, and one of its lines puts `"😀"` before `util::ok()`. Only `main.rs` was opened (`didOpen`); `util.rs` was never opened. No code was changed.

**V1 — file watching.**

- `rust-analyzer --print-config-schema`: `files.watcher` is an enum of `client` (default, "Use the client (editor) to watch files for changes") and `server` ("Use server-side file watching"). `cargo.targetDir` accepts null, a boolean or a string.
- Watcher `server` (the adapter default), with no `workspace.didChangeWatchedFiles` capability advertised:
  1. After indexing went quiet, `util.rs` was edited on disk (`ok` renamed) with no notification of any kind.
  2. The server log shows a `Vfs` event and a new database revision for the edit, and again for the revert.
  3. A hover on `util::ok` in `main.rs` returned the function signature before the edit, `null` after it, and the signature again after the revert. Go-to-definition after the edit returned `[]`.
  4. The server therefore saw the unopened file's changes by itself.
- Contrast: with watcher `client` and the same capabilities, the server also self-watched (same hover result). It falls back to its own watching when the client offers no `didChangeWatchedFiles` registration. The adapter's explicit `server` value removes that reliance on fallback.
- Server log: `WARN notify error: No path was found.` appeared twice during the initial load. It did not affect watching. It may be relevant to V2.
- **Stop condition not triggered.**

**V5 — `initialize` result.** Raw capability fields from the real server:

| Field | Value |
|---|---|
| `positionEncoding` | `"utf-16"` |
| `textDocumentSync` | `{"openClose": true, "change": 2, "save": {}}` |
| `completionProvider` | `{"triggerCharacters": [":", ".", "'", "("], "resolveProvider": true, "completionItem": {"labelDetailsSupport": false}}` |
| `hoverProvider`, `definitionProvider`, `referencesProvider`, `documentSymbolProvider` | `true` |
| `diagnosticProvider` | `{"identifier": "rust-analyzer", "interFileDependencies": true, "workspaceDiagnostics": false}` |
| `serverInfo` | `rust-analyzer`, `1 (9074e9b4c6 2026-09-06)` |

The result was then passed to `caps::validate` from `8f7801f`. The file was byte-identical to the commit (sha256 `027eba81…`), compiled on its own against serde and serde_json. The summary line it produced:

`sync Incremental, save Plain, completion on (resolve on, 4 trigger characters), hover on, definition on, references on, symbols on`

Its only note was "pull diagnostics offered; not used in Stage 1". `save: {}` maps to `Plain` (no `includeText`), so `didSave` is sent without text, as the design intends.

**V6 — position encoding.**

- The server chose `utf-16`, the only encoding offered, and the handshake passes validation.
- On line 4 (zero-based), `ok` starts at UTF-16 column 32, code-point column 31 and byte column 34.
- A hover at column 32 returned the signature with range 32–34. A hover at column 31 returned `null`.
- The server therefore counts columns in UTF-16 code units.

**V7 — usable check.**

- `/usr/bin/rust-analyzer --version` exits 0 and prints `rust-analyzer 1 (9074e9b4c6 2026-09-06)` on stdout, so `probe_usable` offers it.
- `command -v rustup` finds nothing, and `~/.cargo/bin` holds no `rust-analyzer`. A pacman install has no rustup proxy, so the missing-component shim cannot occur here and could not be measured.
- The shim's exit status is covered only by the scripted stand-in test, `a_language_server_that_fails_its_version_probe_is_not_usable`. **Unverified against a real shim.**

**Observations outside the 1a checks (for 1b, not verdicts):**

1. **Push diagnostics were not republished after the unopened-file edit.** With `main.rs` open, the edit broke its import. The server's model changed (V1), but no new `publishDiagnostics` for `main.rs` arrived within 60 s. A cold start with the edit already present does publish them: ``unresolved import `util::ok` ``, ``no `ok` in `util` `` and rustc's ``cannot find function `ok` in module `util` ``. This is an early signal against **V3**, not its formal test. V3 should be designed around it, for example by checking whether diagnostics refresh on the next `didChange` or `didSave`.
2. **The server sends `workspace/diagnostic/refresh`** about 2 s after `initialize`, even though the client did not advertise `workspace.diagnostics.refreshSupport`. The static table has no entry for it, so it is answered with `-32601 Unhandled method`. The server carried on normally. Whether to add an explicit `null` reply is for the Implementation lane and the architect. It is not a 1a failure: every server request still got exactly one response.
3. Server requests seen in all runs: `window/workDoneProgress/create` and `workspace/diagnostic/refresh`. No `client/registerCapability`, `workspace/configuration` or `window/showMessageRequest` arrived. V13 is therefore still unexercised.
4. `shutdown` then `exit` ended the server with exit code 0 in every run.

### Findings from implementation (for review)

These are behaviours the design did not spell out, or found to need. They are implemented as described. Each needs the architect's decision before the design text is changed.

1. **The process tree must be tracked before the server can exit.** A first version captured the tree at teardown, after closing the server's stdin. The fake server exited on that EOF, and its detached child was reparented to the session subreaper before the capture, so it survived. rust-analyzer exits on EOF and on `exit` too, and its `cargo check` or proc-macro children would escape the same way. The session now holds an `OwnedTree` from spawn onwards. It refreshes the tree every 500 ms ◇, again right before `exit`, and at teardown before stdin closes. This affects G6, and the design's [Containment](design-lsp-stage-1-rust.md#containment) section could say so.
2. **A stop can race the handshake.** A stop that arrived between `Initializing` and sending `initialize` was recorded as `Failed: could not send initialize` instead of `Exited`. The launcher now defers to a stop that is already in progress. The terminate table covers this case.
3. **A server-request reply that cannot be written fails the session.** Replies may use the writer's reserve. If even the reserve is full, the session goes to `Failed` instead of leaving the request unanswered. This keeps "every server request gets exactly one response" true, at the cost of ending a session that is badly backed up.
4. **Crash detection relies on the server's stdout closing.** A descendant that inherits the server's stdout would delay crash detection until the tree is cleaned. rust-analyzer pipes its children's output, so this is unverified for the real server (see V14).
5. **Ownership precedence.** When several projects claim a file: an explicit include beats default membership; then the deepest project folder wins; then a project's main tree beats its config facet. Any remaining tie is reported as ambiguous, never guessed. The resolver receives the per-language extension tables from its caller (the frontend's `languageMeta`), so the backend holds no second copy. One test compares its single-path answers with the Explorer tree on disk for every file in a fixture. The existing frontend ownership lookups (for example `saveRestartPolicy.ts`) still use their own prefix logic. Moving them onto this resolver is 1b work.
6. **Routing needs a document filter.** Project membership includes `Cargo.toml`, `Cargo.lock` and explicitly included files. The router sends a file to the server only if the adapter's document extensions match (`rs` for Rust). The language still comes from `.craidd`; the extension only filters within the project.
7. **G1 in 1a is backend-only.** `LspRegistry::revalidate_and_ensure` covers "solution closing", "project no longer resolves", "attach to an existing identity" and "a changed toolchain or root is a new identity". The visible-and-active document check and the idle deferral are frontend work (1b).
8. **rust-analyzer defaults.** `files.watcher = "server"` is verified (V1). `cargo.targetDir = true` is accepted by the server's config schema, but its behaviour is unverified (V4, 1b).

### Merge gate

- `0d110f1` (foundation) needs no real server.
- `8f7801f` was gated on V1, V5, V6 and V7 being recorded against an installed `rust-analyzer` (the user installs it; Craidd never does). V1, V5, V6 and V8 are now **Verified**. V7 is verified for the installed binary; only the rustup-shim case remains Unverified.
- ~~**Decision for the architect:** accept V7 as recorded, or require rustup before the merge.~~ **Decided:** see below.
- The V1 stop condition was checked and **not triggered**.

### Architect decision on V7

Recorded from the architect's decision after the V1, V5, V6 and V7 evidence above.

- **V7, installed binary:** accepted as **passed for the current environment** (pacman `rust-analyzer 20260907-1`, no rustup).
- **V7, rustup shim:** remains **Unverified** (scripted stand-in tested only). V7 is not marked fully Verified, and not Not Applicable.
- **Release qualification requirement:** the real rustup-shim case must be verified in an isolated environment before Craidd claims complete Stage 1 support for rustup installations.
- **No workaround:** implementation must not silently change toolchain discovery semantics to work around this requirement.
- **Adapter merge:** integrating `8f7801f` into `feat/intellisense-ws` is **conditionally approved**, subject to clean integration, the relevant regression tests passing, and no outstanding mandatory adapter gates.
- **Scope:** no expansion into Stage 1b or 1c, no push, and no merge to `master` without further approval.

### Adapter integration

- **Integrated:** the Rust adapter (`8f7801f` on `claude/blissful-hopper-bc6a74`) landed on `feat/intellisense-ws` as **`99863a4`**, on top of `6f3b1bf`. Only the adapter commit was taken; the branch's copy of this record (`ff60aa9`) was not.
- **Tests, Implementation-reported:** 195 library, 7 process-cleanup and 26 DAP tests passing after integration. These counts are as reported by the Implementation lane and have **not been independently re-run**.
- The rustup-shim case of V7 remains Unverified and a release qualification requirement, as decided above.

### Follow-up investigations

The three early warnings from the V1–V7 runs are kept as separate investigations. None is a 1a failure, and none is resolved by this record.

| # | Investigation | Source | Status |
|---|---|---|---|
| F1 | **V3:** diagnostics for an open file were not republished after an external change to an unopened file it imports | Observation 1 above | **Investigated: V3 Failed for push-only.** The server's own diagnostics are pull-only in this version. See [F1](#f1--what-republishes-diagnostics-v3). **Architect decision: pull diagnostics move into Stage 1b**; see the [design](design-lsp-stage-1-rust.md#pull-and-push-diagnostics). |
| F2 | **`workspace/diagnostic/refresh`:** determine whether an explicit response is required by the negotiated protocol, given the client did not advertise `refreshSupport` | Observation 2 above | **Investigated: Verified.** A reply is mandatory; `null` is the spec's success value. rust-analyzer treats `null` and the current error identically. **Architect decision: approved (decision 16)**: reply `null`, and schedule a bounded refresh when pull is enabled; regression coverage is listed under Required test evidence. See [F2](#f2--workspacediagnosticrefresh). |
| F3 | **V13:** no `window/showMessageRequest` arrived from the real server. Await a reproducible real-server request, or construct a targeted protocol test | Observation 3 above | **Investigated: V13 Unverified (not reproducible).** `workspace/configuration` measured; `registerCapability` never arrived. New finding: startup failures are silent on the protocol. **Architect decision: approved (decision 17)**: option (a), with bounded stderr and error-log reporting as the fallback; coverage is listed under Required test evidence; lifecycle verification is V27. See [F3](#f3--showmessagerequest-configuration-and-registration-v13). |


### F1–F3 evidence

Investigation session, 2026-10-28, on `4d61dd0` (adapter `99863a4`). Server: `rust-analyzer 1 (9074e9b4c6 2026-09-06)`, Arch package `rust-analyzer 20260907-1`; cargo and rustc 1.99.1 (Arch). The same probe client as the V1–V7 session, extended into scenario scripts. It used the client capabilities, init options and server-request table of `4d61dd0`, and each scenario got a fresh copy of the two-file test crate. No code was changed.

**Measured** means observed on the wire or in the server log in these runs. **Inferred** means reasoned from the spec or from the behaviour, not observed directly.

#### F1 — What republishes diagnostics (V3)

**Setup.** `main.rs` was open. `util.rs` was never opened and was edited on disk only. There were two kinds of break:

- **Import break** (as in the V1 run): renaming `ok` breaks `use util::ok`.
- **Argument-count break**: `ok()` gains a parameter. The server diagnoses this itself (E0061).

**Results.** All measured; each row is one fresh server.

| Trigger after the on-disk edit | Push for `main.rs`? | What arrived |
|---|---|---|
| Nothing; waited 175 s (both breaks) | No | Only the initial empty publish at about 0.5 s |
| Nothing, with `workspace/diagnostic/refresh` answered `null` instead of an error (both breaks) | No | Same |
| `didChange` on `main.rs` (a newline appended at the end; both breaks; and with the refresh answered `null`) | No, within 60 s | Same |
| `didOpen` of `util.rs` | No, within 60 s | Same |
| `didSave` on `main.rs` | **Yes**, 0.08 s after `didSave` | `source: "rustc"` only. Import break: ``unresolved import `util::ok` ``, ``no `ok` in `util` `` and ``cannot find function `ok` in module `util` ``. Argument break: `this function takes 1 argument but 0 arguments were supplied`, plus its sub-diagnostics. |
| `textDocument/diagnostic` (pull) on `main.rs`, sent without the client advertising pull | Push: no. **Pull reply: yes, immediately** | Argument break: `{"kind": "full", "items": [{"source": "rust-analyzer", "code": "E0061", …}]}`. Import break: `items: []`; the server's own analysis does not flag that import, only `rustc` does. |

**Control: does the server ever push its own diagnostics?** An error was typed into the open `main.rs` itself: `didChange` from `util::ok()` to `util::ok(1, 2)`.

| Client capabilities | Push with items within 30 s | Pull reply |
|---|---|---|
| Craidd's (no `textDocument.diagnostic`) | **No**; only the initial empty publish | `rust-analyzer` E0061 `expected 0 arguments, found 2` |
| Craidd's plus `textDocument.diagnostic` | **No**; no publish at all | Same |

The config schema has no push/pull switch. `diagnostics.enable` (default true) only turns the server's own diagnostics on or off.

**Conclusions.**

1. **Measured:** this rust-analyzer build delivers its own diagnostics only through pull, whatever the client advertises. Push carries only cargo-check (`rustc`) diagnostics, which run at startup and after `didSave` (`checkOnSave` defaults to true).
2. **Measured:** a change to an unopened file updates the server's model (V1) and the pull answer, but produces no push until the next `didSave`, and then only cargo-check results.
3. **Inferred:** the empty publish at about 0.5 s is cargo check's initial clear. The cold-start errors in the V1 run were also all `rustc`; this explains why they appeared and the live update did not.
4. **Push-only diagnostics cannot satisfy V3.** With push alone, Craidd would show no rust-analyzer diagnostics at all, only cargo-check results, refreshed on save. Measured for this version; whether other versions behave the same is not checked.
5. **What the design would need (for the architect; not designed here).** Pull diagnostics, currently "deferred, not tracked as a blocker", move into Stage 1b:
   - **Advertise** `textDocument.diagnostic` and `workspace.diagnostics.refreshSupport`.
   - **Pull** `textDocument/diagnostic` for open documents: on open, after `didChange` (debounced), and on `workspace/diagnostic/refresh`.
   - **Use `resultId`** so an unchanged answer is cheap.
   - **Keep two sources per file**, pull (server) and push (cargo check), merged at display. A4 already separates sources.
   - **Bound and cancel** pull requests like other requests.

   The alternative is accepting save-only, cargo-check diagnostics in Stage 1. That keeps the push design but shows nothing between saves. A4 and the "pull diagnostics deferred" line would change in either case.

#### F2 — `workspace/diagnostic/refresh`

**Spec, LSP 3.17 (quoted).**

- Requests: "Every processed request must send a response back to the sender of the request." A void result: "The result property of the ResponseMessage should be set to `null` in this case to signal a successful request."
- Diagnostics Refresh: `params: none`, `result: void`, error "code and message set in case an exception happens during the 'workspace/diagnostic/refresh' request".
- The client capability `workspace.diagnostics.refreshSupport` is described as "Whether the client implementation supports a refresh request sent from the server to the client."

**Measured.**

- The server sent `workspace/diagnostic/refresh` exactly once per run, 0.4–3.8 s after start, in every scenario with a valid workspace. Craidd does not advertise `refreshSupport`.
- With the current `-32601 Unhandled method` reply and with a `null` reply, the server's log has no line about the response, it sends no retry, and the scenario results are identical (F1 table).
- Exit code was 0 in every run.

**Conclusions.**

1. **A response is mandatory**, because it is a request. The spec gives `null` as the success value; an error is for an exception while handling it.
2. **Inferred:** the server should not send this request without `refreshSupport`. Sending it anyway is a server deviation, not a Craidd fault, and it makes no difference to rust-analyzer which reply it gets.
3. **Recommendation for the Implementation lane:** add `workspace/diagnostic/refresh` → `Ok(Value::Null)` to the static table in `session::answer_server_request`, with a test in the `asks` fake-server script. Reasons:
   - `null` is the spec's success value. `-32601` claims the method is unknown, which is wrong for a method the protocol defines.
   - It keeps server stderr clean if a future version starts logging failed replies.
   - If F1's pull model is adopted, this request becomes the trigger to re-pull the visible documents. At that point Craidd must also advertise `refreshSupport`.
4. **Not a 1a defect:** every server request still gets exactly one response.

#### F3 — `showMessageRequest`, configuration and registration (V13)

**Scenarios.** Each scenario used Craidd's capabilities unless stated otherwise. All measured.

| Scenario | `window/showMessageRequest` | `window/showMessage` | Other server requests | How the failure surfaced |
|---|---|---|---|---|
| Malformed `Cargo.toml` | none | none | progress only | stderr only: `failed fetching cargo workspace root … unclosed table` |
| Same, plus `experimental.openServerLogs` and `window.showMessage.messageActionItem` (not Craidd's) | none | none | progress only | stderr only |
| No `Cargo.toml` anywhere | none | none | progress only | stderr only: `failed to find any projects`, `FetchWorkspaceError` |
| `cargo.sysroot = "/nonexistent/sysroot"` | none | none | refresh | stderr only |
| A proc-macro crate with `procMacro.server = "/nonexistent/proc-macro-srv"` | none | none | refresh | stderr only |
| Same proc-macro crate, default server | none | none | refresh | — (works) |
| `workspace/didChangeConfiguration {"settings": {}}` after startup | none | none | **`workspace/configuration`** `{"items": [{"section": "rust-analyzer"}]}`, 6.05 s, answered from the table | — |
| Malformed `Cargo.toml`, plus `experimental.serverStatusNotification` (not Craidd's) | none | none | — | `experimental/serverStatus`: `{"health": "error", "quiescent": true, "message": "Failed to load workspaces."}` |
| Missing proc-macro server, plus `experimental.serverStatusNotification` (not Craidd's) | none | none | — | `experimental/serverStatus`: `{"health": "warning", "message": "Failed spawning proc-macro server … No such file or directory"}` |

`client/registerCapability` never arrived in any F1, F3 or V1–V7 run. **Inferred:** Craidd sets `dynamicRegistration: false` everywhere, and `files.watcher = "server"` removes the one registration rust-analyzer would otherwise make (watched files).

**Conclusions.**

1. **V13 stays Unverified.** No real `showMessageRequest` was reproducible in 9 scenarios. The fake-server test `server_requests_are_answered_by_the_backend_alone` already checks the no-selection reply (`id 1004` → `result: null`, one notice, message logged). Proposed additions for the Implementation lane, all in the fake server:
   1. A `showMessageRequest` with no `type` and no `actions`: the reply is `null` and the notice severity is 3.
   2. One sent while the server is `Initializing`, before the `initialize` reply: it must still be answered exactly once.
   3. One sent while the delivery consumer is stalled (reuse `flood`): the reply must not wait on the frontend (A3).
   4. A string `id`, echoed back verbatim.
2. **`workspace/configuration` is now measured.** It arrives after `didChangeConfiguration`, never at startup, and the static table answers it with the adapter's init options under `rust-analyzer`.
3. **New finding, outside F1–F3, for the architect.** With Craidd's capabilities, a failed workspace load or proc-macro server is **silent on the protocol**: no `showMessage`, no `logMessage`, no diagnostic, only stderr. This conflicts with amendment A2's proposed wording ("A failure to start … is visible to the user"). Options, none designed here:
   - **(a)** Advertise rust-analyzer's `experimental.serverStatusNotification` and show `health` and `message` in the existing language-server status (measured to work).
   - **(b)** Surface the server's stderr `ERROR` lines in Output.

   (a) is server-specific, through the adapter; (b) is generic.

---

## Stage 1b implementation record

Implementation lane, branch `feat/lsp-stage-1b` on `242c3fd`. This section records what was built and the implementation's own test evidence. It does not record any gate as Pass: G1, G3, G5, G6 (real tree) and G7 stay **Unmeasured** until the Verification lane records them.

### What was built

| Piece | Where |
|---|---|
| Document table: versions, epochs, desync without replay, atomic `didClose` + `didOpen` resync, event-driven retry on writer drain, Unresponsive bound | `lsp/documents.rs`, `lsp/session.rs`, `FrameWriter::try_send_all` / `spawn_with_drain` |
| Pull diagnostics capability and `diagnosticProvider` validation; `workspace/diagnostic/refresh` answered `null` (decision 16) | `lsp/caps.rs`, `lsp/session.rs` |
| `experimental/serverStatus` in the status record (decision 17); readiness gate (decision 20); coalesced workspace reload (decision 21) | `lsp/protocol.rs`, `lsp/delivery.rs`, `lsp/session.rs`, `lsp/rust_adapter.rs` |
| Tauri surface, per-window manager, acknowledged Channel delivery, `CRAIDD_LSP=0` | `lsp/commands.rs` |
| Tab-owned document tracker, wave scheduler, route-separated diagnostic store | `src/lib/lsp/documents.ts`, `pulls.ts`, `diagnostics.ts` |
| Monaco bridge, deferred launch, per-frame store writes and markers | `src/lib/lsp/bridge.ts`, `src/store/lspStore.ts` |
| Status chip, Output source, Problems badges and per-source counts | `StatusBar.tsx`, `BottomPanel.tsx` |
| Development-only measurement hooks (decisions 23, 24) | `src/lib/lsp/metrics.ts` |

### Test evidence

| Suite | Result |
|---|---|
| `cargo test --lib` | 215 passed, 0 failed, 7 ignored (62 in `lsp::`) |
| `cargo test --test process_cleanup` | 7 passed, 0 failed, 1 ignored |
| DAP suite (`commands::debug`) | 26 passed, unchanged |
| `node --test tests/*.test.mjs` | 107 passed (23 new in `lspDocuments` and `lspDiagnostics`) |
| `tsc --noEmit`, `vite build` | clean |

Fake-server regression tests added: F2 `null` reply with pull on and off, string ids and a stalled consumer; F3 `showMessageRequest` before the `initialize` reply; server health by shape, bounded message, phase unchanged; incremental UTF-16 sync and `resultId` handling; `retriggerRequest`; session death; a forced writer overflow resynchronised to the model text exactly once; stale pushes dropped; the readiness gate including health `error` and re-arming after a reload; one pull in flight per document; coalesced reloads.

### Real-server smoke runs (opt-in tests)

`cargo test --lib real_rust_analyzer -- --ignored --nocapture`, against `rust-analyzer 1 (9074e9b4c6 2026-09-06)`, two runs each, one fixture crate. Measured:

- Ready 25 ms after start; workspace quiescent at about 1.9 s; a pull before that was refused by the gate.
- The first pull returned `full`, `resultId` `"rust-analyzer"`, with `rust-analyzer` E0061. A second pull with that `previousResultId` returned `full` again, not `unchanged` (agrees with the Verification lane's V22 dry run).
- After `didSave`, push carried three `rustc` diagnostics 87 ms later.
- **V27, two cases.** A manifest broken mid-session and then fixed: health went `error` ("Failed to load workspaces.") and returned to `ok` within 10 s with no reload. A manifest broken from the start and then fixed: health stayed `error` for 15 s; after one `rust-analyzer/reloadWorkspace` it returned to `ok` in about 100 ms. The reload trigger therefore applies only while health is not `ok` (decision 21 allows this narrowing).

### Provisional values (◇) and where they came from

None is set from measured evidence yet; V26, G3 and G5 are unmeasured.

| Value | Set to | Source |
|---|---|---|
| Pull debounce | 300 ms | Initial proposal |
| Pulls in flight per session | 4 | Initial proposal |
| Documents per wave | 12 | Initial proposal |
| Wave spacing | 250 ms | Initial proposal |
| Focus interval | 2 s | Initial proposal |
| Retrigger re-arms | 3 | Initial proposal; V22 says retrigger fires during normal typing |
| Consecutive pull failures before "degraded" | 5 | Initial proposal |
| Deferred-launch maximum wait | 1.5 s | Initial proposal |
| Writer low-water mark | 64 of 128 | Initial proposal |
| Resync Unresponsive bound | 10 s | Design ◇ |
| Delivery batch | 256 events, 1 MiB, 500 log lines | Initial proposal (design: from G3) |
| Pull timeout, reload timeout | 30 s, 60 s | Initial proposal |
| Health message cap | 2,048 bytes | Initial proposal |
| Retention: per file, closed files, closed total | 500, 2,000, 20,000 | Initial proposal (design: from G5 / V20) |
| Problems rows rendered | 500 | Initial proposal |

### Findings from implementation (for review)

1. **Wave tests live in the frontend.** The scheduler needs visibility, recency and Monaco's `versionId`, which only the frontend has, so it is a frontend module. Its wave tests run under `node --test` with a scripted transport. The backend parts (refresh counter, pull requests, gate) are covered by fake-server tests.
2. **Versions are assigned in the backend's document table**, where the enqueue happens, not in the bridge. The stale key `(epoch, versionId)` is unchanged.
3. **Lock glyph not built.** Nothing in Stage 1b opens an unowned file: that comes only from go-to-definition (1c). The read-only rule and glyph land with navigation.
4. **Attribution of unopened files** (push sets for files with no tab) uses the deepest project folder that contains the path, not the full membership resolver. Open documents use the backend resolver.
5. **V15 / decision 22 not measured.** Retention stays bounded with visible eviction and "+N not retained". Whether complete sets fit a measured budget needs a large cargo check (G5, V20), so it is not claimed.
6. **No-status servers.** Decision 20's bounded wait for servers without a status notification is not built; only Rust ships, and its adapter always declares the notification.

### Repair pass (architect-approved)

Commits `a054599`–`89c1acd` on `feat/lsp-stage-1b`, on top of `ea33c1e`. Implementation evidence only; nothing here marks Stage 1b or a gate Pass.

| Item | Change | Coverage |
|---|---|---|
| V2 watcher-limit warning (decision 28) | The fragment `OS file watch limit reached` (case-insensitive, on stderr or `logMessage` text) sets `watcherWarning` in the status record; the chip shows ⚠ with the raw line on hover; the line stays in Output. `notify error: No path was found.` does not match. | Unit and fake-server tests (stderr; `logMessage` text, any case; `showMessage` ignored; the bounded ring keeps the raw line); opt-in real-server test below |
| Attribution | Diagnostics for files with no tab are attributed by `crate::ownership::owning_project` through `lsp_attribute` (includes, nested-project boundaries, config-facet files, ambiguity), cached per solution and applied at display time. No folder inference. | Backend resolver tests: nested boundary, config facet, external, explicit include, ambiguous file; display test |
| Readiness fallback (decision 31) | If no `experimental/serverStatus` has arrived 30 s (◇) after Ready, the session is status-less: `readyFallback` opens the gate, a wave seeds the Open documents, the chip reads `rust-analyzer (no status)` with an explanation on hover, and Output logs `[lsp] the server sent no workspace status within 30 s of starting; …`. A status arriving later switches gating back to it. **Early-empty handling:** an empty report is authoritative only if its pull was sent with the gate open; the backend refuses pulls while the gate is closed, and the frontend discards an empty report whose pull was sent before readiness (the route stays unknown, so Problems shows results pending); a non-empty report always counts. | Fake-server status-less test; `isAuthoritative` / `gateOpen` test |
| Reload membership (decision 33) | Affected manifests are the root manifest the session started with and the package manifests of the last successful `cargo metadata` (kept after a break; a fresh result is added). If metadata never succeeded, only the root manifest counts; a broken member is then not recognised and recovery is the manual restart. A change that moves the workspace root is a new identity: the session restarts, never reloads. `Cargo.lock` and other files never trigger. Follow-up `008ce44` corrected R6a, which had accepted any `Cargo.toml` under the root in that state. | Negative tests: non-member manifest, nested separate crate (also with real cargo), manifests under `target/` and vendored crates, `Cargo.lock`, healthy-state save, unchanged content, not Ready; identity change → restart; reload timeout logged, session survives; gate re-arms on reload and the next ready report runs one wave |
| F3 | `showMessageRequest` with no type and no actions, a string id, sent while no delivery is consumed: answered once with `null`, id verbatim, severity-3 notice. | Fake-server test |
| Metrics on/off | `createMetrics(dev, host)`; the same scripted session gives identical wire traffic, stored diagnostics and scheduler statistics with dev on and off; with dev off nothing is installed, exposed or emitted. | Node tests |
| `inputToPaint` | Key press to the **second** animation frame after it (after the frame showing the edit is painted); an upper bound on the visible update by at most one frame. | Node test |

**Real-server runs** (`rust-analyzer 1 (9074e9b4c6 2026-09-06)`):

- **V2** (`real_rust_analyzer_v2_watch_limit_warns`, `RA_LOG` unset, the Verification lane's `inotify_hog.py` with a 60 s hold): the helper held 416,337 watches (ENOSPC, 65 free of 524,288). The warning reached the status record 125 ms after start, with health `ok` and phase Ready; two raw stderr lines were kept for Output. The helper released all its watches on termination.
- **Smoke rerun:** ready in 11 ms, quiescent in 1.3 s, a pull before readiness refused; first pull `full`, E0061; push after `didSave` in 79 ms (three `rustc`). V27: broken mid-session recovers by itself; broken from the start recovers 84 ms after one reload.

- **Status-less** (smoke tests with `rust-analyzer` on `PATH` replaced by a proxy that drops every `experimental/serverStatus`): the gate opened by the fallback after 30.2 s, the first pull then reported E0061, and both tests finished; the V27 parts are skipped because health is reported only through the status notification.
- **V2 warning lifetime:** the warning is per session and clears only when the session ends (a restart starts a clean record). Releasing the watches does not clear it, and the server sends no all-clear (decision 28).

- **Decision 33** (`real_rust_analyzer_decision_33_broken_root_ignores_a_nested_non_member`): with the root manifest broken from the start (membership never resolved), saving a nested non-member `Cargo.toml` gave affected `false`, no action, 0 reloads, health still `error`. Fixing the root manifest gave one reload and health `ok` 112 ms later.

**Test counts after the decision 33 follow-up:** `cargo test --lib` 228 passed, 9 ignored (75 in `lsp::`); `process_cleanup` 7 passed, 1 ignored; DAP suite 26 passed, unchanged; `node --test` 113 passed; `tsc` clean.

**Test counts after the repair pass:** `cargo test --lib` 223 passed, 8 ignored (70 in `lsp::`); `process_cleanup` 7 passed, 1 ignored; DAP suite 26 passed, unchanged; `node --test` 112 passed; `tsc` and `vite build` clean.

## Stage 1b verification record

Verification lane, independent of the Implementation lane. Run on 2026-10-29 against `feat/lsp-stage-1b` at `8620328`, in a separate detached checkout. Tooling is on `verify/lsp-stage-1b` (`verification/lsp-1b/`, decision 27: not merged here). No implementation code was changed.

**Environment.** Arch Linux, kernel 7.2.11, 32 logical CPUs, 60 GiB RAM. `rust-analyzer 1 (9074e9b4c6 2026-09-06)`, pacman `20260907-1`, no rustup. cargo and rustc 1.99.1 (Arch); node v24.21.0. `fs.inotify.max_user_watches` = 524288.

**Method.** There are three kinds of evidence, labelled throughout:

- **build:** the branch's own tests, re-run here.
- **probe:** a client sending the build's exact client capabilities (`caps::client_capabilities(false, {"serverStatusNotification": true})`, checked by hand) and init options to the real server.
- **inferred:** read from the code, not run.

UI-level items wait for the scripted manual runs in `verification/lsp-1b/UI-STEPS.md` (decision 25), which the user performs and reviews by eye.

### Implementation claims, reproduced

| Claim | Result here | Reproduced |
|---|---|---|
| `cargo test --lib`: 215 passed, 7 ignored, 62 in `lsp::` | 215 passed, 0 failed, 7 ignored; 62 `lsp::` passed, 3 ignored (two real-server tests and the fake server's entry) | Yes |
| `process_cleanup`: 7 passed, 1 ignored | 7 passed, 1 ignored | Yes |
| DAP suite 26, unchanged | 26 passed; `commands/debug*` byte-identical to `0d110f1` | Yes |
| `node --test`: 107, 23 new | 107 passed; `lspDocuments` + `lspDiagnostics`: 23 | Yes |
| `tsc`, `vite build` clean | `tsc --noEmit` exit 0; `vite build` succeeded (only the existing chunk-size and dynamic-import warnings) | Yes |
| Repeatability (not claimed) | `lsp::` tests: 10 consecutive runs, 10 passed | — |
| A pull before readiness is refused; ready at about 1.9 s | Refused in 3/3 runs; quiescent at 1360–1385 ms | Yes (timing differs by machine) |
| Push 87 ms after save | 83–86 ms (3 runs) | Yes |
| V27: a mid-session break recovers alone; a break from the start needs a reload, about 100 ms | Alone in 3/3; reload recovered in 94–108 ms in 3/3. My own probe agrees (0.26 s without a reload mid-session; none in 90 s from the start) | Yes |
| The hooks are development-only and read-only | `metrics.ts`: every hook is gated on `import.meta.env.DEV` and writes only its own counters (inferred) | Yes, by reading |

The opt-in tests call `reload_workspace` directly. The production trigger (`Cargo.toml` saved in Craidd → `lsp_manifest_changed`) is not exercised against the real server; that is U5.

### Real-server evidence for V24, V27 and decision 19

- **V24 / decision 20.** A pull 2 ms after `didOpen` returned an empty `full` report while `quiescent:false`. The same file has 2 × E0061 once ready, so the gate is necessary. The build's gate refused the early pull in all runs. Refresh requests arrive twice before readiness (about 0.5 s); the gate must keep ignoring them for authority, which the node test "decision 20: becoming ready drops reports of earlier pulls" covers.
- **V27 / decision 21.** Mid-session recovery happens without a reload; a break present from the start needs one. This confirms decision 21's narrowing (reload only while health is not `ok`).
- **Decision 19 refresh.** Refresh follows every kind of change at the server, within milliseconds (V23 row). The accepted limitation "edited while Craidd stays focused" is covered at the server level. Whether the build's wave turns those refreshes into pulls in the IDE is U3 step 5.

### Failures

1. **Watcher-failure surfacing is not built (1b scope; design UI table "Watcher problem → status chip and Output").**
   - **Measured:** with watches exhausted, the server is silent on the protocol and only writes a stderr WARN.
   - **Inferred:** the build forwards stderr to Output as plain log lines, but nothing matches it, so the chip never warns. The user sees no sign that edits to unopened files are being missed.
   - **Status:** Failed against the 1b scope until it is built, or the architect rewords the claim (V2's flip condition).

### Design conflicts raised by the Implementation lane

| # | Point | Conflicts with the design? | Note |
|---|---|---|---|
| 1 | No lock glyph (needs go-to-definition, 1c) | **Yes.** The Stage 1b scope lists "lock glyph" as user-visible | The reasoning holds: nothing in 1b opens an unowned file. It needs the architect to move it to 1c |
| 2 | Unopened files attributed to the deepest containing project folder | **Yes.** The design attributes `projectId` "via project ownership", and the 1a record made moving the frontend prefix lookups onto `owning_project` 1b work | A file explicitly included by one project but under another's deeper folder, a config-facet file, or an ambiguous file would be mis-attributed. Fix: ask the backend resolver for unopened files too |
| 3 | No bounded wait for servers without status notifications | **Yes**, decision 20 ("No status notification" bullet) | Not reachable with this server: every run sent `experimental/serverStatus`. If a server version stops sending it, the first pull never happens and server diagnostics are silently absent. Needs the architect to accept the deferral with that risk stated, or the wait built |
| 4 | Wave tests in node, not against the fake server | **Partly.** The Testing section lists "waves (fake server)" | The behaviours listed there are covered by node tests with a scripted transport, and the backend refresh path by the F2 fake-server test. A method difference, not a coverage gap |

### Further findings (for review)

1. **Decision 21 guards are narrower than the design.**
   - "Affected" is a path-prefix test against the session root, not membership from `cargo metadata`, so a separate crate nested under the root (like `fx-ws/outside`) counts.
   - No identity-change check (the design says restart instead of reload).
   - The effect is limited by the health-not-`ok` guard. Inferred from `lsp_manifest_changed`.
2. **Test coverage below the design's Testing list.** Inferred from the test names.
   - Decision 21 negative cases (unchanged manifest, non-affected file, failed save, not Ready, identity change, timeout): only coalescing has a fake-server test.
   - "Hooks off": the node tests run with `DEV` false, so hooks are off by construction, but there is no on/off comparison.
   - F3 edge cases: 1 of 4.
3. **V16 holder risk.** If the canonical-path tab becomes the holder of a symlinked file, the build sends a URI the server does not treat as part of the crate. Measured: hover was empty for that path. Holder selection may need to prefer the path inside the project tree.
4. **Method notes for G3.**
   - The build's `inputToPaint` is keydown to the first animation frame, which comes before the paint, so it reads low. The verification probe uses the second frame; both are recorded in U12.
   - `metrics.ts` states that WebKitGTK has no long-task entries. That is asserted, not measured; U12 records `longtask_supported`.
5. **Retention evidence.** `fx-many` pushes about 7320 diagnostics (61 per file), not about 2400. Under the build's caps (500 per file, 20,000 closed total) the set fits by count. A memory budget is still Unmeasured (G5, V20).

### Repair-pass verification

Verification lane, 2026-10-30, against `feat/lsp-stage-1b` at `1e567b5` (`a054599`–`1e567b5` on `ea33c1e`), in a separate detached checkout. The design reference is decisions 28–37 at `66f7a9a` on `feat/intellisense-ws`. No implementation code was changed. Same environment as above. Real-server runs use `rust-analyzer 1 (9074e9b4c6 2026-09-06)`.

#### Claims, reproduced

| Claim | Result here | Reproduced |
|---|---|---|
| `cargo test --lib`: 223 passed, 8 ignored | 223 passed, 0 failed, 8 ignored; `lsp::` 70 passed, 4 ignored (three real-server tests and the fake server's entry) | Yes |
| `process_cleanup` 7, 1 ignored; DAP 26 unchanged | 7 passed, 1 ignored; 26 passed; `commands/debug*` still byte-identical to `0d110f1` | Yes |
| `node --test` 112; `tsc` clean | 112 passed; `tsc --noEmit` exit 0 | Yes |
| `vite build` (not claimed) | Exit 0 | — |
| Repeatability (not claimed) | `lsp::` tests: 10 consecutive runs, 10 passed | — |
| Without status, the fallback opened at 30.2 s and the first pull then had E0061 | Smoke test through the verification tap in no-status mode, 2 runs: the gate opened at 30 178 and 30 152 ms; the first pull had E0061. On the wire, no `textDocument/diagnostic` was sent before 30.14 s | Yes |
| With status, ready at about 1.3 s; a manifest broken from the start recovered in 96 ms after one reload | 3 runs: quiescent at 1 333–1 730 ms; early pull refused 3/3; reload recovery in 92–96 ms; a manifest broken mid-session recovered without a reload 3/3; push 80–85 ms after `didSave` | Yes |
| V2 matches only the fragment, on stderr or `logMessage` | Code: `is_watcher_failure` is a case-insensitive `contains("os file watch limit reached")`, called for stderr lines and for `logMessage` (not `showMessage`). The unit test rejects `No path was found.`. Real server: warned in 129 ms | Yes, by reading code and one real run |
| An early-empty report counts only if its pull was sent with the gate open | Node test "decision 31: an empty report counts only if its pull was sent after readiness" passes. Real server, status-less: no pull was sent before the fallback opened the gate (tap) | Yes (test and wire) |

#### R1–R6 verdicts

| Repair | Verdict | Evidence and looseness |
|---|---|---|
| R1 — V2 warning (decision 28) | **Verified** (backend, real server). The chip and Output display are **Unverified** until U6 | Real server with watches exhausted (helper reached ENOSPC, released back to the baseline of 110 753 watches, no process left): warning in 129 ms, health `ok`, phase Ready, raw lines kept. Clearing only at session end matches decision 28. **Gap:** decision 28's `logMessage` case and its "ring bound still holds" case have no test; the `logMessage` path exists in code |
| R2 — Lock glyph to 1c (decision 29) | **Verified** (docs) | `66f7a9a` moves the glyph from the 1b scope to 1c with the requirement unchanged. U10 no longer expects it |
| R3 — Attribution through `owning_project` (decision 30) | **Verified** | `attributionOf` uses the tab binding for open files and `lsp_attribute` (the backend resolver) for the rest; no folder lookup remains in `src/lib/lsp`. **Gap:** decision 30 names an explicit include and an ambiguous file. The backend test covers a nested project, a config facet and an external file; ambiguity appears only in the node display test, and an explicit include in neither |
| R4 — Readiness fallback (decision 31) | **Verified** | It is timer-driven (the 500 ms tree tick), so a silent server still trips it. It fires only for a session that has never sent a status. The real-server run is above. A 30 s bound against a measured readiness of about 1.3 s is long but marked ◇. Decision 31's "a wave is seeded" and the chip's ` (no status)` are visible only in the IDE (could be added to U4) |
| R5 — Wave tests in node (decision 32) | **Accepted** by the architect | — |
| R6a — Reload membership (decision 33) | **Failed at `1e567b5` (one clause); fixed and Verified at `502668a`** (see [Decision 33 follow-up verification](#decision-33-follow-up-verification)) | Membership comes from `cargo metadata` (root and package manifests), kept across a break. The nested separate crate is rejected (unit test and real cargo). **Fails decision 33:** when membership was never resolved (a manifest broken from the start), `manifest_affects` accepts **any `Cargo.toml` under the root**. Decision 33 says membership is then "unknown beyond the root manifest", and the test at `commands.rs` asserts the widened behaviour ("membership unknown on both sides: anything under the root"). Effect: in that state, saving a nested crate's or a vendored manifest sends a reload to the broken session. **Missing tests required by decision 33:** a manifest under `target/` or in a vendored directory, a `Cargo.lock` change (filtered by file name, untested), a changed server identity restarting instead of reloading, a reload timeout not failing the session, and the gate re-arming with a wave after a reload |
| R6b — F3 cases (decision 34) | **Verified** | All four are covered: no `type` and no actions (severity 3), sent while the consumer is stalled, before the `initialize` reply, and a string id echoed verbatim |
| R6c — Hooks on and off (decision 35) | **Verified at unit level** | `createMetrics(dev, host)`: with `dev` off nothing is installed, exposed or emitted (node test). The same scripted tracker, scheduler and store session gives identical wire traffic, stored sets and statistics with hooks on and off (node test). Every hook call in `bridge.ts` is a bare statement whose result is unused (read). This is one scenario, not "the same suites run both ways" as decision 35 words it; the gap is small given the call sites. An IDE comparison (dev build against `tauri build --debug`) would also change React's dev mode, so a difference could not be attributed to the hooks; U13 is kept as optional corroboration |
| R6d — `inputToPaint` to the visible paint (decision 36) | **Verified at unit level** | Node test: a key press is measured to the second animation frame after it, an upper bound by at most one frame. The IDE comparison with `frame_probe.js` is in U12 |

#### Gate statuses after the repair pass

No gate is **Pass**. G1, G2, G3, G5, G6 and G7 remain **Unmeasured**: their evidence is the scripted manual runs (U1, U2, U12, U7, U8, U9), which have not been run. G4's 1b evidence is reproduced; G3 and G4 complete in 1c. None is **Blocked** or **Fail** on the evidence so far.

#### Not reproduced

Nothing the Implementation lane claimed failed to reproduce. Timings differ by run as expected: readiness 1.33–1.73 s here against "about 1.3 s"; V2 warning at 129 ms against 125 ms.

### Decision 33 follow-up verification

Verification lane, 2026-10-30, against `feat/lsp-stage-1b` at `502668a` (`008ce44`, `13cac64`, `502668a` on `6ef1c21`), in a separate detached checkout. The design reference is decisions 28, 30 and 33 at `66f7a9a` on `feat/intellisense-ws`. No implementation code was changed.

#### Claims, reproduced

| Claim | Result here | Reproduced |
|---|---|---|
| `cargo test --lib` 228 passed, 9 ignored (75 in `lsp::`) | 228 passed, 0 failed, 9 ignored; `lsp::` 75 passed, 5 ignored (four real-server tests and the fake server's entry) | Yes |
| `process_cleanup` 7, 1 ignored; DAP 26 unchanged | 7 passed, 1 ignored; 26 passed; `commands/debug*` byte-identical to `0d110f1` | Yes |
| `node --test` 113; `tsc` clean | 113 passed; `tsc --noEmit` exit 0 | Yes |
| `vite build`; 10× `lsp::` (not claimed) | Exit 0; 10 of 10 runs passed | — |
| With the root broken from the start, saving a nested non-member: not affected, 0 reloads, health stays `error` | 3 runs of `real_rust_analyzer_decision_33_broken_root_ignores_a_nested_non_member` through the verification tap: affected `false`, action `Nothing`, 0 reloads, health `error`. **On the wire: no `rust-analyzer/reloadWorkspace` was sent during the nested save** | Yes |
| Fixing the root: exactly 1 reload, `ok` 112 ms later | Same 3 runs: exactly **one** `rust-analyzer/reloadWorkspace` on the wire (at 5.11 s); health `ok` 116–119 ms after the fix | Yes (116–119 ms against 112 ms) |

That opt-in test re-runs the steps of `lsp_manifest_changed` (layout, membership, action) in the test rather than calling the Tauri command. The production command path is confirmed in U5 step 6.

#### Verdicts

| Decision | Verdict | Evidence |
|---|---|---|
| **28** — watcher-limit warning | **Verified** (backend). The chip and Output display are **Unverified** until U6 | New tests: the `logMessage` fragment matches in any case and `showMessage` is ignored; the Output ring stays bounded and keeps the raw lines. Real server (repair pass): warning in 129 ms with `RA_LOG` unset |
| **30** — attribution through the resolver | **Verified** | New backend test: an explicit include and an ambiguous file are resolved by `owning_project` (ambiguous reported, not guessed), in addition to a nested project, a config facet and an external file. The frontend keeps no folder lookup |
| **33** — reload membership | **Verified** | `manifest_affects` accepts only the session's starting root manifest and the package manifests of the last successful `cargo metadata` (kept after a break; a fresh result is added). With membership never resolved, only the root counts. `manifest_action`: not affected → nothing; root moved → restart; otherwise reload only while Ready, not healthy and not the same content. Tests cover `target/`, vendored, nested non-member, `Cargo.lock` (never triggers), identity change → restart, reload timeout logged and not fatal, and the gate re-arming with exactly one wave after a reload. Real `cargo metadata` on the `fx-ws` fixture lists only the root, `alpha` and `beta` (not `outside`, `target/x` or `vendor/v`); with the root broken, metadata fails and writes no `Cargo.lock` |

#### Finding (for the architect)

**A member project whose workspace root is broken from the start is not recovered by a reload.** The adapter falls back to the project folder as the session root when `cargo metadata` fails. So for a member project such as `fx-ws/alpha`, the session's "root manifest" is `alpha/Cargo.toml`, and fixing the real workspace root (`fx-ws/Cargo.toml`) is not affected under decision 33. Measured against the real server, started that way with `RA_LOG` unset: health stayed `error` for 45 s after the fix; one explicit `rust-analyzer/reloadWorkspace` recovered it. In Craidd the chip therefore stays on error until `↻ Restart`.

This is consistent with decision 33's stated residual limitation ("membership is unknown beyond the root manifest … recovery there is the manual restart"). It extends to the common case of opening a member project, which the decision text does not name. Possible direction (not designed): treat the nearest ancestor `Cargo.toml` of the fallback root as a root candidate. U5 step 6b records the IDE behaviour.

#### Gates

No gate is **Pass**. G1, G2, G3, G5, G6 and G7 remain **Unmeasured** until the scripted manual runs. G3 and G4 complete in 1c.

### Manual UI review, 2026-11-03 (in progress, held)

Attempts 1–2 build: `feat/lsp-stage-1b` at `502668a`, dev build (`npm run tauri dev`), launched by the user from the Verification lane's run checkout (`502668a` + `3ad3f27`, docs only). Method: the scripted UI steps in `verification/lsp-1b/UI-STEPS.md` at `3e462f1`, with the process sampler at 100 ms.

#### U1 — G1: **Fail (blocked by a defect)**

- **Attempt 1, invalid.** Preferences → Rust → Language Server was `/usr/bin/lldb-dap (custom path)`, not rust-analyzer, so any language-server activity came from `lldb-dap`. No `lldb-dap` or IDE process remained after the IDE closed.
- **Attempt 2.** Server set to `/bin/rust-analyzer` (`/bin` links to `/usr/bin` on Arch); `fx-small.cln` open with `main.rs` and `util.rs`, `main.rs` active. **Observed by the user:** the status bar showed no language-server chip at all, only `⚠ 0 ✕ 0`, and `pgrep rust-analyzer` found nothing while the IDE ran. **Measured:** 2 338 process samples over 265 s, never a `rust-analyzer` process.
- **Root cause (code and history):** the module-level `startupDone` in `src/lib/lsp/bridge.ts` is declared `false` (line 33) and is **never set to `true`** in any Stage 1b commit (checked at `028847a`, `8620328`, `1e567b5` and `502668a`). `startupComplete()` wires everything up but never sets it. Both `onActive()` (line 363) and `attachActive()` (line 388) return early while it is `false`. So the IDE never schedules a launch, never calls `lsp_attach`, never creates a document entry (hence no chip) and never starts a server. **Every IDE-level Stage 1b path is inert in this build.**
- **Why tests missed it:** no test imports `bridge.ts`. The node tests drive the tracker, scheduler and store directly, and the metrics on/off test re-creates the bridge's hook calls. The real-server tests drive `Session` directly.
- **Proposed fix (Implementation lane; not applied):**
  - In `startupComplete()`, set `startupDone = true` once wiring is complete, immediately before the final `onActive()`. When `CRAIDD_LSP=0` it stays `false`, so nothing else changes.
  - Add a test that imports the bridge, or extracts the start-up gate into a testable function, asserting that after `startupComplete()` an active `.rs` tab schedules exactly one launch and a non-Rust active tab schedules none (G1's revalidation cases).
- **Effect on the review:** every U-step depends on a server attaching in the IDE, so U1–U13 are held until a fix is approved and verified. No harness was run, because no unblocked step remains. G1 is **Fail** on this evidence; G2, G3, G5, G6 and G7 stay **Unmeasured**.

#### Start-up fix `700b59d`, verified

The Implementation lane fixed the `startupDone` defect in `700b59d` (parent `ef358d5`). The start-up gate moved into `LaunchGate` (`src/lib/lsp/launch.ts`). `startupComplete()` calls `gate.complete()` after the `if (!enabled) return;` and immediately before the final `onActive()`. The filtering in `onActive()` is unchanged, and `tests/lspLaunch.test.mjs` adds three tests. This matches the proposed fix. The backend is unchanged since `502668a`, and `commands/debug*` is still byte-identical to `0d110f1`.

| Suite at `700b59d` | Result |
|---|---|
| `node --test tests/*.test.mjs` | 116 passed (113 + 3 in `lspLaunch`) |
| `tsc --noEmit`, `vite build` | Exit 0 |
| `cargo test --lib` | 228 passed, 0 failed, 9 ignored; `lsp::` 75 passed, 5 ignored |
| `cargo test --test process_cleanup` | 7 passed, 1 ignored |
| DAP suite (`commands::debug`) | 26 passed, unchanged |
| `lsp::` repeated | 10 of 10 runs passed |
| Opt-in real-server tests (`real_rust_analyzer`, `--ignored`) | 4 passed |

#### U1, attempt 3 (harness, `700b59d`): **Fail (a second defect)**. Harness-observed, pending user review.

Method: the WebDriver harness (`verification/lsp-1b/scripts/harness.py`, `f2b4381`) drives the dev build (`700b59d` frontend from Vite, debug binary built from the unchanged backend) under Xvfb. It uses an isolated `HOME`, with the server set to `/usr/bin/rust-analyzer`. The process sampler ran at 100 ms throughout. A subscription to the frontend store logged session and document updates. Evidence is in `verification/lsp-1b/runs/harness-20261103/u1/`: `steps.jsonl`, `proc.jsonl` and screenshots `01`–`03`.

- **Premise of U1 steps 2, 3 and 5:** this build has no tab restore at launch. The main window always starts on the welcome screen. "Previously Opened Windows" reopens the solution without its tabs. Tabs are reopened only when a parked (hidden) linked window is brought back (`restoredFromHidden`). The harness therefore opened `fx-small` from the welcome screen, waited, and then opened `src/main.rs` from the Solution Explorer. The parked-window restore path was not exercised.
- **Observed before the crash:**
  - The solution was open with no tab for 8.7 s, and no server ran: 0 of 117 samples over 13.2 s before the click.
  - `startupInteractive` was 3002 ms.
  - Opening `main.rs` scheduled one launch, at 11 735 ms page time, 4 ms before the click was logged.
  - The launch fired by `timeout`, after the 1.5 s bound; WebKitGTK exposes no idle callback.
  - The chip showed `language server…`, and a `rust-analyzer` process (with its proc-macro server) appeared 1.6 s after the click.
  - Nothing was left after the IDE closed.
- **New defect: the IDE window crashes on the first attach.** About 20 ms after the server spawns, the whole window is replaced by the error boundary: "This IDE window could not render … undefined is not an object (evaluating 'view.server.split')". The error comes from `serverName` (`src/store/lspStore.ts:34`), called from `LanguageServerChip` (`StatusBar.tsx:42`). It happened in 4 of 4 harness runs.
- **Cause (store trace):**
  - The order was: `main.rs` waiting (t 13 235) → session 1 created with **only** `status` (`spawning`), from a Channel batch (t 13 255) → `main.rs` bound (t 13 256).
  - The backend's first status batch arrives before the `lsp_attach` reply resolves. `updateSession()` (`bridge.ts`) creates a session view from any patch containing `status` (`if (!current && !patch.status) return state;`).
  - `attachActive()` then writes the attach reply's `server`, `version`, `root` and `notes` only when the session does not exist yet (`if (!useLsp.getState().sessions[reply.session])`). So those fields are never written. The chip renders a view without `server` and throws.
  - The `startupDone` defect hid this, because no attach ever happened in the IDE. No test renders the chip or orders a status batch before the attach reply.
- **Proposed fix (Implementation lane; not applied):**
  - In `attachActive()`, always merge the reply's descriptive fields (`generation`, `server`, `version`, `root`, `notes`) into the session view. Initialise `status`, `progress` and `pullDegraded` only when the view is absent, so a newer status from the Channel is not overwritten by the reply's older one.
  - Alternatively, `updateSession()` could refuse to create a view from a status-only patch. `lastStatus` already keeps the status, and the reply's `!lastStatus.has(...)` check already replays it.
  - Add a node test where a status batch for a new generation arrives before the attach reply, asserting the view then has `server`, `version` and `root`.
  - Optional hardening, for the architect: a failure inside the status chip currently takes down the whole IDE window through `AppErrorBoundary`. A local boundary, or a chip that tolerates a partial view, would contain it.
- **Effect on the review:** every U-step attaches a server, so U1–U13 are held again until this is fixed and verified. G1 stays **Fail**. Its start-up part (no server before a Rust tab is active, one bounded launch) is harness-observed and looks right, but a gate needs the whole step. G2, G3, G5, G6 and G7 stay **Unmeasured**.

#### Chip-crash fix `ead1a68` + `39f4e89`, verified (2026-11-08). Harness-observed, pending user review.

- **What changed, as read:**
  - `updateSession()` no longer creates a session view.
  - `onStatus()` creates or updates the view through `viewWithStatus` (empty `progress`, null `pullDegraded`).
  - `attachActive()` always merges the reply through `viewWithAttach`. `server`, `version`, `root` and `notes` are always written. `status`, `progress` and `pullDegraded` are written only when the view lacks them, so a newer Channel status is kept.
  - `serverName` falls back to `language server`.
  - `ChipBoundary` wraps only `LanguageServerChip`, keyed by the active document. Its fallback is a muted, non-clickable `language server`.
  - The backend is unchanged since `700b59d` (and since `502668a`).
- **Suites at `39f4e89`:**

  | Suite | Result |
  |---|---|
  | node | 120 passed, including 4 in `lspSessionView`: status before registration, registration before status, no rollback, chip containment |
  | `tsc --noEmit`, `vite build` | Exit 0 |
  | `cargo test --lib` | 228 passed, 9 ignored; `lsp::` 75 passed, 5 ignored |
  | `process_cleanup` | 7 passed, 1 ignored |
  | DAP | 26 passed, unchanged |
  | `lsp::` repeated | 10 of 10 runs passed |
  | Real-server opt-in tests | 4 passed |

  These match the Implementation lane's counts.
- **Cold starts in the real IDE:**
  - **Method:** five runs with `verification/lsp-1b/scripts/coldstart_check.py --runs 5 --contain`. The dev build is served by Vite on port 1440 (1420 belongs to another project on this machine), under Xvfb. Each run is a fresh process with a fresh isolated `HOME` and the server set to `/usr/bin/rust-analyzer`. Each run opens `fx-small` from the welcome screen, then `src/main.rs`.
  - **Evidence:** `verification/lsp-1b/runs/harness-20261108/coldstart-39f4e89/` (`summary.json`; per run `steps.jsonl`, `proc.jsonl`, and screenshots `ready`, `contain`, `after-switch`).
  - **Negative control:** the same script at `700b59d` reported the crash and a status-only first write.

  | | Result in 5 of 5 runs |
  |---|---|
  | Window crash | None |
  | Chip | Went from `rust-analyzer: indexing` to `rust-analyzer` (ready) 3.0 s after the click. Hover: `/usr/bin/rust-analyzer (rust-analyzer 1 (9074e9b4c6 2026-09-06))`, the fixture root, `File watching: server-side` |
  | Status before reply | Every run: the first session write had no `server` (phase `spawning`). The reply was merged 1–2 ms later, still `spawning`, and the document was bound in the same millisecond. Phases then ran `spawning`, `initializing`, `ready` |
  | Start-up (G1 inputs, not a gate result) | 0 server samples before the click (78–84 samples); first server 1.6 s after it; one launch, reason `timeout`; `startupInteractive` 2915–2969 ms |
  | Containment | With the bound session's `status` set to `null` in the store (a chip render fault), the window kept rendering and the Solution Explorer stayed. The chip showed the muted fallback `language server` ("The language server status could not be shown"), and the error was logged as `[lsp] Status chip rendering failed`. After the view was restored, switching to `util.rs` reset the boundary, and the chip read `rust-analyzer` again |
  | Page errors | Only the injected fault's two lines |
  | Leftovers after close | None |

- **Minor (cosmetic, not a defect for this pass):** until the reply is merged (1–2 ms here), the chip's hover would read `undefined (undefined)` for the server and version.
- **Verdict:** the window-crash defect is **resolved**, harness-observed and pending user review. **G1 stays Fail.** Its gate measurements (U1, whose steps are being reworded because tab restore is not a product requirement) have not been run. U1–U13 acceptance testing has not started.

#### Second independent reproduction of the chip-crash fix (2026-11-08, DA-2). Harness-observed, pending user review.

A second Verification session, with its own run checkout, repeated the check above on `39f4e89`. It did not read the first run's results before running. Tooling is `verify/lsp-stage-1b-crashfix-tools` (`ed78cc0` and one commit after it: `coldstart_check.py` takes the run checkout from `CRAIDD_RUN_DIR`, and records `console.warn`). The run checkout is a detached `39f4e89` at `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/crashfix-39f4e89` (git-ignored). Server: `/usr/bin/rust-analyzer`, `rust-analyzer 1 (9074e9b4c6 2026-09-06)`. Vite on port 1440 and Xvfb `:97`, both started and stopped by this session by pid.

- **Suites, re-run on `39f4e89` (all match Implementation's claim):**

  | Claimed | Reproduced | Log |
  |---|---|---|
  | `node --test` 120 | 120 passed, 0 failed (`tests/*.test.mjs`) | `crashfix-node.log` |
  | `tsc` clean | `tsc --noEmit` exit 0 | `crashfix-tsc.log` |
  | `vite build` ok | exit 0 | `crashfix-vite.log` |
  | `cargo test --lib` 228 passed, 9 ignored | 228 passed, 0 failed, 9 ignored | `crashfix-cargo-lib.log` |
  | `process_cleanup` 7 passed, 1 ignored | 7 passed, 1 ignored | `crashfix-cargo-pc.log` |
  | DAP 26 unchanged | 26 `commands::debug*` tests ok; `git diff 0d110f1 39f4e89 -- src-tauri/src/commands/debug*` is empty | `crashfix-cargo-lib.log` |

  (Logs are under `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/`.) Each lib run also leaves a `SIGSEGV` core dump from the test binary at exit; the suites pass, and the same dumps appear for other worktrees' test runs at the same hour. This pass did not investigate them.
- **Cold starts, two batches (10 starts):** evidence `crashfix-coldstart-1/` (`--runs 5 --contain`) and `crashfix-coldstart-2/` (`--runs 5`), each with `summary.json` and per run `steps.jsonl`, `proc.jsonl`, `out/ready.png`.

  | | Result |
  |---|---|
  | Window crash (`could not render`) | None in any run |
  | Chip | Reached `rust-analyzer` (ready) in 9 runs: 3.0 s after the click in 8 runs, 4.5 s in batch 1 run 2. Hover shows the `/usr/bin/rust-analyzer` path, version, fixture root and `File watching: server-side` |
  | Status before reply | The first session write had no `server` in every run (keys `generation`, `progress`, `pullDegraded`, `status`; phase `spawning`). The chip did not crash. The reply was merged afterwards |
  | Containment (batch 1 runs 3 to 5) | Setting the bound session to a partial view (only `status`) made the chip fail. `ChipBoundary` logged `[lsp] Status chip rendering failed`; the window kept its Solution Explorer and editor; the chip showed the muted `language server` fallback. Screenshot: `crashfix-coldstart-1/run3/out/contain.png` |
  | Leftover processes after close | None, all runs |

- **Harness incidents (recorded, not product verdicts):**
  - Batch 1 run 1 reported "the page is not Craidd's welcome screen". It was the first page load while Vite was still bundling dependencies. Rig warm-up; not repeated.
  - Batch 1 run 2 reached `rust-analyzer` ready at 4.5 s and took its screenshot, then the next WebDriver call returned `RemoteDisconnected`. The run's driver log shows a connection reset. No core dump exists for the app binary at that time and no other error was logged. **Cause unknown.** It did not recur in the nine later runs. It is not counted as a crash, and it is not explained.
  - In batch 1 run 3, after the injected partial view, a Channel progress event threw an unhandled `TypeError: view.progress is not an Object` (`bridge.ts` `onBatch`, `event.token in view.progress`). It follows from the injected view having no `progress`; the production path always writes `progress` through `viewWithStatus`. Recorded as a related note to finding 8, not as a defect of this fix.
- **New defect (not part of the crash fix; found by this run): `lsp_open` fails on every document.**
  - **Observed:** in all five runs of batch 2 and in batch 1 runs 2 and 3, the page logged `[lsp] document operation failed: …/src/main.rs invalid args `languageId` for command `lsp_open`: command lsp_open missing required key languageId`. Store metrics after ready: `markerCalls` 0, `stored` 0 for both routes.
  - **Probable cause (read from the source, and reproduced in a scratch crate; not yet confirmed inside the IDE):** `AttachReply` in `src-tauri/src/lsp/commands.rs` is `#[serde(rename_all = "camelCase", tag = "kind")]` on an enum. That renames the variants only. The fields of `Routed` stay `language_id`, `project_id`, `project_name`, while `bridge.ts` (`reply.languageId`) expects camelCase. A scratch `serde` enum of the same shape serialises as `{"kind":"routed","session":1,"language_id":"rust","project_name":"x"}`. `binding.languageId` is therefore `undefined`, and Tauri drops it from `lsp_open`'s arguments.
  - **Origin:** `AttachReply` has this shape since `43bc86b` (the Stage 1b Tauri surface), so it is not caused by `ead1a68` or `39f4e89`. It stayed hidden because no attach had happened in the IDE until `700b59d`.
  - **Consequence:** the document is never opened on the server from the IDE (no `didOpen`), so no sync, diagnostics or markers can be exercised through the UI. U2 to U13 and G5/G7 UI evidence cannot be gathered until it is fixed. It is inside Stage 1b's scope.
  - **Not fixed here.** For the lead: this is a DA-7 candidate (a regression test that serialises `AttachReply` and checks the camelCase keys, plus independent re-check). A candidate fix is `rename_all_fields = "camelCase"` on the enum, but that is Implementation's call.
- **Verdict (check: crash-fix verification):** **Verified**, harness-observed, pending user review. Suites reproduced; no window crash in 10 cold starts; the partial-view fault is contained. Two qualifications: one unexplained harness disconnect (batch 1 run 2), and the `lsp_open` defect above, which this fix does not touch. **G1 stays Fail**; no gate is moved.

#### `lsp_open` fix `ab52d83`, independent re-check (2026-11-08, DA-7). Harness-observed, pending user review.

Fix under test: `fix/lsp-1b-attach-keys` at `ab52d83` (one commit on `2631cac`: `rename_all_fields = "camelCase"` on `AttachReply`, plus a test pinning the JSON keys of every variant). The diff touches only `src-tauri/src/lsp/commands.rs`. Run checkout: detached `ab52d83` at `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/fix-ab52d83` (git-ignored); dev binary built with `devUrl` 1440; Vite on 1440 and Xvfb `:98`, both started and stopped by this session.

- **Suites (own run, `ab52d83`):** `node --test` 120 passed; `tsc` exit 0; `vite build` exit 0; `cargo test --lib` 229 passed, 9 ignored (the one new test is `lsp::commands::tests::attach_reply_keys_are_the_ones_the_frontend_reads`, ok); `process_cleanup` 7 passed, 1 ignored; 26 `commands::debug*` tests ok. Logs `fix-*.log` under `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/`.
- **didOpen check:** `scripts/jobb_didopen.py`, 3 runs, evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/didopen-ab52d83/`. Each run opened `main.rs`, waited for the chip to read `rust-analyzer`, appended `fn broken( {` and read the store.

  | | At `39f4e89` (before) | At `ab52d83` (3 of 3 runs) |
  |---|---|---|
  | `[lsp] document operation failed … missing required key languageId` | Every run | None |
  | `markerCalls` | 0 | 1 |
  | `stored` (pull / push) | 0 / 0 | 3 / 0 |

- **Cold start and containment on `ab52d83`:** `coldstart_check.py --runs 3 --contain`: no crash, ready at 3.0 s, containment held, no leftover processes, and the only page errors were the injected fault's own. Evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/fix-coldstart/`.
- **Verdict (check: `lsp_open` fix):** **Verified**, harness-observed, pending user review. The defect recorded above is resolved at `ab52d83`: a document opened in the IDE now reaches the server and produces markers. No gate moves. U3, U4, U5, U7, U9, U10, U11, G5, G7 and V3, V20, V25, V26 are unblocked and will be run against `ab52d83`.

#### Job B, batch 1: U1 (reworded), U2 and U8 on `ab52d83` (2026-11-08, DA-3). Harness-observed, pending user review.

Build: `ab52d83` (code identical to the tip `0778c9e`), dev binary on port 1440, Xvfb `:98`, isolated `HOME` per launch, `/usr/bin/rust-analyzer 1 (9074e9b4c6 2026-09-06)`. Scripts: `scripts/jobb_u1.py`, `jobb_u2.py`, `jobb_u8.py` on `verify/lsp-stage-1b-jobb`. Evidence root `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/` (git-ignored). No gate status is changed by this entry; where a gate's pass condition is met by the measurement but the step needs the user's eyes or a missing measurement, that is said.

**U1, G1 (reworded under DA-4), 5 runs with LSP on and 5 with `CRAIDD_LSP=0`** (`u1-fix/`; per run `result.json`, `proc.jsonl` at 100 ms).

| Check | Result |
|---|---|
| Server processes with the solution open and no tabs | 0 in 10 of 10 runs (4 s of 100 ms samples) |
| Server processes with a non-Rust tab (`fx-small.cln`) active | 0 in 10 of 10 runs |
| Open `main.rs`, switch to a non-Rust tab and back within about 0.7 s | Exactly 1 server, never more (`max_servers` 1 in 5 of 5 LSP-on runs). The first server appeared 2.77 to 2.81 s after the click, after the 1.5 s bound. One `launch` line per run, reason `timeout`, `schedulingDelayMs` 1520 |
| Startup to interactive (T1, the `startupInteractive` event) | LSP on: 2954, 2955, 2955, 2956, 2957 ms. `CRAIDD_LSP=0`: 2953, 2955, 2958, 2959, 2960 ms. No measurable difference at this resolution |
| T2 (scheduling delay) | 1520 ms, reason `timeout` (WebKitGTK exposes no idle callback; the bound fired every time) |
| T3 (spawn to `initialize` reply) | The Output line reads `ready after 0 ms`. That is the app's own number; it looks too small to be a spawn-to-reply time and is **not trusted** here |
| T4 (`initialize` reply to end of indexing) | **Not measured** (needs a tap run) |
| Chip | `language server…` then `rust-analyzer` (ready) 3.0 s after the click |
| Baseline (`CRAIDD_LSP=0`) | No server in any run; the chip never appears |

Not covered (Unverified): the parked-window hide and restore steps (4 and 6 of the reworded U1); the WebDriver cannot hide and restore a window. A never-idle forced start-up is also not run. The `Get Started…` menu item does **not** close the solution, and the server stays up; the harness's only reachable close is closing the window (observation for Docs, not a gate failure). **G1:** its status is left at **Fail** as recorded; the crash behind it is resolved (above), and the evidence here meets the first, second and fourth conditions, but T3 is untrusted, T4 is missing and the parked-window case is not run. Whether that moves G1 is for the lead.

**U2, G2, 3 runs** (`u2-fix/run*/result.json`, `proctree`): servers after opening `alpha/src/main.rs`, then `beta/src/main.rs`, then `outside/src/main.rs` of `fx-ws`: **1, 1, 2** in 3 of 3 runs (the two processes had different roots; each has 2 descendants). The chip read `rust-analyzer` after each open, and nothing remained after the run. This is the pass condition's count (one server for the shared workspace, a separate one for the outside crate). The "diagnostics in all three files" part of U2 is not measured here; the numbers are from the process table. G2 stays **Unmeasured** until the user's review.

**U8, G6** (`u8-fix-*`, 4 scenarios; `result.json`, `after_*_samples` at 500 ms):

| Fixture | Action | Descendants seen while running | Servers left | Cargo, rustc or proc-macro left |
|---|---|---|---|---|
| `fx-procmacro` | Close the IDE window | `rust-analyzer-proc-macro-srv` (2 processes) | 0 at the first 0.5 s sample | None |
| `fx-procmacro` | `kill -9` the IDE | the same | 0 at 0.5 s | None |
| scratch copy of `src-tauri`, during indexing | Close the IDE window | `rust-analyzer-proc-macro-srv` (2); an earlier run on `39f4e89` saw `cargo` and `rustc` too (4 and 7 children) | 0 at 0.5 s | None |
| scratch copy of `src-tauri`, during indexing | `kill -9` the IDE | the same | 0 at 0.5 s | None |

`kill -9` of the IDE left no `rust-analyzer`, `cargo`, `rustc` or proc-macro process within 0.5 s (supervisor backstop). Limits: "close the solution" with the window left open has no harness path (see above); the closing action here is closing the window, which also closes the solution. The `src-tauri` copy lives in the run checkout, not the repo's real `src-tauri`. G6 stays **Unmeasured** until the user's review; the pass condition is met by these measurements.

#### Job B, batch 2: U3 (diagnostics, V3, change/cross-document/save seeds) on `ab52d83` (2026-11-08, DA-3). Harness-observed, pending user review.

Build `ab52d83` (code identical to `0778c9e`), isolated `HOME`, the LSP tap (`rust-analyzer-tap`) as the language server, Xvfb `:98`. Script `scripts/jobb_u3.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u3/` (5 repetitions, `tap.jsonl`, `result.json`) and `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u3b/` (the background-tab case). **Method limits:** edits are made through Monaco's API (`executeEdits` and `undo`), not keystrokes, so the model's change events are the ones a user edit raises but no key handling is exercised; save is `Ctrl+S` sent to the editor. U3 step 3 asks for `util.rs` "beside" `main.rs`; the harness cannot make a split view, so `main.rs` stayed a background tab. Steps 5 (external edit and focus return) and 6 (close and reopen) were **not run**.

| Step | Result |
|---|---|
| Step 2, change seed (`util::ok()` to `util::ok(1)`, 5 of 5) | The wire: `didChange`, then a `textDocument/diagnostic` pull within 1 ms, then a `full` reply with 1 item 3 to 50 ms after it. The Monaco marker (`lsp:1:pull`, severity 8, `expected 1 argument, found 0`) appeared **0.31 to 0.36 s** after the edit (50 ms polling), and cleared 0.31 to 0.36 s after the undo (the pull for the undo returned 0 items within 4 ms). So most of that interval is after the reply, in the frontend; the cause (a coalescing window or frame batching) is **not established** here |
| Step 3, cross-document, `main.rs` in a background tab (5 of 5) | After `util.rs` changed (`pub fn ok(x: u32)`, unsaved) the wire shows pulls for `util.rs` only; **no pull for `main.rs` and no marker in 30 s**. The metrics show `pullNeeded: 1`. This fits the design's visible-first rule with `main.rs` flagged to pull on activation, but the step as written (beside) is not tested |
| Step 3b, switch to the background `main.rs` after the `util.rs` change (3 of 3) | The marker `expected 1 argument, found 0` appeared **6 to 59 ms** after the switch; `pullNeeded` read 0 afterwards |
| Step 4, save seed (`util.rs` changed and saved) | The Problems panel showed both `LIVE · RUST-ANALYZER` rows and `LIVE · RUSTC` rows (E0061 at `main.rs:6:23` and `6:25`) after the check; the script's own `rustc` flag is case-sensitive and read false, so the evidence is the panel text in `result.json` and `step4.png`. Duplicates appear labelled by source, as the step expects. Whether the save seed adds a pull beyond the change seed is not separated here |
| Whole run | 42 pulls (25 for `util.rs`, 17 for `main.rs`), 26 waves, `max_in_flight` 1, 0 cancelled requests, `previousResultId` used 40 times, `full` 42 and `unchanged` 0, 0 `didChange` version errors; 16 `setModelMarkers` calls, 14 store writes |

**V3 (revised)** is partly answered from this: change-seed trigger to wire reply is a few ms to about 50 ms and trigger to marker is 0.31 to 0.36 s on this machine, n 5, one fixture. That is a distribution of one fixture, not a budget. The cross-document and focus-return cases are **Unverified** (step 3 beside, step 5). No gate moves.

#### Job B, batch 3: T3 and T4 for U1, U4 and U5 on the final 1b code (2026-11-08, DA-3). Harness-observed, pending user review.

Build for U4 and U5: the tip of `feat/lsp-stage-1b` at the time (`dd02020`, the code of `345eb37` on top of `ab52d83`), own run checkout, isolated `HOME`, tap as the language server, Xvfb `:98`. Scripts `scripts/jobb_t34.py` (T3 and T4, on `ab52d83`) and `scripts/jobb_u45.py` (U4 and U5); evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/t34/`, `u4/`, `u5/`, `u5-r2/`, `u5-r3/`. Edits go through Monaco's API and save is `Ctrl+S` to the editor.

**U1: what `ready after N ms` means, and T3 and T4.** The Output line `[lsp] ready after N ms` (`session.rs`) measures from sending `initialize` to its reply, so it is the wrong quantity for T3; the `0 ms` recorded above is plausible and is **not** T3. From the store trace (3 runs): the session phase `spawning` to `ready` took **about 10 ms** (0.009 to 0.011 s). The 100 ms process sampler first saw the server 30 to 100 ms after the `spawning` phase, so spawn to ready is at most a sampler resolution of 100 ms and about 10 ms by the store clock. **T3 is therefore about 10 ms, with the 100 ms sampling limit stated.** **T4** (ready to the end of initial indexing, from the last progress `end` in the same trace, with the status's `quiescent: true`): **1.39 s** in all 3 runs on `fx-small` (store timestamps; the chip's `rust-analyzer` text appears about 3.0 s after the click because the launch waits the 1.5 s bound). One small fixture; not a large-workspace figure. The parked-window case for G1 is still not run (no window-manager hide in WebDriver; the app's park action was not looked for in this batch).

**U4, V24 (1 run).** The copy of `fx-small` had the argument break (`pub fn ok(x: u32)`) in `util.rs` on disk, and `util.rs` then `main.rs` were opened at once with the Problems tab showing. Timeline (chip text, whether the panel text `No problems from the last build or the language server` was shown, markers on `main.rs`):
- 0.16 s: no server yet, the panel text **was** shown (before any server exists; it says nothing about the server);
- 1.7 to 3.0 s, `rust-analyzer: indexing`: the panel text was **not** shown, no markers;
- from 3.24 s the E0061 markers (`expected 1 argument, found 0` and the rustc rows) appeared.
On the wire the first `textDocument/diagnostic` pull went out 1 ms after the first `quiescent: true` status (1.3458 s against 1.3448 s of the tap clock), so no pull preceded readiness. This matches V24 and decision 19 for this case. Step 3 (the status-less server) was not run.

**U5, V27 (steps 1 to 5; steps 6a and 6b not run).** Method: `Cargo.toml` edited through Monaco's API (`[package]` to `[package`) and saved. The chip only renders while a Rust tab is active, so the status was read from the store (phase, and the server's health) instead of the chip. Three identical runs (`u5/`, `u5-r2/`, `u5-r3/`):
- Step 2: health `error` (`cargo check failed to start: Cargo watcher failed, …`), 0 `rust-analyzer/reloadWorkspace` sent by the tap at that point.
- Step 3: health back to `ok` **0.3 s** after the restoring save. **One reload** was counted by then, not none (the guide expects none: a manifest broken mid-session recovered without one when measured headless on 2026-10-29). Decision 21 sends one reload per successful save of an affected `Cargo.toml`, coalesced, and a broken-content save is a successful save, so one is consistent with decision 21 but not with the guide's text; recorded for the architect.
- Step 4 (two break and fix pairs, 0.4 s apart): no further reload; the total for steps 2 to 4 was 1 (the bound is 2).
- Step 5: the `↻ Restart` action is shown only for a failed chip, so it was not available; **restart is Unverified in this run**.
An earlier run of the same script, which read the chip instead of the store, counted 1 reload at step 2 and 2 at step 4; its chip was absent all along, because `Cargo.toml` was the active tab, so it is not used. The cause of the difference in counts is not established.

No gate moves. V24 for this scenario and V27 steps 2 to 4 are **Verified** as far as these limits go; the rest of U4 and U5 is Unverified.

#### Job B, batch 4: U7 (G5, V15, V20, decision 22) on the final 1b code (2026-11-08, DA-3). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` at `dd02020`, own run checkout, isolated `HOME`, no tap, Xvfb `:98`. Fixture `fx-many` (120 modules, 20 E0061 each), a fresh copy per run. Script `scripts/jobb_u7.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u7/` and `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u7b/` (`result.json`, `after-check.png`, `end.png`). Two runs; the second adds a longer wait and the retention fields. Ten tabs (`m000.rs` to `m009.rs`) were opened, `m000.rs` was given a one-line edit and saved, the Problems panel was read, the ten tabs were closed, and `m005.rs` was reopened. The hooks are the dev build's `__craiddLspMetrics()` and the store.

| Measure | Run 2 (`u7b`) | Run 1 (`u7`) |
|---|---|---|
| Server ready | 2.5 s after the first open | 2.5 s |
| Stored diagnostics, push route (rustc) | 7167 | 7182, then 7212 after the close step |
| Push arrivals delivered / store writes | 213 / 190 | 214 / 183 |
| `setModelMarkers` calls, 10 tabs open | 22 | 25 |
| Stored, pull route, 10 tabs open | 40 | 40 |
| `unchanged` / `full` pull reports | 0 / 5 | 0 / 5 |
| Evicted files, "not retained", pull-unknown | 0, 0, 0 | not read |
| Problems header | `Language server (live): 2389 errors … showing 500 of 7207` | `2394 errors … showing 500 of 7222` |

Reading:
- **G5 counts.** The push set (about 7.2k diagnostics) arrived through 213 deliveries and about 190 store writes, and 22 to 25 `setModelMarkers` calls were made for 10 open files and about 2400 server errors, not one per diagnostic. The delivery count and store-write count are measured; the "at most one store write per frame" condition is **not** separated here (the `frameWrites` counter was 111 to 117 and its exact meaning was not checked against the code), and the `unchanged`/`full` ratio is 0 of 5, so the identical-report suppression is not exercised. **Approximate memory was not measured** (WebKitGTK has no `performance.memory`). G5 stays **Unmeasured**.
- **The save-triggered check did not show.** The initial check that rust-analyzer runs on start-up already produced the ~7.2k push diagnostics, before the edit. After the edit and `Ctrl+S` on `m000.rs` (the file changed on disk, `m000.rs` line 1 is `// touch`), no further push arrival came in 75 s (`arrivals.push` unchanged). Whether the save started a check that produced identical results or did not start one is **not established**; the "save seed adds a check" expectation of U7 step 2 is **Unverified**.
- **Step 3.** The panel stayed responsive in the harness; frame gaps stayed at 17 to 27 ms while scrolling and switching 10 tabs (p95 up to 25 ms, max 27 ms, 44 samples, run 1). The header carried per-source counts as the step expects, with the row cap stated (`showing 500 of N`).
- **Step 4 and V15.** After closing the 10 tabs the pull set went from 40 to 0 and the push set stayed (7167, and 7212 in run 1); reopening `m005.rs` brought 20 pull diagnostics back through a new pull. That is the design: closed push rows stay, pull rows go.
- **V15 and decision 22 retention budget: the limits were not reached.** The per-file and route cap is 500, the closed-file cap 2000 and the closed-set diagnostic cap 20 000; this fixture never exceeded any (`evictedFiles` 0, `notRetained` 0). So eviction, the "at least" wording and the next-check wording are **Unverified** here; a fixture with more than 20 000 closed-set diagnostics or more than 500 per file is needed.
- **Observation (not a verdict):** the stored push count differed between two runs of the same fixture (7167, 7182 and 7212), so the exact count is not stable across runs.

No gate moves: G5 Unmeasured, and V15, V20 and decision 22 are Unverified for eviction.

#### Job B, batch 5: U9 (G7 synchronisation) on the final 1b code (2026-11-08, DA-3). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` at `dd02020`, own run checkout, isolated `HOME`, the tap as the language server, Xvfb `:98`. Script `scripts/jobb_u9.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u9/` (first run) and `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u9b/` (second run, with the extra CRLF edit and the EOL-insensitive comparison). **Method limits:** edits are made through Monaco's API (`executeEdits`, `undo`, `redo`, `setSelections`, `setEOL`), not keystrokes or the clipboard, so a real paste and the status bar's EOL control are not exercised; steps 8 (dispose and recreate the model view while the tab stays open) and 9 (edit on disk while the model is disposed) were **not run**. After each step the server's text was rebuilt from the tap log with `tap_report.py --texts` and compared byte for byte with the model (`result.json` per step).

| Step | Server text equals the model (byte for byte, after the tool correction) |
|---|---|
| 0 open | Yes (92 characters) |
| 1 type a line, 2 undo, 2 redo | Yes, each |
| 3 multi-cursor edit on three lines | Yes |
| 4 insert 2000 lines (45 006 characters, with non-ASCII) | Yes |
| 5a set the model's EOL to CRLF | Yes, once the tool was corrected (see the correction below): the app sends `didClose` and `didOpen` with the full CRLF text (2008 `\r\n`), and the rebuilt server text equals the model |
| 5c edit a line while the model is CRLF | Yes (2009 `\r\n` on both sides) |
| 5b set the EOL back to LF | Yes |
| 6a insert a non-BMP character (U+1F600), 6b edit after it | Yes, each (7 more characters, UTF-16 length counted) |
| 7 switch to `util.rs` and back | Yes |

Wire: no `didChange` version errors, `max_in_flight` 1, no cancelled requests, 23 pulls.

**Correction (retracted finding, 8 November 2026, later that day).** An earlier version of this record reported that an EOL change is not sent to the server. That was wrong. The comparison script read the rebuilt server text with Python's `Path.read_text()`, which turns `\r\n` into `\n`, so the server's text looked like LF. The tap log shows the app sending `didClose` and `didOpen` with the CRLF text at the EOL change (the "EOL changed" full resync in `documents.ts`), and re-run with the bytes read as they are (`/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u9d/`) the server's text equals the model byte for byte at 5a, 5c and 5b. The defect report and any fix request built on it are withdrawn. The script (`scripts/jobb_u9.py`) is corrected; polling up to 8 s for equality also records the resync latency (0.0 to 0.3 s in the corrected run).

G7 stays **Unmeasured**: steps 8 and 9 are not run, forced overflow comes from the fake-server tests, and the edits were made through Monaco's API. For the steps that were run, the server's text equalled the model byte for byte after every one (after the tool correction).

#### Job B, batch 6: U5 steps 3, 6a and 6b (V27, decision 33) (2026-11-08, DA-3, DA-12). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` at `dd02020`, own run checkout, isolated `HOME`, tap as the language server, Xvfb `:98`. Script `scripts/jobb_u5b.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u5-6a/` and `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u5-6b/` (`result.json`, `tap.jsonl`, screenshots). Health is read from the store, and the chip's own text and hover were read where a Rust tab was active. Edits go through Monaco's API and are saved with `Ctrl+S`.

**Step 3 expectation (lead ruling).** The lead ruled under DA-12 (a test-method choice, not a design change; the architect may revise it) that one `reloadWorkspace` at the restoring save is the expected behaviour, per decision 21, and that the guide text expecting none came from a headless measurement and does not describe the IDE path. `UI-STEPS.md` U5 step 3 is corrected accordingly. With that, the three U5 runs recorded above (one reload at the restoring save, none further for the burst, total 1 against a bound of 2, recovery 0.3 s) **match the design**.

| Case | Result |
|---|---|
| **6a**, `fx-nested` root `Cargo.toml` broken from the start, `src/main.rs` open | Chip `rust-analyzer: indexing ⚠`; hover `Server error: Failed to load workspaces.` and `Cargo workspace discovery failed; using the project folder (cargo metadata failed: error: unclosed table, expected `]`)`; health `error` |
| 6a: save `tools/gen/Cargo.toml` (a separate crate, not a member) | 0 `reloadWorkspace` on the wire; the warning stays |
| 6a: restore `]` in the root `Cargo.toml` and save | **Exactly one** `reloadWorkspace`; health back to `ok` **0.2 s** after the save. Matches the expectation |
| **6b**, `fx-ws` with `[workspace` broken, `alpha/src/main.rs` open | Chip `rust-analyzer: indexing ⚠` with `Failed to load workspaces.` |
| 6b: restore `]` in `fx-ws/Cargo.toml` and save, wait 30 s | **0** `reloadWorkspace`; the warning stays (the known limitation, decision 38). As the step describes |
| 6b: click `↻ Restart` | **Not possible: no such control exists in this state.** `StatusBar.tsx` shows `↻ Restart` only when the session has ended or is `unresponsive`. A session that is `ready` with an error health shows only the chip, and clicking the chip opens nothing. The warning therefore **cannot be cleared from the status bar** here, and the 6b guide text "`↻ Restart` clears it" does not hold for this build |

**Finding for the lead (recorded, not fixed).** Decision 33's residual limitation says recovery from a broken workspace root with a member project is "by manual restart". In the IDE as built there is no restart control while the server is alive and reports an error. Restart exists for ended or unresponsive sessions only, so the documented recovery is not reachable from the UI; closing and reopening the solution would do it. The same applies to U5 step 5 (restart still works), which stays **Unverified**. Whether this is a defect (a restart should be offered for error health) or a wording error in the guide is for the architect; no code was changed.

V27 steps 2 to 4, 6a and the 6b limitation are **Verified** as far as these limits go (harness-observed, pending user review); step 5 and the 6b restart are **Unverified**.

#### Job B, batch 7: U12 (G3, V4; G3b and V26 only in part) on the final 1b code (2026-11-08, DA-3). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` at `dd02020`, own run checkout, isolated `HOME`, Xvfb `:98` (a software-rendered X server, so frame times are **not** comparable with a real desktop; the comparison is between the two modes on the same rig). Workspace: a scratch copy of Craidd's own `src-tauri` inside the run checkout (about 400 crates), opened as a solution; no repo file was touched. Script `scripts/jobb_u12.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u12/{on,off}{1,2,3}/result.json` and `end.png`. Each run: open `commands/debug.rs` (2824 lines) and `lib.rs`, start the probe (`frame_probe.js`, the approved A3 substitute), then for 40 s send real key events (3 characters about every 150 ms, 657 to 672 keystrokes), scroll the editor every fourth batch and switch tabs every twelfth, all while the server indexes. Three runs with LSP on and three with `CRAIDD_LSP=0`, alternating. The typed text was never saved.

| Measure (40 s, 3 runs each) | LSP on | `CRAIDD_LSP=0` |
|---|---|---|
| Frame gap p50 / p95 | 16 / 17 ms in every run | 16 / 17 ms in every run |
| Frame gap max | 82, 82, 108 ms | 75, 100, 104 ms |
| Gaps over 50 ms | 1, 2, 1 | 1, 1, 1 |
| Gaps over 100 ms | 1, 0, 0 | 0, 0, 1 |
| Input to paint p50 | 29, 29, 29 ms | 30, 28, 28 ms |
| Input to paint p95 | 37, 35, 34 ms | 35, 34, 35 ms |
| Input to paint max | 186, 117, 128 ms | 112, 131, 130 ms |
| `longtask` supported by this WebKitGTK | No | No |
| Channel messages over the run | 838, 573, 544 | 0 |
| Startup to interactive | 2959, 2960, 2978 ms | 2960, 2959, 2961 ms |
| Server CPU over the 40 s (`/proc` utime+stime) | 65.9, 69.8, 70.5 CPU-seconds (about 1.7 cores) | no server |
| Webview (WebKitWebProcess) VmRSS at the end | 782, 753, 765 MB | 765, 743, 769 MB |
| `rust-analyzer` VmRSS at the end | 3378, 2615, 2715 MB | none |

Reading: with the server indexing a large workspace, typing, scrolling and tab switching were no different from the baseline on this rig. One run with LSP on had the single largest input-to-paint value (186 ms), and the baseline had gaps of the same size, so no regression is shown, but three runs per mode on one machine under a software X server is a small sample. These are labelled **substitutes** (frame gaps measure cadence, not task duration; input to paint ends at the second frame after the key, not at the display). The build's own `inputToPaint` hook only saw 0 to 5 samples (its keydown sampling is sparse) and cannot be compared with the probe; the probe's numbers are the ones used.

**V4 (separate target directory).** `cargo.targetDir = true` puts the server's checks in `src-tauri/target/rust-analyzer`, **961 MB** after these runs (cumulative over the 6 runs that reused the checkout, and only for the LSP-on ones), beside 4.5 GB in `target/debug`. First-check time and whether a user Build waits on the lock were **not measured** (no Build was issued during a check). **G3b** is therefore **Unmeasured**.

**V26.** Server CPU while typing is in the table (about 1.7 cores averaged over 40 s of initial indexing plus typing); the pull-request rate and waves under typing were **not measured** in this batch (no tap, to avoid perturbing the timing); V26 stays **Unverified**. The Channel message rate is the total above (about 14 to 21 messages per second on average) with no per-message size.

**G3 status:** the numbers are recorded and compared with the baseline as the gate requires; the gate also asks for the Channel message size and the pull rate, which are not here, so G3 stays **Unmeasured** pending those and the user's look.

#### Job B, batch 8: U11 (V9) and the retention bounds with memory (U7, larger fixture) on the final 1b code (2026-11-08, DA-3). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` at `21c926d`, own run checkout, isolated `HOME`, Xvfb `:98`. Scripts `scripts/jobb_u11.py` and `scripts/jobb_u7big.py`; the fixture generator `scripts/make_fx_big.py` (the fixture's `src/` is generated and git-ignored); evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u11/` and `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u7big/`.

**U11, V9 (one run; the split view is not tested and stays Unverified).** Monaco was reached by importing the same `monaco-editor` module the app uses (`import('/node_modules/.vite/deps/monaco-editor.js')` in the dev build), so the URI and model events could be read; listeners on `onDidCreateModel` and `onWillDisposeModel`, plus the tap.

| Step | Models (URI file name, number of views) | Tap document messages |
|---|---|---|
| Before any file | none | none |
| Open `main.rs` | `main.rs` (1) | `didOpen main.rs` 1 |
| Open `util.rs`, `main.rs` tab stays | `main.rs` (0), `util.rs` (1) | no `didOpen util.rs` yet after 1.5 s |
| Switch back to `main.rs` | `main.rs` (1), `util.rs` (0) | `didOpen util.rs` 1 (it arrived by then) |
| Close the `main.rs` tab | `main.rs` (0), `util.rs` (1): **the model is not disposed** | `didClose main.rs` 1 |
| Reopen `main.rs` | `main.rs` (1), `util.rs` (0): the same model reused | `didOpen main.rs` 2 |

- The model URI is `file://` plus the percent-encoded path (scheme `file`, language `rust`), for example `file:///…/fx-small/src/main.rs`, not an `inmemory` URI.
- A model outlives its view: switching tabs leaves a model with 0 views, and closing the tab does **not** dispose it. Only two `create` events were seen (one per file) and **no `dispose` event** in the run, including after the tab close and the reopen. That is what `keepCurrentModel` implies. The server's side follows the tab, not the model: one `didClose` on tab close and a fresh `didOpen` on reopen.
- The second document's `didOpen` was not on the wire 1.5 s after its tab was opened and appeared by the next step; its attach had not completed, and the timing was not pinned down.
- **Observation (not a verdict):** closed models stay in Monaco for the life of the window; with many files opened and closed that is memory the product keeps. Not measured here.
- **Verdict (V9):** the URI and lifetime parts are **Verified** for open, switch, close and reopen (harness-observed, pending user review); the split view and the path-change case are **Unverified**.

**Retention bounds and memory, larger fixture.** `fx-big` has 2100 modules with 10 E0061 each, plus `huge.rs` with 700 (generated, so the decision 22 bounds are exceeded: 500 per file and route, 2000 closed files, 20 000 diagnostics in closed sets). One run: open the solution, open `huge.rs`, wait for the start-up check.

| Measure | Result |
|---|---|
| Stored push diagnostics | rose to about **20 480 to 20 490** and stayed there |
| Files evicted / diagnostics "not retained" | **1443 / 1801** |
| Problems header | `Language server (live): 7110 errors … · counts are at least: diagnostics for 1443 files and 1801 more diagnostics not retained · showing 500 of 20986` |
| Webview VmRSS (WebKitWebProcess) | 560 MB with the solution open, 1117 MB after opening the file, 1338 MB after the check, 1404 MB at the end (with about 21 000 diagnostic rows stored). Method: `/proc/<pid>/status` of the app's `WebKitWebProcess` child |
| `rust-analyzer` VmRSS | 929 MB |

So the retention limits do engage: the stored set is capped at about 20 000 rows, files are evicted, and the header says the counts are "at least" and names both the evicted files and the diagnostics not retained (the wording the design asks for). The per-file cap's own wording (a single file above 500) is inside that "not retained" count and was not separated. Whether an evicted set comes back on reopening was not tested on this fixture. **G5's memory figure** is recorded above; the gate's other missing conditions (store writes per frame, the `unchanged` ratio, the save-triggered check) are unchanged from batch 4, so **G5 stays Unmeasured**. **V15 and V20** (retention and eviction behaviour) are **Verified** for the cap and the wording, harness-observed, pending user review; the eviction order was not examined.

#### Job B, batch 9: G3 leftovers (wire sizes, pull rate, first check, Build against the check) on the final 1b code (2026-11-08, DA-3). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` at `63f2390`, own run checkout, isolated `HOME`, Xvfb `:98`, scratch copy of `src-tauri`. Scripts `scripts/jobb_g3a.py` (tap, typing) and `scripts/jobb_g3b.py` (Build); evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/g3a/`, `g3a-cold/`, `afterindex/`, `g3b/`, `g3b2/`.

| Item | Result |
|---|---|
| Message size (server to client, **wire** sizes from the tap; the Channel hook exposes counts, not bytes, so this is a proxy) | 960 messages over 41 s, p50 186 B, p95 208 B, max 2786 B, total 182 635 B (about 4.5 KB/s). 935 of them are `$/progress` (p50 186 B). A second, cold-cache run: 1133 messages, p95 196 B, max 2786 B, 210 219 B |
| First check time | On a warm `target/rust-analyzer` the check began at 4.25 s and ended at 4.37 s (0.1 s). With the directory deleted first (cold), the check began 12.6 s after the tap started and had not ended 9 s later when the run closed; its duration was **not obtained** (not longer observed than about 9 s). The server's target directory reached 848 to 961 MB |
| **Build against the check (G3b)** | A Build clicked about 10 s after ready, while the cold first check was running (`cargo`, `rustc` and the proc-macro server under the server): **3.5 s** with LSP on in run 1, **6.5 s** in run 2 (only the proc-macro server was running, so that check had finished); **7.5 s and 7.5 s** with `CRAIDD_LSP=0` (the same forced recompile, `lib.rs` touched). **No wait on the server's check was seen.** n 2 each, one of the two LSP-on runs was truly concurrent with the check. An earlier pair (8.0 s on, 0.5 s off) was an order artefact: the first run compiled the crate and the second found it current, and is not used |
| V26: pulls per keystroke | 2 pulls for 744 keystrokes in 40 s (0.003) |

**Observation (cause not established, not a verdict): `didChange` is withheld while typing continues.** In the same typing runs the client sent `didChange` at 0.8 s (13 changes), 4.2 s (60) and 4.4 s (6), then **nothing for 36 s** while 744 keystrokes were typed 150 ms apart, then one `didChange` with **663 changes** at 40.3 s when the typing stopped. A second run with indexing already finished (15 s of typing): one `didChange` with 782 changes at the end (`/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/g3a/tap.jsonl`, `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/afterindex/tap.jsonl`). The design says `didChange` is flushed at the end of each event-loop turn and is not debounced by time. A hypothesis (not checked): the flush is chained behind a pending debounced pull in the per-document chain, so continuous typing never flushes. WebDriver key events at 150 ms intervals may differ from a person typing. The effect, if real, is that the server's text lags the editor by the length of an unbroken typing burst. Implementation can confirm from the code.

G3 and G3b remain **Unmeasured** as gates: the numbers above are recorded against the baseline; the first-check duration is missing, the Channel size is a wire proxy, and the gate wants the user's look.

#### Job B, batch 10: where the webview's memory goes, and whether an evicted file's rows return (fx-big) (2026-11-08, DA-3). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` (`fcb891a`), own run checkout, isolated `HOME`, Xvfb `:98`, the generated `fx-big` fixture. Script `scripts/jobb_u7big.py` (`--lsp-off` for the baseline); evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u7big-off/`, `u7big2/`, `u7big3/`. VmRSS of the app's `WebKitWebProcess` child from `/proc/<pid>/status`. One run each; the figures vary by tens of MB between runs.

| Stage | LSP on (`u7big2`) | `CRAIDD_LSP=0` (`u7big-off`) |
|---|---|---|
| Solution open | 560 MB | 557 MB |
| `huge.rs` open (and, with LSP on, the chip ready) | 1122 MB | 773 MB |
| 60 s later (off) / after the start-up check, Problems tab never opened (on) | 1391 MB | 701 MB |
| After opening the Problems tab (on) | 1464 MB | n/a |

So Monaco with the file accounts for about 700 to 770 MB, and the language-server path adds about 350 MB by the time the server is ready and about 620 to 690 MB once the check's diagnostics (about 21 000 rows, 20 495 stored push) have arrived; showing them in the Problems panel adds a further 70 MB. The Problems panel was never "collapsed" (it shows its Output tab by default); the "Problems not opened" row is the nearest available split. For decision 22's question, the cost of the capped store is roughly 0.6 GB of webview memory on this fixture, with the store plus markers not separated further here.

**Does an evicted file's set return on reopen?** `evictedFiles` is only a count (1440 to 1446), so files could not be named; three files were opened after the check and their Monaco markers read (`u7big3`): `m0100.rs` and `m1000.rs` (very likely evicted) each showed **10 markers, all from the pull route** (`lsp:1:pull`), none from the push route; `m2050.rs` (kept) showed **41, 10 pull and 31 push**. So reopening an evicted file brings back its live (pull) diagnostics, and the push (`rustc`) set stays gone, which is what V15 and decision 22 describe. Which files were evicted was inferred from their having no push rows, not read from the store.

#### Job B, batch 11: U9 steps 8 and 9 and U10 (V16 facts only) on the final 1b code (2026-11-08, DA-3, DA-13). Harness-observed, pending user review.

Build: the tip of `feat/lsp-stage-1b` at the time (`fcb891a`'s code), own run checkout, isolated `HOME`, the tap as the language server, Xvfb `:98`. Scripts `scripts/jobb_u9b.py` and `scripts/jobb_u10.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u9step89/` and `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u10b/`, `u10c/`.

**U9 step 8 (model disposed while the tab stays open).** Method limit: the model was disposed with `model.dispose()` through Monaco's API, which is not the same as the editor view unmounting; it exercises the app's "model about to be disposed" path (`documents.ts`) but not React's own unmount. Result: after the dispose the server's text was unchanged and the tap shows **no `didClose`**; switching to another tab and back recreated the model with the same content (92 characters), and the server's text equalled it byte for byte. This matches the "suspend, keep the server document" design.

**U9 step 9 (edit on disk while the model is disposed): Unverified.** A line was appended to the file on disk (139 bytes against 92) while the model was disposed. On returning to the tab the model came back with the **old** content (92 characters), the server matched the model, and the tab did not reload from disk; no `didClose`, `didOpen` or `didChange` followed. The harness raises no window-focus event, and that is the app's trigger for noticing disk changes, so the resume-with-a-different-hash path (resynchronisation) was **not reached**. The step needs a real focus change, which is for the user.

**U10, V16 facts (no verdict; DA-13).** Method limit: the explorer does not list symlinked folders (`src/linked` and `vendor` are absent from the tree and from File Discovery), so the step "open `src/linked/deep.rs` through the tree" is not possible; the two paths were opened through the app's own `openFile` store action (`useSolution.getState().openFile`), which the tree click also calls. Opening the file picker is a native dialog and was not used. Wire facts from the tap:

| Order | What the tap and the chip showed |
|---|---|
| 1. `main.rs` with `deep::deep(1)` typed, `src/linked/deep.rs` opened first, `real_mods/deep.rs` second | `didOpen` for `main.rs` and later for the canonical `real_mods/deep.rs` only. **No `didOpen` for the tab opened through the symlinked path**, and that tab showed **no language-server chip** (no `rust-analyzer: alias`). The canonical-path tab showed `rust-analyzer` and 1 marker. `main.rs` kept its E0061 marker |
| 4. canonical first (`real_mods/deep.rs`), symlinked second | `didOpen` for `main.rs` and the canonical path; again **no `didOpen` for the symlinked tab and no chip** on it |

In both orders the server's open document is the canonical path and the tab opened through the symlinked path is never sent to the server and shows no chip. The guide expected the first-opened tab to be the holder and the second an `alias` tab with the chip `rust-analyzer: alias`; that was **not** observed. Two limits apply: the tabs were opened through the store action and not the tree, and no typo-and-undo check on the holder was made (the marker count of 1 on the canonical tab was not traced to a cause). Steps 3 and 5 (close both, promote the alias) were not run. **Proposed V16 wording (for the architect, not a decision):** "In the IDE as built, a file opened through a symlinked folder is not synchronised with the server and shows no chip, whichever path is opened first; the canonical path's tab is the one the server sees. The alias chip and promotion were not observed. Reconfirm with the explorer's real path, after the symlinked-folder case is settled." V16 stays **Open**.

#### Job B, batch 12: U4 step 3 (status-less server, decision 31) and U3 steps 5 and 6 (2026-11-08, DA-3). Harness-observed, pending user review.

Build: the code of `fcb891a`, own run checkout, isolated `HOME`, Xvfb `:98`. Scripts `scripts/jobb_u45.py --drop-status` and `scripts/jobb_u3b.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u4-nostatus/` and `u3b56/`.

**U4 step 3, a server that never sends a status.** The tap wrapper withheld `experimental/serverStatus` from the client (`CRAIDD_LSP_TAP_DROP_STATUS=1`; the tap logs what it dropped). The copy of `fx-small` has the argument break on disk; `util.rs` then `main.rs` were opened at once.

| Time (s after open) | Chip | `No problems…` text in Problems | Markers on `main.rs` |
|---|---|---|---|
| 0.14 | no server yet | shown (no server exists yet) | 0 |
| 1.7 | `rust-analyzer: indexing` | not shown | 0 |
| 3.1 | `rust-analyzer: indexing` | not shown | 6 |
| 31.7 | `rust-analyzer (no status)` | not shown | 6 |

The first `textDocument/diagnostic` pull went out at **30.03 s** (tap clock), which is the 30 s readiness fallback of decision 31; the chip read `rust-analyzer (no status)` at 31.7 s (polling resolution 0.1 s plus the render). So no pull preceded the fallback, as decision 31 and decision 19 require. The 6 markers at 3.1 s are not from a pull (none had been sent); they are the push-route `rustc` rows from the check the server runs on start-up. The Output line `the server sent no workspace status within 30 s of starting` was **not found** by the script's filter (it returned no lines), so that line is **Unverified** here. The guide's "about 30 s" and the 30.2 s headless figure agree with 30.0 s.

**U3 step 5 (external edit on disk and focus return).** Method limit: Xvfb has no window focus change, so a synthetic `blur`, `focus` and `visibilitychange` event was dispatched on the page; the app's real focus trigger is therefore not shown to have fired. `util.rs` (the closed tab) was edited on disk (`pub fn ok(x: u32)`). The `main.rs` markers (2 pull markers) were already present 1.5 s after the disk edit, **before** the synthetic focus event; the revert on disk cleared them within 0.4 s with no focus event. So in this build a disk change is picked up without a focus event, through the server's own file watching (the chip's hover says `File watching: server-side`) and its diagnostics refresh. This shows the case the design calls "not covered" for focus is covered here by the server watcher; it does **not** show the focus seed itself.

**U3 step 6 (close and reopen) Unverified.** There was no `rustc` (push) set in this run, so the "pull rows clear, push rows stay" part could not be read; after `main.rs` was closed its model was gone from Monaco's model list, and on reopen the 2 pull markers were present at once. The state while the tab was closed was not read.

#### Independent re-check of the candidate `1ab81d5` (Restart fix and `didChange` fix) (2026-11-08, DA-7). Harness-observed, pending user review.

Candidate: `lead/lsp-1b-candidate` at `1ab81d5`; own run checkout `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/cand-1ab81d5`, dev binary on port 1440, Xvfb `:98`, isolated `HOME`. Scripts on `verify/lsp-stage-1b-jobb`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/c-*`.

| Check | Result |
|---|---|
| Suites | `node --test` 125 passed; `tsc` 0; `vite build` 0; `cargo test --lib` 236 passed, 9 ignored; `process_cleanup` 7 passed, 1 ignored; 26 `commands::debug*` tests ok |
| `didChange` during continuous typing (scratch `src-tauri`, tap, 40 s, two clean runs) | **Fixed.** 711 `didChange` for 714 keystrokes and 730 for 732, one change per message, flowing from the first keystroke (before: three messages, then one with 663 changes at the end) |
| After indexing finished (15 s typing) | 267 `didChange` for 267 keystrokes (before: one with 782 changes at the end). One batch of 501 changes was also seen |
| V26, pulls per keystroke | 99 and 110 pulls in 40 s (**0.14 and 0.15 per keystroke**, about 2.5 to 2.75 per second) during indexing; 62 pulls for 267 keystrokes (**0.23**) after indexing. A pull is not sent per keystroke, but about one per 4 to 7 keystrokes while typing continues. No budget is declared by the design; recorded as measured |
| U5 step 5 / 6b Restart | `fx-ws` with the root manifest broken: the `↻ Restart` control is **offered** while health is `error` (before: absent); clicking it ended the old session (`shuttingDown`) and started a new one, health `ready/ok` |
| U9 (sync) | Byte for byte equal at every step including 5a, 5c, 5b (CRLF), the 2000-line insert, the non-BMP character and the tab switch; no version errors, max in flight 1 |
| U3 marker latency (5 runs, change seed) | Edit to marker **0.05 to 0.10 s** and undo to clear 0.16 to 0.21 s. This is **not** the 0.31 to 0.36 s recorded before the fix, so the earlier gap is no longer present on this build; Implementation expected it to stay |

One harness incident, unexplained: the first `g3a` run on the candidate ended with `RemoteDisconnected` about 3 s into typing (`c-g3a/`); no core dump of the app exists, and two repeat runs were clean. Recorded as the third occurrence of this symptom, not counted as a crash.

**Verdict:** the `didChange` fix and the Restart fix are **Verified**, harness-observed, pending user review. Not re-run in this pass: the U7 save seed and the WebKitGTK check of the "Illegal invocation" cause itself (the behaviour change above is the evidence).

#### Suites at `9083915`, U6 (V2) and the save seed again (2026-11-09, DA-3, DA-7). Harness-observed, pending user review.

Build: `feat/lsp-stage-1b` at `9083915` (own run checkout `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/fin-9083915`; dev binary on port 1440, Xvfb `:98`, isolated `HOME`). Scripts `scripts/jobb_u6.py`, `jobb_u7.py`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/u6/` and `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/f-u7/`.

**Suites (covers the test-only ETXTBSY merge).** `node --test` 125 passed; `tsc` 0; `vite build` 0; `cargo test --lib` run **3 times**: 236 passed, 0 failed, 9 ignored each time, **no flaky test seen** (back to back, a quiet machine; the timing flakes Implementation reported in `lsp::tests` did not occur); `process_cleanup` 7 passed, 1 ignored; 26 `commands::debug*` tests ok.

**U6, V2: the file-watch limit (one 120 s hold; the user's answer, relayed by the lead: "Yes, run U6").** Method A5: `inotify_hog.py --hold 120`, one process in its own session, no sudo, no setting changed. Watches in use by the user before: 8140 (limit 524 288). The helper reported `holding` (`hit_enospc: true`, 131 watches free) 10 s after it started.

| Observation | Result |
|---|---|
| Chip during the hold (about 6 s after `main.rs` opened) | `rust-analyzer ⚠`; hover `File watching failed (changes on disk may be missed): … WARN notify error: OS file watch limit reached. about […/fx-small/src]` |
| Output, `Language Server` source | the raw server lines `WARN notify error: OS file watch limit reached` for the project folder and `src` (four lines) |
| After the helper released | The chip **kept** the ⚠ (the server sends no all-clear, decision 28) |
| `↻ Restart` | **Not offered**, during the hold or afterwards: the status is a warning, not an error and not an ended session (the Restart fix covers error health only). The guide's "click `↻ Restart` and the ⚠ clears" cannot be followed from the status bar, as with U5 step 5 before the Restart fix. A new session (closing and reopening the solution) was not tried |
| **Release** | The helper exited by itself 131.5 s after the run started, **exit code 0**, `reason: hold expired`; its pid is gone; watches in use afterwards **8126** (before: 8140), so the quota is back to baseline; no helper process remained. One hold only |

**Verdict (V2):** the watch-limit warning shows on the chip and in Output as the repair R1 describes, and it persists until a new session; verified harness-observed, pending user review. The clearing step is **Unverified** because no restart control exists for this state. Whether a restart should be offered for a warning is for the architect.

**U7 save seed on `9083915`.** The same `fx-many` run as before (edit one line of `m000.rs`, `Ctrl+S`): after 75 s the push set was unchanged (`arrivals.push` 137, `storeWrites.push` 137, `stored.push` 7278, markers 16 to 17 from the pull route), so **no new push diagnostics arrived after the save**, as before the fixes. The harness lost its connection (`RemoteDisconnected`) after this measurement, during the later steps of the script (fourth sighting; no cause found), so the closed-tab part was not read in this run. Implementation is checking the `didSave` and check-on-save wiring.

#### Other findings recorded during U1 (not 1b verdicts)

1. **The language-server usable check accepts any binary that exits 0.** `lldb-dap` was accepted as Rust's language server. That is consistent with the designed check (V7), which proves only that a binary runs. What the chip showed for that session was not observed.
2. **Toolchain discovery never rescans.** Preferences showed the language server "Not found" on Automatic. The rust toolchain scan in `~/.craidd-studio/user_preferences.toml` (`scanned = true`, cargo 1.98.1) predates the rust-analyzer install. This is an existing discovery limitation; Choose Path… is the workaround.
3. **Harness artifact.** Vite warned that Monaco's `codicon.ttf` is outside its serving allow list, because the run checkout's `node_modules` is linked to the main checkout. Icons may not render. LSP behaviour is unaffected.

### Findings 8–12 (Documentation lane; no verdicts)

Recorded from the manual UI review and the handoff. They continue the numbering of the handoff's finding list and are findings, not verdicts: none changes a gate or a V row. Findings 9 and 10 carry fix proposals approved as stand-ins under [DA-8](delegated-approvals-lsp-stage-1.md); nothing is implemented here.

8. **Progress events before a view exists are dropped.** If a Channel batch carries progress but no status, `updateSession()` has no view to attach it to and ignores it. Implementation has not checked whether the backend's first batch always carries a status. Open: Implementation checks the backend and reports. If a first batch can lack a status, a fix goes through DA-7 (a regression test and an independent re-check); otherwise this stays a note. Under DA-6, no fix is proposed here.
9. **The language-server "usable" check accepts any binary that exits 0 on `--version`.** This let `lldb-dap` be accepted as the Rust language server (`src-tauri/src/commands/toolchain.rs`; see also "Other findings recorded during U1", item 1, and V7).
   - **Proposal (stand-in approval, DA-8; the architect may revise it):** the toolchain table entry for a role declares how a binary identifies itself; for `rust-analyzer`, `--version` output beginning `rust-analyzer`. The usable check requires that identity. A mismatch shows "Not usable: this looks like a different tool", with the version line shown. The identity comes from data in the table, not from a rule hardcoded at runtime.
   - **Risk:** a legitimate build whose version line does not start with the declared text is rejected until the user chooses it by path or the table entry is widened; a wrapper such as a rustup shim prints its own line (V7's rustup-shim case is still Unverified), so the declared identity must be checked against it. The check stays a statement that the binary identifies as the tool, not that it works.
   - Goes through DA-7's rules: a regression test and an independent re-check.
10. **Toolchain discovery never rescans.** `~/.craidd-studio/user_preferences.toml` held a stale `[toolchains.rust] scanned = true` with only `cargo` and `rustc`, so `rust-analyzer` showed "Not found" after it was installed (see "Other findings recorded during U1", item 2). The user's preferences file is not edited by an agent.
    - **Proposal (stand-in approval, DA-8; the architect may revise it):** when a role's binary is missing from the stored scan, Craidd re-probes on read and shows what it found. It writes that result to preferences **only** when the user presses the existing Rescan or Save action. Nothing is installed, and the user's file is not edited by an agent.
    - **Risk:** a re-probe on every read of a missing role costs a process spawn per read unless bounded or cached for the session; the displayed result and the stored result can differ until the user saves, which the interface must say. Goes through DA-7's rules.
11. **A status batch that arrives after the solution closes creates a view for an old session.** Harmless; mentioned only. Not investigated further.
12. **The `codicon.ttf` console message is a Vite allow-list artifact.** The nested run checkout uses the parent `node_modules`, so Vite refuses to serve the font from outside its allow list. It is not a product defect (the same observation is item 3 of "Other findings recorded during U1").

**Decision 39 (design) — note.** The design records the two defects found in this review as [decision 39](design-lsp-stage-1-rust.md#open-decisions-for-review), under stand-in approval DA-5: `startupDone` never set (`700b59d`), and the first-attach chip crash (`ead1a68`, tests `39f4e89`, with the local `ChipBoundary` around `LanguageServerChip`). Their verification stays as recorded above; this note adds no result.

### Findings 13–19 (Documentation lane; from Job B; no verdicts)

Recorded from the Verification lane's Job B records above, which stay the evidence. They continue the numbering of findings 8–12 and are findings, not verdicts: none changes a gate or a V row. Each names the record it comes from. Fixes marked as queued or approved are Implementation's under [DA-7](delegated-approvals-lsp-stage-1.md); nothing is fixed here.

13. **"File > Get Started" does not close the solution.** The menu item leaves the solution open and the server up, so the only close the harness can reach is closing the window. Source: "Job B, batch 1: U1 (reworded), U2 and U8" (the not-covered note). Effect: G6's close path (U8) was measured through the window close, not through a solution close from the menu.
14. **`↻ Restart` is not offered for a ready session with health `error`.** `StatusBar.tsx` (line 47) shows it only when the session has ended or is `unresponsive`; a `ready` session with an error health shows only the chip, and clicking the chip opens nothing. Decision 38's recovery (the manual restart) therefore cannot be reached from the status bar in that state. Source: "Job B, batch 6: U5 steps 3, 6a and 6b" (step 6b). A fix is queued under DA-7.
    - **Update (8 November 2026, DA-7):** fixed in `51ad0d9` (`restartOffered`). Pending Verification's independent re-check; no verdict here.
15. **`didChange` is held back during continuous typing.** In the G3 typing runs the client sent a few `didChange` messages early, then none for 36 s while 744 keystrokes were typed 150 ms apart, then one `didChange` with 663 changes when typing stopped; a second run sent one `didChange` with 782 changes at the end. Source: "Job B, batch 9: G3 leftovers" (the observation). The record states the cause is not established. The cause is under investigation, and a fix is approved under DA-7 if the cause is confirmed.
    - **Update (8 November 2026, DA-7):** cause found by Implementation. `DocumentTracker`'s default scheduler was `queueMicrotask` assigned as a field (`src/lib/lsp/documents.ts:78`), so the browser threw "Illegal invocation", `flushQueued` stayed stuck, and only the pull's own flush sent `didChange`. Fixed in `a203c10`. Pending Verification's re-check; no verdict here. The 0.31 s trigger-to-marker lag recorded under V3 is a separate thing: it is the designed 300 ms pull debounce.
16. **About 620–690 MB of extra webview memory for about 21 000 diagnostics on `fx-big`.** Monaco with the file accounts for about 700–770 MB; the language-server path adds about 350 MB at ready and about 620–690 MB once the check's diagnostics (about 21 000 rows, 20 495 stored push) have arrived, with a further 70 MB when shown in the Problems panel. Sources: "Job B, batch 8" (U11 and retention with memory) and "Job B, batch 10" (where the webview's memory goes). The cause is under investigation. It bears on decision 22's question whether complete diagnostic sets fit a measured budget, which is the architect's; no budget is set here.
    - **Update (8 November 2026):** Implementation's reading of the code, **not profiling**, puts the retained data at about 100 MB: stored items 30–60 MB, store rows about 9 MB, and two derived panel copies about 18 MB (`BottomPanel.tsx:32`, `58`, `61`, `64`). The rest is likely allocation churn: each of about 194 frame writes rebuilds all rows and both panel arrays, even with the Problems tab closed, and WebKit keeps the high-water mark. No unintended retention was found. Cheaper shapes are candidates for the architect under decision 22; none is chosen here, and the churn explanation is unmeasured.
17. **Monaco models are never disposed when a tab closes.** Closing the `main.rs` tab left its model alive (0 views); only two `create` events and no `dispose` event were seen across the close and the reopen, consistent with `keepCurrentModel`. The server side follows the tab (`didClose` was sent). Source: "Job B, batch 8" (U11, V9). The split view is not tested.
18. **U10 facts (V16).** In both open orders only the canonical path is registered with the server (`didOpen` for the canonical `real_mods/deep.rs` and none for the tab opened through the symlinked path). The symlinked-path tab shows no chip and no alias note; the guide expected the first-opened tab to be the holder and the second an alias with the chip `rust-analyzer: alias`. The cause is under investigation. Limits stated in the record: tabs were opened through the store action and not the tree; steps 3 and 5 (close both, promote) were not run. Source: "Job B, batch 11: U9 steps 8 and 9 and U10". **V16 stays open** (decision 37, DA-13); the record's proposed V16 wording is a proposal for the architect, not a decision.
    - **Update (8 November 2026):** cause found by Implementation. The alias is never detected because ownership rejects any path through a symlinked folder or file (`src-tauri/src/ownership.rs:107`, `111`; the header at `ownership.rs:6`), so the symlinked tab is `NotRouted` with "no owning project" and renders no chip (`StatusBar.tsx:16`). Decision 12's symlinked alias cannot be reached while ownership rejects symlinks: a **design conflict for the architect** (V16, decision 37, decision 52). It is also a UX gap: a `NotRouted` tab shows no reason at all.
19. **The EOL finding was raised and then retracted as a tooling error.** An earlier version of the U9 record said an EOL change is not sent to the server. The comparison script read the rebuilt server text with `Path.read_text()`, which turns `\r\n` into `\n`; read as bytes, the server's text equals the model, and the app does send `didClose` and `didOpen` with the CRLF text. Recorded so the trail is honest. Source: "Job B, batch 5: U9 (G7 synchronisation)", the correction note. It is not a product finding.

### Toolchain fixes for findings 9 and 10 and the chip hover, independent re-check (2026-11-08, DA-7 and DA-8). Harness-observed, pending user review.

Under test: `fix/lsp-1b-toolchain-2` at `345eb37` (cut from `0778c9e`: `6cfcf7a` identity check, `3346a72` re-probe on read, `345eb37` chip hover). Own run checkout `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/tc-345eb37` (detached, git-ignored); dev binary on port 1440; Xvfb `:98`. Every launch used an isolated `HOME`; the user's `~/.craidd-studio` was never read or written. Scenario script `scripts/jobb_tc.py` on `verify/lsp-stage-1b-jobb`; evidence `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/jobb/tc/` (`result.json`, screenshots `stale/out/prefs-stale.png`, `prefs-rescanned.png`).

| # | Check | Result |
|---|---|---|
| 1 | Suites | `node --test` 120 passed; `tsc` 0; `vite build` 0; `process_cleanup` 7 passed, 1 ignored. `cargo test --lib` run **5 times**: 236 passed, 0 failed, 9 ignored each time. **No flaky test was seen.** The runs were back to back on an otherwise quiet machine, so a failure that needs CPU contention, which Implementation may have hit once, is not ruled out. Logs `tc-lib-1.log` to `tc-lib-5.log`, `tc-node.log`, `tc-tsc.log`, `tc-vite.log`, `tc-pc.log` under `/mnt/ext_drives/Development/Development/Desktop Development/Craidd-Studio/.claude/worktrees/intellisense-verify-0b263b/verification/lsp-1b/runs/` |
| 2 | `/usr/bin/lldb-dap` as the Rust language server | `set_tool_default(rust, language_server, /usr/bin/lldb-dap)` returned `Not usable: this looks like a different tool (lldb-dap: LLVM (http://llvm.org/):)`, and the preferences file hash was unchanged. **Limit:** the Preferences "Choose Path…" button opens a native file dialog, which the harness cannot drive. The command the button calls was invoked directly, so the dialog and the message's on-screen appearance are not checked |
| 3 | Stale preferences (`scanned = true`, only `cargo` and `rustc`) | A Rust file opened from that file launched the server: `rust-analyzer` ready at 3.0 s, 1 process. Preferences showed `rust-analyzer: rust-analyzer 1 (9074e9b4c6 2026-09-06)` and the notice `Showing tools found just now that your saved scan lacks. Nothing is saved until you press Rescan my system.` The file hash was unchanged after the launch and after viewing Preferences. Pressing `Rescan my system` changed the file, and it then lists `rust-analyzer`. The notice's colour (amber) was not judged; it is for the user's eyes |
| 4 | Chip hover while spawning | In 5 runs, a 20 ms sampler plus a `MutationObserver` recorded every chip text and hover change from the open of `main.rs`. **No run showed `undefined`.** The first chip state seen was `rust-analyzer: starting` and its hover already carried the server path, version and root. The earlier state (a view without a server) lasts about 1 to 2 ms and **was not caught**, so this does not exercise the case the fix targets. The new node test is what covers it |

Verdict: items 1 to 3 **Verified** as far as the limits state, and item 4 **Unverified** for the targeted window (no failure was seen). Harness-observed, pending user review.

### Waiting for the scripted manual runs (user review)

U1 (G1), U2 (G2), U3 (V3, V26, decision 19 in the IDE), U4 (V24 in the IDE), U5 (V27 trigger path; step 6a nested non-member, 6b member with a broken workspace root), U6 (V2 chip and Output), U7 (G5, V15, V20), U8 (G6), U9 (G7), U10 (V16 holder, including the canonical-path-first case), U11 (V9), U12 (G3, G3b, V4 lock, V26, `inputToPaint` against the probe), U13 (optional: hooks on/off on the IDE's wire).

*Last updated: Phase 3 (Stage 1a, adapter integrated as 99863a4; F1–F3 investigated; decisions 16–37 approved; Stage 1b implementation, repair pass and decision 33 follow-up recorded and independently verified; U1 attempt 3 at 700b59d held by a chip defect; chip-crash fix ead1a68 verified). Author: ShinkuKira21.*
*This document is a record.*
