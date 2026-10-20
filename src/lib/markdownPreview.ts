import type { Element, Root, RootContent } from "hast";

function textOf(node: RootContent): string {
  return node.type === "text" ? node.value : node.type === "element" ? node.children.map(textOf).join("") : "";
}

/** Add source ranges without ever converting the rendered tree back to Markdown.
 * Raw HTML is left to react-markdown's skipHtml policy. */
export function rehypeDocumentBlocks() {
  return (tree: Root, file?: { value: unknown }) => {
    const source = typeof file?.value === "string" ? file.value : "";
    const annotate = (parent: Root | Element) => {
      parent.children = parent.children.map((node) => {
        if (node.type === "element") { annotate(node); return node; }
        const start = node.position?.start.offset, end = node.position?.end.offset;
        if (node.type !== "text" || start === undefined || end === undefined || source.slice(start, end) !== node.value) return node;
        return { type: "element", tagName: "span", properties: { "data-md-text-start": start }, children: [node] } as Element;
      });
    };
    annotate(tree);
    const used = new Set<string>();
    const nextSuffix = new Map<string, number>();
    for (const node of tree.children) {
      if (node.type !== "element" || !/^h[1-6]$/.test(node.tagName)) continue;
      const base = textOf(node).toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, "").replace(/\s/g, "-");
      let slug = base;
      let suffix = nextSuffix.get(base) ?? 0;
      while (used.has(slug)) slug = `${base}-${++suffix}`;
      nextSuffix.set(base, suffix);
      used.add(slug);
      node.properties.id = `craidd-md-${slug}`;
    }
    tree.children = tree.children.map((node) => {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (node.type !== "element" || start === undefined || end === undefined) return node;
      const wrapper: Element = { type: "element", tagName: "div", properties: { "data-md-start": start, "data-md-end": end }, children: [node] };
      return wrapper;
    });
  };
}

export function replaceMarkdownRange(source: string, start: number, end: number, replacement: string, expected: string): string {
  if (start < 0 || end < start || end > source.length || source.slice(start, end) !== expected) {
    throw new Error("The document changed while this block was being edited. Reopen the block to continue.");
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

export type MarkdownFormat = "bold" | "italic" | "code" | "link";
export function formatMarkdownSelection(value: string, start: number, end: number, format: MarkdownFormat) {
  const selected = value.slice(start, end);
  if (format === "link") {
    const label = selected || "link text";
    const insert = `[${label}](https://example.com)`;
    return { value: value.slice(0, start) + insert + value.slice(end), start: start + label.length + 3, end: start + insert.length - 1 };
  }
  const marker = format === "bold" ? "**" : format === "italic" ? "*" : "`";
  // A single * inside a ** run belongs to bold, not italic. Odd-length
  // emphasis runs include italic; this also handles ***bold and italic***.
  const hasStyle = (left: string, right: string) => {
    if (format !== "italic") return left.endsWith(marker) && right.startsWith(marker);
    const before = left.match(/\*+$/)?.[0].length ?? 0;
    const after = right.match(/^\*+/)?.[0].length ?? 0;
    return before % 2 === 1 && after % 2 === 1;
  };
  if (selected.length > marker.length * 2 && hasStyle(selected.match(/^\*+/)?.[0] ?? selected.slice(0, marker.length), selected.match(/\*+$/)?.[0] ?? selected.slice(-marker.length))) {
    const text = selected.slice(marker.length, -marker.length);
    return { value: value.slice(0, start) + text + value.slice(end), start, end: start + text.length };
  }
  if (hasStyle(value.slice(0, start), value.slice(end))) {
    return { value: value.slice(0, start - marker.length) + selected + value.slice(end + marker.length), start: start - marker.length, end: end - marker.length };
  }
  const text = selected || (format === "bold" ? "bold text" : format === "italic" ? "italic text" : "code");
  return { value: value.slice(0, start) + marker + text + marker + value.slice(end), start: start + marker.length, end: start + marker.length + text.length };
}


export function markdownFormatKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): MarkdownFormat | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  const key = event.key.toLowerCase();
  return key === "b" ? "bold" : key === "i" ? "italic" : key === "k" ? "link" : null;
}

/** Smallest single replacement, including delimiters removed by a toggle. */
export function markdownTextEdit(source: string, next: string) {
  let start = 0, end = source.length, nextEnd = next.length;
  while (start < end && start < nextEnd && source[start] === next[start]) start++;
  while (end > start && nextEnd > start && source[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
  return { start, end, text: next.slice(start, nextEnd) };
}
