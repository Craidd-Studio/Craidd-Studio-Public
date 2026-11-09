import type { ProviderKind } from "./providers.ts";

/**
 * Provider request helper (Stage 1c, design: "Request policy" and "Independent stale
 * rejection"). Every position-dependent request flushes the document first, records
 * `{epoch, versionId}`, supersedes the previous request of the same kind for the document,
 * cancels when Monaco's token fires, and applies a reply only if nothing moved.
 */

export type ProviderReply =
  | { kind: "result"; epoch: number; uri: string; value: unknown }
  | { kind: "noResult"; epoch: number; uri: string }
  | { kind: "busy" } | { kind: "notSynced" } | { kind: "disabled" }
  | { kind: "error"; code: number; message: string };

export interface Stamp { epoch: number; versionId: number }
export interface RequestToken { isCancellationRequested: boolean; onCancellationRequested(listener: () => void): { dispose(): void } }

export interface RequestHost {
  /** The document's session and uri, or null when it is not bound. */
  binding(fileId: string): { session: number; uri: string } | null;
  /** `(epoch, versionId)` now, or null when the document is not Open. */
  stamp(fileId: string): Stamp | null;
  flush(fileId: string): Promise<void>;
  call(command: string, args: Record<string, unknown>): Promise<ProviderReply>;
  cancel(session: number, uri: string, kind: ProviderKind): Promise<void>;
}

export const COMMANDS: Record<ProviderKind, string> = {
  hover: "lsp_hover", definition: "lsp_definition", references: "lsp_references", documentSymbol: "lsp_document_symbol", completion: "lsp_completion",
};

export class ProviderRequests {
  readonly stats = { sent: 0, applied: 0, stale: 0, superseded: 0, cancelled: 0, busy: 0, empty: 0 };
  private newest = new Map<string, number>();
  private clock = 0;
  private host: RequestHost;

  constructor(host: RequestHost) { this.host = host; }

  /**
   * Resolves to the server's value, or `null` for anything that should show nothing: no binding,
   * busy, not synced, no result, a stale or superseded or cancelled reply. Never throws.
   */
  async request(kind: ProviderKind, fileId: string, args: Record<string, unknown>, token?: RequestToken): Promise<unknown | null> {
    const binding = this.host.binding(fileId);
    if (!binding || !this.host.stamp(fileId)) return null;
    const key = `${fileId}\u0000${kind}`;
    const mine = ++this.clock;
    if (this.newest.has(key)) this.stats.superseded++;
    this.newest.set(key, mine);
    await this.host.flush(fileId);
    const sent = this.host.stamp(fileId);
    if (!sent || this.newest.get(key) !== mine || token?.isCancellationRequested) { this.stats.cancelled++; return null; }
    const listener = token?.onCancellationRequested(() => { this.stats.cancelled++; void this.host.cancel(binding.session, binding.uri, kind).catch(() => {}); });
    this.stats.sent++;
    try {
      const reply = await this.host.call(COMMANDS[kind], { session: binding.session, uri: binding.uri, ...args });
      if (reply.kind === "busy") { this.stats.busy++; return null; }
      if (reply.kind !== "result") { this.stats.empty++; return null; }
      const now = this.host.stamp(fileId);
      const stale = !now || now.epoch !== sent.epoch || now.versionId !== sent.versionId || reply.epoch !== sent.epoch
        || this.newest.get(key) !== mine || token?.isCancellationRequested === true;
      if (stale) { this.stats.stale++; return null; }
      this.stats.applied++;
      return reply.value;
    } catch { return null; }
    finally { listener?.dispose(); if (this.newest.get(key) === mine) this.newest.delete(key); }
  }
}
