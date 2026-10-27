# Review: LSP Stage 1 against Visual Studio 2022, Rider and VS Code

**Roadmap track:** Phase 3 language intelligence, Stage 1 pre-approval review. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Independent design review. Nothing in the design, the philosophy or the source has been changed by it. Findings are proposals for the architect to accept or reject.

**Subject:** [design-lsp-stage-1-rust.md](design-lsp-stage-1-rust.md).

**Purpose:** Test the Stage 1 design against how mature products solve the same problems. This is not a mandate to copy any of them. Craidd's priority is Linux-first performance, correctness, reliability and a responsive editor.

---

## How to read the evidence

| Tag | Meaning |
|---|---|
| **[D]** | Documented by the vendor or the specification. Source linked. |
| **[S]** | Read directly from public source code (`vscode-languageclient`). Source linked. Describes that code on its current main branch, not a guarantee. |
| **[O]** | Reported product behaviour (support pages, community reports). Weaker evidence. |
| **[I]** | Inference or general knowledge I could not verify in this review. Treat as a hypothesis. |

Important limits:

- **Visual Studio 2022 and Rider do not use LSP for their own C# analysis.** Visual Studio uses Roslyn; Rider uses a ReSharper backend. Visual Studio's LSP support is for third-party language servers. Neither is an LSP architecture comparable to Craidd's, so they are compared on *principles* (isolation, responsiveness, recovery), never on mechanism.
- Only VS Code's LSP client is a like-for-like comparison, and only its public client library (`vscode-languageclient`). VS Code's internal editor is a different component from Monaco's standalone package, which is what Craidd uses.
- Rider support for Rust and Visual Studio's handling of Rust are out of scope; neither was reviewed.
- I could not find vendor documentation on crash recovery for Rider's backend or on Visual Studio's LSP client lifecycle details. Those are recorded as gaps, not filled by guess.

---

## Summary

The Stage 1 design holds up. On the points where an independent source exists, the design agrees with the specification and with VS Code's client, and in several areas it is stricter (a flush-before-request rule the specification mandates, a per-session document table, no stale responses applied).

Nothing found requires a change in architecture. There are **nine small Stage 1 clarifications**, none of which expand scope. They are mostly missing safeguards that the specification or a performance argument makes necessary:

| # | Finding | Area |
|---|---|---|
| N1 | A cancelled request is still answered by the server, so the pending table must keep it until the reply arrives | Completion |
| N2 | The backend reader must never block on the frontend; diagnostics and progress need backend-side latest-wins coalescing with a bounded queue | Isolation |
| N3 | Map `isIncomplete` and the completion trigger context | Completion |
| N4 | G6 must prove that the server's descendant processes are gone, not just its main pid | Lifecycle |
| N5 | Distinguish a framing error (fatal) from one unparsable message body (bounded tolerance) | Recovery |
| N6 | `additionalTextEdits` must not overlap the main edit, including the same insert position | Completion |
| N7 | Do not clear LSP diagnostics on `didClose`; add a test | Diagnostics |
| N8 | Measure diagnostic store memory (G5) and IPC rate and size (G3) | Isolation |
| N9 | State a path canonicalisation policy for external files | Dependency navigation |

Everything else is either already covered, a later-stage item, or unnecessary.

---

## 1. Server lifecycle

**Evidence**

