# Plan: LSP Stage 1c — providers

[Design](design-lsp-stage-1-rust.md#stage-1c--providers) · [Results](results-lsp-stage-1.md) · [Delegated approvals](delegated-approvals-lsp-stage-1.md)

**Roadmap track:** Phase 3 language intelligence, Stage 1. See the [current roadmap](../../../roadmaps/Roadmap-v0.0.4A.md).

**Status:** Reviewed by the lead. The plan and decisions 40–51 and 53–55 have **stand-in approval (DA-14)**. Decision 52 **needs the architect**. Stage 1c begins only after `feat/lsp-stage-1b` is merged into `feat/intellisense-ws` (DA-10). No code has been written under this plan. See [DA-14](delegated-approvals-lsp-stage-1.md) for the conditions attached to 44, 49 and 54.

**Scope:** exactly the design's [Stage 1c](design-lsp-stage-1-rust.md#stage-1c--providers). Nothing else: no rename, code actions, signature help, inlay hints, semantic tokens, workspace symbols or formatting (the design's non-goals), and no language other than Rust.

**Authority:** The design and the [philosophy](../../../philosophies/ide_editor/intellisense/philosophy-intellisense.md) stay authoritative. This plan sequences and tests what the design already requires, and lists the choices the design leaves open. A6, A7 and the stage 6 wording are not touched (DA-9).

**Code basis:** read on `refs/heads/feat/lsp-stage-1b`. File names below are real; function names are given only where the 1b code showed them, and anything inferred is said to be inferred.

---

## What 1b already gives 1c

| Piece | Where (1b) | Use in 1c |
|---|---|---|
| Request machinery | `src-tauri/src/lsp/session.rs`: `begin_request`, `cancel`, `request` (with timeout); `pending.rs` (Awaiting / Cancelled table, cap, expiry); `protocol.rs` `Outcome` | Providers reuse it. `lsp_pull` in `commands.rs` is the template: begin, `spawn_blocking` wait, cancel on no result, typed reply, no lock across the round trip. |
| Capability validation | `caps.rs`: `NegotiatedCaps` already holds `completion { trigger_characters, resolve }`, `hover`, `definition`, `references`, `document_symbol` | The backend is ready. The **frontend** `NegotiatedCaps` in `src/lib/lsp/protocol.ts` carries only sync, save, pull and server identity; it must be extended with the validated provider booleans and trigger characters (no raw `initialize` result, per the design). |
| Documents and sync | `documents.rs` and `src/lib/lsp/documents.ts` (`DocumentTracker`): ordered queue, epoch, flush, Pending / open / alias states | Every provider request flushes first and captures `(epoch, versionId)`. |
| File ownership | `src-tauri/src/ownership.rs` `owning_project`; `router.rs` `route`; `lsp_attribute` | Decides owned versus unowned for a navigation target. Navigation bindings exist "reached only from tests" (`lsp/mod.rs` header); 1c wires them. |
| Bridge and Monaco hooks | `src/lib/lsp/bridge.ts`: `attachMonaco`, `modelFor`, `fileIdOf`, `DocTransport`; `CodeView.tsx` and `SideEditor.tsx` (`readOnly: false` is fixed today) | Provider registration and the editable/read-only switch. |
| Tab strip | `src/components/editor/EditorTabs.tsx` | Lock glyph, beside the existing status dots. |
| Fake server | `src-tauri/src/lsp/fake_server.rs`, `tests.rs`; `real_rust_analyzer` opt-in tests (`--ignored`) | All backend provider tests; real-server tests follow the same opt-in shape. |
| Measurement hooks | `src/lib/lsp/metrics.ts`, `CRAIDD_LSP=0` baseline (decision 23) | G3 and G4 under provider load extend these; no new switch. |

Open facts to check at the start of 1c, not assumed: the 1b `initialize` params already advertise the provider capabilities in the design's client-capability table (completion with snippets and `resolveSupport`, hover, definition, references, hierarchical document symbols); and whether `lsp/mod.rs`'s `#![allow(dead_code)]` can be narrowed once navigation is wired.

## Order of work

Each step lands with its own tests; there is no "code now, tests later". A step that fails its tests stops the steps after it.

