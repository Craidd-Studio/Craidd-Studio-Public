import { toMonacoRange, type LspRange } from "./protocol.ts";

/**
 * Hover result mapping (Stage 1c, decision 45). The text comes from an external process, so
 * it is rendered as Markdown that is never trusted: no command links, no raw HTML, and
 * `isTrusted`/`supportHtml` stay false. Nothing a server sends can execute anything.
 */

export interface MarkdownString { value: string; isTrusted: false; supportHtml: false }
export interface MonacoHover { contents: MarkdownString[]; range?: { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number } }

type MarkedString = string | { language: string; value: string };
type MarkupContent = { kind: "markdown" | "plaintext"; value: string };

const fence = (language: string, value: string) => {
  const ticks = "`".repeat(Math.max(3, (value.match(/`+/g) ?? []).reduce((m, t) => Math.max(m, t.length + 1), 3)));
  return `${ticks}${language.replace(/[^\w+#.-]/g, "")}\n${value}\n${ticks}`;
};

/** Markdown links whose target is a `command:` URI are turned into plain text; they must never be live. */
export function neutraliseCommandLinks(markdown: string): string {
  return markdown.replace(/\[([^\]]*)\]\(\s*command:[^)]*\)/gi, "$1").replace(/<\s*a\b[^>]*href\s*=\s*["']?\s*command:[^>]*>/gi, "");
}

/** Plain text shown literally: every Markdown-significant character is escaped. */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, "\\$&").replace(/\n/g, "  \n");
}

function one(content: MarkedString | MarkupContent): string | null {
  if (typeof content === "string") return neutraliseCommandLinks(content);
  if ("kind" in content) return content.kind === "plaintext" ? escapeMarkdown(content.value) : neutraliseCommandLinks(content.value);
  if (typeof content.value === "string" && typeof content.language === "string") return fence(content.language, content.value);
  return null;
}

/** The server's `Hover | null`, or anything else it might send, to Monaco's hover. `null` shows nothing. */
export function hoverToMonaco(result: unknown): MonacoHover | null {
  if (!result || typeof result !== "object") return null;
  const raw = (result as { contents?: unknown; range?: LspRange }).contents;
  const list = (Array.isArray(raw) ? raw : [raw]).filter((item) => item !== undefined && item !== null);
  const contents = list.map((item) => one(item as MarkedString | MarkupContent))
    .filter((value): value is string => value !== null && value.trim() !== "")
    .map((value): MarkdownString => ({ value, isTrusted: false, supportHtml: false }));
  if (contents.length === 0) return null;
  const range = (result as { range?: LspRange }).range;
  const valid = range?.start && range?.end && Number.isFinite(range.start.line) && Number.isFinite(range.end.line);
  return valid ? { contents, range: toMonacoRange(range!) } : { contents };
}