- VS Code activates extensions lazily by activation events, so they do not use CPU and memory unnecessarily [D: [extension host](https://code.visualstudio.com/api/advanced-topics/extension-host)].
- VS Code's client can defer `didOpen` for documents that are not visible (`delayOpenNotifications`, default `false`) [S: [textSynchronization.ts](https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/textSynchronization.ts)].
- VS Code's default error handler restarts a crashed server up to 4 times; if the restarts fall within 3 minutes of each other it stops restarting and logs that it will not restart [S: [client.ts](https://github.com/microsoft/vscode-languageserver-node/blob/main/client/src/common/client.ts)].
- `stop()` defaults to a 2,000 ms timeout, racing `shutdown`/`exit` against it [S: client.ts].
- The specification requires waiting for the `shutdown` response before `exit`, and exit code 0 only if `shutdown` was received [D: [LSP 3.17](https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/)].
- Visual Studio runs Roslyn analysis in out-of-process helpers (`ServiceHub.RoslynCodeAnalysisService`), and when one ends unexpectedly shows an infobar and recommends restarting Visual Studio [D: [Microsoft Learn](https://learn.microsoft.com/en-us/troubleshoot/developer/visualstudio/ide/visual-studio-unrecoverable-process-error)].
- Rider runs a ReSharper backend as a separate 64-bit process from the IntelliJ-based frontend [D: [JetBrains](https://blog.jetbrains.com/dotnet/2023/01/05/resharper-out-of-process/)].

**1. Done well.** Start on demand, with background tabs pending, is the same idea as VS Code's lazy activation and deferred `didOpen`. The explicit state machine, the supervisor-owned process, and a 2 s `shutdown` wait that matches VS Code's default are all sound. Craidd's supervisor survives an IDE SIGKILL, which none of the compared products documents.

**2. Mature IDEs do better.** VS Code restarts a crashed server automatically, bounded by a crash-loop guard. Craidd has no auto-restart by design (philosophy: the user decides). A transient crash costs the user a manual click and loses diagnostics until then. Visual Studio's own recovery here is weaker, not stronger: it asks the user to restart the whole IDE.

**3. Risks.** `rust-analyzer` starts child processes (cargo check, build scripts, a proc-macro server) [I]. The supervisor tracks descendants [D: Craidd's [process cleanup design](../../runtime/design-process-cleanup.md)], but G6 as written counts "server processes" and could pass while a descendant is left.

**4. Change?**
- **N4, Stage 1:** G6 must assert that the server's descendants are gone too.
- Bounded auto-restart: **later.** It would need amendment A6 to be revisited, and the evidence for it should come from real crash frequency, not from VS Code's choice.

---

## 2. Document ownership and synchronisation

**Evidence**

- The client must claim a document with `didOpen` before sending changes; open and close must balance; one open at a time [D: LSP 3.17].
- Within a `didChange`, changes apply in array order; version is "the version after all provided content changes have been applied" and need not be consecutive [D: LSP 3.17].
- Before requesting information, the client must ensure the document is synchronised [D: LSP 3.17].
- `vscode-languageclient` sends each incremental change as its own notification immediately, with no debounce or batching. Full-sync documents are queued per URI, with a 250 ms delayer, and flushed before requests [S: textSynchronization.ts, client.ts].
- The client does not itself check that a document is open before sending a change; it relies on selector matching [S: textSynchronization.ts].

**1. Done well.** The design's ordered batching, flush before dependent requests, per-session open/close balance and resync path implement what the specification requires, and are stricter than the VS Code client in one respect: VS Code does not enforce open-before-change [S], Craidd does. Batching consecutive changes into one array is permitted by the specification and VS Code's immediate per-event sends show an unbatched approach is also workable, so batching is an optimisation, not a necessity.

**2. Mature IDEs do better.** Nothing material. VS Code's approach is simpler; Craidd's is not worse.

**3. Risks.** None beyond those already handled. The design's "at most one `didOpen` per `(session, uri)`" and replay-on-restart cover the specification's balance rule.

**4. Change?** None needed. Per-event sending (VS Code's approach) would be a simplification but gives up batching; **unnecessary** to change.

---

## 3. Completion responsiveness

**Evidence**

- Visual Studio's async completion model keeps UI-thread work minimal (`TryGetApplicableSpan` is called on the UI thread and "should return promptly"), and runs item computation on cancellable background threads [D: [vs-editor-api wiki](https://github.com/Microsoft/vs-editor-api/wiki/Modern-completion-walkthrough)].
- A cancelled request "still needs to return from the server and send a response back" [D: LSP 3.17].
- `ContentModified` means the content changed outside normal conditions; `staleRequestSupport` lets a client declare cancel and retry behaviour [D: LSP 3.17].
- `vscode-languageclient` maps `RequestCancelled`/`ServerCancelled` to a default value when the token was cancelled, and retries `ContentModified` only for semantic-token requests; other requests return the default (empty) [S: client.ts].
- `completionItem/resolve` lazily fills `detail` and `documentation` by default, and other properties only if the client declares `resolveSupport`; `sortText`, `filterText`, `insertText` and `textEdit` must not change during resolve. `additionalTextEdits` "must not overlap (including the same insert position) with the main edit nor with themselves" [D: LSP 3.17].

**1. Done well.** Provider work stays off the UI path; the newest request supersedes the old; stale responses are rejected independently of cancellation; `ContentModified` is treated as no result, which matches VS Code's behaviour for non-semantic-token requests [S]. Including `completionItem/resolve` is consistent with how the specification expects costly detail to be deferred.

**2. Mature IDEs do better.** Visual Studio's explicit split between a cheap synchronous decision (whether completion applies) and an asynchronous item computation is a clear guard against input lag. Monaco's provider API is already asynchronous, so Craidd gets the equivalent, but nothing in the design says *what* runs before the first await.

**3. Risks.**
- **Cancelled requests still get replies.** The pending table is bounded (cap, fail-fast). If cancelled entries are removed when cancelled, late replies look like unknown ids, and if they stay counted, the cap can fill during fast typing. The design does not say which.
- **`isIncomplete` and trigger context.** Whether Monaco filters a returned list locally or re-requests is controlled by the list's incomplete flag. If the design does not map it [I: Monaco's own field name should be checked], every keystroke either re-requests unnecessarily or filters a list the server wanted refreshed. The trigger kind and character must also be passed to the server for context-sensitive completion.
- **Overlap rule wording.** The design rejects overlapping `additionalTextEdits`; the specification also forbids the *same insert position*.

**4. Change?**
- **N1, Stage 1:** keep cancelled requests in the pending table, marked cancelled, until the reply arrives; the late reply is matched and dropped; cancelled entries count toward the cap only for a bounded time or count, stated in the design.
- **N3, Stage 1:** map `isIncomplete` to Monaco's incomplete flag and pass trigger kind and character. Verify the Monaco field behaviour on 0.56.x.
- **N6, Stage 1:** tighten the overlap rule to include equal insert positions.
- Automatic retry on `ContentModified`: **unnecessary** for Stage 1 (VS Code retries only semantic tokens [S]).

---

## 4. Diagnostics

**Evidence**

- Push: newly pushed diagnostics replace earlier ones; the server clears with an empty array; `version` is optional and used only if the client declares `versionSupport` [D: LSP 3.17].
- Pull (3.17): added because push lets the server choose when to compute, so it cannot prioritise the file being edited or visible files; clients pull for the active document and less often for visible ones [D: LSP 3.17].
- VS Code's sample language server guide uses pull diagnostics [D: [guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)].
- Rider's solution-wide analysis is separate from per-file analysis, runs in the background, can be paused, and does not monitor projects that are not built in the current configuration [D: [JetBrains help](https://jetbrains.com/help/rider/Code_Analysis__Solution-Wide_Analysis.html)]. It only supports C# and Visual Basic [D: same page].
- Publish rules for files that are closed differ between single-file and project-based languages [D: LSP 3.17].

**1. Done well.** Replace-per-file storage matches the push semantics; separating live server results from build results (labelled by source, separate lifecycles) is clearer than a single mixed list; coalescing and hash-skip protect Monaco. Not clearing on session end would have been a mistake; clearing them is correct.

**2. Mature IDEs do better.** Pull diagnostics let a client prioritise the file being edited, which push cannot. That matters mostly for servers that are slow to publish. Rider treats whole-solution analysis as a distinct, pausable background activity; `rust-analyzer`'s workspace check on save is the closest equivalent here.

**3. Risks.**
- **Clearing on `didClose`.** For project-based languages the specification expects diagnostics to persist for closed files. The design stores them for the Problems panel, but does not say a close must not clear them.
- **Unbounded diagnostic memory.** The design bounds panel *rendering* but keeps full totals. A workspace with a very large number of diagnostics grows the store without limit. Not a correctness bug, but unmeasured.
- Whether `rust-analyzer` supports pull diagnostics was not verified [I]; it is not needed for Stage 1.

**4. Change?**
- **N7, Stage 1:** closing a document does not clear its diagnostics; add the test.
- **N8, Stage 1 (measurement only):** record diagnostic store size in G5.
- Pull diagnostics: **later**, if push proves slow for the active file. Not a Stage 1 need.

---

## 5. Dependency navigation

**Evidence**

- Visual Studio opens a read-only metadata view when source is unavailable; decompiled-source navigation (ILSpy) is an opt-in setting; since 17.1 it can also navigate to external source via PDB lookup [D: [Microsoft Learn](https://learn.microsoft.com/en-us/visualstudio/ide/go-to-and-peek-definition); [Roslyn blog](https://devblogs.microsoft.com/dotnet/go-to-definition-improvements-for-external-source-in-roslyn/)].
- Rider opens decompiled sources read-only, and its navigation and search commands still work inside them [D: [JetBrains help](https://jetbrains.com/help/rider/Navigation_and_Search__Navigate_from_Here__Decompiled_Code.html)].

**1. Done well.** Read-only, with intelligence still working in the file (because it stays bound to its session), is the same model both products use. A lock indicator in the tab is a clearer signal than a silently read-only buffer.

**2. Mature IDEs do better.** Both products make navigation *inside* the external file work (find usages, further go-to-definition); Craidd's binding gives this too, but only while the originating session lives. Both also make the source of external code explicit (Visual Studio labels metadata views; Rider marks decompiled output).

**3. Risks.**
- **Path identity.** The same registry file can be reachable through a symlink and a canonical path. The design has one path-to-URI function but does not say whether it resolves symlinks, so one file could be two documents in a session [I].
- **Missing standard-library source.** Go-to-definition into the standard library needs the Rust source component installed [I]. If absent, the user gets no navigation and no explanation.
- A restored external tab after restart has no session and must open read-only and unbound.

**4. Change?**
- **N9, Stage 1:** state the canonicalisation policy for external files in the path-to-URI rule and test it.
- Status message when the standard-library source is missing: **later** (needs verification of the exact failure first).
- Decompilation, metadata views: **unnecessary** (not applicable to Rust).

---

## 6. Failure recovery

**Evidence**

- VS Code's error handler tolerates up to 3 message-level errors before shutting the connection down (`Continue` while the count is truthy and at most 3) and restarts a closed connection with the crash-loop guard described in section 1 [S: client.ts].
- Requests that fail for `PendingResponseRejected`/`ConnectionInactive` resolve to a default value [S: client.ts].
- Visual Studio: an Roslyn helper process dying produces an infobar and a recommendation to restart Visual Studio [D: Microsoft Learn].
- Rider backend crash behaviour: **no vendor documentation found.**

**1. Done well.** Every failure degrades to a working editor with visible status, diagnostics from a dead session are cleared, and the user decides about restarts. This is at least as protective of the editor as either product's documented behaviour.

**2. Mature IDEs do better.** VS Code (a) restarts automatically, bounded, (b) tolerates a few bad messages before giving up, and (c) resolves in-flight requests to an empty default on connection loss. Craidd's design treats *any* malformed message as `Failed`. For a framing error that is right, because the stream position is lost. For a single unparsable JSON body with intact framing, the stream is still aligned and the session could continue.

**3. Risks.** Failing the whole session on one bad body turns a recoverable glitch into a user-visible restart. On connection loss, the design should state that every in-flight request resolves to "no result" so no provider promise is left pending.

**4. Change?**
- **N5, Stage 1:** a framing error is fatal; an unparsable body with intact framing is counted, logged and skipped, with a small bounded count before the session fails. All in-flight requests resolve to no result on any terminal state.
- Auto-restart: **later**, as in section 1.

---

## 7. Performance isolation

**Evidence**

- VS Code's guide: language analysis is heavy on CPU and memory, and running it in a separate process "avoids performance cost" [D: [language server guide](https://code.visualstudio.com/api/language-extensions/language-server-extension-guide)].
- VS Code's extension host exists so that extensions do not slow startup or UI operations or modify the UI [D: extension host page]. That page does not describe the process boundary, so I do not claim one from it.
- Visual Studio moved heavy analysis out of the IDE process; Visual Studio 2022 is 64-bit and still uses out-of-process analysis [D/O: Microsoft Learn; [NDepend history](https://blog.ndepend.com/visual-studio-2022-64-bits-elements-of-history/) is secondary].
- Rider keeps the analysis backend in its own 64-bit process [D: JetBrains].
- Microsoft notes that on large solutions an out-of-process analysis helper can have a significant performance impact, and it can be reduced by disabling features [D: Microsoft Learn]. Isolating a process does not remove its CPU and memory cost.

**1. Done well.** Servers are already separate processes. Reader, writer and stderr threads are separate from the UI. Nothing blocks on a server round trip. Gates G1, G3 and G4 are measurements against a baseline, not claims.

**2. Mature IDEs do better.** None of the compared products documents a technique Craidd lacks here. All rely on a process boundary, which Craidd has.

**3. Risks.** This is where the design has its largest gap.
- **Backend back-pressure.** The design coalesces diagnostics *in the frontend store*, per frame. It does not say what the backend does when the frontend is slower than the server. If the backend reader waits on the frontend channel, it stops reading the server's output; the server then blocks on a full pipe, and a slow UI stalls the server (and its on-save check). The reader must never block on the frontend.
- **Serialisation cost.** Large replies (completion lists, document symbols) and diagnostic floods cross the Tauri channel as JSON into the webview. That cost is on the UI process even though the server is isolated. The design measures typing latency (G3) but not message rate and size.
- A process boundary does not bound CPU. The server's on-save check competes with the user's builds for CPU (the lock contention was addressed by the separate target directory; CPU contention was not).

**4. Change?**
- **N2, Stage 1:** the backend reader never blocks on the frontend. Progress and diagnostics are coalesced latest-wins per key in the backend, in a bounded queue, before being sent. Add a test with a deliberately slow consumer.
- **N8, Stage 1 (measurement only):** record channel message rate and bytes during indexing in G3.
- Lowering the server's CPU priority: **later**, only if G3 shows CPU contention with builds. **Unnecessary** otherwise; none of the compared products documents it.

---

## Findings by decision

### Necessary for Stage 1 (clarifications and measurements; no scope expansion)

| # | Change | Where it lands in the design |
|---|---|---|
| N1 | Cancelled requests stay in the pending table until the reply arrives; late replies matched and dropped; cap behaviour stated | Requests, cancellation and staleness |
| N2 | Backend reader never blocks on the frontend; backend-side latest-wins coalescing in a bounded queue; slow-consumer test | Architecture (delivery), Diagnostics, Testing |
| N3 | Map `isIncomplete`; pass trigger kind and character; verify on Monaco 0.56.x | Capability negotiation, Pending verifications |
| N4 | G6 asserts descendant processes are gone | Performance gates (G6), Testing |
| N5 | Framing error fatal; unparsable body skipped with a bounded count; all in-flight requests resolve to no result on terminal states | Error recovery |
| N6 | `additionalTextEdits` overlap rule includes equal insert positions | Accepting a completion |
| N7 | Closing a document does not clear its diagnostics; test | Diagnostics, Testing |
| N8 | Record diagnostic store size (G5) and IPC rate and size (G3) | Performance gates |
| N9 | State path canonicalisation policy for external files; test | Routing, Testing |

### Appropriate for a later stage

- Bounded automatic restart with a crash-loop guard (revisit amendment A6 with real crash data).
- Pull diagnostics (if push proves slow for the active file; support in `rust-analyzer` not verified).
- A visible message when standard-library source is missing (verify the failure first).
- Lower CPU priority for the server (only if G3 shows contention with builds).

### Unnecessary

- Sending one `didChange` per edit event (batching is permitted and kept).
- Retrying on `ContentModified`.
- Decompilation or metadata-as-source views.
- A Rider-style solution-wide analysis feature (the server's workspace check covers the Rust case).
- Copying any compared product's process model; Craidd already isolates servers as separate processes.

---

## Evidence and gaps

**Read directly:** LSP 3.17 specification (sections on base protocol cancellation, error codes, lifecycle, `didOpen`/`didChange`/`didClose`/`didSave`, publish and pull diagnostics, completion resolve), `vscode-languageclient` source (`textSynchronization.ts`, `client.ts`), VS Code extension-host and language-server guides, Microsoft Learn and JetBrains documentation pages cited inline.

**Not found or not verified:**

- Vendor documentation of Rider backend crash recovery.
- Visual Studio's LSP client lifecycle details (the reviewed page covers building an extension, not client behaviour).
- VS Code's treatment of an unresponsive extension host (the reviewed page does not address it).
- Whether `rust-analyzer` supports pull diagnostics, and the exact names of its child processes (marked [I] where used).
- Monaco's exact incomplete-list behaviour on the pinned version.
- Any numbers on product performance. None were gathered, and none are claimed.

---

*Last updated: Phase 3 (Stage 1 pre-approval review). Author: ShinkuKira21.*
*This document is a record.*