| Step | Work package | Depends on |
|---|---|---|
| 0 | Prerequisites: DA-10 merge of 1b; frontend capability summary extension | — |
| 1 | Request plumbing: typed backend commands, bridge `request` helper (flush, supersede, cancel, stale rejection), provider registration once per language | 0 |
| 2 | Hover | 1 |
| 3 | Document symbols | 1 |
| 4 | Definition, with navigation to **owned** files and focusing the holder tab | 1 |
| 5 | Unowned files: read-only, bound to the originating session, lock glyph (decisions 4 and 29) | 4 |
| 6 | References | 4 |
| 7 | Symlinked-vendor cases (a)–(d) | 4, 5, and **U10 / V16** |
| 8 | Completion: trigger context, `isIncomplete`, resolve | 1; V11 |
| 9 | Atomic acceptance (decision 13, F1 then F2) | 8; V10, V12, V18 |
| 10 | Provider-load measurement (G3, G4) and acceptance criterion 1 | all |

Hover goes first because it is the smallest request that exercises the whole path (flush, capture, response, stale check, mapping). Completion goes late because it carries the one hard requirement (atomic acceptance) and the Monaco verifications V10–V12.

---

## Work packages

### 0. Prerequisites

- **Touches:** `src/lib/lsp/protocol.ts` (`NegotiatedCaps`), the backend summary that feeds it (`caps.rs` to the Channel record; inferred from how `pull` already travels), `src/store/lspStore.ts`.
- **Tests:** table-driven summary test (valid, absent, invalid shape for each provider field, as for pull); node test that the frontend never receives the raw `initialize` result.
- **Exit evidence:** summary shows the validated booleans and the trigger-character list on a real server's Output line (the design already requires the one-line capability summary).

### 1. Request plumbing and provider registration

