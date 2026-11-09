import { toMonacoRange, type LspRange } from "./protocol.ts";

/**
 * Completion mapping and the F3 decisions (Stage 1c steps 8-9, DA-15). Pure functions: the
 * Monaco-facing accept command lives in `completionAccept.ts`.
 */

export const LSP_INVOKED = 1, LSP_TRIGGER_CHARACTER = 2, LSP_RETRIGGER_INCOMPLETE = 3;

/** Monaco's `CompletionTriggerKind` (0 invoke, 1 trigger character, 2 incomplete re-trigger) to the LSP values (V11). */
export function contextToLsp(ctx: { triggerKind: number; triggerCharacter?: string } | undefined): { triggerKind: number; triggerCharacter: string | null } {
  if (ctx?.triggerKind === 1 && ctx.triggerCharacter) return { triggerKind: LSP_TRIGGER_CHARACTER, triggerCharacter: ctx.triggerCharacter };
  if (ctx?.triggerKind === 2) return { triggerKind: LSP_RETRIGGER_INCOMPLETE, triggerCharacter: null };
  return { triggerKind: LSP_INVOKED, triggerCharacter: null };
}

// LSP CompletionItemKind (1..25) to Monaco's CompletionItemKind. A generic protocol table, not language knowledge.
const KIND: Record<number, number> = {
  1: 18, 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 7, 9: 8, 10: 9, 11: 12, 12: 13, 13: 15, 14: 17, 15: 27,
  16: 19, 17: 20, 18: 21, 19: 23, 20: 16, 21: 14, 22: 6, 23: 10, 24: 11, 25: 24,
};
export const kindToMonaco = (kind: unknown): number => (typeof kind === "number" && KIND[kind] !== undefined ? KIND[kind] : 18 /* Text */);

type Pos = { line: number; character: number };
export interface LspTextEdit { range: LspRange; newText: string }
export interface LspItem {
  label: string | { label: string; detail?: string; description?: string };
  kind?: number; detail?: string; documentation?: unknown; sortText?: string; filterText?: string; insertText?: string;
  insertTextFormat?: number; textEdit?: { range?: LspRange; insert?: LspRange; replace?: LspRange; newText: string };
  additionalTextEdits?: LspTextEdit[]; data?: unknown; tags?: number[]; deprecated?: boolean; preselect?: boolean; command?: unknown;
}

const validPos = (p: any): p is Pos => Number.isFinite(p?.line) && Number.isFinite(p?.character);
export const validRange = (r: any): r is LspRange => validPos(r?.start) && validPos(r?.end);
export const labelText = (item: LspItem) => (typeof item.label === "string" ? item.label : item.label?.label ?? "");

/**
 * Whether accepting this item can still gain edits from a resolve, decided from the server's own data:
 * the server offers resolve, the list item carries no additional edits yet, and it has opaque `data` to resolve with.
 * Those take the Craidd-owned (F3) path; everything else uses Monaco's plain path.
 */
export function needsOwnedAccept(item: LspItem, resolveProvider: boolean): boolean {
  return resolveProvider && item.additionalTextEdits === undefined && item.data !== undefined;
}

/** The primary edit's server-side range for Monaco's insert or replace mode, and its text. */
export function primaryOf(item: LspItem, mode: "insert" | "replace"): { range: LspRange; newText: string; snippet: boolean } | null {
  const snippet = item.insertTextFormat === 2;
  const edit = item.textEdit;
  if (edit) {
    const range = edit.range ?? (mode === "replace" ? edit.replace ?? edit.insert : edit.insert ?? edit.replace);
    return validRange(range) && typeof edit.newText === "string" ? { range, newText: edit.newText, snippet } : null;
  }
  return null;
}

/**
 * Edits are applied as one set or not at all (decision 13): none may overlap each other or the primary
 * edit's range, and none may insert at the same point (including the primary's start). Additional edits
 * must also end above the line of the primary edit, because their positions were computed against the
 * document as it was when the list was requested, and typing after that only changes the cursor line.
 */
