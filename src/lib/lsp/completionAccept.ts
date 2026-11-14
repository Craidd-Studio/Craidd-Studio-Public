import { primaryOf, validateEdits, labelText, type LspItem, type LspTextEdit } from "./completion.ts";

/**
 * The Craidd-owned accept command (F3, DA-15, plan step 9). Monaco is given a no-op primary edit and this
 * command; the real edits are applied here, after Craidd's own resolve, as one undo step or not at all:
 * the primary edit is never applied alone (decision 13). `monaco` is passed in so the module needs no
 * Monaco import and the headless probe can run it against plain Monaco.
 */

export const ACCEPT_COMMAND = "craidd.lsp.acceptCompletion";
/** ◇ How long accept waits for the resolve (decision 43). */
export const RESOLVE_BOUND_MS = 1500;

export interface Entry { item: LspItem; fileId: string; /** LSP position of the request that built the list. */ position: { line: number; character: number } }

export interface AcceptDeps {
  entry(id: string): Entry | undefined;
  /** The server item after Craidd's resolve (only the lazily declared properties merged), or null. */
  resolve(id: string): Promise<LspItem | null>;
  /** A visible rejection or failure, on existing surfaces only (Output line and chip detail; decision 44). */
  notice(fileId: string, text: string): void;
  boundMs?: number;
}

type MonacoLike = any;

const pos = (line: number, character: number) => ({ line, character });

