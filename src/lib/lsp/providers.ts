import type { NegotiatedCaps } from "./protocol.ts";

/** The provider kinds a session can serve (Stage 1c). */
export type ProviderKind = "completion" | "hover" | "definition" | "references" | "documentSymbol";

/**
 * Whether a session may be asked for `kind`: the server negotiated it and document
 * synchronisation is usable (the backend already folds this in, so a provider is
 * never requested from a session that cannot answer it).
 */
export function providerAvailable(caps: NegotiatedCaps | null | undefined, kind: ProviderKind): boolean {
  if (!caps || caps.syncUnusable) return false;
  return kind === "completion" ? caps.completion !== null : caps[kind] === true;
}

/** Trigger characters the first ready session negotiated; the client hardcodes none. */
export function triggerCharacters(caps: NegotiatedCaps | null | undefined): string[] {
  return providerAvailable(caps, "completion") ? [...caps!.completion!.triggerCharacters] : [];
}

export interface Disposable { dispose(): void }

/**
 * Monaco providers are global per language, not per session (design: "Monaco provider
 * registration"). Each is registered once per (language, kind); at call time it resolves the
 * model's session and checks that session's capabilities. Only properties Monaco fixes at
 * registration (completion trigger characters) re-register, and only when they differ.
 */
export class ProviderRegistrations {
  private entries = new Map<string, { signature: string; handle: Disposable }>();
  readonly stats = { registered: 0, reregistered: 0 };

  /** Returns true when a registration was made (first time, or the signature changed). */
  ensure(language: string, kind: ProviderKind, signature: string, register: () => Disposable): boolean {
    const key = `${language}\u0000${kind}`;
    const current = this.entries.get(key);
    if (current && current.signature === signature) return false;
    if (current) { current.handle.dispose(); this.stats.reregistered++; }
    this.entries.set(key, { signature, handle: register() });
    this.stats.registered++;
    return true;
  }

  disposeAll(): void { for (const { handle } of this.entries.values()) handle.dispose(); this.entries.clear(); }
}
