import { toMonacoRange, uriToPath, type LspRange } from "./protocol.ts";

/**
 * Navigation targets (Stage 1c step 4, decision 46). A server's definition and references
 * replies become file targets; opening them goes through Craidd's tab logic and never
 * through a model Monaco creates itself: the opener below decides owned versus unowned.
 */

export interface Target { path: string; range: ReturnType<typeof toMonacoRange> }

const validRange = (range: unknown): range is LspRange => {
  const r = range as LspRange | undefined;
  return Boolean(r?.start && r?.end && Number.isFinite(r.start.line) && Number.isFinite(r.start.character)
    && Number.isFinite(r.end.line) && Number.isFinite(r.end.character));
};

/** `Location`, `Location[]` and `LocationLink[]` (not requested, but tolerated). Non-file URIs and bad ranges are skipped. */
export function locationsToTargets(result: unknown): Target[] {
  const list = Array.isArray(result) ? result : result ? [result] : [];
  const targets: Target[] = [];
  for (const item of list as Record<string, any>[]) {
    const uri = typeof item?.targetUri === "string" ? item.targetUri : item?.uri;
    const range = item?.targetSelectionRange ?? item?.targetRange ?? item?.range;
    if (typeof uri !== "string" || !uri.startsWith("file://") || !validRange(range)) continue;
    let path: string;
    try { path = uriToPath(uri); } catch { continue; }
    if (!path.startsWith("/")) continue;
    targets.push({ path, range: toMonacoRange(range) });
  }
  return targets;
}

export interface Selection { lineNumber?: number; column?: number; startLineNumber?: number; startColumn?: number }

export interface NavigationDeps {
  /** A tab already holds this path (the holder is focused, never duplicated). */
  isOpen(path: string): boolean;
  /** The owning project of a path from the single ownership resolver, or null when unowned. */
  owner(path: string): Promise<{ projectId: string | null } | null>;
  /** Open (or focus) an owned file at a position, through the store's existing tab logic. */
  reveal(path: string, line: number, column: number): Promise<void>;
  /** An unowned target (step 5). */
  unowned(path: string, line: number, column: number): Promise<void>;
}

export type Opened = "holder" | "owned" | "unowned" | "ignored";

/** The editor opener's decision. Returns what happened; `ignored` leaves Monaco's default (non-file resources). */
export async function openTarget(deps: NavigationDeps, scheme: string, path: string, at: Selection | undefined): Promise<Opened> {
  if (scheme !== "file" || !path.startsWith("/")) return "ignored";
  const line = Math.max(1, at?.startLineNumber ?? at?.lineNumber ?? 1);
  const column = Math.max(1, at?.startColumn ?? at?.column ?? 1);
  if (deps.isOpen(path)) { await deps.reveal(path, line, column); return "holder"; }
  const owner = await deps.owner(path);
  if (owner && owner.projectId) { await deps.reveal(path, line, column); return "owned"; }
  await deps.unowned(path, line, column);
  return "unowned";
}
