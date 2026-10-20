export type DocumentLink = { kind: "external"; url: string } | { kind: "local"; path: string; fragment: string };

export function withinRoot(root: string, path: string): boolean {
  const base = root.replace(/\/+$/, "");
  return path === base || path.startsWith(`${base}/`);
}

/** Paths are Linux paths. Decode before containment checks; never interpret an
 * arbitrary document URL as an IDE or filesystem command. */
export function resolveDocumentLink(document: string, root: string | null, href: string): DocumentLink {
  if (!href || /[\u0000-\u0020\u007f\\]/.test(href) || href.startsWith("//")) throw new Error("This link is empty or uses an unsupported URL.");
  if (/^(https?:|mailto:)/i.test(href)) return { kind: "external", url: href };
  if (/^[a-z][a-z\d+.-]*:/i.test(href)) throw new Error("This URL scheme is blocked.");
  const hash = href.indexOf("#");
  const fragment = hash < 0 ? "" : decodeURIComponent(href.slice(hash + 1));
  const encoded = hash < 0 ? href : href.slice(0, hash);
  if (encoded.includes("?")) throw new Error("Local document links with query parameters are unsupported.");
  const relative = decodeURIComponent(encoded);
  if (/[\u0000-\u001f\u007f\\]/.test(relative)) throw new Error("Invalid local document path.");
  const candidate = !relative ? document : relative.startsWith("/") ? relative : `${document.slice(0, document.lastIndexOf("/"))}/${relative}`;
  const segments: string[] = [];
  for (const part of candidate.split("/")) { if (part === "..") segments.pop(); else if (part && part !== ".") segments.push(part); }
  const path = `/${segments.join("/")}`;
  // Same-document fragments work even for a file outside the open workspace.
  if (path !== document && (!root || !withinRoot(root, path))) throw new Error("This local link is outside the open workspace.");
  return { kind: "local", path, fragment };
}