- **Touches:**
  - Backend: new typed commands in `src-tauri/src/lsp/commands.rs`, one per kind (proposed decision 40), a shared helper in `session.rs` next to `begin_pull`; `pending.rs` unchanged unless the cap needs a per-kind count.
  - Frontend: a request helper in `src/lib/lsp/bridge.ts` (or a new `requests.ts` beside it, to keep `bridge.ts` from growing further) that flushes the document, records `{requestId, uri, epoch, versionId, position}`, supersedes the previous request of the same kind and document, and rejects a stale response.
  - Registration: in `bridge.ts` `attachMonaco`, once per language from the `LANGUAGES` table; each provider resolves the model's session and checks that session's capabilities, returning empty otherwise (design: [Monaco provider registration](design-lsp-stage-1-rust.md#monaco-provider-registration)).
- **Tests:**
  - Fake server: round trip per kind; cancel moves the entry to Cancelled and the late reply is dropped and counted; a full table returns typed busy and the provider returns empty; a dead session resolves every awaiting command; a provider is never requested when its capability is absent (table over all five); `ContentModified` and `ServerCancelled` are "no result".
  - Node: position mapping (UTF-16, 0 to 1-based) on multi-byte text; stale rejection on epoch change and on `versionId` change; supersession; registration happens once for two sessions and re-registers only when trigger characters differ; no Rust characters hardcoded in the frontend (the 1b grep-style check, if one exists, extended).
- **Exit evidence:** the tests above; DAP suite unchanged; no new always-on cost with `CRAIDD_LSP=0`.

### 2. Hover

- **Touches:** a `hover` provider in the bridge; mapping of `MarkupContent` and `MarkedString` to Monaco markdown (decision 45).
- **Tests:** fake server returns each shape (markdown, plaintext, `MarkedString[]`, null); range mapping; stale hover dropped after an edit; no request when `hover` is false.
- **Exit evidence:** real `rust-analyzer` returns type information for a known symbol in `fx-small` (opt-in test); part of acceptance criterion 1.

### 3. Document symbols

- **Touches:** a `documentSymbol` provider; mapping of `DocumentSymbol[]` (hierarchical, advertised) and tolerance of `SymbolInformation[]` (decision 48).
- **Tests:** nested symbols keep their tree; range and selection range both mapped; a symbol with an invalid range is dropped, not thrown; null and empty.
- **Exit evidence:** real server output for a file with nested modules and impls; shown only through Monaco's own outline and breadcrumbs (no panel, decision 15).

### 4. Definition and navigation to owned files

- **Touches:** a `definition` provider; an editor opener registered with Monaco so a returned location goes through Craidd's tab logic and not Monaco's own model creation (decision 46); `documents.ts` focus-the-holder path; `solutionStore` tab open for an owned path.
- **Behaviour (from the design, not new):** a location is mapped to a filesystem identity; a holder tab is focused, no second tab; a path under a project root opens in the project's own path form (owned, editable); anything else goes to step 5.
- **Tests:** node: locations as `Location`, `Location[]`, `LocationLink[]` (the last is not requested but tolerated); focus-the-holder; owned path opens in project form; explicit opens by path are unchanged. Fake server: cancellation on a superseded definition.
- **Exit evidence:** definition within the file, to another file in the project, and to a file already open focuses that tab (U-steps below).

### 5. Unowned files, read-only, lock glyph (decisions 4 and 29)

- **Touches:**
  - Backend: a read command for a navigation target (decision 49) beside `commands/fs.rs` `read_file`, or a restriction on it; router/registry binding of the file to the originating session (the design's "sticky" rule; 1b has the binding code, test-only).
  - Frontend: per-tab read-only flag in the tab/solution state, consumed by `CodeView.tsx` and `SideEditor.tsx` in place of the fixed `readOnly: false`; the lock glyph in `EditorTabs.tsx`.
- **Rules (from the design):** read-only; Craidd never saves it, so no dirty state, no save path, no backup; bound to the originating session; if that session ends the tab stays open but unbound, with no intelligence; a file already open as a normal editable file keeps its owner-based routing and editability.
- **Tests:** node: the flag follows the path view, not the underlying file; a dirty-state change is impossible on a read-only tab (the model rejects edits and the store never marks it dirty); save and "save all" skip it; session end unbinds without closing. Rust: the read command refuses a path the session did not return (decision 49), refuses oversize files, and never writes. A negative test that nothing under `~/.cargo` or the toolchain is ever written.
- **Exit evidence:** a standard-library or registry file opens read-only with the lock glyph; typing does nothing and the reason is visible; the file is never modified on disk (checksum before and after, a harness step).

### 6. References

- **Touches:** a `references` provider with `includeDeclaration` per Monaco's context; the same location mapping and opener as step 4.
- **Tests:** results across several files, including an unowned one; a large result is capped with a visible "+N" (decision 47); stale drop; capability gate.
- **Exit evidence:** real-server references for a symbol used in more than one file.

### 7. Symlinked-vendor cases (a)–(d) and V16

- **Touches:** the holder rules in `src/lib/lsp/documents.ts` and the navigation focus logic from step 4.
- **Tests:** the design's four cases, each as a node test and as a real-filesystem test: (a) a vendored copy that is a real directory; (b) a vendored path that is a symlink to the registry copy; (c) both opened explicitly by path; (d) navigation to each while the other is open. Expected, per the design: one underlying file, one registration, the owned editable tab holds it, the registry-path view is a read-only alias, navigation to either focuses the holder.
- **Dependency:** decision 37 keeps V16 open. 1b recorded that a hover in the same file opened through its canonical path returned nothing, so the canonical-path holder may get no features. **This step does not start until U10 gives the facts.** If U10 shows the design's holder rule is wrong, the rule changes: that is a change to design rules 2 and 3 of [File identity](design-lsp-stage-1-rust.md#file-identity-three-questions) and **needs the architect** (decision 52).
- **Exit evidence:** (a)–(d) recorded; V16 decided from U10.

### 8. Completion: trigger context, `isIncomplete`, resolve

- **Touches:** a `completion` provider; the `resolveCompletionItem` hook; trigger characters taken from the first ready session's validated list; `isIncomplete` carried to Monaco's list-incomplete flag (V11 settles the flag name on the pinned Monaco 0.56.x); the item mapping (kind, `textEdit` or `insertText`, `InsertReplaceEdit`, snippet marking, `filterText`, `sortText`, `data` preserved untouched).
- **Rules (from the design):** resolve is never sent unless `resolveProvider` was `true`; only documentation, detail and additional text edits are applied from a resolve response, and changes to `label`, `kind`, `sortText`, `filterText`, `insertText` or `textEdit` are ignored and logged; resolve follows the same flush, supersession, cancellation and stale rules; a resolve for a superseded item or a dead session is dropped.
- **Tests:** fake server: resolve not sent when not advertised; response fields outside the allowed set ignored and logged; `data` round trip byte-identical; incomplete list re-requested on typing, complete list filtered locally; trigger characters from the capability list, none hardcoded. Node: context mapping (invoked, trigger character, re-trigger).
- **Exit evidence:** V11 recorded; real-server completion in `fx-small`; part of acceptance criterion 1.

### 9. Atomic acceptance (decision 13)

- **Touches:** the accept path for completion items with `additionalTextEdits`: one function that validates the edit set, maps ranges with the same conversion as every other position, and applies primary and additional edits as one grouped edit. Item-level state bound to `(epoch, versionId)`.
- **Rules (from the design, all eight):** resolved before applied; edits mapped like any range; **no overlap, or the whole item is rejected** (including the same insert position), with a log line and a brief notice, never degraded to the primary edit; insert versus replace follows Monaco's mode and snippets only where the server marks them; a stale item is re-resolved or rejected; one undo step; edits are ordinary model edits flowing into the change queue and mark nothing LSP-specific dirty; an item from a dead session is applied only if already complete.
- **Fallback order, decided in the design:** F1 (Monaco waits for the resolve; a compensating revert after accept if the resolve fails, times out, is stale or returns invalid edits), then F2 (eager mode: Craidd stops declaring lazy `additionalTextEdits`). **Applying the primary edit alone is never acceptable.** If neither F1 nor F2 can be shown to work, the completion part of 1c does not ship and criterion 1 is not weakened; this is recorded as a result and **goes to the architect**.
- **Verifications first:** V10 (does accept wait for a pending resolve; behaviour when resolve fails; can a post-accept command revert) and V12 (one undo step) are run against Monaco 0.56.x **before** the accept path is written, because they choose between F1 and F2. V18 (the server sends additional edits in the list when the client does not declare them lazy) is run for F2.
- **Tests:** node, one test per requirement 1–8, plus: an auto-import (`HashMap` with a `use` edit) lands as one undo step; an overlapping set is rejected whole and the document is unchanged byte for byte; an edit set computed against an older version is not applied; the primary-only case cannot be produced by any code path (a test that fails the build if a path applies fewer edits than the item carries). Real server: an auto-import completion in `fx-small` inserts symbol and `use` correctly.
- **Exit evidence:** V10, V12, V18 recorded; acceptance criterion 1's auto-import case demonstrated; the byte-for-byte negative tests.

### 10. Measurement under provider load (G3, G4) and criterion 1

- **Touches:** `src/lib/lsp/metrics.ts` and the 1b hooks, extended (decision 53); no production behaviour change with hooks on or off (decision 35 rule, same suite on both).
- **Method:** with a real `rust-analyzer` indexing a large workspace, drive scripted typing and file switching with completion, hover and symbol requests in flight; record frame gaps and visible-update delay as in decisions 24 and 36; record Channel message rate and size, pending-table depth and busy replies; repeat with `CRAIDD_LSP=0` as baseline. A stalled-consumer run with providers active (the 1a fake-server stalled-consumer test extended to provider replies).
- **Exit evidence:** G3 and G4 rows complete in the results record, each Pass, Fail or Blocked with the raw numbers and the baseline beside them. No numeric budget is invented (design rule); a result is compared with the baseline and reviewed.

---

## Proposed decisions

All are **proposed, stand-in approval pending (DA-12)** unless the last column says **needs the architect**. Numbers continue the design's list (39 is the last).

| # | Choice the design leaves open | Proposal | Fits / changes |
|---|---|---|---|
| 40 | Backend shape of provider requests | One typed Tauri command per kind (`completion`, `resolve`, `hover`, `definition`, `references`, `documentSymbol`), each following `lsp_pull`: begin, wait off the async thread, cancel on no result, typed reply with the echoed `(epoch, uri)`. No generic "send any method" command, so the frontend cannot request a method the capability table did not validate. | Fits the design's request policy |
| 41 | Per-kind timeouts and the pending-table share (◇ values) | Initial ◇ timeouts per kind (short for completion and hover, longer for references), a timeout is "no result" with the request cancelled; no kind may take the whole table (a per-kind share so references cannot starve completion). Values set from G3/G4 results, none invented as budgets. | Fits |
| 42 | Completion trigger context | Map Monaco's invoked / trigger-character / re-trigger-for-incomplete to the three LSP trigger kinds; carry `isIncomplete` to Monaco's flag. Flag name and re-request behaviour fixed by V11; if the pinned Monaco does not expose it, document the limitation, as the design says. | Fits |
| 43 | Resolve policy under F1 | Resolve runs when an item is selected in the list (Monaco's hook), not for the whole list, with the same supersession and cancellation as other requests; a ◇ bound on how long accept waits for a pending resolve. On timeout or failure the item is rejected with a notice, never applied partly. Chosen only if V10 shows F1 works; otherwise F2. | Fits (decision 13) |
| 44 | The "brief notice" for a rejected item or a failed read | Use the surfaces that exist: a line in the Output tab's `[lsp:rust-analyzer]` source and the status chip's detail. No new toast or panel (decision 15). If Craidd already has a transient notice mechanism in the editor, use it; the lane confirms this at step 1. | Fits decision 15. **Needs the architect** if the only workable option is a new surface |
| 45 | Hover and documentation rendering | Markdown rendered by Monaco's markdown renderer with command links and raw HTML disabled, since the text comes from an external process. Links to http(s) open through the existing external-open path or not at all; nothing executes. | Fits "no silent mutation"; security is the reason |
| 46 | How a returned location opens | Register Monaco's editor opener so navigation goes through Craidd's tab logic (holder focus, owned form, unowned read-only) and Monaco never creates a model for a path itself. Peek views use Monaco's built-ins for display only. | Fits file-identity rule 3 |
| 47 | References and symbol result caps | A ◇ cap on references shown, with a visible "+N more" when truncated and a log line; no silent truncation (the flood-control rule applied to providers). `includeDeclaration` follows Monaco's request. | Fits |
| 48 | Symbol shapes | Prefer `DocumentSymbol[]` (advertised); tolerate `SymbolInformation[]` by mapping it flat; drop a symbol with an invalid range and count it. No outline panel; Monaco's own outline and breadcrumbs only. | Fits decision 15 |
| 49 | Reading an unowned navigation target | A backend read command that serves **only a path the originating session returned** in a definition or references reply, canonicalised, with a size cap (◇) and a text-only check; it never writes. A path the server did not return is refused. This stops a crafted message from turning navigation into a general file read. | Fits "no silent mutation"; adds a restriction not in the design, so **proposed for the architect to see** |
| 50 | Read-only state location | Read-only is a property of the tab's path view in the solution/tab state, read by the editors, not set on the shared Monaco model, so a second view of the same file keeps its own editability (file-identity rule 4). | Fits |
| 51 | Binding of an unowned tab | `didOpen` to the originating session using the canonical-path URI, in the design's Pending → open lifecycle on activation; when the session ends the tab stays open, unbound, with a status note; navigating again from a live session rebinds. | Fits the routing rules |
| 52 | Symlinked-vendor holder rule | **No change until U10 / V16 has facts.** If U10 shows the holder rule gives a canonical-path holder no features, the candidate change is to prefer the path inside the project tree when choosing the holder. This alters design rules 2 and 3. | **Needs the architect** (changes an existing rule) |
| 53 | Provider-load measurement | Extend the existing hooks and methods (decisions 23–26, 35, 36); no new switch; budgets are not invented. | Fits |
| 54 | Server `command` on a completion item | Craidd advertises no `workspace/executeCommand`, so item commands are not run; a command that a server needs for correctness (not a convenience such as re-triggering hints) is logged in Output when an item is accepted. Revisit if the real server relies on one. | Fits the capability table. **Needs the architect** if V10's F1 revert depends on running a command (the design lists "the item's post-accept command" for F1) |
| 55 | When Stage 1c is "done" | Per the design: criterion 1 demonstrated, V10–V12 and V18 recorded, G3 and G4 recorded under provider load. Stage 1 acceptance (every gate G1–G7 Pass) stays with the architect; 1c completing accepts no gate. | Fits criteria 13 and 14 |

Decision 54's second half is a real tension: F1's compensating revert uses "the item's post-accept command" while the capability table advertises no command execution. The design needs to say whether Craidd runs that one command locally in Monaco (it is a Monaco command, not a server `workspace/executeCommand`). That is a clarification, not a new rule, but it is flagged so the lead sees it before step 9.

---

## Exit evidence, mapped

| Required (design) | Where it is produced |
|---|---|
| V10: accept waits for a pending resolve; failure behaviour; post-accept revert | Step 9, before the accept path is written |
| V11: incomplete-list flag and completion context on Monaco 0.56.x | Step 8 |
| V12: primary and additional edits undo as one step | Step 9 |
| V18: server sends additional edits when not declared lazy | Step 9, F2 |
| G3 and G4 under provider load, with baseline | Step 10 |
| Acceptance criterion 1: diagnostics, completion (auto-import as one undo step), hover, definition, references, symbols, only from advertised capabilities | Steps 2–9 on a real server |
| Criterion 12 tail: `completionItem/resolve` never sent unless advertised | Step 8 fake-server test |
| Decision 29: lock glyph delivered | Step 5 |
| Cases (a)–(d), V16 | Step 7 |

A gate or V row changes status only together with its evidence, in the results record, by the Verification lane. Implementation never marks a gate.

## U-step outline for Verification

Numbered from U14 (1b used U1–U13). Verification turns these into harness steps. "Eyes" marks steps that need the user's visual review; those stay **harness-observed, pending user review** and never become a Pass on the harness alone.

| Step | Action | Expected | Evidence | Eyes |
|---|---|---|---|---|
| U14 | Open `fx-small`, `main.rs`. Hover a known symbol. | Type text shown; no request when the server lacks `hover` (fake-server variant) | Hover text, request log | Yes |
| U15 | Edit the file, then hover quickly at the old position | Stale hover is not shown | Store trace | No |
| U16 | Invoke the outline (Monaco's symbol picker) | Nested symbols match the file | Symbol list, screenshot | Yes |
| U17 | Go to definition: same file, another project file, an already-open file | Cursor moves; the open file's existing tab is focused; no second tab | Tab list before and after | Yes |
| U18 | Go to definition on a standard-library or registry symbol | Read-only tab with lock glyph; typing does nothing; reason visible | Screenshot, disk checksum unchanged | Yes |
| U19 | Close the server (restart) while the unowned tab is open | Tab stays, unbound, note shown; no crash | Chip, store trace | Yes |
| U20 | Find references on a symbol used in several files | Results across files; an unowned hit opens read-only; large result shows "+N" | Results list | Yes |
| U21 | Type a prefix and open completion; type on | List refreshes when incomplete, filters locally when complete | Request count per keystroke | No |
| U22 | Accept an auto-import completion (`HashMap`) | Symbol and `use` line both inserted; one undo reverts both | Buffer text, undo result | Yes |
| U23 | Force each rejection path: overlapping edits (fake server), stale item, failed resolve | Document byte-identical; Output line and notice shown; primary-only never applied | Checksums, Output text | No |
| U24 | Symlinked-vendor (a)–(d) | One registration; owned editable tab holds it; alias read-only; navigation focuses holder | Tab list, registration trace | Yes |
| U25 | Large workspace indexing with typing, file switching, completion, hover (hooks on, then `CRAIDD_LSP=0`) | G3 and G4 numbers recorded with baseline | `metrics` output | No |
| U26 | Stalled consumer with providers active | Bounded memory; no stall of the server; replies not lost for non-replaceable classes | Fake-server trace | No |

Port **1440** for the harness; Verification kills only its own pids (project rule).

## Risks and stop conditions

- **V10 and V18 both fail:** completion cannot ship (design). Stop step 9, record the evidence, report to the lead; the architect decides.
- **V16 unresolved:** step 7 does not start; steps 1–6 and 8–10 do not depend on it.
- **DA-10 not done:** nothing here starts.
- **A defect in 1b found during 1c:** recorded in the results record first; a fix goes through DA-7, not this plan.
- **Large step:** step 9 and step 10 are each bigger than they look (one grouped-edit function under four Monaco verifications; a measurement run needing a large workspace). If either needs a second attempt, the cause is written down first.

## Changes this plan makes elsewhere

None to code, to the philosophy or to the design's rules. The design's Stage 1c section links here. The proposed decisions above join the design's open-decisions list only once approved under DA-12 or by the architect.

---

*Last updated: Phase 3 (Stage 1c plan, 8 November 2026). Author(s): ShinkuKira21*
*This document is a plan.*