export function validateEdits(primary: LspRange, additional: LspTextEdit[]): { ok: true } | { ok: false; reason: string } {
  const all: LspRange[] = [primary];
  for (const edit of additional) {
    if (!validRange(edit?.range) || typeof edit.newText !== "string") return { ok: false, reason: "an additional edit is malformed" };
    if (edit.range.end.line >= primary.start.line) return { ok: false, reason: "an additional edit reaches the line being completed" };
    all.push(edit.range);
  }
  const key = (p: Pos) => p.line * 1e6 + p.character;
  const spans = all.map((r) => [key(r.start), key(r.end)] as const);
  for (let i = 0; i < spans.length; i++) for (let j = i + 1; j < spans.length; j++) {
    const [a0, a1] = spans[i], [b0, b1] = spans[j];
    if (a0 === a1 && b0 === b1 ? a0 === b0 : a0 < b1 && b0 < a1 || (a0 === a1 && a0 >= b0 && a0 <= b1 && b0 !== b1) || (b0 === b1 && b0 >= a0 && b0 <= a1 && a0 !== a1)) {
      return { ok: false, reason: "edits overlap" };
    }
  }
  return { ok: true };
}

export interface MonacoItem {
  label: string | { label: string; detail?: string; description?: string };
  kind: number; insertText: string; insertTextRules?: number; range: unknown; sortText?: string; filterText?: string;
  detail?: string; documentation?: unknown; tags?: number[]; preselect?: boolean; additionalTextEdits?: { range: ReturnType<typeof toMonacoRange>; text: string }[];
  command?: { id: string; title: string; arguments?: unknown[] };
}

export interface WordAt { startColumn: number; endColumn: number; text: string; lineNumber: number }

/**
 * A server list to Monaco suggestions (V11: `incomplete` is Monaco's flag name). `word` is the typed prefix at the
 * cursor when the list was built; `acceptId` registers the item for the owned accept command.
 */
export function listToMonaco(result: unknown, opts: {
  word: WordAt; resolveProvider: boolean; mode: "insert" | "replace"; ownedCommand: string; register(id: string, item: LspItem): string;
  /** False when several cursors are active: the no-op primary edit would also be applied at the other cursors, so owned items are not offered at all. */
  allowOwned?: boolean;
}): { suggestions: MonacoItem[]; incomplete: boolean } {
  const list: LspItem[] = Array.isArray(result) ? result : Array.isArray((result as any)?.items) ? (result as any).items : [];
  const incomplete = Boolean(!Array.isArray(result) && (result as any)?.isIncomplete);
  const suggestions: MonacoItem[] = [];
  const { word } = opts;
  const prefixRange = { startLineNumber: word.lineNumber, startColumn: word.startColumn, endLineNumber: word.lineNumber, endColumn: word.endColumn };
  for (const item of list) {
    const label = labelText(item);
    if (!label) continue;
    const owned = needsOwnedAccept(item, opts.resolveProvider);
    if (owned && opts.allowOwned === false) continue;
    const out: MonacoItem = { label: item.label, kind: kindToMonaco(item.kind), insertText: label, range: prefixRange,
      sortText: item.sortText, filterText: item.filterText ?? label, detail: item.detail, documentation: item.documentation as any,
      tags: item.tags ?? (item.deprecated ? [1] : undefined), preselect: item.preselect };
    if (owned) {
      // F3: a no-op primary edit (the typed prefix replaced by itself) keeps Monaco's filtering and applies no text;
      // the owned command applies the real edits as one set after the resolve, or none.
      out.insertText = word.text;
      out.command = { id: opts.ownedCommand, title: "", arguments: [opts.register(`${label}\u0000${suggestions.length}`, item)] };
    } else {
      const primary = primaryOf(item, opts.mode);
      const text = primary?.newText ?? item.insertText ?? label;
      out.insertText = text;
      if (item.insertTextFormat === 2) out.insertTextRules = 4; // InsertAsSnippet
      if (primary) out.range = toMonacoRange(primary.range);
      if (item.additionalTextEdits?.length) {
        const check = validateEdits(primary?.range ?? { start: { line: word.lineNumber - 1, character: word.startColumn - 1 }, end: { line: word.lineNumber - 1, character: word.endColumn - 1 } }, item.additionalTextEdits);
        if (!check.ok) continue; // never degrade to the primary edit alone
        out.additionalTextEdits = item.additionalTextEdits.map((e) => ({ range: toMonacoRange(e.range), text: e.newText }));
      }
    }
    suggestions.push(out);
  }
  return { suggestions, incomplete };
}
