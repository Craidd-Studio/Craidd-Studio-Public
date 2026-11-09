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
