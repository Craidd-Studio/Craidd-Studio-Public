import { create } from "zustand";
import type { LspProblem } from "../lib/lsp/diagnostics";
import type { StatusRecord } from "../lib/lsp/protocol";

/** What the language server is doing for one session, as the status chip shows it. */
export interface LspSessionView {
  generation: number;
  status: StatusRecord;
  server: string;
  version: string;
  root: string;
  notes: string[];
  /** Live work-done progress titles (indexing, cargo check, …). */
  progress: Record<string, string>;
  /** Set when consecutive pulls fail; cleared by the next accepted report. */
  pullDegraded: string | null;
}

/** The attach reply's part of a session view; only the reply carries these. */
export interface SessionDescription {
  generation: number;
  server: string;
  version: string;
  root: string;
  notes: string[];
  status: StatusRecord;
}

/**
 * A status for `generation`. The Channel's first batch can arrive before the
 * attach reply, so this may create a view that has no description yet.
 */
export function viewWithStatus(current: LspSessionView | undefined, generation: number, status: StatusRecord): LspSessionView {
  return { progress: {}, pullDegraded: null, ...current, generation, status } as LspSessionView;
}

/**
 * The attach reply. Its description is always written; its status, and the
 * progress and degradation fields, only when the view has none, so a newer
 * status from the Channel is never replaced by the reply's older one.
 */
export function viewWithAttach(current: LspSessionView | undefined, reply: SessionDescription): LspSessionView {
  return {
    ...current, generation: reply.generation, server: reply.server, version: reply.version, root: reply.root, notes: reply.notes,
    status: current?.status ?? reply.status, progress: current?.progress ?? {}, pullDegraded: current?.pullDegraded ?? null,
  };
}

/** Why the active document has, or does not have, a language server. */
export type LspDocInfo =
  | { kind: "none" }
  | { kind: "waiting" }
  | { kind: "notRouted"; reason: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "bound"; session: number; alias: string | null; state: string }
  /** A read-only navigation tab whose originating session ended: open, unbound, no intelligence (decision 51). */
  | { kind: "ended"; session: number };

/** A read-only tab opened by navigation: bound only by navigation from a live session, never by routing. */
export function isNavigationOnly(tabs: { fileId: string; readOnly?: boolean }[], fileId: string): boolean {
  return tabs.find((tab) => tab.fileId === fileId)?.readOnly === true;
}

/**
 * Decision 51: when a session ends, each of its read-only tabs stays open but unbound and says so. Other
 * documents keep the existing behaviour (they relaunch through the normal routing).
 */
export function endedDocs(affected: string[], tabs: { fileId: string; readOnly?: boolean }[], session: number): Record<string, LspDocInfo> {
  const out: Record<string, LspDocInfo> = {};
  for (const fileId of affected) if (tabs.find((tab) => tab.fileId === fileId)?.readOnly) out[fileId] = { kind: "ended", session };
  return out;
}

export interface LspOutputLine { session: number; text: string; severity: number }

/** ◇ Lines kept for the Output source; the backend ring stays authoritative. */
export const OUTPUT_LINES = 2000;

interface LspState {
  enabled: boolean;
  sessions: Record<number, LspSessionView>;
  docs: Record<string, LspDocInfo>;
  problems: LspProblem[];
  evictedFiles: number;
  notRetained: number;
  /** Open documents whose pull result is still unknown (not yet ready, or not yet pulled). */
  pullUnknown: number;
  output: LspOutputLine[];
  droppedLogs: number;
}

export const useLsp = create<LspState>(() => ({
  enabled: false, sessions: {}, docs: {}, problems: [], evictedFiles: 0, notRetained: 0, pullUnknown: 0, output: [], droppedLogs: 0,
}));

export function appendLspOutput(lines: LspOutputLine[], droppedLogs?: number): void {
  if (lines.length === 0 && droppedLogs === undefined) return;
  useLsp.setState((state) => ({
    output: [...state.output, ...lines].slice(-OUTPUT_LINES),
    droppedLogs: droppedLogs ?? state.droppedLogs,
  }));
}

/** The status chip's states, in the words the UI uses. */
export type ChipState = "notFound" | "starting" | "indexing" | "ready" | "unresponsive" | "crashed" | "failed" | "stopped";

export function chipState(view: LspSessionView): ChipState {
  const { phase, unresponsive } = view.status;
  if (phase === "crashed") return "crashed";
  if (phase === "failed") return "failed";
  if (phase === "exited" || phase === "shuttingDown") return "stopped";
  if (phase === "spawning" || phase === "initializing") return "starting";
  if (unresponsive) return "unresponsive";
  if (Object.keys(view.progress).length > 0 || (view.status.workspaceReady === false && !view.status.readyFallback)) return "indexing";
  return "ready";
}

/** The server's own name (from `serverInfo`), else the binary's file name; never hardcoded. */
export function serverName(view: LspSessionView): string {
  // `server` is absent until the attach reply is merged (see `viewWithStatus`).
  return view.status.caps?.serverName ?? (view.server?.split("/").pop() || "language server");
}

/**
 * Whether the chip offers ↻ Restart (decision 38: recovery is the manual restart).
 * It does once the session ended or went unresponsive, and also while a live
 * session's own health is "error" (for example a broken workspace root) or a
 * file-watcher failure is recorded (decision 28: Restart clears it).
 * Generic health "warning" keeps the bar quiet.
 */
export function restartOffered(state: ChipState, health: string | undefined | null, watcherWarning?: string | null): boolean {
  return state === "crashed" || state === "failed" || state === "stopped" || state === "unresponsive" || health === "error" || Boolean(watcherWarning);
}

export function chipLabel(state: ChipState, name: string): string {
  return state === "ready" ? name : state === "notFound" ? `${name} not found` : `${name}: ${state}`;
}
