import { codeText, setHash, severityName, uriToPath, type LspDiagnostic } from "./protocol.ts";

/**
 * Language-server diagnostic storage (design: "Pull and push diagnostics",
 * "Semantics" and "Flood control"). Sets are keyed (session, uri, route):
 * the route decides where a set lives, never the `source` string. Neither
 * route writes the other's set, and build problems live elsewhere; the
 * three are merged only for display.
 */

export type Route = "push" | "pull";

/**
 * ◇ Provisional retention limits, a safety net only until G5 records the
 * stored count and memory under a large check (V20).
 */
export const RETENTION = { perFile: 500, closedFiles: 2000, closedTotal: 20000 };
export type Retention = typeof RETENTION;

/** From the backend's ownership resolver; `null` while it is being resolved. */
export interface Attribution { projectId: string | null; projectName: string | null; ambiguous?: string[] }

interface StoredSet { session: number; uri: string; route: Route; items: LspDiagnostic[]; hash: string; notRetained: number; at: number }

export interface LspProblem {
  key: string;
  session: number;
  route: Route;
  file: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  severity: "error" | "warning" | "info" | "hint";
  message: string;
  code?: string;
  /** Displayed only (for example `rust-analyzer` or `rustc`); never used for logic. */
  source: string;
  projectName: string | null;
  external: boolean;
}

/**
 * Decision 20: is an accepted pull report proof of the file's diagnostics?
 * Before the workspace has reported ready (the bounded fallback), an empty
 * report clears the set but leaves the route unknown; a non-empty one is real.
 */
export function isAuthoritative(workspaceReady: boolean | null | undefined, itemCount: number): boolean {
  return workspaceReady !== false || itemCount > 0;
}

const keyOf = (session: number, uri: string, route: Route) => `${session}\u0000${route}\u0000${uri}`;

export class DiagnosticsModel {
  private sets = new Map<string, StoredSet>();
  private evicted = new Set<string>();
  /** Pull keys with an accepted report: absent means unknown, never "no problems" (decision 20). */
  private known = new Set<string>();
  private clock = 0;
  readonly stats = { writes: 0, skippedEqual: 0, evictions: 0 };

  private retention: Retention;

  constructor(retention: Retention = RETENTION) { this.retention = retention; }

  /** Replace a set. Returns false (no write, no marker call) when it equals the stored one. */
  apply(session: number, uri: string, route: Route, items: LspDiagnostic[], isOpen: (uri: string) => boolean): boolean {
    const key = keyOf(session, uri, route);
    const hash = setHash(items);
    const current = this.sets.get(key);
    this.evicted.delete(key);
    if (current && current.hash === hash) { this.stats.skippedEqual++; current.at = ++this.clock; return false; }
    // An empty set is a real update; it clears and is not stored.
    if (items.length === 0) {
      if (!current) { this.stats.skippedEqual++; return false; }
      this.sets.delete(key);
      this.stats.writes++;
      return true;
    }
    const kept = items.slice(0, this.retention.perFile);
    this.sets.set(key, { session, uri, route, items: kept, hash, notRetained: items.length - kept.length, at: ++this.clock });
    this.stats.writes++;
    this.enforce(isOpen);
    return true;
  }

  get(session: number, uri: string, route: Route): LspDiagnostic[] { return this.sets.get(keyOf(session, uri, route))?.items ?? []; }

  /** An accepted pull report (including an authoritative empty one) makes the pull route known. */
  markKnown(session: number, uri: string): void { this.known.add(keyOf(session, uri, "pull")); }
  isKnown(session: number, uri: string): boolean { return this.known.has(keyOf(session, uri, "pull")); }
  clearKnown(session: number, uri: string): void { this.known.delete(keyOf(session, uri, "pull")); }

  /** Closing a document clears its pull set (decision 18); its push set stays. */
  clearPull(session: number, uri: string): boolean {
    this.known.delete(keyOf(session, uri, "pull"));
    return this.sets.delete(keyOf(session, uri, "pull"));
  }

  /** Session end: both routes' sets for that session, and nothing else. Returns the affected uris. */
  clearSession(session: number): string[] {
    const uris = new Set<string>();
    for (const [key, set] of this.sets) if (set.session === session) { uris.add(set.uri); this.sets.delete(key); }
    for (const key of this.evicted) if (key.startsWith(`${session}\u0000`)) this.evicted.delete(key);
    for (const key of this.known) if (key.startsWith(`${session}\u0000`)) this.known.delete(key);
    return [...uris];
  }

  /** Closed documents hold push sets only; least recently published goes first. Open sets are never evicted. */
  enforce(isOpen: (uri: string) => boolean): void {
    const closed = [...this.sets.entries()].filter(([, set]) => !isOpen(set.uri)).sort(([, a], [, b]) => a.at - b.at);
    let total = closed.reduce((sum, [, set]) => sum + set.items.length, 0);
    let files = closed.length;
    for (const [key, set] of closed) {
      if (files <= this.retention.closedFiles && total <= this.retention.closedTotal) break;
      this.sets.delete(key);
      this.evicted.add(key);
      this.stats.evictions++;
      files--;
      total -= set.items.length;
    }
  }

  /** Files whose diagnostics are not retained: shown, never silent; counts become "at least". */
  evictedFiles(): number { return this.evicted.size; }
  notRetained(): number { return [...this.sets.values()].reduce((sum, set) => sum + set.notRetained, 0); }
  storedCount(route?: Route): number {
    return [...this.sets.values()].filter((set) => !route || set.route === route).reduce((sum, set) => sum + set.items.length, 0);
  }

  /** Distinct uris that have a stored set (for attribution lookups). */
  uris(): string[] { return [...new Set([...this.sets.values()].map((set) => set.uri))]; }

  /** Rows for display. Attribution is looked up per uri, so it can arrive after the set. */
  problems(attribute: (uri: string) => Attribution | null): LspProblem[] {
    const rows: LspProblem[] = [];
    for (const [key, set] of this.sets) {
      const file = uriToPath(set.uri);
      const who = attribute(set.uri);
      set.items.forEach((item, index) => rows.push({
        key: `${key}\u0000${index}`, session: set.session, route: set.route, file,
        line: item.range.start.line + 1, column: item.range.start.character + 1,
        endLine: item.range.end.line + 1, endColumn: item.range.end.character + 1,
        severity: severityName(item.severity), message: item.message, code: codeText(item.code),
        source: item.source ?? (set.route === "pull" ? "language server" : "language server (push)"),
        projectName: who === null ? null : who.ambiguous?.length ? `ambiguous: ${who.ambiguous.join(", ")}` : who.projectName,
        external: who !== null && who.projectId === null && !who.ambiguous?.length,
      }));
    }
    return rows;
  }
}
