/**
 * Boundary types and pure conversions between Monaco and the LSP backend.
 * One function maps paths to URIs and back, one maps positions, so no
 * second code path can disagree (design: "URI and position rules").
 */

export interface LspPosition { line: number; character: number }
export interface LspRange { start: LspPosition; end: LspPosition }
export interface MonacoRange { startLineNumber: number; startColumn: number; endLineNumber: number; endColumn: number }

export type Phase = "spawning" | "initializing" | "ready" | "shuttingDown" | "exited" | "failed" | "crashed";
export const isTerminal = (phase: Phase) => phase === "exited" || phase === "failed" || phase === "crashed";

export interface PullCaps { identifier: string | null; interFileDependencies: boolean; workspaceDiagnostics: boolean }
export interface NegotiatedCaps {
  sync: "none" | "full" | "incremental";
  syncUnusable: string | null;
  save: "none" | "plain" | "includeText";
  pull: PullCaps | null;
  serverName: string | null;
  serverVersion: string | null;
  notes: string[];
}
export interface Health { health: "ok" | "warning" | "error"; quiescent: boolean | null; message: string | null }
export interface StatusRecord {
  generation: number;
  phase: Phase;
  terminalReason: string | null;
  caps: NegotiatedCaps | null;
  resync: string[];
  refresh: number;
  writerRoom: number;
  unresponsive: boolean;
  health: Health | null;
  /** null: the server reports no workspace status; false until it first reports quiescent. */
  workspaceReady: boolean | null;
  reloads: number;
  /** V2: the server's raw line reporting a file-watcher failure, if any. */
  watcherWarning: string | null;
  revision: number;
}

export type DocSync = { state: "synced" } | { state: "desynced"; reason: string; changed: boolean };
export interface DocView { uri: string; version: number; epoch: number; sync: DocSync }

export interface LspDiagnostic {
  range: LspRange;
  severity?: number;
  code?: string | number | { value: string | number };
  source?: string;
  message: string;
  tags?: number[];
  relatedInformation?: { location: { uri: string; range: LspRange }; message: string }[];
}

export interface LogLine { source: "log" | "show" | "stderr"; severity: number; text: string }

export type Delivered =
  | { kind: "diagnostics"; uri: string; version: number | null; diagnostics: LspDiagnostic[] }
  | { kind: "progressBegin"; token: string; value: { title?: string; message?: string; percentage?: number } }
  | { kind: "progressReport"; token: string; value: { message?: string; percentage?: number } }
  | { kind: "progressEnd"; token: string; value: unknown }
  | { kind: "progressCompleted"; token: string; begin: unknown; end: unknown };

export interface Batch { status: StatusRecord | null; events: Delivered[]; logs: LogLine[]; droppedLogs: number }

/** Same bytes as the backend's `file_uri`: unreserved ASCII and `/` stay, every other UTF-8 byte is percent-encoded. */
export function fileUri(path: string): string {
  let uri = "file://";
  for (const byte of new TextEncoder().encode(path)) {
    const c = String.fromCharCode(byte);
    uri += /[A-Za-z0-9/\-_.~]/.test(c) ? c : `%${byte.toString(16).toUpperCase().padStart(2, "0")}`;
  }
  return uri;
}

export function uriToPath(uri: string): string {
  const path = uri.startsWith("file://") ? uri.slice("file://".length) : uri;
  const bytes: number[] = [];
  for (let i = 0; i < path.length; i++) {
    if (path[i] === "%" && /^[0-9a-fA-F]{2}$/.test(path.slice(i + 1, i + 3))) { bytes.push(parseInt(path.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(...new TextEncoder().encode(path[i]));
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Monaco is 1-based UTF-16; LSP is 0-based and Craidd offers only utf-16, so no re-encoding. */
export const toLspPosition = (lineNumber: number, column: number): LspPosition => ({ line: lineNumber - 1, character: column - 1 });

export function toMonacoRange(range: LspRange): MonacoRange {
  return { startLineNumber: range.start.line + 1, startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1, endColumn: range.end.character + 1 };
}

export function toLspRange(range: MonacoRange): LspRange {
  return { start: toLspPosition(range.startLineNumber, range.startColumn), end: toLspPosition(range.endLineNumber, range.endColumn) };
}

export interface ModelChange { range: MonacoRange; text: string }
export type ContentChange = { range: LspRange; text: string } | { text: string };

/**
 * Monaco lists one event's changes from the end of the document to the
 * start, each in pre-edit coordinates, so applying them in array order is
 * the same as LSP's sequential application.
 */
export function contentChanges(changes: ModelChange[]): ContentChange[] {
  return changes.map((change) => ({ range: toLspRange(change.range), text: change.text }));
}

/** FNV-1a over UTF-16 units plus the length; computed only at suspension and resume. */
export function textHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return `${text.length}:${hash.toString(16)}`;
}

/** Stable identity of a diagnostic set, for hash-skipping identical updates. */
export function setHash(items: unknown[]): string { return textHash(JSON.stringify(items)); }

export function severityName(severity: number | undefined): "error" | "warning" | "info" | "hint" {
  return severity === 2 ? "warning" : severity === 3 ? "info" : severity === 4 ? "hint" : "error";
}

export function codeText(code: LspDiagnostic["code"]): string | undefined {
  if (code === undefined || code === null) return undefined;
  return typeof code === "object" ? String(code.value) : String(code);
}
