import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSolution } from "../../../store/solutionStore";
import { useLayout } from "../../../store/layoutStore";
import { filterDocs, scanDocs } from "../../../lib/docsDiscovery";
import { openWorkspaceFile } from "../../../lib/openWorkspaceFile";
import type { FileNode } from "../../../types/project";

export default function DocsBrowser({ active }: { active: boolean }) {
  const root = useSolution((s) => s.rootPath);
  const discovery = useSolution((s) => s.discovery);
  const selected = useSolution((s) => s.activeFileId);
  const [result, setResult] = useState<{ root: string; tree: FileNode; warnings: string[] } | null>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [directories, setDirectories] = useState(0);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setExpanded(new Set()); setQuery(""); setResult(null); setError(null); }, [root]);
  useEffect(() => {
    if (!active || !root) return;
    const controller = new AbortController();
    setLoading(true); setDirectories(0);
    void scanDocs(root, (path) => invoke<FileNode>("read_dir_children", { root, path }), controller.signal, setDirectories)
      .then(({ tree, warnings }) => setResult({ root, tree, warnings }))
      .catch((failure) => { if (!controller.signal.aborted) setError(String(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, root, discovery, revision]);
  useEffect(() => {
    if (!active) return;
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [active]);
  const tree = useMemo(() => result?.root === root ? filterDocs(result.tree, query.trim()) : null, [result, root, query]);
  const open = async (node: FileNode) => {
    setError(null);
    try { await openWorkspaceFile(`${root!.replace(/\/$/, "")}/${node.path}`); }
    catch (failure) { setError(String(failure)); }
  };
  const render = (node: FileNode, depth: number): React.ReactNode => {
    const folder = node.kind === "folder";
    const opened = Boolean(query.trim()) || expanded.has(node.path);
    const path = `${root!.replace(/\/$/, "")}/${node.path}`;
    return <li key={node.path}>
      <div className="flex items-center group">
        <button type="button" aria-expanded={folder ? opened : undefined} aria-current={!folder && path === selected ? "page" : undefined}
          title={node.path} style={{ paddingLeft: 10 + depth * 12 }}
          className={`min-w-0 flex-1 flex gap-2 items-center py-1 pr-1 text-left text-xs ${path === selected ? "bg-blue-900/40 text-zinc-100" : "text-zinc-300 hover:bg-zinc-800"}`}
          onClick={() => folder ? setExpanded((previous) => {
            const next = new Set(previous); if (next.has(node.path)) next.delete(node.path); else next.add(node.path); return next;
          }) : void open(node)}>
          <span aria-hidden="true" className="w-3 shrink-0 text-zinc-500">{folder ? opened ? "▾" : "▸" : "·"}</span>
          <span className="truncate">{node.name}</span>
        </button>
        <button type="button" title={`Reveal ${node.name} in File Discovery`} aria-label={`Reveal ${node.name} in File Discovery`}
          className="px-2 text-zinc-500 hover:text-zinc-100 focus:opacity-100 opacity-0 group-hover:opacity-100"
          onClick={() => useLayout.getState().revealInDiscovery(path)}>↗</button>
      </div>
      {folder && opened && <ul>{node.children?.map((child) => render(child, depth + 1))}</ul>}
    </li>;
  };
  return <section aria-label="Docs browser" className="flex flex-col flex-1 min-h-0">
    <div className="h-8 px-3 flex items-center border-b border-zinc-800 shrink-0">
      <h2 className="text-[11px] font-semibold text-zinc-300 uppercase tracking-wide">Docs</h2>
      <button type="button" title="Refresh Docs" aria-label="Refresh Docs" onClick={() => setRevision((n) => n + 1)} className="ml-auto text-zinc-400 hover:text-zinc-100">↻</button>
    </div>
    {root && <div className="p-2"><input aria-label="Filter Docs by filename or path" placeholder="Filter by name or path…" value={query}
      onChange={(event) => setQuery(event.target.value)} className="w-full text-xs rounded px-2 py-1 bg-zinc-950 border border-zinc-700 text-zinc-200" /></div>}
    <div role="status" className="px-3 text-xs text-zinc-500">
      {!root ? "Open a folder to browse its documentation." : loading ? `Discovering… ${directories} folders scanned` : !tree?.children?.length ? query ? "No documents match this filter." : "No Markdown documents found." : null}
    </div>
    {error && <div role="alert" className="p-3 text-xs text-red-300">{error}</div>}
    {result?.root === root && result?.warnings.length > 0 && <details className="p-2 text-xs text-amber-300">
      <summary>Discovery incomplete</summary>{result.warnings.map((warning, index) => <p key={index} className="py-1 break-words">{warning}</p>)}
    </details>}
    <nav aria-label="Markdown documents" className="flex-1 min-h-0 overflow-auto scroll-thin py-1"><ul>{tree?.children?.map((node) => render(node, 0))}</ul></nav>
  </section>;
}
