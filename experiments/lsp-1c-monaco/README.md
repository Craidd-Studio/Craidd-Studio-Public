# LSP Stage 1c: Monaco verifications V10, V11, V12

Probes for the facts that choose between fallback F1 (Monaco waits for the
resolve, compensating revert) and F2 (eager `additionalTextEdits`) in the
[Stage 1c plan](../../docs/feats/editor/intellisense/plan-lsp-stage-1c-providers.md),
step 9. They touch nothing under `src/`.

**Pinned Monaco:** `monaco-editor` 0.56.0 (the repository's `node_modules`). Chrome 157, headless.

## Method

`probe.ts` builds with the repo's Vite into a scratch directory, is served on
`127.0.0.1:1461` (never 1420, AgentIShip's, or 1440, the Craidd harness) and
runs in `google-chrome-stable --headless=new`. It creates real Monaco editors
with a test completion provider and drives the real suggest widget
(`triggerSuggest`, `acceptSelectedSuggestion`, `undo`, `redo`, typing). The
page writes its findings into `#result`; `run.sh` prints them.

```bash
experiments/lsp-1c-monaco/run.sh      # needs node_modules, chrome, python3
```

Three consecutive runs produced byte-identical output. No real browser UI,
display or Tauri is needed, so **Verification can run it as is**. Source
reading of `suggestController.js` / `suggest.js` in the same package was used
to explain the results, not to establish them.

## Results (Monaco 0.56.0, branch cut from d3fd9a8)

### V10: does accept wait for a pending `resolveCompletionItem`? **Failed (F1's premise does not hold)**

| Case | Observed |
| --- | --- |
| A. Resolve takes 800 ms, adds an import | The primary edit is applied at once; the import arrives ~800 ms later. Accept does **not** wait. |
| B. Resolve rejects | The primary edit stays. Nothing reverts it, nothing is signalled to the provider's caller. |
| C. Resolve never settles | The primary edit stays; accept does not time out or notify. |
| D2. Edit located after the insertion point, resolve pending at accept | The additional edit is **silently dropped**; primary-only result (Monaco's own check `Position.isBefore`). |
| D1. Same edit, but the item was already resolved when accepted (Monaco resolves the focused item) | Edits are applied synchronously **before** the primary edit using stale columns; the result is garbled text (`Fo /*afterFoo`). So overlap and adjacency must be rejected by Craidd before Monaco sees the item, as the plan's rule 3 says. |
| E. `item.command` (a Monaco-local command, not `workspace/executeCommand`) | It runs immediately after the primary edit, and may await Craidd's own resolve state and then revert with `undo`; with the user idle this restored the original text. |
| E2. The user types one character before the revert fires | `undo` removed the user's character, not the primary edit: the document is **not** back to the original. A revert by `undo` is unsafe; it would have to be a computed inverse edit, and still is not atomic (the primary text is visible and typeable for the resolve duration). |

So F1 as written ("Monaco waits for the resolve") is **Failed**: the primary edit is applied alone for the whole resolve, and a post-accept command is a best-effort revert, not atomicity. A command can be run locally (it is a Monaco command, so DA-14's clarification of decision 54 holds mechanically), but it does not make acceptance atomic.

Source explanation: in `_insertSuggestion`, an item that already has `additionalTextEdits` takes the synchronous path; an unresolved one applies the snippet first and awaits `item.resolve` afterwards. Also `Object.assign(this.completion, value)` in `suggest.js` means a resolve response can overwrite *any* item field, so Craidd's resolve hook must return only the allowed fields (plan step 8).

**Consequence for step 9 (for the lead; not decided here):** F1 does not deliver atomic acceptance. F2 (edits complete in the list, so the sync path runs) does; it depends on **V18** (server sends the edits eagerly), which this probe cannot establish. An additional route worth recording for the architect: none found that makes Monaco wait.

### V12: do the primary and additional edits undo as one step? **Verified (eager path); also holds for the lazy path with no typing in between**

- Eager edits in the list: accept → one `undo` restores the original; one `redo` restores the accepted text. With an earlier user edit in the buffer, one undo removes only the completion.
- Lazy edits (case A): after the resolve applies the import, one `undo` restores the original (single step). If the user types between accept and the late edit, Monaco inserts an undo stop (source: `didType` branch), so then it is two steps.

### V11: incomplete flag, re-request, context. **Verified**

- Flag name on `CompletionList`: **`incomplete`** (`monaco.d.ts`, 0.56.0).
- `incomplete: true`: provider calls were `Invoke(0)`, then `TriggerForIncompleteCompletions(2)` on each typed word character, then `TriggerCharacter(1)` with `triggerCharacter: "."`. `incomplete: false`: `Invoke(0)` then `TriggerCharacter(1)`; typing filters locally with no re-request.
- `CompletionContext` carries `triggerKind` (0/1/2) and `triggerCharacter` (only for kind 1). These map one-to-one to LSP `Invoked`, `TriggerCharacter`, `TriggerForIncompleteCompletions`. Monaco never re-triggers on its own for a complete list.

## Limits

- Timing probes (resolve delays of 0.1-0.8 s, 300-400 ms waits) run under virtual time in headless Chrome; the logic does not depend on the exact values, but a slow machine could change which path (D1 vs D2) a given delay lands on.
- The suggest widget is driven by commands, not by real key presses or a visible display.
- This is plain Monaco with a test provider, not Craidd's provider: it says nothing about V18 or the real server.

---

*Last updated: Phase 3 (Stage 1c prep, V10-V12 probes). Author(s): ShinkuKira21.*
*This document is a record.*
