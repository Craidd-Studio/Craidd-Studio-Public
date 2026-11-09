import { toMonacoRange, type LspRange } from "./protocol.ts";

/**
 * Document symbols (Stage 1c step 3). The server returns hierarchical `DocumentSymbol[]` or
 * flat `SymbolInformation[]`; Monaco's outline takes `DocumentSymbol[]`. LSP `SymbolKind` is
 * Monaco's `SymbolKind` plus one, so the mapping needs no table and no language knowledge.
 */

/** ◇ Nodes handed to Monaco per document; the rest are counted, never silently lost (decision 47). */
export const SYMBOL_CAP = 5000;
const MAX_DEPTH = 64;

export interface MonacoSymbol {
  name: string; detail: string; kind: number; tags: number[];
  range: ReturnType<typeof toMonacoRange>; selectionRange: ReturnType<typeof toMonacoRange>;
  children?: MonacoSymbol[];
}

const validRange = (range: unknown): range is LspRange => {
  const r = range as LspRange | undefined;
  return Boolean(r?.start && r?.end && Number.isFinite(r.start.line) && Number.isFinite(r.start.character)
    && Number.isFinite(r.end.line) && Number.isFinite(r.end.character));
};
const kindOf = (kind: unknown) => (typeof kind === "number" && kind >= 1 && kind <= 26 ? kind - 1 : 12 /* Variable */);

export function symbolsToMonaco(result: unknown, cap = SYMBOL_CAP): { symbols: MonacoSymbol[]; dropped: number } {
  if (!Array.isArray(result)) return { symbols: [], dropped: 0 };
  let kept = 0, dropped = 0;
  const convert = (item: any, depth: number): MonacoSymbol | null => {
    if (!item || typeof item.name !== "string") return null;
    // SymbolInformation carries `location.range`; DocumentSymbol carries `range`.
    const range = validRange(item.range) ? item.range : validRange(item.location?.range) ? item.location.range : null;
    if (!range) return null;
    if (kept >= cap) { dropped += 1 + countAll(item.children, 0); return null; }
    kept++;
    const selection = validRange(item.selectionRange) ? item.selectionRange : range;
    const symbol: MonacoSymbol = { name: item.name, detail: typeof item.detail === "string" ? item.detail : item.containerName ?? "",
      kind: kindOf(item.kind), tags: Array.isArray(item.tags) ? item.tags.filter((t: unknown) => typeof t === "number") : (item.deprecated ? [1] : []),
      range: toMonacoRange(range), selectionRange: toMonacoRange(selection) };
    if (Array.isArray(item.children) && item.children.length > 0) {
      if (depth >= MAX_DEPTH) dropped += countAll(item.children, 0);
      else symbol.children = item.children.map((c: unknown) => convert(c, depth + 1)).filter((c: MonacoSymbol | null): c is MonacoSymbol => c !== null);
    }
    return symbol;
  };
  const symbols = result.map((item) => convert(item, 0)).filter((s): s is MonacoSymbol => s !== null);
  return { symbols, dropped };
}

function countAll(children: unknown, depth: number): number {
  if (!Array.isArray(children) || depth > MAX_DEPTH) return 0;
  return children.reduce((n: number, c: any) => n + 1 + countAll(c?.children, depth + 1), 0);
}
