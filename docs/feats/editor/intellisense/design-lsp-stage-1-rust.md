# Design: LSP Stage 1 — Rust foundation

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Proposal for review. No implementation code has been written. No LSP client exists in current source.

**Revision:** Revised after the [comparison review](review-lsp-stage-1-comparison.md) (findings N1–N9) and four earlier design-review concerns. The architecture is unchanged; the changes are clarifications and safeguards. What was already covered, what was refined and what is new is listed in [Review reconciliation](#review-reconciliation). A further independent review is reconciled in [review-lsp-stage-1-independent-reconciliation.md](review-lsp-stage-1-independent-reconciliation.md); the changes it prompted are **approved** (decisions 11–15). Philosophy amendments A1, A2, A3, A4 and A5 are approved and applied to the philosophy; A6 and A7 remain pending.

**Revision (pull diagnostics).** The architect moved pull diagnostics into Stage 1b after the [F1 evidence](results-lsp-stage-1.md#f1f3-evidence) showed that `rust-analyzer` delivers its own diagnostics only when asked. The design now has two diagnostic routes per file, push and pull, described once in [Pull and push diagnostics](#pull-and-push-diagnostics); the rules elsewhere refer to it. Amendment A4 is reworded to match and is still a proposal. The architect has since approved decisions 16, 17 and 18 (the `null` reply to the refresh request, server-status reporting of silent failures, and clearing a closed document's pull set). Decision 19 (cross-document refresh) is now **approved**, and amendments A2 and A4 are **approved and applied** to the philosophy; see [Open decisions](#open-decisions-for-review). A6 and A7 remain pending. The architect's Stage 1b verification decisions (20–27: readiness gating, workspace reload, retention, measurement hooks and methods) are recorded in the same list and in the sections they name. The architect's Stage 1b repair decisions (28–37: the watcher-limit warning, the lock glyph moving to 1c, project attribution, the readiness fallback, reload membership and several test and metric corrections) follow them.

**Applies to:** Rust only, through `rust-analyzer`.

**Governs:** The architecture of Craidd's language-server client, as proven on one language. Later stages add table entries and adapters on top of it.

**Authority:** [philosophy-intellisense.md](../../../philosophies/ide_editor/intellisense/philosophy-intellisense.md) stays authoritative. Where this design changes a rule there, it is listed in [Philosophy amendments](#philosophy-amendments-required). Nothing in this document silently overrides it.

---

## Objective

A robust, responsive LSP foundation. Not "autocomplete appears in Monaco".

Stage 1 is done when the shape is correct under stress: server identity, routing, document synchronisation, capability negotiation, failure recovery and containment all hold, and the [performance gates](#performance-gates) have recorded results against a baseline. Completion, hover, definition, references, document symbols and diagnostics are the features used to prove it.

## Non-goals

- No language other than Rust. No clangd, TypeScript, C# or Python behaviour.
- No multiple servers per language. The catalog shape allows it; nothing orchestrates it.
- No user-editable server settings, no settings UI.
- No rename, code actions, signature help, inlay hints, semantic tokens, workspace symbols, formatting.
- No workspace-wide pull (`workspace/diagnostic`). Pull is per open document only.
- No cross-window diagnostic aggregation (philosophy stage 6). The diagnostic record is shaped so stage 6 does not need a rewrite.
- No bundling, installing or bootstrapping of `rust-analyzer`.

---

## What exists today

Verified against the source on this branch.

| Need | Existing piece | Stage 1 use |
|---|---|---|
| Message reading | `read_message` in `commands/debug.rs`: `Content-Length` parse, 8,000,000-byte cap, private to the DAP client | Extract into a shared framing module. DAP behaviour must not change. |
| Off-thread writes | `DapWriter` in `commands/debug_transport.rs`: dedicated thread, bounded queue (128), `try_send` that fails fast instead of blocking | Same pattern for LSP writes. Generalise, do not copy. |
| Spawning owned children | `process_supervisor::spawn`: registers the child before it can run, TERM then KILL after a bounded grace on IDE exit, survives IDE SIGKILL | All server spawns go through it. |
| Process-tree stop | `process_supervisor::capture_cancel_tree(pid, birth)`: identity-scoped, guards PID reuse | Bounded termination after graceful `shutdown`/`exit`. |
| Thread panic safety | `containment::guard`, `containment::signal_name` | Wrap reader/writer/stderr threads. Report signal exits by name. |
| Tool discovery | `toolchain.rs` static `catalog(language)` of `(role, name)` pairs, `resolve_tool(language, role)`, preferences in `~/.craidd-studio/user_preferences.toml` | Add a `language_server` role to the Rust entry. |
| Problems panel | `useBuild.problems` (`BuildProblem`: file, line, column, severity, message, code) and linked-window problems carrying `windowLabel` / `projectName` | Add an LSP diagnostic source beside it. |
| Editor | `@monaco-editor/react` `<Editor path={fileId}>` in `CodeView.tsx` and `SideEditor.tsx`. Two views can show the same file, so a model is shared. | Document tracking is per model, not per view. |
| Disk changes | `stat_files`-on-focus and conflict/reload through `solutionStore`. No file watcher. | See [External disk changes](#external-disk-changes). |
| Tests | `src-tauri/tests/process_cleanup.rs` (production supervisor, no GTK); `node --test` suites | Same shapes for LSP tests. |

Gaps found while reading, to be resolved during implementation, not assumed here:

- There is no single named "file → owning project" resolver. Ownership logic is spread across stores (for example `solutionStore.ts` project lookup). Stage 1 needs exactly one, and it must be the same one the Explorer and linked windows use.
- `catalog()` is a static slice. Whether Preferences renders new roles automatically needs checking.
- The exact Monaco model URI that `@monaco-editor/react` creates from `path={fileId}` must be confirmed. The boundary rule below makes this safe either way.

---

## Architecture

```
 Monaco models ──► monaco bridge (TS) ──► Tauri commands / Channel ──► LspRegistry
 (source of truth     per-model doc                                     │  identity → Session
  for text)           tracker, position                                 │
                      mapping, provider                                 ▼
                      dispatch                                    Session (one per server process)
                                                                   ├─ state machine
 Problems panel ◄── lspStore (TS) ◄── Channel ◄── Router ◄─────────┤  pending-request table
 Monaco markers      per-(session,uri)           (diagnostics,     ├─ doc table (open docs, versions)
                     diagnostic sets             progress, status) ├─ writer thread  (bounded queue)
                                                                   ├─ reader thread  (framing → dispatch)
                                                                   └─ stderr thread  (bounded log ring)
                                                                          │
                                                                          ▼
                                                                  rust-analyzer process
                                                                  (setsid, supervisor-owned)
```

### Backend modules (Rust, `src-tauri/src/lsp/`)

| Module | Responsibility |
|---|---|
| `framing` | `Content-Length` read/write. Shared with DAP after extraction. Tolerates `Content-Type`, rejects missing/negative/oversized length, never reads a partial body as complete. |
| `transport` | Writer thread with bounded queue; reader thread; stderr drain. Panic-guarded. |
| `session` | One server process: state machine, JSON-RPC id allocation, pending table, document table, capability store. |
| `registry` | `ServerIdentity → Session`. Get-or-start, stop-by-solution, stop-all. |
| `adapter` | Trait resolving a project to a `ServerContext`. `adapter::rust` is the only implementation. |
| `router` | File → owning project → adapter → registry. Pure and unit-testable. |
| `commands` | Tauri surface. Every command returns without holding a lock across a server round trip. |

### Frontend modules (TS)

| Module | Responsibility |
|---|---|
| `src/lib/lsp/bridge.ts` | Per-model document tracking, ordered change capture, position/range mapping, flush-before-request. |
| `src/lib/lsp/providers.ts` | Monaco provider registration and dispatch. Stale-response rejection. |
| `src/store/lspStore.ts` | Session status, progress, per-(session, uri) diagnostic sets, bounded updates. |

### User-visible surfaces

*Approved.* Stage 1 adds no panel, bottom-panel tab, sidebar view, preferences page or toolbar button. It extends what exists:

| Need | Existing surface | Extension |
|---|---|---|
| Server status (not found, starting, indexing, ready, unresponsive, crashed) | Status bar (`StatusBar.tsx`) | One small chip next to the language and file items. Click opens the log; hover gives the detail (binary, version, root). |
| Server log (`window/logMessage`, `showMessage`, stderr) | Output tab | Lines prefixed `[lsp:rust-analyzer]` shown as an additional source in the existing tab. Output today shows one stream chosen from build or debug output and has no channel concept, so this needs a small source extension, decided in Stage 1b. Per-source filtering is deferred. (The existing `[craidd-debug]` prefix is process stderr, not Output, so it is not a precedent.) |
| Diagnostics | Problems tab | A source badge on each row (build or language server) and per-source counts, as already decided. |
| Read-only external file | Editor tab | A lock glyph beside the file icon. The status-dot column stays for deleted, newer and dirty. **Delivered in Stage 1c** with go-to-definition, the only way an unowned file is opened (decision 29); the requirement is unchanged. |
| Which server to use | Preferences → Toolchain | A `language_server` role in the existing per-language loop. |
| Watcher problem | Status chip and Output | A warning on the chip with the raw server text in Output. Recognised from the verified server line `WARN notify error: OS file watch limit reached.` (decision 28). |

### Server-to-frontend delivery and message classes

Server output reaches the frontend through a `tauri::ipc::Channel` per window, not global events. Channels are ordered per channel and intended for streaming; diagnostics and progress during indexing can be high volume. Messages are small typed envelopes, never raw LSP JSON. This keeps protocol knowledge in the backend.

Streaming is safe only if it can never starve or corrupt correctness. So every inbound message is classified by the **reader thread** the moment it is parsed, and the class fixes its path and whether it may ever be coalesced or dropped. Coalescing applies to *inbound state snapshots only*. It never touches client-to-server traffic (document synchronisation, requests, cancellation); those are protected by [Desynchronisation and writer-queue overflow](#desynchronisation-and-writer-queue-overflow).

| Class | Examples | Path | Coalesced? | Dropped? |
|---|---|---|---|---|
| **R** Responses to our requests | completion, hover, definition, references, symbols, resolve results, **pull diagnostic reports**, and errors | Pending table → the awaiting command's one-shot channel → returned as that command's result. **Not** sent over the Channel. | Never | Never, except a deliberate, counted drop when nobody wants it any more (superseded, closed document, cancelled, dead session) |
| **Q** Server-to-client requests | `window/workDoneProgress/create`, `workspace/configuration`, `workspace/workspaceFolders`, registration, `window/showMessageRequest`, `workspace/diagnostic/refresh` | Answered **by the backend itself** from a static handler table; the frontend is not involved. The reply uses the writer's reserved capacity. | n/a | Never. Every request gets exactly one response. |
| **S** Replaceable snapshots | `publishDiagnostics` (the push route; key: session + uri), `$/progress` (key: token) | Backend coalescing map → batched delivery | Latest-wins per key, under the rules below | Only values already superseded by a newer one for the same key |
| **L** Lossy by declaration | `window/logMessage`, `window/showMessage`, stderr | Bounded ring per session | n/a | Oldest first, with a visible "N lines dropped" counter. Error severity is kept in preference to lower severities. |
| **T** Session status (a record, not a queue) | session phase, session-ready, negotiated-capability summary, the set of documents needing resync | A per-session **status record** read by the delivery task; changed fields go out in the next batch; also available by pull | Latest state wins; the **terminal phase is absorbing** | Never. A terminal phase cannot be overwritten or discarded, and the record cannot overflow. |

**Rules for class S**

- **Diagnostics.** The pending value for a uri is the last published set, **including an empty set**. An empty set is a real update (it clears), never treated as "nothing to send". A set equal to the last *delivered* one is skipped. The `version` field travels with it.
- **Progress.** Per token the record is `{ begun, latest, ended }`. `end` is never dropped. If `begin` and `end` both occur before a delivery, one "completed" record is delivered so the status can never be left saying "indexing". Reports pending when `end` arrives are discarded.
- **Ordering.** Within a key, arrival order decides. There is no ordering promise across keys. On a terminal session state, the session's pending S entries are discarded once the terminal phase is recorded; this is the same rule as "diagnostics from a dead session are cleared".

**Reader-thread guarantees**

- The reader performs O(1) work per message, holds no lock across I/O, and never blocks on the frontend. A stalled frontend therefore cannot stop the reader draining the server's stdout, so it cannot stall the server through a full pipe.
- R and Q do not depend on the Channel at all, so a notification flood cannot delay a response or leave a server request unanswered.
- Memory in the coalescing map is bounded by the number of distinct keys (files with diagnostics, live progress tokens), not by message count.

**Bounded, acknowledged delivery**

- The backend sends S in batches bounded by count and bytes (values set at implementation from the G3 measurements), and sends the next batch when the frontend acknowledges the previous one. Between batches, incoming S entries keep coalescing.
- If the frontend never acknowledges, S keeps coalescing within its key bound, and R and Q are unaffected. T is a fixed-size record, so nothing accumulates (see below).

**Class T is state, not a queue**

- The record holds: the session generation, the phase, the terminal reason, the negotiated-capability summary (set once, when Ready), a **set** of document URIs needing resync, a **diagnostics-refresh counter** (see [Pull and push diagnostics](#pull-and-push-diagnostics)), and the server's last reported **health** (`ok`, `warning` or `error`, `quiescent`, and a message truncated to a bounded length; see [Server health](#server-health-silent-failures)).
- **Terminal is absorbing.** It is set by compare-and-set inside `terminate()` ([One terminal transition](#one-terminal-transition)); once set, nothing overwrites it.
- Intermediate phases may collapse. The frontend needs the current state, not the history. Anything that seems to need "exactly once" (registering documents when Ready, for instance) is derived idempotently from `(generation, phase)`.
- The resync set is bounded by the number of open documents and is idempotent.
- The refresh counter is one integer. The backend increments it when it answers `workspace/diagnostic/refresh`; the frontend re-pulls when the value differs from the one it last acted on. Missing intermediate values loses nothing, because one re-pull covers any number of refreshes.
- The frontend can pull the current record, so a window reload or a missed batch loses nothing.
- There is no queue to overflow, so there is no failure-on-overflow rule and no panic path. A violated internal invariant terminates that one session via `terminate("internal error")`; threads remain wrapped by `containment::guard`, so the IDE process is never at risk.

What this deliberately does **not** do: it does not make the frontend a source of truth for protocol state, and it does not reorder or drop anything the server relies on being answered.

---

## Server identity and ownership

### Separate project ownership from server ownership

Two different questions, answered by two different mechanisms:

- **Project ownership:** which `.craidd` project does this file belong to? This decides language, attribution and what the user sees.
- **Server ownership:** which server process analyses this file? This decides cost and correctness.

Many projects may share one server. A file always has exactly one owning project (or none). Diagnostics are attributed by project ownership, never by which server produced them.

### Adapter

Each language has an adapter that turns a project into a `ServerContext`:

```rust
trait LanguageAdapter {
    fn language(&self) -> &'static str;                  // "rust"
    fn resolve(&self, project: &ProjectRef) -> Result<ServerContext, ResolveNote>;
}

struct ServerContext {
    implementation: ToolRef,        // resolved binary path + probed version
    root: PathBuf,                  // server root (may be wider than the project)
    projects: Vec<ProjectRef>,      // projects this root serves, known at resolve time
    init_options: serde_json::Value,
    lsp_language_id: &'static str,  // "rust"
}
```

`ResolveNote` is a non-fatal status string. Resolution failure never prevents the file opening; it only means no intelligence for that file, with the reason visible in the language-server status.

### Rust root resolution

1. Run `cargo metadata --no-deps --format-version 1` in the project directory, off the UI thread, with a bounded timeout. `--no-deps` avoids network and dependency resolution.
2. Take `workspace_root`.
3. On any failure (no `cargo`, malformed manifest, timeout): fall back to the project root and record `ResolveNote`: "Cargo workspace discovery failed; using the project folder". The editor still opens.

**Supervision and caching**

- `cargo metadata` runs through `process_supervisor::spawn`, like every other IDE-owned child, so it is registered before it can run and reaped if the IDE exits. It never runs on the UI thread, and its output size is capped.
- The timeout is a named constant (◇ initial value, tuned from measurement).
- **Single flight:** concurrent file opens in one project share one subprocess.
- **Cache key:** the canonical project directory plus the file stamps (modification time and size) of the project's `Cargo.toml` and, once known, the workspace root's `Cargo.toml`. A stamp change invalidates the entry using the existing stat-on-focus path; there is no new watcher.
- **Failures are cached too**, under the same key. A broken manifest does not re-run `cargo` on every file open, and fixing the manifest changes its stamp and retries automatically. A user restart of the language server also forces a retry.
- **No silent mutation.** `cargo metadata` must not create or rewrite `Cargo.lock`. Whether `--no-deps` guarantees that is verification V8; if it can, an alternative is needed before the adapter merges.

### Session identity

```
ServerIdentity = ( implementation id, resolved root, configuration identity )
```

- **Implementation id:** resolved binary path plus probed version. A different binary or version is a different server.
- **Resolved root:** the adapter's `root`.
- **Configuration identity:** a stable hash of the `initializationOptions`, plus any environment overrides passed to the process. Changing configuration produces a different identity and therefore a restart on next use. A running session's configuration is never mutated.

Consequences:

- Two Craidd projects in one Cargo workspace resolve to the same root, same binary, same options → one `rust-analyzer`.
- A toolchain preference change produces a new identity. The old session is stopped when its last document closes or on solution close; the new one starts on next file open. This matches the philosophy's "restart on next file open" rule.
- Two windows with the same workspace each have their own session. This follows the philosophy's no-cross-solution-sharing rule and is accepted cost.

### Lifetime scope

The registry lives per window solution session. Closing the solution stops every session it created. No server is shared across windows.

---

## Routing

```
file path
  └─► owning project (single shared resolver; none ⇒ no routing)
        └─► project.language declared in .craidd  (not the extension)
              └─► adapter for that language (none ⇒ no routing)
                    └─► ServerContext (ResolveNote ⇒ status, fall back or stop)
                          └─► ServerIdentity ──► registry get-or-start
```

Rules:

- Language comes from `.craidd`. A `.rs` file in a Config project, or outside any project, is not routed. A `.rs` file inside a Rust project is.
- Routing is a pure function of (file, solution model, preferences). It is unit-tested without spawning anything.
- **Binding is sticky for navigated files.** A file opened by go-to-definition from session S (a dependency source under `~/.cargo`, the standard library) usually has no owning project. It stays bound to S for as long as it is open, and is not sent to any other session. A file with no owning project is opened **read-only** and bound to the originating session. If the file is already open in a tab, navigation focuses that tab instead (see [File identity](#file-identity-three-questions)).

  - The tab shows a lock indicator, so it is clear why typing does nothing. (Built with navigation in Stage 1c; decision 29.)
  - Craidd never saves it, so it has no dirty-state or save path and cannot write into `~/.cargo` or the toolchain.
  - If the originating session ends, the tab stays open but unbound: no intelligence until the user navigates from a live session again.
  - A file that is inside a solution project (including path or vendored dependencies) has an owner, so it is that project's normal editable file and routes by project, not by this rule.
  - If the user already has the same path open as a normal editable file, it keeps its existing owner-based routing; navigation does not change its editability.
- Start is demand-driven by [the trigger rule](#launch-trigger).

### Launch trigger

**Decision (approved):** a server starts for the **visible, active** Rust document, **after startup and any parked-window restore have completed**.

The philosophy says a server starts when a file of that language is first opened. Craidd restores intent, not state, so a normal launch opens no tabs. Tabs arrive after startup in two ways: the user opens them, or a parked linked window is restored with its tabs (`restoredFromHidden`). A restore could otherwise start a server before startup has finished, so Stage 1 defines the trigger precisely:

- **Eligible:** a document that is the visible, active editor model, whose owning project declares Rust, once startup, including any parked-window tab restore, has finished.
- **Not eligible:** background tabs from a parked-window restore. They stay *pending* and receive `didOpen` only when they become the active document and a session exists.
- **Startup never waits.** Startup and editor restoration do not wait for language-server spawn, initialization or indexing. The editor is usable first; intelligence arrives afterward.

**Deferred launch, with a bound.** The launch is scheduled for idle time so it cannot compete with startup work. Idle scheduling must not be able to postpone it forever:

- The deferral has a maximum wait (initial ◇ value to be tuned, not a guarantee). After it, the launch is attempted even if the UI never reports idle.
- The scheduler uses an idle callback with that timeout as the upper bound, not an unbounded idle wait.

**Revalidate before launching.** Between scheduling and execution the world can change. The deferred launch re-checks all of these, and does nothing if any fails:

- the solution (and window) is still open and not closing;
- the document is still open, still visible and active (if the user moved to another file, the check re-runs for the new active document instead);
- the document's owning project still declares Rust, and the adapter still resolves;
- the toolchain preference and resolved binary are unchanged (otherwise re-resolve, since identity may differ);
- no session already exists for the resolved identity (in which case the document simply attaches);
- startup, including any parked-window tab restore, is still finished, and the supervisor is still accepting launches.

A failed revalidation is not an error and shows no warning; it simply means no launch.

**One knob, one log.** The deferral values live in one named constants location, and a debug-only log records why a launch fired (idle, timeout, or revalidation re-run). Without a single place to tune and a single place to observe, the G1 timings could not be attributed to a cause.

**Measured separately.** Gate G1 reports these as distinct numbers, never as one:

1. startup to interactive editor (must be unaffected by language-server work);
2. scheduling delay: from the active document becoming eligible to the process being spawned;
3. spawn to `initialize` response;
4. `initialize` response to the end of initial indexing progress.

---

## Process lifecycle

### State machine

```
            ensure()                handshake ok                shutdown/stop
 (none) ───────────► Spawning ──► Initializing ───────────► Ready ──────────► ShuttingDown ──► Exited
                         │              │                     │                    │
                         └─ spawn error ┴─ timeout / bad init ┴─ unexpected exit ──┴──► Failed / Crashed
```

- `Spawning`: `process_supervisor::spawn` with `setsid`, piped stdin/stdout/stderr, cwd = server root. A spawn refused by the supervisor (IDE shutting down) is `Failed`.
- `Initializing`: `initialize` sent; document opens are queued, not sent. A bounded handshake timeout applies to the `initialize` response only. Indexing happens after `initialized` and is reported through `$/progress`; it is **not** part of readiness.
- `Ready`: documents flush, requests flow. The UI shows indexing as status, never as a wait on typing.
- `Failed` / `Crashed`: terminal. See [error recovery](#error-recovery).

### Graceful stop

1. Send `shutdown`; wait a bounded time for the response.
2. Send `exit`.
3. Wait a bounded time for process exit.
4. If still alive: `capture_cancel_tree` TERM, then bounded wait, then KILL of the process group.
5. Join reader/writer/stderr threads; drop queues.

All of this runs on a background thread. Closing a solution or a window never blocks the UI waiting for a server. IDE exit relies on the supervisor as the backstop; it does not depend on step 1–4 completing.

Partial initialisation (process alive, `initialize` never answered) takes the same path from step 4.

Time values are initial proposals (marked ◇) to be tuned from measured results, not guarantees:

| Value | Initial ◇ |
|---|---|
| `initialize` response timeout | 30 s |
| `shutdown` response wait | 2 s |
| wait for exit after `exit` | 2 s |
| grace between TERM and KILL | follows supervisor (600 ms) |
| write queue depth | 128 (matches DAP) |
| stderr ring buffer | 1,000 lines |
| max inbound message size | configurable constant; larger than DAP's 8 MB to allow big completion/symbol replies, still capped |
| request admission reserve | 16 of the 128 writer slots held back from new requests |
| `Cancelled` pending-entry expiry | 30 s |
| tolerated bad message bodies before `Failed` | 3 |
| bound before a resync is reported Unresponsive | 10 s |
| class T | a fixed-size record; no capacity value |
| class S batch size | set at implementation from the G3 measurements |

### One terminal transition

*Approved.* The session owns four pieces of state that must agree at the end: the pending-request table, the class S coalescing map, the document table and the status record. If "the session ended" were four calls to four subsystems, one would eventually be missed. So:

- **Every** entry into a terminal phase (`Failed`, `Crashed`, `Exited`) goes through one function, `Session::terminate(reason)`. No other code path may mark the session terminal.
- It is **idempotent and first-cause-wins**: the terminal phase is set by compare-and-set. A second cause is logged and changes nothing.
- Fixed order, holding no lock that blocks the reader or writer:
  1. Set the terminal phase and reason in the status record. From this moment request admission, the writer and the reader's dispatch refuse new work for the session.
  2. Resolve every pending-table entry, `Awaiting` and `Cancelled`, to "no result", waking the awaiting commands.
  3. Discard the session's class S entries. The class L ring is **kept**, so the post-mortem remains readable.
  4. Mark the session's documents Pending (or Closed if their tab has closed). The frontend learns this from the status record and the new generation.
  5. Start the process teardown (the [graceful stop](#graceful-stop) sequence if the process is still alive) on a background thread, and release the writer and queues.
- Bookkeeping (steps 1–4) never waits on process teardown (step 5). A user-initiated stop is the non-terminal `ShuttingDown` phase, which refuses new requests and runs graceful stop, then calls `terminate(Exited)`.
- Tests: a table-driven test over every cause (spawn failure, handshake timeout, invalid capabilities, unexpected exit and signal, framing error, bad-body bound, thread panic, completed user stop, solution close, internal error) asserts the same invariants after each: terminal phase set once, no pending entry left, no S entry left, documents Pending, no thread or queue left, no second terminal event.

### Containment

- `setsid` for the process group. Spawn only through `process_supervisor::spawn`, so a server is registered before it can run and is cleaned up if the IDE is SIGKILLed.
- Reader, writer and stderr threads wrapped in `containment::guard`. A panic in any ends the session as `Crashed`, never the IDE.
- Unexpected exit reported with `signal_name` for signal deaths, shown in Output, never swallowed.
- stderr is drained continuously; an unread pipe stalls a server. It goes into a bounded ring shown in Output under "Language Server: rust-analyzer", never unbounded memory.
- A session's threads and queues are released on every terminal state, including `Failed`.

---

## Document lifecycle and synchronisation

The Monaco model is the single source of truth for text. The backend holds no text copy.

### Three lifetimes: tab, model, view

Three different things exist for one open file, and they must not be confused:

| Thing | Lifetime | Role for LSP |
|---|---|---|
| **Tab** (the open document in the solution store) | until the user closes it | Owns the document's registration lifetime |
| **Monaco model** | created when the document is first shown; can be disposed and recreated independently of the tab (for example by the side editor, or by the editor wrapper when its `path` changes) | Source of text and edits **while it exists** |
| **View** (an editor instance showing a model) | mounts and unmounts as panes appear | **None.** A view never opens or closes anything. |

Rule: LSP registration is bound to the **tab**, begins at first activation, and observes the **model** through model-level events (not editor-level events). Two views of one file, a split, or a pane unmounting change nothing. A model with no tab (a transient diff, for instance) is not registered.

Per `(session, uri)` the document is in one state:

```
  Pending ──activated while session Ready──► Open ──model disposed, tab remains──► Suspended
     ▲                                        │ ▲                                    │
     │                                        │ └── model recreated, text hash same ─┘
     │                                        │
     │                                        └── model recreated, text hash differs ──► Desynced ──resync──► Open
     │
  tab exists, never activated        Closed: tab closed | binding changed | session ended
```

- **Pending.** The tab exists, but the document has not been activated while its session was Ready. Nothing is sent. Every restored tab starts here, and so does the active restored tab until the [deferred launch](#launch-trigger) completes. This is the only place restored tabs are handled; the launch trigger decides when a server starts, this section decides when a document registers.
- **Open.** `didOpen` was sent with the model's current text. The document **stays Open while its tab exists**, including when the user switches to another tab. There is no close and reopen on tab switch, which avoids needless churn on the server.
- **Suspended.** The model was disposed while the tab remains. Before disposal the bridge flushes pending changes and records `{ lastSentVersion, textHash }`. Nothing is sent while Suspended. The bridge never uses the solution store's tab content as a text source for the server; the model is the only text authority.
- **Resume.** When a model for that URI exists again, its text hash is compared with the recorded one. Equal → Open again with no notification. Different (for example the file was reloaded from disk while Suspended) → Desynced, then resynchronised. The hash is computed only at suspension and resume, never per edit.
- **Closed.** `didClose` is sent when the tab closes and the session is alive. When the session ends nothing is sent. When the binding changes (toolchain preference change, routing change) the document is closed on the old session and Pending on the new one.

A restored dirty buffer (and any future backup/recovery content) is handed to the model when the model is created. `didOpen` always carries the model's text at activation, so the server never sees pre-restore disk text for a dirty restored buffer.

A document is bound to exactly one session at a time. `didOpen` is idempotent per `(session, uri)`: re-activation of an Open document sends nothing. After a user restart of the session, every document returns to Pending and re-registers when next relevant, with its text taken from its model; the backend never reconstructs text.

### URI and position rules at the boundary

- One function maps file path ↔ `file://` URI. Both directions go through it. Models are keyed by it. Whatever `@monaco-editor/react` produces is normalised here.
- **File identity** is defined in [File identity: three questions](#file-identity-three-questions). The URI sent to the server is the form the session presented: the project's own path for owned files, the canonical path for unowned files.
- Monaco lines/columns are 1-based UTF-16 code units. LSP lines/characters are 0-based. Stage 1 advertises `positionEncodings: ["utf-16"]` only, so no re-encoding is needed, and the conversion is one tested function.
- Text is sent with the model's EOL. If the user changes the model's EOL, that is treated as a full resync of the document.

### File identity: three questions

*Approved.* Three different questions were being treated as one. They have three different answers, and only one is new.

| Question | Identity | Owned by | Stage 1 change |
|---|---|---|---|
| Which **tab** is this? | The absolute path string the store keys it by (`fileId`) | Solution store | **None.** Two path forms stay two tabs. |
| Which **underlying file** is this? | Canonical filesystem path (symlinks resolved when the file exists, lexical normalisation otherwise), computed by a backend command and cached | LSP layer only | New, LSP-only |
| Which **project** owns it? | Project membership by path, as the solution model defines it | Solution model | **None** |

The solution store is not canonicalised. Doing so would change tab, breakpoint, tree and session identity for every feature to serve one subsystem, and it would collapse path views that are legitimately distinct. Whether the store should ever canonicalise is a separate decision with its own design.

Rules:

1. **Registration key.** An LSP registration is keyed by `(session, filesystem identity)`. Nothing outside LSP uses it.
2. **Alias tabs.** If two open tabs share a filesystem identity, exactly one holds the registration. The others are **aliases**: no `didOpen`, no changes sent, language features off, with a visible note ("also open as `<path>`"). Aliases never send text, so the server can never see two diverging models of one file. The holder is, in order: an owned, editable tab over an unowned read-only one; otherwise the earlier-activated tab. When the holder closes, the best remaining alias is promoted to Pending.
3. **Navigation focuses the holder.** A location returned by the server is mapped to a filesystem identity. If a tab already holds it, that tab is focused; a second tab is not created. Otherwise, if the returned path lies under a project root by path, it opens in the project's own path form (owned, editable). Otherwise it opens as an unowned, read-only file bound to the originating session. Explicit opens by path are unchanged: they can still produce two tabs.
4. **Read-only belongs to the path view.** A path with no owning project is read-only; this is independent of what other tabs show the same file.

**V16 stays open (decision 37).** The server returns locations in the path form it was given, not canonicalised, and a hover in the same file opened through its canonical path returned nothing; the build uses the canonical path only to choose the holder, so a canonical-path holder may get no server features (inferred). Rules 2 and 3 above stay as written until U10, the Verification lane's IDE-level holder check, establishes the facts. The four navigation cases (a)–(d) move with go-to-definition to 1c.

**The symlinked-vendor case.** One underlying file reached through a vendored project path and a registry path looks both owned and unowned. Ownership is judged on the presented path and registration on the file, so there is no conflict: the owned editable tab holds the registration; the registry-path view is a read-only alias; a navigation request to either focuses the holder. If the two paths are different files there is nothing to reconcile. Test cases: (a) a vendored copy that is a real directory; (b) a vendored path that is a symlink to the registry copy; (c) both opened explicitly by path; (d) navigation to each while the other is open.

### Versioning

- Each `(session, uri)` has a monotonic integer `version`, assigned by the bridge when a change is enqueued.
- The bridge also captures Monaco's `versionId` per change batch and stores it alongside. Together with the document's sync epoch (see [Desynchronisation](#desynchronisation-and-writer-queue-overflow)) this forms the stale-response key `(epoch, versionId)` used below.

### Incremental sync and fallback

The **validated** `textDocumentSync` capability decides (see [Validating negotiated capabilities](#validating-negotiated-capabilities); the raw value is never used directly):

| Validated sync kind | Stage 1 sends |
|---|---|
| Incremental | Ordered `contentChanges` from Monaco's change events |
| Full | Whole document text on each flush |
| None / unusable | Document is not opened; document-dependent providers are disabled; status explains |

If the bridge ever loses order or detects an unexplained mismatch, the document is **desynced** and is resynchronised by the deterministic protocol in [Desynchronisation and writer-queue overflow](#desynchronisation-and-writer-queue-overflow). Desync is a normal, tested path, not an error.

### Ordered change queue, no blind debouncing

`didChange` is not debounced by time. Instead:

1. Monaco change events append to a per-document ordered queue.
2. Consecutive pending changes for the same document are batched into **one** `didChange` carrying the `contentChanges` array in order, which the spec defines as sequentially applied. This preserves exact semantics while reducing messages.
3. Flush happens at the end of the current event-loop turn (or animation frame), and **immediately before**:
   - any request that depends on the document (`completion`, `hover`, `definition`, `references`, `documentSymbol`),
   - `didSave`,
   - `didClose`,
   - a resync.
4. A deliberately introduced delay window, if one proves useful, must be justified by the typing-latency gate measurement. The default is zero.

This guarantees a request never reaches the server ahead of the edits it depends on.

### Desynchronisation and writer-queue overflow

Recovery must be deterministic, and it must never replay a change that a resynchronisation has already made redundant. Replaying stale changes after a fresh `didOpen` would apply them twice.

Per `(session, uri)` the sync state is `Synced(epoch)` or `Desynced(reason)`.

**Causes.** A synchronisation notification the writer could not admit (queue full); an EOL change; a model replaced mid-sequence; a detected order loss; a session restart; a resume whose text hash differs (see [Three lifetimes](#three-lifetimes-tab-model-view)).

**Protocol**

1. **Detect.** The first failure to admit a sync notification marks the document `Desynced`. The notification that failed is discarded.
2. **Discard, never replay.** The document's ordered pending-change queue is cleared. Changes already inside the writer queue are older than the resync, and the `didClose` + `didOpen` that follows them in FIFO order supersedes them. **Nothing from the discarded queue is ever sent afterwards.**
3. **Epoch.** The document's epoch is incremented. Requests, `completionItem/resolve` calls and diagnostics checks carry the epoch with the model `versionId`; results from an older epoch are dropped. The staleness key becomes `(epoch, versionId)`.
4. **While Desynced.** Further edits only set a "changed since desync" flag; they are not queued as changes. Document-dependent requests on that document fail fast to "no result", because they cannot be flushed. Other documents are unaffected.
5. **Resync.** When the writer can admit the **pair** `didClose` + `didOpen` as one atomic unit (both or neither, so nothing interleaves between them), the bridge reads the model text *at that moment*, assigns the next version, and enqueues the unit. The text already contains every edit made during `Desynced`, so none is lost and none is replayed. On admission the state becomes `Synced(new epoch)` and normal queuing resumes from that text.
6. **Retry is event-driven.** The writer signals when its depth falls back below a threshold; there is no polling loop. The active document is resynchronised first, then the most recently active.
7. **Bounded.** If the writer cannot admit a resync unit within a bounded time (the server is not reading), the session is reported **Unresponsive** in its status, requests continue to fail fast, documents stay `Desynced` visibly, and the user can restart it. Nothing is silently dropped.
8. **Reserved capacity.** New requests are admitted only while the writer depth is below `capacity − reserve`. Sync notifications, resync units, replies to server requests (class Q) and `$/cancelRequest` may use the reserve. A flood of requests cannot starve synchronisation.

The result is a function of the edit sequence and the writer's capacity events alone, so it can be tested with scripted capacity (see Testing).

### Save

On Craidd's successful save, send `didSave` (without text) after flushing. For `rust-analyzer` this is meaningful: it triggers its on-save check (cargo diagnostics). Save semantics are unchanged by LSP; a failed save sends nothing.

### External disk changes

**Decision (approved):** `rust-analyzer` watches the disk itself. Craidd advertises no watched-file support and builds no watcher in Stage 1.

**Ownership boundary.** The server's watcher exists only so the server can keep its own analysis current. It is never read by Craidd and never feeds Craidd state. These stay Craidd's, whatever any server does:

- dirty-state detection,
- external-change detection and conflict resolution (the existing `stat_files` / reload / conflict flow),
- saving,
- any future backup and recovery system.

Corollaries:

- A server event never marks a tab dirty, clean, conflicted or reloaded.
- Craidd never infers "file changed on disk" from a server message.
- When Craidd reloads a document from disk, the bridge sends that to the server as an ordinary content change (same path as any edit). Server and editor therefore agree on buffer text from Craidd's side regardless of what the server's watcher saw.
- Open documents are analysed from the buffer the server was sent, not from disk; the server's watcher is not relied on for them.

**Keeping a Craidd-native watcher possible.** A future Craidd watcher must not require an LSP redesign. The seam is a single backend function, `notify_files_changed(session, changes)`, that would send `workspace/didChangeWatchedFiles`. It is not implemented or advertised in Stage 1. Adding it later means: advertise the capability for that language, route events from the Craidd watcher to the function, and switch the server's watcher option to the client setting. Identity hashing already includes the watcher setting (it is part of `initializationOptions`), so the switch is a clean restart, not a special case.

**Watcher configuration.** The adapter sets `rust-analyzer.files.watcher` to the server-side value.

- Verified from the rust-analyzer configuration documentation: the key `files.watcher` exists, its default is `"client"`, and it is described as controlling the file watching implementation.
- **Not verified:** the documentation page does not list the allowed values or say what the server does when the client lacks watched-file registration. `rust-analyzer` is not installed on this machine, so the behaviour could not be checked locally. Implementation step 3 must confirm the accepted value and the actual behaviour against the real binary before the adapter is merged, and record the pinned version.

**Surfacing watcher failure.** Craidd cannot prove analysis is current, but it must not hide what it can see:

- The session status shows "File watching: server-side" while Ready.
- `window/showMessage`, `window/logMessage` and stderr lines are retained in the Output channel. Messages that indicate a watcher problem (for example inotify limits) are promoted to a visible, non-blocking status warning on the session, with the raw text. Matching is on server-reported text and is best-effort; unmatched failures still appear in the Output channel.
- **The verified signal (decision 28).** With the user's inotify watches exhausted, the server reports nothing on the protocol (no `showMessage`, no `logMessage`) and health stays `ok`. The only signal is the stderr line `WARN notify error: OS file watch limit reached.`, which the server's default log level keeps. The adapter recognises that line (matching on the stable fragment `OS file watch limit reached`, case-insensitively, on stderr and on `logMessage` text), raises a non-blocking warning on the status chip, and **keeps the raw line in Output**, where it also stays in the bounded ring. The warning clears when the session ends; there is no later all-clear message to wait for. Other `notify error` lines are not promoted. The architect called this an error-log message; the verified line is a stderr WARN, and the match does not depend on the severity word.
- **Regression coverage (decision 28).** Fake server: the line on stderr raises the chip warning and the raw line is in Output; the same fragment in a `logMessage` does too; an unrelated `notify error` line does not; the warning does not alter the session phase or health; the ring bound and dropped-lines counter still hold. Real server: the V2 helper-process run (decision 26) shows the chip warning.
- The real-server smoke test includes an unopened-file case: change a file on disk outside the editor and assert that the server's model updated and that an open file's pulled diagnostics reflect it once pulled. Which trigger makes that happen is verification V3 as re-scoped in [Pull and push diagnostics](#verifications-for-pull-diagnostics). A failure there fails the test rather than being tolerated.
- This machine reports `fs.inotify.max_user_watches` = 524288; Linux defaults are often lower, so the limit warning path is a real case, not hypothetical.

### Unsaved buffers

`didOpen` carries the buffer text, not disk text. A dirty buffer is what the server analyses. Closing a tab with unsaved changes follows existing close/save flows; `didClose` is sent when the tab closes (or its binding changes), whatever its dirty state. Disposing a model while the tab remains is a suspension, not a close.

---

## Requests, cancellation and staleness

### Request policy

- Every request goes through the bridge, which flushes the document first, then records `{requestId, uri, epoch, modelVersionId, position}`.
- Per kind and document, the newest request supersedes the previous: a new `completion` cancels the in-flight one.
- Monaco's `CancellationToken` triggers `$/cancelRequest` and drops the result.
- The backend pending table is bounded. At the cap, new requests fail fast with a typed "server busy" error, never queue unboundedly. Providers return empty on it.
- Pull diagnostics (`textDocument/diagnostic`) are requests of this kind, with the additions in [Pull and push diagnostics](#pull-and-push-diagnostics).
- No Tauri command holds a lock or blocks a thread across a server round trip.

### Pending-request table and cancelled requests

The specification requires the server to answer a cancelled request anyway ("a request that got canceled still needs to return from the server and send a response back"), so cancellation cannot simply delete the entry.

- Request ids are monotonic and never reused within a session, so a late reply can never match a different request.
- Each entry is `Awaiting` or `Cancelled`. `$/cancelRequest` moves it to `Cancelled`; it is not removed.
- A reply for an `Awaiting` entry is delivered (class R). A reply for a `Cancelled` entry is dropped and counted. A reply for an **unknown** id (for example an evicted entry) is ignored with a debug log. It is never a protocol error and never fatal.
- The cap counts both states. Under admission pressure, the oldest `Cancelled` entries are evicted first, since they are only bookkeeping; new requests fail fast with "server busy" only if every entry is `Awaiting`. `Cancelled` entries also expire after a bounded time (◇).
- On any terminal session state, every entry, `Awaiting` and `Cancelled`, resolves to "no result" and wakes the awaiting commands, so no provider promise is left pending.

### Completion requests

- The request carries the trigger context mapped from Monaco's completion context: invoked explicitly, triggered by a character (with that character), or re-triggered for an incomplete list.
- The response's `isIncomplete` is carried to Monaco's list-incomplete flag, so Monaco re-requests as the user types for an incomplete list and filters a complete list locally. Without this, every keystroke either re-requests needlessly or filters a list the server wanted refreshed. The exact flag name and re-request behaviour on the pinned Monaco (0.56.x) are listed under pending verifications in the results record.

### Independent stale rejection

Cancellation is best-effort. The server may answer anyway, or answer `ContentModified` / `ServerCancelled`. Craidd therefore also rejects obsolete responses on its own:

- A position-dependent response (completion, hover, definition, references) is applied only if the document's current epoch and the model's current `versionId` equal the captured ones **and** the request is still the newest of its kind.
- `ContentModified` / `ServerCancelled` are treated as "no result", not errors.
- Pushed diagnostics carrying a `version` older than the document's current server-side version are ignored.
- A pull report is applied only if the document's epoch and the model's `versionId` equal those captured when the pull was sent and it is the newest pull for that document. A dropped report does not record its `resultId`.
- Responses for a closed document or a dead session are dropped.

### Accepting a completion, including `additionalTextEdits`

Completion is only correct if accepting an item produces the right text everywhere, not just at the cursor. The common case is an auto-import: the item inserts `HashMap` at the cursor and a `use` line near the top of the file.

**Atomic or rejected** *(Proposed, replaces the earlier partial-apply rules)*. If an item has additional edits, accepting it applies the primary edit and every additional edit together as one undo step, or applies nothing. **Applying the primary edit alone is never acceptable.** It can produce wrong code: an auto-import without its `use` can resolve to a different item of the same name that happens to be in scope, and completions that also change surrounding text would leave that text garbled.

Requirements:

1. **Resolved before applied.** Edits that exist only after `completionItem/resolve` must be present on the item before it is applied. Whether Monaco waits for a pending resolve on accept is verification V10; the design does not assume it.
2. **Edits are mapped like any other range.** `additionalTextEdits` use the same LSP-to-Monaco range conversion (UTF-16, 0-based to 1-based) as every other position. No second code path.
3. **No overlap, or the whole item is rejected.** The LSP spec forbids `additionalTextEdits` overlapping the item's own edit, **including the same insert position**, or overlapping one another. A set that violates this makes the **item unacceptable**: it is not applied at all, a log entry is written, and the user sees a brief notice. It is never degraded to the primary edit.
4. **Insert versus replace.** Where the server supplies both ranges (`InsertReplaceEdit`), the choice follows Monaco's insert/replace mode. Snippet text format is honoured only when the server marks it.
5. **Stale means rejected.** Resolved edits are bound to the `(epoch, versionId)` they were computed against. If the document changed between resolve and accept, the item is re-resolved or rejected; edits are never applied with positions from an older document.
6. **One undo step.** Primary and additional edits apply together so one undo reverts both. Verify against Monaco (V12); if it does not hold, apply them as a single grouped edit.
7. **Normal edits afterward.** The applied changes are ordinary model edits that flow into the bridge's ordered change queue. Nothing LSP-specific marks the tab dirty.
8. **Dead session.** An item from a session that has ended is applied only if it is already **complete** (it needs no resolve and carries every edit it will ever have). If it still needs a resolve, it is rejected.

**Fallback order if Monaco cannot guarantee requirement 1.** Decided in advance, so the choice is not made under pressure:

| Order | Mechanism | Cost | Depends on |
|---|---|---|---|
| F1 | Monaco waits for the resolve; if the resolve fails, times out, is stale or returns invalid edits, a compensating revert after accept (through the item's post-accept command) restores the document and shows a notice. The revert command is a Monaco-local command that Craidd attaches to the item, not a server `workspace/executeCommand` (decision 54). | None when it works | V10 (waiting and revert feasibility) |
| F2 | **Eager mode.** Craidd stops declaring lazy `additionalTextEdits`, so edits arrive complete in the completion list and an item is whole or absent. Documentation and detail stay lazy. | Slower completion lists, measured under G3 | V18 (the server then sends them eagerly) |
| F3 | **Craidd-owned acceptance.** *Stand-in approval (DA-15), probe pending.* Craidd declares lazy `additionalTextEdits` as F1 does. For an item that may still gain edits on resolve, it gives Monaco a no-op primary edit and a Monaco-local accept command (decision 54's mechanism). That command awaits the resolve (decision 43's ◇ bound), validates primary plus additional edits against rules 1–8 above, and applies them as one grouped edit with one undo stop. It rejects the whole item, with no change to the document, if the model's version moved since accept, the resolve fails or times out, or the edits overlap. | A custom accept path in Craidd; the item is visibly inert until the resolve returns | A headless probe (`experiments/lsp-1c-monaco`) showing idle accept is atomic and one undo step, typing during the resolve rejects with the document unchanged apart from the typing, a failed or late resolve applies nothing, and Monaco never applies a partial edit |
| Never | Apply the primary edit alone. | — | — |

If neither F1 nor F2 can be shown to work, atomic acceptance cannot be guaranteed. Acceptance criterion 1 is not weakened to fit; the completion part of Stage 1c does not ship until it can. V10 and V18 both **Failed** (Monaco does not wait for a pending resolve; with lazy edits not declared, `rust-analyzer` omits auto-import items), so neither F1 nor F2 gives atomic acceptance; F3 is approved as a probe first under [DA-15](delegated-approvals-lsp-stage-1.md), and if the probe fails this rule stands.

---

## Capability negotiation

### Client capabilities: advertise only what is implemented

Anything not listed is omitted, not set to false-by-accident.

| Area | Advertised in Stage 1 |
|---|---|
| `general.positionEncodings` | `utf-16` |
| `general.staleRequestSupport` | `cancel: true`, no automatic retry |
| `textDocument.synchronization` | incremental, `didSave`, no `willSave`, no dynamic registration |
| `textDocument.completion` | snippets, markdown + plaintext docs, `resolveSupport` for documentation and detail, and for additional text edits **only while lazy resolution is verified safe** (see the fallback order under [Accepting a completion](#accepting-a-completion-including-additionaltextedits)) |
| `textDocument.hover` | markdown + plaintext |
| `textDocument.definition` | locations only (no `linkSupport`) |
| `textDocument.references` | yes |
| `textDocument.documentSymbol` | hierarchical |
| `textDocument.publishDiagnostics` | `relatedInformation`, `versionSupport`, tag support (unnecessary/deprecated) |
| `textDocument.diagnostic` | no dynamic registration; `relatedDocumentSupport: false`; the same `relatedInformation` and tag support as `publishDiagnostics` |
| `experimental` | Declared by the **adapter**, not the core: for Rust, `serverStatusNotification: true` (decision 17). Other servers advertise nothing here. |
| `workspace.diagnostics` | `refreshSupport: true`. Advertising it commits Craidd to answering `workspace/diagnostic/refresh` (class Q) and to re-pulling when it arrives. |
| `window.workDoneProgress` | yes |
| `workspace` | `workspaceFolders`, `configuration`; **no** `didChangeWatchedFiles`, **no** `applyEdit`, **no** dynamic registration for anything |

### Server capabilities: what the server says is the truth

The `initialize` result is stored on the session, after validation. Nothing is assumed to exist:

- A feature the server did not advertise is not requested. Its provider returns empty and the status shows the feature as unavailable only if the user triggers it, not as noise.
- Completion trigger characters, the sync kind, and similar properties are read from the validated result, never hardcoded.

### Validating negotiated capabilities

The `initialize` result is untrusted input. One function builds an immutable `NegotiatedCaps` from it. Each field is parsed by its allowed shapes; an invalid shape disables that feature with a recorded note and never panics. Only fields essential to correctness can fail the handshake.

| Field | Accepted shapes | Absent or invalid |
|---|---|---|
| `positionEncoding` | `"utf-16"` | Absent → utf-16 (the protocol default). Any other value → session `Failed`: Craidd offered only utf-16, and a different encoding would silently corrupt every position. |
| `textDocumentSync` | A number (0 none, 1 full, 2 incremental) or an object `{ openClose, change, save }`. A number n means `openClose` true and `change` n. | Unknown number, an object without `change`, or `change` above 0 with `openClose` not true → **unusable**: documents are not opened, document-dependent providers are disabled, and the status says why. |
| `textDocumentSync.save` | absent/`false`, `true`, or `{ includeText }` | absent/`false` → no `didSave` is sent. `true` → `didSave` without text. `includeText: true` → text is included. |
| `completionProvider` | an options object | absent → completion disabled. |
| `completionProvider.triggerCharacters` | array of non-empty strings | invalid entries are dropped. The frontend receives only the validated list. |
| `completionProvider.resolveProvider` | boolean `true` only | absent/`false`/any other value → `completionItem/resolve` is **never sent**; Monaco's resolve hook returns the item unchanged without a request. |
| hover, definition, references, document symbol providers | boolean or options object | `false`, absent, or any other shape → that feature is disabled with a note. |
| `diagnosticProvider` (pull) | an options object `{ identifier?, interFileDependencies, workspaceDiagnostics }`, or the same with registration fields (`documentSelector`, `id`) | Absent, `false` or any other shape → **pull is disabled for the session** with a note; the push route still works. `identifier`: a string is kept and echoed in each pull; any other type is dropped. `interFileDependencies` and `workspaceDiagnostics`: booleans only, anything else reads as `false`. `workspaceDiagnostics` is recorded and never used (no workspace-wide pull). |
| `serverInfo` | `{ name, version }` | Recorded for status display only; never used for logic. |
| unknown fields | any | Ignored. |

When resolve is enabled, the `completionItem/resolve` response is applied only to the properties Craidd declared lazily resolvable (documentation, detail, additional text edits). Changes to `label`, `kind`, `sortText`, `filterText`, `insertText` or `textEdit` in a resolve response are ignored and logged, because the specification says they must not change during resolve. The item's opaque `data` is preserved unchanged.

`NegotiatedCaps` never changes during a session; there is no dynamic registration. The frontend receives only the validated summary (booleans and the trigger-character list), never the raw result. A one-line summary is written to Output when the session becomes Ready (for example sync kind, save, which providers, resolve), so a capability problem is diagnosable. A table-driven test covers every row above with valid, absent and malformed values.

### Monaco provider registration

Monaco providers are global per language, not per session. So:

- Register each provider **once** per language, not per session. At call time the provider resolves the model's session and checks that session's capabilities, returning empty when absent.
- Properties that Monaco fixes at registration time (completion trigger characters) are taken from the first ready session's reported capabilities and re-registered only if a later session reports different ones. No Rust-specific characters are hardcoded in the frontend, which keeps the "no hardcoded framework knowledge at runtime" rule intact.

### Server-to-client requests

Servers send requests, not just notifications, and silence stalls them. These are class **Q**: the **backend** answers them itself from a static handler table, without waiting on the frontend, so a stalled UI can never leave a server request unanswered. Stage 1 answers:

| Request | Response |
|---|---|
| `window/workDoneProgress/create` | success; progress is routed to status |
| `workspace/configuration` | the configured values for the requested sections, else `null` entries |
| `workspace/workspaceFolders` | the session root |
| `client/registerCapability` / `unregisterCapability` | Not advertised, so should not arrive. If it does, respond with an error response and record a "capability gap" note in the session log. It is not acknowledged as success while ignored. |
| `workspace/diagnostic/refresh` | **success with `result: null`** (decision 16). Always answered, whether or not pull is enabled for the session. When pull is enabled the backend also increments the refresh counter, which schedules a bounded refresh wave ([Cross-document refresh](#cross-document-refresh-decision-19-revised)). |
| `window/showMessageRequest` | respond immediately with no selection; the message is shown to the user as a non-blocking notice (an action choice from the user is not relayed in Stage 1) |
| anything else | `MethodNotFound` error response |

Dynamic registration is out of Stage 1. If `rust-analyzer` turns out to require it, that is recorded as a finding and addressed as a design change, not worked around.

### Server health (silent failures)

*Approved (decision 17): option (a), with bounded stderr and error-log reporting kept as the fallback and for troubleshooting.* With Craidd's default capabilities a failed workspace load or proc-macro server is silent on the protocol: no `showMessage`, no `logMessage`, no diagnostic, only stderr ([F3](results-lsp-stage-1.md#f3--showmessagerequest-configuration-and-registration-v13), measured). So:

- **(a) Status notification.** The Rust adapter declares `experimental.serverStatusNotification`. The backend parses `experimental/serverStatus` by shape (`health`, `quiescent`, `message`) and keeps the latest value in the class T record: one fixed-size field, latest wins, message length bounded. An unknown `health` value or a malformed body is ignored with a log note. Health is **separate from the session phase**: a session can be Ready with health `error`.
- **Surfacing.** `error` and `warning` show on the existing status chip with the server's raw message on hover and in Output; `ok` clears it. This is the same surface and rule as the watcher warning. Craidd does not interpret or rewrite the message.
- **(b) Bounded log reporting.** Stderr and `logMessage` stay in the class L ring (bounded, oldest dropped first, error severity kept in preference, with the dropped-lines counter) and appear in Output under the `[lsp:rust-analyzer]` prefix. This is the only signal for a server version that never sends the notification, and the detail behind the chip. No new matching of stderr text is added beyond the existing best-effort watcher case.
- **Scope.** Nothing here gates the editor or the pull/push routes. Whether the notification reliably returns to `ok` and what `quiescent` means is verification V27; it is also the readiness signal for [pull gating](#readiness-gating-decision-20) (decision 20), and what `quiescent` means is fixed by V27 before the gate is implemented against it.

---

## Diagnostics

### Record

```
Diagnostic {
  session, uri, projectId?, projectName?, windowLabel,   // attribution
  range { startLine, startCol, endLine, endCol },        // LSP gives ranges; BuildProblem does not
  severity, message, code?, source?, tags[], related[],
  documentVersion?
}
```

- `projectId` is resolved from the file via project ownership, not from the session. It comes from the **backend file-to-project resolver** (`ownership::owning_project`) for every file, including unopened files that hold only push sets; it is never inferred from the deepest containing directory, which mis-attributes explicit includes, config-facet files and ambiguous files (decision 30). An ambiguous file is reported as ambiguous, not guessed. Files with no owning project (dependency sources) are attributed as "external" and are not listed as a project's problems.
- `windowLabel` and `projectName` are present now so linked aggregation later is additive.
- `source` shows where it came from, so rust-analyzer diagnostics and `cargo build` problems are distinguishable.

### Pull and push diagnostics

*Architect decision; detailed design proposed.* Evidence: against `rust-analyzer 1 (9074e9b4c6 2026-09-06)`, the server's own diagnostics arrive **only when the client asks** (`textDocument/diagnostic`). Unprompted push carries only cargo-check (`rustc`) results, on startup and after `didSave` ([F1](results-lsp-stage-1.md#f1--what-republishes-diagnostics-v3), measured, one version). Push alone would show no server diagnostics. The design therefore never assumes which route a given diagnostic takes.

**Two routes, stored separately**

| Route | In practice (measured, one version) | A set is replaced by | Cleared by |
|---|---|---|---|
| **Push** | cargo check (`rustc`) | the next `publishDiagnostics` for that uri, including an empty set | session end |
| **Pull** | `rust-analyzer`'s own analysis | the next `full` report for that uri; an `unchanged` report keeps the set | session end; closing the document (see below) |

- Sets are keyed `(session, uri, route)` in `lspStore`. The route, not the `source` string, decides where a set lives. `source` is displayed and never used for logic, because "pull is rust-analyzer, push is cargo check" is a measured fact about one version.
- Neither route writes the other's set. They are **merged only at display**, beside build problems, which remain a third, separate source ([Semantics](#semantics)). There is no deduplication in Stage 1 (decision 5); the measured argument-count break appears once from each route, as `rust-analyzer` E0061 and as `rustc`.

**Client side**

- The client advertises `textDocument.diagnostic` and `workspace.diagnostics.refreshSupport` ([Client capabilities](#client-capabilities-advertise-only-what-is-implemented)).
- Pull is used only for a session whose validated `diagnosticProvider` is present. Otherwise only the push route exists, and the status notes it.
- Pull covers **Open** documents only. Pending, Suspended and alias documents are not pulled. A document that Resumes or is resynchronised is pulled again once it is Open at its new epoch.

**When to pull**

| Trigger | Rule |
|---|---|
| Open | After `didOpen` has been flushed (also after a resume or a resync), and **not before the workspace is ready** ([Readiness gating](#readiness-gating-decision-20)). |
| After a change, debounced | A time debounce applies **to the pull, never to `didChange`** (the change queue above stays undelayed). Each new change restarts the timer and cancels that document's in-flight pull. The pull is sent after the pending changes are flushed. The debounce value is ◇ and is set from G3b and G5; none is chosen here. |
| Save | After `didSave` has been sent (a successful save only). Seeds the saved document, and the cross-document seed below. |
| `workspace/diagnostic/refresh` | Answered by the backend with `null` (class Q), which increments the refresh counter in the T record. The frontend seeds a wave with the visible Open documents; the rest are flagged pull-needed. |
| Window focus | Seeds the visible Open documents; the rest are flagged pull-needed. At most once per minimum interval (◇). |
| Cross-document change | After a changed document's pull settles, and only if the validated `interFileDependencies` is `true`, every other Open document is seeded. |

All triggers feed one scheduler, the **wave**, described in [Cross-document refresh](#cross-document-refresh-decision-19-revised). Decision 19 is approved, so all six triggers are approved.

**Request handling.** Pulls follow the existing rules and add these:

- Each pull is a cancellable request in the [pending table](#pending-request-table-and-cancelled-requests). At most **one pull is in flight per document**; a newer one cancels the older. A cap (◇) limits pulls in flight across documents, so a refresh with many open tabs is spread out, not sent at once.
- Pulls are admitted only below `capacity − reserve`, like any request. A pull that is not admitted is not lost: the document is marked pull-needed, and the writer's capacity event or the next trigger re-issues it.
- A `ContentModified` or `ServerCancelled` answer is "no result". If the cancellation data says `retriggerRequest`, as the specification defines for diagnostic requests, the document is re-armed once per debounce window, up to a bounded number of consecutive times (◇), so it cannot loop.
- `previousResultId` is sent only when the last **accepted** report for this uri carried a `resultId`. A `resultId` is reset when the document is resynchronised, closed, or the session ends, so an `unchanged` answer can never confirm a set that was discarded.
- Staleness follows the existing key: `(epoch, versionId)` captured at send ([Independent stale rejection](#independent-stale-rejection)).

**Lifecycle and the existing rules**

- **Closing a document clears its pull set**, unlike its push set. The N7 rule (a close does not clear diagnostics) rests on the server keeping the set current; nothing refreshes a pulled set for a closed file, and showing it as current would mislead. This is a consequence of pull, approved as decision 18.
- **Terminate.** `terminate()` resolves pending pulls to "no result" with all other entries, and clears both routes' sets, their `resultId`s, the pull-needed marks and the markers. Reports that arrive for a dead session are dropped.
- **Delivery.** A pull report is class R: it is never lossy and never passes through the S coalescing map. It reaches the store through the frontend's own per-frame coalescing, hash comparison and marker diffing ([Flood control](#flood-control)). The backend is bounded by the pending-table cap, the one-in-flight rule and the concurrency cap, not by queue growth.
- **Retention.** Pull sets exist only for Open documents, so they are bounded by the number of open tabs and the per-file cap. They are never evicted while the document is open. Push sets follow the closed-document retention policy unchanged.

#### Readiness gating (decision 20)

*Approved (V24).* Measured in a dry run against `rust-analyzer 1 (9074e9b4c6 2026-09-06)`: a pull sent before the workspace has loaded returns an **empty `full` report**. Taken at face value that is "no diagnostics", which is false.

- **The gate.** The first pull for a session is held until the server reports the workspace ready: the status record has `quiescent: true` and health is not `error` ([Server health](#server-health-silent-failures)). The same gate applies again after a [workspace reload](#workspace-reload-decision-21). It is **not** applied to ordinary change pulls once the session has been ready: `quiescent` is false during routine analysis, and gating every pull on it would stall typing feedback.
- **An empty report received while not ready is not proof of zero diagnostics.** It is discarded, not stored. The pull route for that uri stays **unknown**, which is distinct from an authoritative empty set. The store therefore has three states per `(session, uri, pull)`: unknown, a set, an authoritative empty set. Nothing renders "no problems" from the first.
- **Transition to ready.** A transition from not-ready to ready seeds a wave with every Open document, visible first ([Cross-document refresh](#cross-document-refresh-decision-19-revised)). Pending pulls from before the transition are cancelled and their reports dropped.
- **Health `error`.** The workspace did not load, so readiness never arrives. Pull reports stay non-authoritative while it lasts; the chip already shows why.
- **Fallback timeout (decision 31).** A missing status notification must not suppress pull diagnostics indefinitely, so the fallback is **required in 1b**, not deferred. If no `experimental/serverStatus` has arrived a bounded time (◇) after the session is Ready, the session is marked **status-less**: the gate opens, a wave is seeded over the Open documents (visible first), the status chip notes that the server reports no status, and the log records it. If a status notification arrives later, gating switches to it and the usual transition to ready applies.
- **Early-empty handling.** An empty `full` report is **authoritative only if its pull was sent after readiness**: after the status reported ready, or, for a status-less session, after the fallback timeout fired. An empty report from a pull sent earlier is discarded and the route stays unknown. A non-empty report is stored whenever it arrives, because it is evidence of a problem, and a later authoritative empty report replaces it. This keeps a fixed file's diagnostics clearable in a status-less session, which "empty is never authoritative" would not.
- **Refresh is not a readiness signal.** Measured: the server sends `workspace/diagnostic/refresh` twice before readiness (about 0.5 s after start). A refresh received before readiness is answered `null` and does not establish authority; the gate ignores it.
- **Not a gate on the push route.** Pushed sets are unaffected.

#### Workspace reload (decision 21)

*Approved conditionally (V27).* Measured in a dry run: after a broken `Cargo.toml` is fixed, server health stays `error` until `rust-analyzer/reloadWorkspace` is sent. So Craidd sends it, within bounds.

- **Adapter-owned.** The request is a `rust-analyzer` extension and lives in the Rust adapter, never inferred from `serverInfo`. The core sees an optional adapter hook, "reload request", which other languages leave empty.
- **Trigger.** A **successful change to an affected `Cargo.toml`**: a successful save of that file in Craidd, or a reload of it from disk through Craidd's existing external-change flow. **Affected means actual workspace membership** (decision 33): the root manifest the session was started with, or a package manifest listed by the session's last successful `cargo metadata` result, which the adapter already caches with manifest paths and stamps and keeps even after the manifest breaks. A path-prefix test against the session root is not enough: a separate crate nested under the root has its own workspace and its own server identity, and a `Cargo.toml` under `target/` or a vendored directory is not a member. If the manifest was broken before any successful metadata, membership is unknown beyond the root manifest; a broken member manifest in that state is not recognised, and recovery there is the manual restart. This residual limitation is recorded, not hidden. A manifest changed by another program while Craidd is not looking is not detected by Craidd and falls under the accepted external-change limitation; the user's manual restart remains.
  - **The member-project case, named explicitly (decision 38).** When a member project (for example `fx-ws/alpha`) is opened while its workspace root `Cargo.toml` is broken from the start, `cargo metadata` fails and the adapter falls back to the project folder as the session root. The real root manifest is then outside that session, so fixing it is not an "affected" change and no reload is sent. Measured: `rust-analyzer` stayed in `error` 45 s after the fix, and one explicit `rust-analyzer/reloadWorkspace` recovered it. In Craidd the chip stays at the warning until the user presses ↻ Restart. **Accepted for Stage 1b; recovery is the manual restart.**
  - **Possible future direction (unscheduled, not designed):** treat the nearest ancestor `Cargo.toml` of the fallback root as a root candidate for membership and reload. It is recorded only so the limitation is not mistaken for a closed door; it is not part of Stage 1b and has no stage. The limitation, the recovery and the open questions for this fix are in [future-lsp-member-root-recovery.md](../../../future/future-lsp-member-root-recovery.md).
- **Bounded and coalesced.** Changes within a window (◇) collapse into one request. At most one reload is in flight; one more may be pending, never a queue. The request is class R through the pending table with its own timeout (◇); a timeout is logged, not fatal.
- **No redundant reloads.** None is sent when the manifest content equals the one last reloaded against, when the session is not Ready, or when the change altered the server identity (a changed root or membership is a new identity and a clean restart under A1, not a reload). Whether a reload is also needed when health is already `ok` (the server may reload by itself) is part of V27; if it is not, the trigger narrows to health other than `ok`.
- **After a reload** the readiness gate re-arms and a wave follows when the server reports ready.
- **Manual restart is preserved.** The chip's restart action is unchanged and always available.
- **Verification.** Recovery from a broken manifest is verified against the real server (V27): break the manifest, observe `error`, fix and save, observe the reload and the return to `ok` with diagnostics again.

#### Cross-document refresh (decision 19, revised)

*Approved.* The external-change limitation in the last row of the table below is **accepted**. Open, debounced change and refresh react to the document that changed. Two cases they do not cover: an edit to an **unopened** file on disk that changes an open file's diagnostics, and an edit in one open document that changes **another** open document's (the server reports `interFileDependencies: true`). F1 measured `workspace/diagnostic/refresh` once per run at startup, not after later changes, so the server cannot be relied on to say when to re-pull.

**One scheduler: the wave.** A wave is a set of documents to pull. Every trigger above only adds documents to it.

- **Coalescing.** At most one wave is pending and one in progress. A new seed merges into the pending set; a document appears once. Seeds that arrive during a wave join the next one, not a parallel one. This is what keeps a burst of saves, focus events and refreshes from multiplying requests.
- **Order.** Visible documents first (the active document of each view), then other Open documents by most recent activity.
- **Bounds (all ◇, none chosen here).** A concurrency cap on pulls in flight (shared with the one-in-flight-per-document rule); a maximum documents per wave; a minimum spacing between waves; the focus interval. Documents beyond the per-wave maximum are flagged **pull-needed** and pulled when they next become visible. Activating a pull-needed document therefore sends one pull; activating any other document still sends nothing.
- **No polling.** There are no timers except the change debounce. A wave starts only from an event. Nothing is pulled per keystroke, and the workspace-wide request (`workspace/diagnostic`) is not used.
- **`interFileDependencies: false`.** Cross-document seeds are not added.
- **Pull disabled for the session.** No waves; the refresh request is still answered `null`.

**What the triggers do and do not cover**

| Case | Covered by |
|---|---|
| Edit in an open document | Debounced change |
| Edit in an open document that affects another open document | Cross-document seed (bounded, visible first) |
| Edit to an unopened file by another program, then the user returns to Craidd | Window focus |
| Save | Save seed (adds a pull after `didSave`; V3 measures whether it earns its place, and the trigger is dropped if it does not) |
| Server asks for a refresh | Refresh seed |
| Edit to an unopened file by another program while Craidd stays focused | **Not covered.** Refreshes at the document's next trigger. Recorded as a known limitation, not hidden. |

The last row is deliberate: covering it needs either polling or a Craidd-side watcher, and the first is excluded and the second is the future `notify_files_changed` seam. The limitation is accepted.

**Preliminary observation, not a verdict (V23, dry run).** With `refreshSupport` advertised, the server sent `workspace/diagnostic/refresh` after edits to unopened files too, not only at startup. If the formal V23 and V3 runs confirm it, the refresh seed would cover part of the "edited while Craidd stays focused" case, and the accepted limitation would shrink. Until then the limitation stands as written.

**Measurement.** V3 (as revised) measures the interval from each kind of change to the updated diagnostics reaching the store. V26 records request volume. Both feed G3/G5; neither sets a budget. See below.

#### Verifications for pull diagnostics

V3 is revised and six items are added (V22–V27). They are entered in the [results record](results-lsp-stage-1.md#pending-verifications) as Unverified. All need a real `rust-analyzer`.

| ID | Item | Blocks | Flip condition if it fails |
|---|---|---|---|
| V3 (revised) | With pull and the wave implemented, the **measured interval** from each change to the updated diagnostics reaching the store, for: an external edit to an unopened file followed by window focus; an edit in an open document affecting another open document; a save; a server refresh. Several runs each; the distribution is recorded and no budget is invented. Also whether the save seed adds anything over the change seed. | Smoke test (1b), decision 19 | A case that never updates is recorded as not covered and returned to the architect; a trigger that adds nothing is dropped |
| V22 | Whether the server returns a `resultId` and answers `unchanged` to `previousResultId`; its `retriggerRequest` data on cancellation; its answer to `$/cancelRequest` on a pull | Pull request handling (1b) | Send no `previousResultId`; every pull is a full report (still correct, costs more) |
| V23 | With `refreshSupport` advertised: when the server sends `workspace/diagnostic/refresh` (startup only, after indexing, after file changes) | Refresh trigger (1b) | Refresh is not a sufficient re-pull trigger; rely on the other triggers and decision 19 |
| V24 | What a pull returns **before the workspace has loaded** (empty report, `ContentModified`, an error) | Pull on open (1b) | **Decided (decision 20):** the first pull is gated on workspace readiness and an empty report before readiness is never proof of zero. Dry run: a pull before load returns an empty `full` report. The exact readiness signal is fixed by V27 |
| V25 | Pull and cargo-check overlap in practice: how often the two routes report the same error | None (informs a later display-level dedup) | n/a |
| V26 | Wave request volume and performance effect: pulls per wave, waves per minute of scripted editing, documents flagged pull-needed, `unchanged` ratio, server CPU and keystroke latency with waves active. Recorded as part of G3/G3b and G5, not as a separate gate | G3, G5 (1b) | Tighten the bounds (caps, spacing, per-wave maximum) |
| V27 | `experimental/serverStatus` with Craidd's advertisement: values seen for a healthy load, a failed load and a missing proc-macro server; whether `health` returns to `ok` after the cause is fixed; what `quiescent` means; message length | Server health surfacing (1b) | Rely on bounded log reporting (b) alone and say the chip cannot show these failures. Dry run: after a manifest fix, health stays `error` until `rust-analyzer/reloadWorkspace`; decision 21 sends it. Also decides whether the reload is needed when health is `ok` |

### Semantics

Each LSP route replaces the full diagnostic set for a URI: `publishDiagnostics` for the push set, a `full` pull report for the pull set. `BuildProblem` accumulates until the next build resets it. These are different sources with different lifecycles and stay that way:

- **Separate storage.** LSP diagnostics (both routes, kept apart) live in `lspStore`; build problems stay in `useBuild.problems`. None of the three writes into another. Merging happens only in the display layer.
- **Separate clearing.** LSP sets are replaced by the next publish or accepted pull report for that file, and cleared when the session ends (the pull set also when its document closes). Build problems are cleared only by Craidd's existing build start/clear paths. Closing a file, saving, or a server publishing an empty set never touches build problems, and a build never touches LSP sets.
- **Clearly distinguished in the UI.** Every row states its source. LSP rows are labelled as live language-server results; build rows are labelled as from the last build, with the build they came from where known. A user must be able to tell "the server currently says this" from "the last build said this".
- **No deduplication in Stage 1.** The same compiler error can appear twice, or three times, once from each source (pull, push, build). Because build problems persist until the next build, **a duplicate can persist after the error is fixed and the server's copy is gone**, not for a short time: the build copy remains until the next build clears it. This is expected behaviour in Stage 1 and is documented as such.
- **Counts.** Error/warning counts include every source and may count one error more than once. The Problems panel shows per-source counts so this is visible.
- **Kept open for later.** The display layer takes both sources as separate typed inputs, so source filtering or display-level deduplication can be added later, once real usage shows how often they overlap, without changing storage, clearing or the protocol layer.

### Flood control

- Two complementary layers, not duplicates. The **backend** layer ([delivery classes](#server-to-frontend-delivery-and-message-classes)) bounds channel traffic and queue memory. The **frontend** layer below bounds store writes and marker calls.
- Store updates are coalesced to one per animation frame across all incoming publishes and accepted pull reports.
- A publish or pull report whose set equals the stored one for that route (hash compare), and an `unchanged` report, cause no store write and no marker call.
- Monaco markers (`setModelMarkers`) are set only for **open** models, with one owner string per session and route, and only when that file's set changed. Files not open exist only in the store for the Problems panel.
- The Problems panel renders a bounded window of a possibly large list (virtualised or capped display), while the stored and counted totals stay accurate.
- On session end (crash, stop, restart), that session's diagnostics (both routes) and markers are cleared. Stale diagnostics from a dead server are not shown as if current.
- **Closing a document does not clear its pushed diagnostics.** For project-based languages the server's pushed diagnostics for a closed file remain valid. A pushed set leaves the store only through a server publish for that URI (including an empty set) or the end of the session. The exception is the pull set, which nothing can refresh once the document is closed; see [Pull and push diagnostics](#pull-and-push-diagnostics). Monaco markers belong to a model: they go when the model is disposed and are re-applied from the store when a model is created again.
- **Retention policy**. The panel bounds *rendering*, so the store needs its own limits:
  - Sets for **open** models are never evicted.
  - A per-file limit (◇) caps the diagnostics stored for one file and route; the excess is summarised as "+N not retained" and is visible.
  - For **closed** documents, which hold push sets only, global limits (◇) on files and total diagnostics apply. When exceeded, the least recently published closed set is evicted first.
  - **Eviction is visible, never silent.** The Problems header says that diagnostics for N files are not retained, and counts are labelled "at least". An evicted file returns only when the server publishes for it again. Measured in a dry run (V15): the server does **not** republish push diagnostics on `didOpen`, so an evicted push set comes back only with the next check (startup or save), and the notice says so.
  - Eviction never touches open models or build problems.
  - **Bounded retention is kept (decision 22, modified approval).** Retention does not become unlimited for cargo-check diagnostics. G5 investigates whether the policy can hold **complete** sets within a measured memory budget (the `fx-many` fixture produces about 2,400 pushed diagnostics); if it cannot, the limitation is reported. Craidd never claims a set is complete unless the measurement shows nothing was truncated or evicted; truncation and eviction stay visible.
  - **No limit value is chosen here.** G5 records the stored count and memory under a large check; the limits are set from that evidence. Until then they are provisional ◇ values acting as a safety net only.

---

## Error recovery

| Failure | Behaviour |
|---|---|
| `rust-analyzer` not found | Status banner naming what to install. The editor works normally. Never installs anything. |
| rustup proxy present but component missing | Version probe must treat a non-zero exit as unavailable. (Verify on target systems.) |
| Spawn refused / fails | `Failed` with reason in Output. No retry loop. |
| `initialize` timeout or error | Terminate the process tree (bounded), `Failed`, reason shown. |
| Unexpected exit | `Crashed`, signal name if any, last stderr lines in Output, markers and diagnostics (both routes) cleared, **no automatic restart**. A restart action in the status lets the user decide, as the philosophy states. |
| Framing error: missing, invalid or oversize `Content-Length`, EOF mid-body | `Failed`. The stream position is lost; do not guess at resync. |
| Message body that is not valid JSON or not a valid JSON-RPC message, **framing intact** | The stream is still aligned. The message is skipped, counted and logged; the session continues. More than a bounded number of bad bodies (◇) → `Failed`. A skipped message that was a response leaves its pending entry to expire or be resolved at session end; it never leaves a caller hanging at a terminal state. |
| Write queue full | Never silently drop a sync notification. Mark the document `Desynced`, discard its pending changes without replay, bump its epoch, and resynchronise with an atomic `didClose` + `didOpen` when the writer has room. See [Desynchronisation and writer-queue overflow](#desynchronisation-and-writer-queue-overflow). |
| Writer cannot admit a resync within the bound | Session reported **Unresponsive**; requests fail fast; documents stay visibly `Desynced`; user can restart. |
| Frontend not consuming | Reader keeps draining the server. Class S keeps coalescing within its key bound; R and Q are unaffected; class T is a fixed-size record, so nothing accumulates and nothing fails. The terminal phase, if reached, is held until read or pulled. See [delivery classes](#server-to-frontend-delivery-and-message-classes). |
| Any terminal session state | Handled only by `terminate()`: see [One terminal transition](#one-terminal-transition). Every pending request, `Awaiting` or `Cancelled`, resolves to "no result"; documents return to Pending for any future session. |
| Workspace load or proc-macro server fails while the session is running | The session stays Ready. If the server reports it, health `error` or `warning` shows on the status chip with the raw message; stderr detail stays in Output (bounded). No restart. See [Server health](#server-health-silent-failures). |
| Server does not offer pull | Pull is disabled for the session with a note; only the push route exists. The editor is unaffected. |
| A pull fails with an error other than `ContentModified` / `ServerCancelled` | "No result"; the document's last pull set is kept, the error is logged, and the next trigger tries again. After a bounded run of consecutive failures (◇) the status notes that pull diagnostics are degraded. No retry loop. |
| Hung server (alive, not responding) | Requests time out to "no result". Typing is never affected. User can restart. |
| Frontend loses a window | Sessions owned by that window stop through the normal stop path. |
| Resolver error (e.g. cargo metadata fails) | Fall back with a visible note; never block the editor. |

Principle: **the editor is never gated on a server.** Every path above degrades to "Monaco without intelligence", with the reason visible in status.

---

## Discovery and configuration

- Add a `language_server` role to the Rust entry in `toolchain.rs`'s catalog (`rust-analyzer`). Resolution uses the existing `resolve_tool("rust", "language_server")`, so the Preferences default-path override works the same as other roles.
- Discovery is on demand by the existing scan, never at launch. Nothing about discovery starts a server.
- **Usable, not just present**. `probe()` in `toolchain.rs` currently reports the first line of stderr as the version when a tool exits non-zero, and never inspects the exit status, so a rustup shim for a missing component would appear "found". For the new `language_server` role a non-zero exit is "tool reported failure" and the tool is not offered. Changing how existing roles display is a separate change. Verified against the shim in V7.
- `initializationOptions` are Craidd's defaults, held in the adapter, never user-editable in Stage 1. They are hashed into the server identity.
- **Cargo target directory (approved):** the server uses its own directory (`cargo.targetDir` set to use a subdirectory of the existing `target/`, i.e. `target/rust-analyzer`), so its on-save `cargo check` never holds the build-directory lock while the user's Build, Run or Debug waits. It lives inside `target/`, so `cargo clean` removes it and existing ignore rules cover it. Cost: duplicated check artifacts on disk and a slower first check. The setting is part of the configuration identity, so reverting is a clean restart. Gate G3 records disk use and first-check time with it on and off; the setting is kept only if the recorded cost is acceptable.

---

## Performance gates

Stage 1 is not accepted on feel. Each gate has a measurable check, a baseline, and a recorded result. **No numeric budget is declared here**; budgets would be invented. The requirement is that results are measured, recorded in a results record (`results-lsp-stage-1.md`), compared with a baseline, and reviewed before acceptance. Absolute gates (counts that must be zero or one) have fixed pass conditions.

A development-only switch (`CRAIDD_LSP=0`) disables the LSP subsystem so a baseline run exists on the same build. It is not a user setting. It must exist in the 1b build (decision 23).

### Measurement hooks and methods (decisions 23–26)

*Approved.* The Verification lane's open questions about what can be observed are answered as follows. (They are labelled VA1–VA5 here to keep them apart from the philosophy amendments A1–A5.)

- **Development-only, read-only hooks (VA1, VA2; decision 23).** Small hooks expose what the wire does not show: store writes per frame, `setModelMarkers` calls, pull-needed flags, wave sizes, Channel message counts and bytes, stored diagnostics per route, and timestamps for the readiness and startup events that define the four G1 timings. They are enabled only by a development-only switch (named at implementation), only observe (counter increments and timestamps), take no lock across I/O and sit outside the reader's O(1) path. **They must not change production LSP behaviour:** the behaviour is identical with them on or off, and a test runs the same suites both ways and asserts that (decision 35). How they are presented (Output lines or a debug command) is the Implementation lane's choice. With `CRAIDD_LSP=0` the baseline run is available on the same build.
- **Long-task substitute (VA3; decision 24).** G3 asks for main-thread long-task counts. First check whether the WebKitGTK runtime exposes long-task entries; if it does, use them. Where it does not, record **frame-gap** (a `requestAnimationFrame` gap sampler) and **input-to-paint** latency as documented substitutes. The record states the method and its limits: frame gaps measure cadence, not task duration; the sampler adds a little load; animation frames are throttled when the window is hidden, so runs are foreground; input-to-paint is measured from a dispatched input event to the **visible update that input causes**, not to the first frame callback. A `requestAnimationFrame` callback runs before the frame is painted and before the editor's response may be rendered, so ending there under-reports the delay (decision 36). The end point is the first frame painted after the editor has applied the input (for example a second frame callback after the editor's own update, or the browser's event-timing entry where available); it is still not measured to the display, and the record says so. Results are labelled "substitute", never "long-task count". The gate's wording is unchanged.
- **UI-level checks (VA4; decision 25).** Scripted manual UI verification with the user's visual review, per the existing rule that the user checks by eye. Each UI item (chip, markers, Problems, tab, focus and model behaviour, V9, G1, G3, G7) has a written step script; the record notes the script, who ran it and the date, and marks the evidence "manual, scripted". Behaviour that can be tested without the UI keeps automated tests (fake server, `node --test`). Manual evidence never replaces an automated test that is possible.
- **File-watch limit (VA5; decision 26).** V2 uses a helper process that holds inotify watches to exhaust the user's limit, so no `sudo` and no persistent system configuration change is involved. The helper takes just enough watches to starve the server, runs in its own process group, dies with its parent, has a hard timeout, and the run asserts afterwards that the user's watch usage returned to the baseline (the kernel releases watches when the process exits). The user is told before it runs, because other programs share the quota while it is held.
- **Tooling isolation (decision 27).** The verification tooling stays on `verify/lsp-stage-1b` and is not merged into `feat/intellisense-ws` without the architect's approval.

| # | Gate | Check | Baseline | Pass condition |
|---|---|---|---|---|
| G1 | No server during startup or parked-window restore; deferral is bounded; startup measured apart from server cost | Launch and open a Rust solution with no tabs, then hide and restore a linked window holding Rust tabs, with a Rust and then a non-Rust tab active. Count language-server processes over time. Record the four timings in [Launch trigger](#launch-trigger). Also force a never-idle startup and confirm the bounded deferral still launches. Also switch the active file during the deferral and confirm revalidation. | Same build with `CRAIDD_LSP=0` for startup-to-interactive | Zero server processes until startup and restore have completed. Background Rust tabs never start a server. Startup-to-interactive not measurably different from baseline, with measurements recorded. Server initialization and indexing cost reported separately and never counted as startup. |
| G2 | No duplicate servers for a shared Cargo workspace | Solution with ≥2 Craidd projects in one Cargo workspace; open files from each | n/a (count) | Exactly one `rust-analyzer` for that workspace. A project outside the workspace gets its own. |
| G3 | Indexing never blocks interaction | Open a large Rust workspace; type, scroll, switch tabs during initial indexing. Also record, with the separate target directory on and off: extra disk use, first-check time, and whether a Build issued during a check waits on the lock. | Same actions with no session, same machine | Main-thread long-task count and keystroke-to-paint latency during indexing recorded and compared with baseline. Typing remains responsive; any regression is explained or fixed before acceptance. Also recorded: Channel message rate and bytes per second during indexing, and the pull-request rate and server CPU while typing with the pull debounce active, with waves active (V26). **G3b (sub-case, not a new gate):** the same measurements while typing in one file during a save-triggered check, plus whether CPU contention with a concurrent user Build appears. Lowering the server's CPU priority, or not sending `didSave`, are considered only if G3b shows contention. |
| G4 | Rapid typing, file switching and a stalled consumer are bounded | Scripted burst typing and rapid tab switching; separately, stall the frontend consumer during a diagnostics and progress flood | n/a (count) | In-flight requests never exceed the cap; no per-keystroke request backlog (at most one pull in flight per document, and no pull per keystroke); exactly one process per identity; superseded requests are cancelled or dropped; document table returns to consistent state; with the consumer stalled the server's stdout keeps draining, every response is delivered exactly once, every server request is answered, and the terminal status and each progress `end` are delivered once the consumer resumes. |
| G5 | Diagnostics do not flood Monaco | Trigger a check producing many diagnostics across many files; pull every open document after a refresh | Count marker calls without coalescing | `setModelMarkers` called only for changed open files; at most one store write per frame; identical republishes, identical pull reports and `unchanged` reports cause no writes. Counts recorded, plus the stored diagnostic count (per route) and approximate memory, and the ratio of `unchanged` to `full` reports. Wave volume is recorded here too (V26). |
| G6 | Closing a solution terminates its servers and their descendants | Open, then close the solution; also kill the IDE. List the server's full process tree before and after, including `cargo` check processes and any proc-macro server it started. | n/a (count) | No server process, **no descendant process**, and no stream thread remains for that solution. IDE SIGKILL leaves no orphan (supervisor backstop). |
| G7 | Sync correctness | Edit, undo/redo, multi-cursor, paste, EOL change, non-BMP characters, large paste; switching tabs, disposing and recreating a model while its tab stays open, reloading a file from disk while its model is disposed; a forced writer overflow during typing; compare server-side view | n/a | Server and Monaco agree after each, or desync is detected and repaired by resync. After a forced overflow the server's text equals the model's text and no edit is applied twice. |

Results are recorded in [results-lsp-stage-1.md](results-lsp-stage-1.md) with explicit statuses (Pass, Fail, Blocked, Unmeasured); a gate with no evidence is Unmeasured, never Pass. Each result carries: machine description, `rust-analyzer` version, workspace measured, method, and raw numbers. If a measurement cannot be taken, the gate is recorded as unmeasured, not passed. The additions made by the comparison review (message rate and size, diagnostic store size, descendant processes, stalled-consumer and overflow checks) add measurements and test evidence only. They add no numeric budget and no pass claim; every one is **Unmeasured** until recorded.

---

## Testing

Per the project's habit of exercising the production path, not mocks of it.

### Rust (`cargo test`)

- **framing:** split reads at every byte boundary, multi-byte UTF-8 bodies, `Content-Type` header, missing/invalid/oversize length, EOF mid-body. Existing DAP tests continue to pass unchanged after extraction.
- **transport:** a non-reading server cannot block the caller (analogue of the existing DAP writer test); queue-full yields desync, not silence.
- **delivery classes:** with a stalled consumer and a flooding fake server, assert that the reader keeps draining stdout; every response (R) is delivered exactly once; every server request (Q) is answered without the frontend; the last diagnostics set per uri is delivered, **including an empty clearing set**; every progress `end` is delivered and `begin` + `end` before a delivery yields one completed record; the terminal phase (T) is never lost and is pullable after the consumer was stalled; a later non-terminal write cannot overwrite it; the coalescing map never exceeds the number of distinct keys; dropped log lines are counted and reported.
- **overflow recovery:** with scripted writer capacity, assert that a rejected sync notification yields `Desynced`; the pending queue is discarded and never replayed; the resync unit is admitted atomically (both messages or neither); the server-side reconstructed text equals the model text; edits made while `Desynced` appear exactly once; results from the old epoch are dropped; request admission respects the reserve; the Unresponsive bound triggers.
- **pull diagnostics (fake server):** a `full` report replaces the pull set; an `unchanged` report keeps it and causes no store write; `previousResultId` is sent only after an accepted report with a `resultId`; a report for an older epoch or `versionId` is dropped and records no `resultId`; one pull in flight per document (a newer cancels the older); `ContentModified` yields no result; `ServerCancelled` with `retriggerRequest` re-arms once per window and stops at the bound; a pull not admitted is re-issued on a capacity event; `workspace/diagnostic/refresh` is answered by the backend with the consumer stalled, increments the counter once per refresh, and many refreshes cause one re-pull; a pull and a push for the same uri are stored apart; session death resolves pending pulls and clears both routes; a server without `diagnosticProvider` gets no pull.
- **readiness gating (fake server), regression for decision 20:** no pull is sent before the status reports ready; an empty `full` report received before ready is discarded and the route stays unknown (nothing renders as "no problems"); the transition to ready seeds one wave over the Open documents, visible first; an empty report after ready is stored as an authoritative empty set; health `error` keeps reports non-authoritative; a reload re-arms the gate; change pulls after the first ready are not gated by `quiescent`; a server that sends no status gets the bounded wait and non-authoritative empties.
- **workspace reload (fake server), decision 21:** a successful save of an affected `Cargo.toml` sends one reload; several within the window send one; a reload in flight plus a pending one never exceeds two; an unchanged manifest, a non-affected `Cargo.toml`, a failed save and a session that is not Ready send none; **negative membership tests (decision 33):** a `Cargo.toml` of a separate crate nested under the root, one under `target/`, one in a vendored directory, a path dependency outside the workspace, and a `Cargo.lock` change each send none, while the root manifest and a listed member each send one; a manifest broken before any successful metadata is recognised only as the root; a changed server identity restarts instead of reloading; the request times out without failing the session; manual restart still works; after a reload the gate re-arms and a wave follows. The recovery from a broken manifest is a real-server check (V27).
- **retention (decision 22):** a push set above the per-file cap shows "+N not retained"; eviction of a closed set is reported with the next-check wording; no path claims completeness after truncation or eviction.
- **F3 cases (fake server; decision 34):** a `window/showMessageRequest` with no `type` and no `actions` is answered `null` and shown at severity 3; one sent while the session is `Initializing`, before the `initialize` reply, is still answered exactly once; one sent with the delivery consumer stalled is answered without waiting on the frontend; a string `id` is echoed back verbatim.
- **readiness fallback (decision 31):** with no status notification, the gate opens at the timeout and one wave is seeded; an empty report from a pull sent before the timeout is discarded, one sent after it is authoritative and clears a non-empty set; a status notification arriving later switches gating to it; a refresh before readiness establishes nothing.
- **attribution (decision 30):** a file explicitly included by one project but under another's deeper folder, a config-facet file and an ambiguous file are attributed exactly as `owning_project` decides (ambiguous reported as ambiguous), for an open document and for an unopened file holding only a push set; a test compares the frontend's use with the resolver, so no second lookup remains.
- **hooks on and off (decisions 23, 35):** the delivery, wave and sync suites give identical results with the measurement hooks enabled and disabled, and with them off, the delivery, wave and sync tests give identical results; the hooks never write to the store, the writer queue or the pending table.
- **F2 regression (fake server):** `workspace/diagnostic/refresh` is answered with `result: null` (never an error), exactly once, with pull enabled and with pull disabled, with the consumer stalled, and with a string id echoed verbatim; with pull enabled the counter increments and a bounded wave follows; with pull disabled no pull is sent.
- **waves (decision 32):** the scheduler is a frontend module (it needs visibility, recency and Monaco's `versionId`), so its behaviours are covered by `node --test` with a scripted transport. The architect accepts that as valid behavioural coverage; the backend parts (refresh counter, pull requests, the readiness gate) stay covered by fake-server tests. Cases: seeds from save, focus, refresh and a cross-document change merge into one pending wave; a document appears once; visible documents are pulled first; the concurrency cap and the per-wave maximum hold; documents beyond the maximum are flagged pull-needed and pulled on activation; no wave runs without an event; `interFileDependencies: false` adds no cross-document seeds; many refreshes in a burst cause one wave.
- **server health (fake server):** `experimental/serverStatus` with `ok`, `warning` and `error` updates the T record field; an unknown `health` or malformed body is ignored and logged; an over-long message is truncated; health does not change the session phase; the chip shows and clears accordingly; stderr and `logMessage` stay bounded with the dropped-lines counter, error severity kept in preference.
- **pending table:** cancel keeps an entry until the reply; a reply to a `Cancelled` entry is dropped and counted; an unknown id is ignored; eviction prefers `Cancelled` entries; every entry resolves to no result at a terminal state; ids are never reused.
- **capability validation:** table-driven over every row of the validation table with valid, absent and malformed values, including a non-utf-16 `positionEncoding` (handshake failure), sync as number and as object, `openClose` missing, `resolveProvider` absent/false/non-boolean (no resolve request is ever sent), and a resolve response that tries to change `textEdit` (ignored and logged).
- **framing vs body errors:** a framing error fails the session; a bad body with intact framing is skipped and counted; the tolerance bound fails the session.
- **identity/routing:** same workspace → same identity; different binary, root or options → different identity; routing by `.craidd` language, not extension; no routing outside projects; sticky binding for navigated files.
- **adapter::rust:** `cargo metadata` parsing; failure falls back with a note; cache invalidation on manifest change.
- **session state machine:** every transition including failure branches; thread cleanup on each terminal state.
- **fake LSP server fixture** (a small test binary with scripted behaviour): normal handshake; never answers `initialize`; ignores `shutdown`; ignores `exit`; crashes mid-session; writes malformed framing; floods diagnostics; asks the client for configuration/registration; answers requests late. Driven through the production supervisor like `process_cleanup.rs`, no GTK.
- **lifecycle:** process-group termination after a server ignores `shutdown`/`exit`; no orphan after simulated IDE kill (extends `process_cleanup.rs`).

### Frontend (`node --test`)

- position/range mapping, including non-BMP and combining characters.
- change batching: ordering, flush-before-request, flush-before-save/close.
- document lifetimes: Pending for restored tabs; a restored active tab registers only after the deferred launch; tab switching sends no close or open; model disposal with the tab open suspends; resume with an identical hash sends nothing; resume with a different hash resynchronises; a model with no tab is not registered; closing the tab sends one `didClose`; two views of one model send one `didOpen`.
- stale-response rejection by `versionId` and supersession, including `completionItem/resolve` for a superseded item and for a dead session, and preservation of the item's opaque `data`.
- diagnostic coalescing, hash-skip, marker diffing, panel bounding; closing a document keeps its diagnostics in the store; a recreated model gets its markers back from the store.
- completion context: trigger kind and character are passed; `isIncomplete` is carried to Monaco's incomplete flag.
- file identity: a symlinked directory and its canonical path produce one registration; the alias tab sends nothing and shows its note; the holder is the owned editable tab; promotion on holder close; a server-returned location focuses the holder rather than opening a second tab; the four symlinked-vendor cases (a)–(d).
- source separation: an LSP publish (including an empty set) never alters build problems or the pull set; a pull report never alters the push set; a build start/clear never alters LSP sets; session end clears only LSP sets; closing a document clears its pull set and keeps its push set; rows carry correct source labels and per-source counts.
- pull scheduling: the debounce restarts on each change and cancels the in-flight pull; no pull on a tab switch; a refresh pulls visible documents first and respects the concurrency cap; Pending, Suspended and alias documents are never pulled; a resumed or resynchronised document is pulled once.
- provider dispatch with and without capability.
- accepting a completion: `additionalTextEdits` applied at the right mapped ranges (including non-BMP lines before the edit); overlapping or same-position edits reject the whole item and never leave a primary-only result; a stale document rejects or re-resolves; primary and additional edits undo together; accept-before-resolve-completes; a failed or timed-out resolve leaves the document unchanged; accept after the session died applies only a complete item.

### Real server

- An opt-in smoke test against an installed `rust-analyzer` on a small fixture crate, skipped cleanly when it is absent. It checks handshake, diagnostics through both routes (including the argument-count break that only pull reports), completion, hover, definition and clean shutdown.
- Lab workspaces under `workspaces/` for G1–G7.

### UI

Live-IDE verification is run only when requested; the user checks by eye. This document does not assume UI harness runs. Stage 1b UI checks follow the scripted manual method in [Measurement hooks and methods](#measurement-hooks-and-methods-decisions-2326).

---

## Acceptance criteria

Stage 1 is accepted when all of the following are true and recorded:

1. A Rust file in a Rust project gets diagnostics (the server's own through pull, cargo check through push), completion (accepting an auto-import completion inserts both the symbol and the `use` edit correctly, as one undo step), hover, go-to-definition, references and document symbols from `rust-analyzer`, using only capabilities the server advertised.
2. No server runs during startup or parked-window restore, the deferred launch is bounded and revalidated, and startup cost is measured apart from server cost (G1).
3. One Cargo workspace shared by several Craidd projects yields one server (G2).
4. Indexing, rapid typing and file switching never block the editor, with measured evidence against baseline (G3, G4).
5. Diagnostics from both routes reach Monaco and the Problems panel with correct project attribution and source labels, bounded and coalesced (G5). An empty pull report received before the workspace is ready is never shown as "no problems".
6. Closing a solution, a window, or the IDE leaves no server or stream thread behind (G6).
7. Edits stay synchronised across the cases in G7, with deterministic repair on desync: pending changes are discarded rather than replayed, and no edit is applied twice.
8. Every failure in [Error recovery](#error-recovery) degrades to a working editor with a visible, accurate status.
9. DAP debugging behaves exactly as before the framing extraction (existing tests pass; no behaviour change).
10. Every philosophy amendment below is either applied to the philosophy document or withdrawn.
11. Delivery never discards a non-replaceable protocol message: responses, server requests, terminal status and progress `end` are always delivered or answered, and a stalled frontend cannot stall the server.
12. Document registration follows the tab, not the view or the model; tabs from a parked-window restore stay Pending until activated; capabilities are validated before use and `completionItem/resolve` is never sent unless the server advertised it.
13. Stage evidence for 1a, 1b and 1c is recorded separately in the results record; completing a stage accepts no gate before the gate's own evidence is complete.
14. Every required gate is **Pass** in the results record with evidence, or has a recorded and reviewed reason it cannot be. **Unmeasured** and **Blocked** gates are not accepted as passed.

---

## Review reconciliation

How each review item maps onto this design, so a requirement lives in exactly one place. **Already addressed** means the requirement existed and nothing was added; **Refined** means an existing rule was made precise; **New** means it was missing.

### Earlier design-review concerns

| # | Concern | Status | Where |
|---|---|---|---|
| 1 | Monaco model lifetime vs active view vs LSP registration, including tabs from a parked-window restore | **Refined.** Background tabs from a parked-window restore were already Pending (launch trigger) and views were already irrelevant to server start. The old rule counted view ids to decide open and close, which tied registration to views. It is replaced by tab-owned registration observing the model, with Suspended and Resume for model disposal. | [Three lifetimes](#three-lifetimes-tab-model-view); launch trigger unchanged |
| 2 | Deterministic writer-queue overflow recovery with no replay of stale changes | **Refined.** "Mark desynced and resend" existed. Now a protocol: discard without replay, epoch, atomic `didClose` + `didOpen`, reserved capacity, event-driven retry, bounded Unresponsive. | [Desynchronisation and writer-queue overflow](#desynchronisation-and-writer-queue-overflow) |
| 3 | Validation of negotiated capabilities, including `textDocumentSync` and `completionItem/resolve` | **Refined.** "The server's capabilities are the truth" existed. Now an explicit validation function and table; `resolveProvider` gates resolve; resolve responses are restricted to the lazily-resolvable properties. | [Validating negotiated capabilities](#validating-negotiated-capabilities) |
| 4 | Performance gates remain explicitly unmeasured until evidence exists | **Already addressed.** Statuses, the "no budget is invented" rule and the placeholder record all exist. This revision adds measurements and tests only, and states that every addition is Unmeasured until recorded. | [Performance gates](#performance-gates); results record |

### Comparison-review findings

| # | Finding | Status | Where |
|---|---|---|---|
| N1 | Cancelled requests still get a reply | **New** | [Pending-request table and cancelled requests](#pending-request-table-and-cancelled-requests) |
| N2 | Backend must never block on the frontend; coalescing must not discard non-replaceable messages | **New.** Frontend per-frame coalescing already existed and is kept; the two layers are complementary, not duplicate. | [Delivery and message classes](#server-to-frontend-delivery-and-message-classes) |
| N3 | `isIncomplete` and trigger context | **New** | [Completion requests](#completion-requests) |
| N4 | G6 must check descendants | **New** | G6 |
| N5 | Framing error fatal; bad body with intact framing tolerated | **Refined** (the single "malformed" row is split) | [Error recovery](#error-recovery) |
| N6 | `additionalTextEdits` overlap includes the same insert position | **Refined** | [Accepting a completion](#accepting-a-completion-including-additionaltextedits), rule 3 |
| N7 | Closing a document must not clear diagnostics | **New** | [Flood control](#flood-control) |
| N8 | Measure store size and IPC rate and size | **New** (measurements only) | G3, G5 |
| N9 | Path canonicalisation for external files | **New**, then refined by the independent review | [File identity](#file-identity-three-questions) |

### Independent pre-implementation review

An independent review (Conditional Go) is reconciled item by item, with each recommendation marked accepted, modified, rejected or deferred, in [review-lsp-stage-1-independent-reconciliation.md](review-lsp-stage-1-independent-reconciliation.md). The resulting rules appear once, in the sections marked, and are not repeated here.

### Change after the F1 investigation

The architect moved pull diagnostics from "deferred" into Stage 1b because V3 failed for push-only diagnostics. No earlier decision is reversed. N7 is refined for the pull route only (decision 18, approved). The approved F2 reply (`null`), the server-status reporting of silent failures (decision 17) and the revised cross-document refresh (decision 19, approved) are recorded in [Q table](#server-to-client-requests), [Server health](#server-health-silent-failures) and [Cross-document refresh](#cross-document-refresh-decision-19-revised). Where it landed: [Pull and push diagnostics](#pull-and-push-diagnostics), the capability and validation tables, the Q and T rows of the delivery classes, [Flood control](#flood-control), [Error recovery](#error-recovery), G3–G5, [Testing](#testing), acceptance criteria 1 and 5, the 1b plan, and amendment A4. The "pull diagnostics deferred" line in the results record's deferred list is superseded by this change; the results record is cross-referenced, not rewritten.

### Not changed

- Approved decisions 1–7 are unchanged.
- No new gate was added. G3–G7 gained measurements and pass-condition detail, including for pull diagnostics.
- **No new philosophy amendment is required.** Amendment A3 already covers answering server-to-client requests; the rule that the backend answers them itself is a design detail beneath it. The philosophy remains unchanged.

---

## Philosophy amendments required

Exact edits needed to `philosophy-intellisense.md`. **A1, A2, A3, A4 and A5 are approved by the architect and applied**, with their added sentences. A6 and A7 remain pending; A8 belongs to the C# stage. A2 and A4 were applied in their revised form (workspace-load failure via server status plus bounded output; pull and push, the `null` reply, clearing a closed document's pull set, no polling).

| # | Current text | Required change | Reason |
|---|---|---|---|
| A1 | "**One server per (project, language) pair.** … they get two `rust-analyzer` instances." | Replace with: one server per **server identity** — implementation, resolved root and configuration identity — where a per-language adapter resolves the root. Many projects may share one server. Project ownership and server ownership are separate. Keep "servers are scoped to a working directory" and the no-cross-solution rule. | Two projects in one Cargo workspace would otherwise start duplicate `rust-analyzer` instances. |
| A2 | "**Launch on demand.** A language server starts when a file of that language is first opened in the editor." | Clarify "opened" as the document becoming the visible, active editor model, after startup and any parked-window restore complete. Background tabs from a parked-window restore do not start a server. The launch is deferred to idle with a bounded maximum wait and revalidated before execution. Startup never waits for server initialization. Add: a failure to start, or to load the workspace after start, is visible to the user: through the server's own status where it reports one (for Rust, the adapter's status notification) and through bounded server output otherwise. Neither gates the editor. *(Second sentence revised after F3 and decision 17. **Approved and applied.**)* *("Session restore" corrected to "parked-window restore", since Craidd restores intent, not state: **stand-in approval, DA-4**, see [delegated approvals](delegated-approvals-lsp-stage-1.md). The architect may revise it.)* | A parked-window restore would otherwise start servers before startup finishes, breaking the startup rule. |
| A3 | "Server -> Client" message list (notifications only) | Add the server-to-client **requests** that must be answered (`workDoneProgress/create`, `workspace/configuration`, `workspaceFolders`, registration, `showMessageRequest`), and the client-to-server `$/cancelRequest` and `didSave` semantics. | Unanswered server requests stall servers; the minimum slice must say so. |
| A4 *(reworded after F1; **approved and applied**)* | "Where the server's diagnostics go … A diagnostic is a diagnostic. It has a file, a line, a column…"; and the client-to-server and server-to-client lists, which name only `publishDiagnostics` | Note that LSP diagnostics arrive by **two routes**, push (`textDocument/publishDiagnostics`) and pull (`textDocument/diagnostic`), and that a server may use either or both, so the client must support both. Each route carries ranges, source, tags and related information and replaces per file; each is stored separately and merged at display, with build problems as a third source that accumulates. Add `textDocument/diagnostic` to the client-to-server list and `workspace/diagnostic/refresh` to the server-to-client requests that must be answered (with success, `null`). Add: a closed document's pull set is cleared and its push set is retained; pull is refreshed by bounded, event-driven triggers (open, change, save, window focus, server refresh, cross-document change), never by polling or per keystroke. *(Revised after decisions 16, 18 and 19.)* | `rust-analyzer` (measured, one version) answers its own diagnostics only to a pull; push carries cargo-check results. `BuildProblem` has no range and accumulates; LSP sets replace. A3 is applied and is not reopened: the added request belongs to A4 because it exists only for pull. **Open conflict, recorded and not part of this approval (stage 6, not Stage 1):** the philosophy's open question says hidden windows' diagnostics "keep flowing"; with pull they continue only for open documents and are refreshed by the server's refresh request, since a hidden window has no focus. Reword then. |
| A5 | "The framing code can be shared between LSP and DAP clients. One `framing.rs` module." | Add: extraction must not change DAP behaviour; the inbound size cap is a parameter, not a shared constant. | DAP's 8 MB cap is a private constant today. |
| A6 | "**What if a language server crashes?** … A restart button" | Add: no automatic restart in Stage 1; diagnostics from a dead session are cleared. | Stale diagnostics from a dead server mislead. |
| A7 | "How are server settings surfaced? Not in Phase 3." | Add: defaults are held by the adapter and hashed into server identity. A configuration change is a new identity, not a live mutation. | Defines what "defaults" means operationally. |
| A8 | "C# case, specifically … Roslyn does not ship a first-class LSP server" | Not a Stage 1 change. Flagged for the C# stage: this statement should be re-verified against the current Microsoft Roslyn language server before that stage is designed. | The claim may be outdated; verification belongs to that stage. |

Further proposed wording for A1, A2, A3, A5, A6 and A7 (one sentence each) is in the [independent-review record](review-lsp-stage-1-independent-reconciliation.md#proposed-additions-to-amendment-text). The A1, A3 and A5 additions are applied with those amendments; the others are not.

---

## Future-stage decisions (recorded, not built)

These are not designed here. They are recorded so Stage 1 does not close doors on them.

| Topic | Decision to make later | Constraint Stage 1 already keeps |
|---|---|---|
| **clangd compile database** | Where `compile_commands.json` lives (CMake build directory); passing `--compile-commands-dir`; `compile_flags.txt` only if it exists. Craidd reads, never writes or links files into the source tree. | Adapter returns init options and arguments; root need not equal project root. |
| **C/C++ shared headers** | Which project owns headers outside any project root. Likely: let clangd choose; do not build header-ownership logic. | Sticky binding for files without an owning project. |
| **Multiple servers per language** | TypeScript/React may need `vtsls` plus ESLint plus Tailwind. | `ServerIdentity` already includes implementation; catalog shape allows a list. |
| **TypeScript configuration** | Driven by `tsconfig`; Craidd adds no settings. | Adapter owns configuration identity. |
| **Python interpreter** | Pass the interpreter from toolchain discovery rather than letting the server guess; virtualenv handling. | Configuration identity includes environment overrides. |
| **C# server choice** | Compare Microsoft's Roslyn language server and `csharp-ls` against a lab workspace; verify Linux support and installation story; pass the solution/project list from `.cln`. | `ServerContext.projects` carries the project list. |
| **Aggregation across linked windows** | Diagnostics from hidden windows in the group's Problems list. With pull, a hidden window's pull sets are refreshed only by the server's refresh request, not by focus; decide then whether that is enough. | Diagnostic record has `windowLabel` / `projectName`. |
| **Dynamic registration and watched files** | A Craidd-native file watcher feeding `didChangeWatchedFiles` through the existing `notify_files_changed` seam. | Not advertised in Stage 1; watcher setting is part of server identity; any gap is logged. |

---

## Open decisions for review

1. ~~**Server-side file watching.**~~ **Resolved:** server-side watching, with Craidd keeping ownership of dirty-state, external-change conflicts, saving and backup/recovery; watcher failures surfaced; a Craidd-native watcher stays possible. Option name and fallback still to be verified against the real binary (see [External disk changes](#external-disk-changes)).
2. ~~**Cargo target directory.**~~ **Resolved:** separate server directory, validated by measurement under G3 (disk and first-check cost recorded; setting reverted if unacceptable).
3. ~~**`completionItem/resolve` in Stage 1.**~~ **Resolved:** included, with explicit rules for applying `additionalTextEdits` on accept (see [Accepting a completion](#accepting-a-completion-including-additionaltextedits)). Resolve requests follow the same flush, supersession, cancellation and stale-rejection rules as other requests; the server's opaque `data` is preserved unchanged; a resolve for a superseded item or dead session is dropped.
4. ~~**Dependency and standard-library files.**~~ **Resolved:** read-only, bound to the originating session, lock indicator in the tab; files with an owning project are unaffected.
5. ~~**Dedup of rust-analyzer check output versus Craidd build problems.**~~ **Resolved:** both shown, labelled by source, no deduplication in Stage 1; storage and clearing lifecycles stay separate; stale build duplicates persist until the next build; display layer stays open to filtering or deduplication later.
6. ~~**Launch trigger wording** (A2).~~ **Resolved:** visible, active Rust document, after startup and any parked-window restore complete; bounded deferral; revalidation before launch; background tabs from a parked-window restore stay pending; startup measured apart from server cost under G1.
7. ~~**Where the results record lives.**~~ **Resolved:** [results-lsp-stage-1.md](results-lsp-stage-1.md), created now as a placeholder with G1–G7 **Unmeasured**; statuses are Pass, Fail, Blocked or Unmeasured; no required gate is accepted without recorded evidence; it becomes a record once real measurements exist.

8. ~~**Document registration lifetime.**~~ **Resolved:** a document stays registered for the whole life of its tab after first activation, so switching tabs sends nothing (see [Three lifetimes](#three-lifetimes-tab-model-view)).
9. ~~**`window/showMessageRequest`.**~~ **Resolved:** answered immediately with no selection, and the message is shown as a non-blocking notice, so a server request never depends on the UI. A server that expects the user's choice does not receive it in Stage 1.
10. ~~**Canonical path policy.**~~ **Resolved:** canonical key for identity, the session's own path for what is sent to the server. *Refined by decision 12: the canonical key is LSP-only and does not replace tab or project identity.*

11. ~~**Class T as a status record.**~~ **Approved.** Replaces the 256-event queue and its failure-on-overflow rule. See [Server-to-frontend delivery](#server-to-frontend-delivery-and-message-classes).
12. ~~**File identity in three questions, with alias tabs.**~~ **Approved.** LSP-only filesystem identity; solution store unchanged. See [File identity](#file-identity-three-questions).
13. ~~**Atomic-or-rejected completion acceptance, with the F1 then F2 fallback order.**~~ **Approved.** Primary-only application is never acceptable. See [Accepting a completion](#accepting-a-completion-including-additionaltextedits).
14. ~~**Stages 1a, 1b and 1c with per-stage evidence.**~~ **Approved,** and the gate mapping above. See [Delivery plan](#delivery-plan-inside-stage-1).
15. ~~**User-visible surfaces on existing UI only.**~~ **Approved,** including a small source extension to the Output tab. See [User-visible surfaces](#user-visible-surfaces).

**Raised by the pull-diagnostics change:**

16. ~~**Reply to `workspace/diagnostic/refresh` (F2).**~~ **Approved:** reply successfully with `result: null`. When pull is enabled, the request schedules a bounded refresh wave. Regression coverage is specified under [Testing](#testing) and recorded in the results record. See [Server-to-client requests](#server-to-client-requests).
17. ~~**Silent workspace-load or proc-macro failure.**~~ **Approved:** option (a), enabling `rust-analyzer`'s status notification and surfacing actionable failures on the status chip, with bounded stderr and error-log reporting in Output as the fallback and for troubleshooting. See [Server health](#server-health-silent-failures).
18. ~~**Closing a document clears its pull set.**~~ **Approved:** the pull set is cleared on close, the push set is retained under the existing retention policy, and source separation is preserved.
19. ~~**Cross-document refresh.**~~ **Approved (revised design),** with the external-change limitation accepted. Bounded refresh waves seeded by save, window focus, the server's refresh request and cross-document changes, visible documents first, with a concurrency cap and no polling. See [Cross-document refresh](#cross-document-refresh-decision-19-revised). The numeric bounds are ◇ values to be set from V26, G3 and G5.

**Stage 1b verification decisions (all approved).** They answer the Verification lane's dry-run findings against `rust-analyzer 1 (9074e9b4c6 2026-09-06)`; the plan is `verification/lsp-1b/VERIFY-PLAN.md` on `verify/lsp-stage-1b`, which is not merged here.

20. ~~**Gate the initial pull on workspace readiness (V24).**~~ **Approved.** An empty result before readiness is not proof of zero diagnostics. Regression coverage added. See [Readiness gating](#readiness-gating-decision-20).
21. ~~**Workspace reload after a manifest change (V27).**~~ **Approved conditionally:** a bounded, coalesced `rust-analyzer/reloadWorkspace` after a successful change to an affected `Cargo.toml`; no redundant reloads; manual restart preserved; recovery from a broken manifest verified against the real server. See [Workspace reload](#workspace-reload-decision-21).
22. ~~**Diagnostic retention (V15).**~~ **Modified approval:** no unlimited cargo-check retention; bounded storage and visible truncation and eviction stay; investigate whether complete sets fit a measured budget and report the limitation if not. See [Flood control](#flood-control).
23. ~~**Measurement hooks and `CRAIDD_LSP=0` (VA1, VA2).**~~ **Approved:** small, development-only, read-only; no change to production LSP behaviour.
24. ~~**Long-task substitute (VA3).**~~ **Approved:** frame-gap and input-to-paint, with the method and limits recorded.
25. ~~**UI verification method (VA4).**~~ **Approved:** scripted manual verification with the user's visual review; automated tests where possible without the UI.
26. ~~**File-watch-limit test (VA5).**~~ **Approved:** helper-process method, no `sudo`, no persistent system change, reliable cleanup.
27. ~~**Verification tooling location.**~~ **Approved:** stays on `verify/lsp-stage-1b`; not merged into `feat/intellisense-ws` without approval.

**Stage 1b repair decisions (all approved).** They follow the Verification lane's Stage 1b record (`ea33c1e` on `feat/lsp-stage-1b`) and the Implementation lane's design-conflict notes.

28. ~~**Watcher-limit warning (V2).**~~ **Approved:** recognise the verified server line, warn on the status chip, keep the raw line in Output, with regression coverage. See [External disk changes](#external-disk-changes).
29. ~~**Lock glyph to Stage 1c.**~~ **Approved:** the unowned-file lock indicator moves from 1b to 1c, where unowned files first open; the requirement is not weakened. See [Stage 1b](#stage-1b--documents-synchronisation-and-diagnostics) and [Stage 1c](#stage-1c--providers).
30. ~~**Project attribution.**~~ **Approved:** fixed in 1b by asking the existing backend resolver, including for unopened files; ownership is never inferred from the deepest directory. See [Diagnostics](#record).
31. ~~**Readiness fallback timeout.**~~ **Approved:** a missing status notification cannot suppress pull diagnostics indefinitely; early-empty reports are handled as recorded. See [Readiness gating](#readiness-gating-decision-20).
32. ~~**Wave tests.**~~ **Approved:** the `node --test` suites are accepted as valid behavioural coverage for waves. See [Testing](#testing).
33. ~~**Reload membership.**~~ **Approved:** Cargo.toml reloads are restricted to actual workspace membership, with negative tests (tightens decision 21). See [Workspace reload](#workspace-reload-decision-21).
34. ~~**F3 test cases.**~~ **Approved:** the four missing `showMessageRequest` cases are required. See [Testing](#testing).
35. ~~**Metrics do not change behaviour when enabled.**~~ **Approved:** verified by running the same suites with the hooks on and off (extends decision 23).
36. ~~**Typing-delay metric.**~~ **Approved:** measure the visible update, not the first frame callback (corrects decision 24's end point).
37. **V16 stays open.** The real-path and symlink behaviour is not decided until U10 establishes the facts. See [File identity](#file-identity-three-questions).
38. ~~**Member project under a broken workspace root.**~~ **Accepted for Stage 1b:** recovery is the manual ↻ Restart. Named under decision 33's residual limitation in [Workspace reload](#workspace-reload-decision-21); the ancestor-manifest idea is recorded there as an unscheduled direction.

**Stage 1b UI-review decisions (stand-in approval).**

39. **Two UI-review defects, fixed and recorded.** **Stand-in approval, DA-5** (see [delegated approvals](delegated-approvals-lsp-stage-1.md)); the architect may revise it. The manual UI review found two defects in Stage 1b, each fixed on `feat/lsp-stage-1b`:
    - **The start-up gate never opened.** `startupDone` was never set, so no server ever attached. Fixed in `700b59d`: the start-up gate moved into `LaunchGate`, and the gate opens when wiring completes. This keeps the [launch trigger](#launch-trigger) as written. Verified by the Verification lane at `700b59d`: no server before a Rust tab is active, and one bounded launch.
    - **The IDE window crashed when `rust-analyzer` first connected.** A status batch created a partial session view before the attach reply arrived, so the status chip read `view.server` and threw. Fixed in `ead1a68` (the attach reply is merged into an early view), with tests in `39f4e89`, and a local `ChipBoundary` around `LanguageServerChip`. The boundary contains a render failure to the chip, and the chip shows that it failed; it hides nothing. Independent verification of `ead1a68` and `39f4e89` is not recorded here; see the [results record](results-lsp-stage-1.md).

    The fixes change no earlier decision. G1 stays as the results record states it; this decision does not mark any gate.

**Stage 1c decisions (stand-in approval, DA-14).** Approved by the lead while the architect is away ([delegated approvals](delegated-approvals-lsp-stage-1.md)); the architect may revise any of them. Details in the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).

40. ~~**Provider requests are typed commands.**~~ **Approved.** *Stand-in approval (DA-14).* One typed Tauri command per kind (completion, resolve, hover, definition, references, document symbol), each shaped like `lsp_pull`; no generic send-any-method command. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
41. ~~**Per-kind timeouts and pending-table share.**~~ **Approved.** *Stand-in approval (DA-14).* ◇ timeouts per kind; a timeout is "no result" with the request cancelled; no kind may take the whole table. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
42. ~~**Completion trigger context.**~~ **Approved.** *Stand-in approval (DA-14).* Monaco's invoked, trigger-character and re-trigger map to the three LSP trigger kinds; `isIncomplete` is carried to Monaco's flag, whose name V11 settles. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
43. ~~**Resolve policy under F1.**~~ **Approved.** *Stand-in approval (DA-14).* Resolve runs when an item is selected, with a ◇ bound on how long accept waits; on timeout or failure the item is rejected, never partly applied. Chosen only if V10 shows F1 works. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
44. ~~**Notices use existing surfaces only.**~~ **Approved.** *Stand-in approval (DA-14).* An Output line plus the status chip detail. If that does not work, a new surface still needs the architect. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
45. ~~**Hover and documentation rendering.**~~ **Approved.** *Stand-in approval (DA-14).* Markdown with command links and raw HTML disabled, because the text comes from an external process. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
46. ~~**How a returned location opens.**~~ **Approved.** *Stand-in approval (DA-14).* Through a registered Monaco editor opener and Craidd's tab logic (holder focus, owned form, unowned read-only). See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
47. ~~**Reference and symbol result caps.**~~ **Approved.** *Stand-in approval (DA-14).* A ◇ cap with a visible "+N more" and a log line; no silent truncation. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
48. ~~**Symbol shapes.**~~ **Approved.** *Stand-in approval (DA-14).* Prefer hierarchical `DocumentSymbol[]`, tolerate `SymbolInformation[]`; no outline panel. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
49. ~~**Unowned reads are restricted.**~~ **Approved.** *Stand-in approval (DA-14).* A backend read serves only a path the originating session returned, canonicalised, with a size cap, and never writes. It adds a restriction, not a permission; the architect should still see it. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
50. ~~**Read-only is a property of the tab's path view.**~~ **Approved.** *Stand-in approval (DA-14).* Not set on the shared Monaco model, so another view of the same file keeps its own editability. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
51. ~~**Binding of an unowned tab.**~~ **Approved.** *Stand-in approval (DA-14).* `didOpen` to the originating session with the canonical-path URI on activation; when the session ends the tab stays open, unbound; navigating from a live session rebinds. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
53. ~~**Provider-load measurement.**~~ **Approved.** *Stand-in approval (DA-14).* Extends the existing hooks and methods (decisions 23–26, 35, 36); no new switch; no invented budgets. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
54. ~~**Server item commands are not run; F1's revert is Monaco-local.**~~ **Approved.** *Stand-in approval (DA-14).* F1's compensating revert is a Monaco-local command that Craidd attaches to the item, not a server `workspace/executeCommand`; server item commands are still not executed. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
55. ~~**When Stage 1c is done.**~~ **Approved.** *Stand-in approval (DA-14).* Criterion 1 demonstrated, V10–V12 and V18 recorded, G3 and G4 recorded under provider load. Completing 1c accepts no gate. See the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions).
52. **Symlinked-vendor holder rule. Open, needs the architect.** If U10 shows the holder rule gives a canonical-path holder no features, the candidate change prefers the path inside the project tree, which alters [File identity](#file-identity-three-questions) rules 2 and 3. Not approved under DA-14; step 7 of the [plan](plan-lsp-stage-1c-providers.md#proposed-decisions) waits for U10 and the architect (relates to decision 37).

**Stage 1c completion acceptance (stand-in approval, goes beyond DA-12).**

56. **F3, Craidd-owned completion acceptance.** *Stand-in approval (DA-15), probe pending.* Adds a route to decision 13's fallback list after V10 and V18 both Failed: see F3 in the [fallback table](#accepting-a-completion-including-additionaltextedits). It becomes the route for plan step 9 only if the probe passes all four conditions there; otherwise the rule stands and the completion part of 1c does not ship, while hover, symbols, definition, references and navigation proceed. Decision 13's principle is unchanged: atomic or rejected, never primary-only. **This goes beyond what DA-12 allows (it adds a route to an existing decision), and the architect should review it first.**

Checked against the applied philosophy: nothing in decisions 20–37 contradicts it. `rust-analyzer/reloadWorkspace` and the status notification are adapter-owned extensions beneath the philosophy's "every other server is a table entry" rule, and the manual restart button it requires is preserved.

The ◇ values introduced by this revision (admission reserve, cancelled-entry expiry, bad-body tolerance, Unresponsive bound; class T has none because it is a fixed-size record) are initial proposals to be tuned from measured results. The pull revision adds more: the pull debounce, the concurrency cap, the retrigger bound, the consecutive-failure bound, the reload coalescing window and timeout, and the readiness wait for a server with no status notification.

---

## Delivery plan inside Stage 1

**Proposed: three milestones.** This is sequencing, not new gates. Each stage lands with its own tests; there is no "code now, tests later". A stage's exit is **milestone evidence**, recorded by stage in the [results record](results-lsp-stage-1.md). A gate is accepted only when the evidence its row requires is complete and Pass. **Stage 1 acceptance is unchanged: every gate G1–G7 Pass.**

### Stage 1a — transport and session foundation

- **Scope.** Framing extraction (DAP tests unchanged); transport threads; message classification and delivery classes; pending table with cancelled entries; **capability validation** (a session reaches Ready only through it); session state machine, `terminate()`, graceful stop and containment; registry, server identity, and the router, which must introduce the single file-to-owning-project resolver; the Rust adapter including supervised `cargo metadata`; the toolchain `language_server` role with the usable check, and its row in Preferences.
- **User-visible.** Only the Preferences role row.
- **Tests.** Against the fake-server fixture: framing, transport, delivery classes, overflow recovery, pending table, capability validation table, terminate table, process tree.
- **Exit evidence.** Those tests; the DAP suite unchanged; the G6 mechanics with a fake server's process tree; the G1 revalidation logic as unit tests; verifications V1, V5, V6, V7 and V8 recorded **before the Rust adapter merges** (these need a real `rust-analyzer`).
- **Does not claim** any editing intelligence.

### Stage 1b — documents, synchronisation and diagnostics

- **Scope.** Document lifetimes, ordered incremental sync, deterministic resync, save; file identity rules; the deferred launch for the real active document; `lspStore`, delivery to Monaco markers, Problems source badges; status chip; Output source; watcher-failure surfacing; the retention policy. **Pull diagnostics:** the client capabilities `textDocument.diagnostic` and `workspace.diagnostics.refreshSupport` (a change to the 1a `caps` module), `diagnosticProvider` validation, the three pull triggers with `resultId` handling, the refresh counter in the T record, the backend's answer to `workspace/diagnostic/refresh`, and separate push and pull sets merged at display; **readiness gating** (decision 20); the adapter's **workspace reload** (decision 21); the development-only **measurement hooks** and `CRAIDD_LSP=0` (decision 23).
- **User-visible.** Status chip (including the watcher-limit warning), diagnostics, markers. The lock glyph is **not** in 1b: nothing in 1b opens an unowned file, so it moves to 1c (decision 29).
- **Exit evidence.** With a real `rust-analyzer`: diagnostics from both routes appear and clear (the push set persists across close; the pull set clears on close); G1 (all four timings), G2, G5, G6 (real process tree) and G7 recorded; first G3 measurements including G3b; V2–V4 (V3 revised), V9, V13–V16 (V16 open pending U10) and V22–V27 recorded, by the methods in [Measurement hooks and methods](#measurement-hooks-and-methods-decisions-2326); decisions 19–27 approved by the architect.
- **Does not claim** completion, hover, definition, references or symbols.

**Open before 1b implementation starts.**

*Needs the architect:* nothing remains for 1b. Decision 19, A2 and A4 are approved and applied. The philosophy sentence about hidden windows (stage 6) stays open and is not a 1b blocker.

*Needs evidence only (real `rust-analyzer`):* V3 (revised), V22–V27, V2, V4, V9, V13–V16, and V7's rustup-shim case as a release qualification. These block the parts of 1b named in the results record, not the start of work that does not depend on them.

### Stage 1c — providers

- **Scope.** Completion (trigger context, `isIncomplete`, resolve) and atomic acceptance; hover; definition; references; document symbols; provider registration once per language, capability-gated. **Navigation to unowned files, with the read-only rule and the tab lock glyph** (moved from 1b, decision 29; the requirement of decision 4 is unchanged), and the symlinked-vendor navigation cases (a)–(d).
- **Exit evidence.** Completion and acceptance tests; V10–V12 and V18 recorded; G3 and G4 recorded under provider load; acceptance criterion 1 demonstrated.
- Stage 1 is accepted when every gate is Pass.
- **Plan.** The implementation plan, work packages, test list, U-step outline and the choices the design leaves open are in [plan-lsp-stage-1c-providers.md](plan-lsp-stage-1c-providers.md). It starts only after the 1b merge (DA-10). The plan's order of work, tests and exit evidence are approved under DA-14; decisions 40–51 and 53–55 are approved as stand-ins, and decision 52 waits for the architect (step 7, the symlinked-vendor cases, waits for U10 and for it).

### Which stage completes which gate

| Gate | Evidence begins | Evidence complete |
|---|---|---|
| G1 | 1a (revalidation logic, process counts) | 1b (real launch, four timings) |
| G2 | 1a (identity unit tests) | 1b |
| G3 | 1b (indexing, G3b) | 1c (under provider load) |
| G4 | 1a (stalled consumer, fake server) | 1c |
| G5 | 1b | 1b |
| G6 | 1a (fake server tree) | 1b (real tree) |
| G7 | 1b | 1b |

Philosophy amendments are applied or withdrawn before the stage they govern is merged: A1, A3 and A5 before 1a merges, and A2 and A4 before 1b merges (all approved and applied); A6 and A7 before Stage 1 acceptance.

**Stop conditions (confirmed by the architect):** if V1 shows `rust-analyzer` cannot watch files itself, or V8 shows `cargo metadata --no-deps` writes `Cargo.lock`, Rust adapter work stops and the design is revisited before anything further merges.

---

*Last updated: Phase 3 (Stage 1 proposal; pull diagnostics in Stage 1b, decisions 16–18 approved, decisions 19–36 and 38 and amendments A2, A4 approved; A2 wording corrected and decision 39 recorded under stand-in approvals DA-4 and DA-5; Stage 1c plan linked, decisions 40–51 and 53–55 approved as stand-ins (DA-14), decision 52 open; V10 and V18 Failed, decision 56 (F3) under DA-15 with its probe pending; decision 37 keeps V16 open). Author(s): ShinkuKira21*
*This document is a design.*