export function registerAcceptCommand(monaco: MonacoLike, deps: AcceptDeps): { dispose(): void } {
  return monaco.editor.registerCommand(ACCEPT_COMMAND, async (_accessor: unknown, id: string) => {
    const entry = deps.entry(id);
    if (!entry) return;
    const label = labelText(entry.item);
    const reject = (why: string) => deps.notice(entry.fileId, `Completion "${label}" was not applied: ${why}`);

    const editor = monaco.editor.getEditors().find((e: any) => e.hasTextFocus() && e.getModel()?.uri.path === entry.fileId)
      ?? monaco.editor.getEditors().find((e: any) => e.getModel()?.uri.path === entry.fileId) ?? monaco.editor.getEditors()[0];
    const model = editor?.getModel();
    if (!model || model.isDisposed()) return;

    // ---- synchronous part: runs right after Monaco's no-op edit, before anything can change the document ----
    const versionAtAccept: number = model.getVersionId();
    if (editor.getSelections().length > 1) return reject("several cursors are active; accept it with a single cursor");
    const cursor = editor.getPosition();
    const cursorLine = cursor.lineNumber - 1;
    const mode: "insert" | "replace" = editor.getOption(monaco.editor.EditorOption.suggest).insertMode === "replace" ? "replace" : "insert";
    const primary = primaryOf(entry.item, mode);
    const word = model.getWordUntilPosition(cursor);
    // Start of the replaced text: the server's, else the typed word. End: through the accept-time cursor, plus any
    // text the server's (replace) range covered beyond where the request was made.
    const startChar = primary ? primary.range.start.character : word.startColumn - 1;
    if (primary && primary.range.start.line !== cursorLine) return reject("the completion belongs to another line");
    if (startChar > cursor.column - 1) return reject("the cursor moved before the start of the completion");
    const beyond = primary && primary.range.end.line === entry.position.line ? Math.max(0, primary.range.end.character - entry.position.character) : 0;
    const endChar = Math.min(model.getLineMaxColumn(cursor.lineNumber) - 1, cursor.column - 1 + beyond);
    const range = { startLineNumber: cursor.lineNumber, startColumn: startChar + 1, endLineNumber: cursor.lineNumber, endColumn: endChar + 1 };
    const prefixAtAccept: string = model.getValueInRange(range);
    const newText = primary?.newText ?? entry.item.insertText ?? label;
    const snippet = primary ? primary.snippet : entry.item.insertTextFormat === 2;

    // ---- the resolve, bounded ----
    let resolved: LspItem | null;
    try {
      resolved = await Promise.race([deps.resolve(id), new Promise<never>((_, no) => setTimeout(() => no(new Error("timed out")), deps.boundMs ?? RESOLVE_BOUND_MS))]);
    } catch (error) { return reject(`the language server did not answer in time or failed (${(error as Error).message})`); }
    if (!resolved) return reject("the language server returned no resolved item");

    // ---- validate against the document as it is now ----
    if (model.isDisposed() || model.getVersionId() !== versionAtAccept) return reject("the document changed while it was being resolved");
    if (model.getValueInRange(range) !== prefixAtAccept) return reject("the text being completed changed");
    const additional: LspTextEdit[] = Array.isArray(resolved.additionalTextEdits) ? resolved.additionalTextEdits : [];
    const lspRange = { start: pos(cursorLine, startChar), end: pos(cursorLine, endChar) };
    const check = validateEdits(lspRange, additional);
    if (!check.ok) return reject(check.reason);

    // ---- apply: one set, between undo stops ----
    const toMonacoEdit = (e: LspTextEdit) => ({ range: new monaco.Range(e.range.start.line + 1, e.range.start.character + 1, e.range.end.line + 1, e.range.end.character + 1), text: e.newText });
    // Every additional edit ends above the completed line (validated), so the completed line moves by exactly this many lines.
    const lineDelta = additional.reduce((n, e) => n + (e.newText.match(/\n/g)?.length ?? 0) - (e.range.end.line - e.range.start.line), 0);
    const startLine = cursor.lineNumber + lineDelta;
    model.pushStackElement();
    if (!snippet) {
      model.pushEditOperations(editor.getSelections(), [...additional.map(toMonacoEdit), { range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn), text: newText }], () => null);
      const lines = newText.split("\n");
      editor.setPosition(lines.length === 1 ? { lineNumber: startLine, column: startChar + 1 + newText.length } : { lineNumber: startLine + lines.length - 1, column: lines[lines.length - 1].length + 1 });
    } else {
      model.pushEditOperations(editor.getSelections(), [...additional.map(toMonacoEdit), { range: new monaco.Range(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn), text: "" }], () => null);
      editor.setPosition({ lineNumber: startLine, column: startChar + 1 });
      const controller = editor.getContribution("snippetController2");
      if (controller?.insert) controller.insert(newText, { overwriteBefore: 0, overwriteAfter: 0, undoStopBefore: false, undoStopAfter: false });
      else editor.setPosition({ lineNumber: startLine, column: startChar + 1 + newText.length });
    }
    model.pushStackElement();
  });
}

/** True when any editor showing `model` has more than one selection. */
export function hasSeveralCursors(monaco: MonacoLike, model: unknown): boolean {
  return monaco.editor.getEditors().some((e: any) => e.getModel() === model && (e.getSelections()?.length ?? 0) > 1);
}

/**
 * F3's no-op primary edit is a no-op only at the primary cursor: Monaco applies it at every cursor, rewriting
 * text before the others. So owned items are never offered with several cursors (`hasSeveralCursors` at list
 * time), and if a second cursor appears while one of our lists is open, the suggest widget is closed before
 * an accept can happen. `listOpen` says whether an owned list is current for the editor's file.
 */
export function guardMultiCursor(monaco: MonacoLike, listOpen: (model: unknown) => boolean): { dispose(): void } {
  const watch = (editor: any) => editor.onDidChangeCursorSelection(() => {
    const model = editor.getModel();
    if (model && (editor.getSelections()?.length ?? 0) > 1 && listOpen(model)) editor.trigger("craidd", "hideSuggestWidget", {});
  });
  const subs = monaco.editor.getEditors().map(watch);
  subs.push(monaco.editor.onDidCreateEditor((editor: any) => { subs.push(watch(editor)); }));
  return { dispose() { subs.forEach((s: any) => s.dispose()); } };
}
