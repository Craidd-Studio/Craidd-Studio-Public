import type { FileNode } from "../types/project";

export const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);
const isRootAgent = (node: FileNode) => !node.path.includes("/") && /^agents?\.md$/i.test(node.name);

export function sortDocs(nodes: FileNode[]): FileNode[] {
  return nodes.sort((a, b) => Number(isRootAgent(b)) - Number(isRootAgent(a))
    || Number(b.kind === "folder") - Number(a.kind === "folder")
    || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.name.localeCompare(b.name));
}

export function filterDocs(node: FileNode, query: string): FileNode | null {
  if (node.kind !== "folder") return isMarkdown(node.path) && node.path.toLowerCase().includes(query.toLowerCase()) ? node : null;
  const children = sortDocs((node.children ?? []).flatMap((child) => {
    const match = filterDocs(child, query);
    return match ? [match] : [];
  }));
  return children.length || node.path === "." ? { ...node, children } : null;
}

/** Discover unopened folders through File Discovery's listing and exclusions.
 * A small batch bounds IPC concurrency; limits count all entries, not only docs. */
export async function scanDocs(
  root: string,
  read: (path: string) => Promise<FileNode>,
  signal: AbortSignal,
  progress: (directories: number) => void = () => {},
  limits = { entries: 12_000, depth: 64 },
): Promise<{ tree: FileNode; warnings: string[] }> {
  const tree: FileNode = { id: ".", path: ".", name: root.split("/").pop() || root, kind: "folder", children: [] };
  const queue = [{ node: tree, depth: 0 }];
  const warnings: string[] = [];
  let entries = 0;
  let directories = 0;
  let limited = false;
  const check = () => { if (signal.aborted) throw new DOMException("Discovery cancelled", "AbortError"); };
  while (queue.length && !limited) {
    check();
    const batch = queue.splice(0, 4);
    const results = await Promise.allSettled(batch.map(({ node }) => read(node.path === "." ? root : `${root.replace(/\/$/, "")}/${node.path}`)));
    check();
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const { node, depth } = batch[i];
      directories++;
      if (result.status === "rejected") {
        if (warnings.length < 20) warnings.push(`${node.path}: ${String(result.reason)}`);
        continue;
      }
      for (const child of result.value.children ?? []) {
        if (++entries > limits.entries) { limited = true; break; }
        if (child.kind === "folder") {
          if (depth >= limits.depth) {
            if (warnings.length < 20) warnings.push(`Depth limit reached at ${child.path}.`);
          } else {
            const folder = { ...child, children: [] };
            node.children!.push(folder);
            queue.push({ node: folder, depth: depth + 1 });
          }
        } else if (isMarkdown(child.path)) node.children!.push(child);
      }
      if (limited) break;
    }
    progress(directories);
    // Let input and workspace changes interrupt even an in-memory listing.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  check();
  if (limited) warnings.push(`Discovery stopped after ${limits.entries.toLocaleString()} entries. Open a smaller workspace to see more documents.`);
  return { tree: filterDocs(tree, "")!, warnings };
}
