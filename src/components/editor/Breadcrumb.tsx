import { isMarkdown } from "../../lib/docsDiscovery";
import { useMarkdown } from "../../store/markdownStore";
import { isFileTab } from "../../types/project";
import { useSolution } from "../../store/solutionStore";

export default function Breadcrumb() {
  const tabs = useSolution((s) => s.tabs);
  const activeFileId = useSolution((s) => s.activeFileId);
  const mode = useMarkdown((s) => activeFileId ? s.modes[activeFileId] ?? "preview" : "source");
  const active = tabs.filter(isFileTab).find((t) => t.fileId === activeFileId);

  if (!active) {
    return (
      <div className="h-7 px-4 flex items-center border-b border-zinc-900 text-xs text-zinc-600">
        No file open
      </div>
    );
  }

  const parts = active.fileId.split(/[\\/]/).filter(Boolean);
  const last = parts.length > 3 ? parts.slice(-3) : parts;

  return (
    <div className="h-7 px-4 flex items-center gap-1 text-xs text-zinc-500 border-b border-zinc-900 shrink-0">
      <div className="flex items-center gap-1 min-w-0 overflow-hidden">{last.map((p, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="text-zinc-700">›</span>}
          <span className={i === last.length - 1 ? "text-zinc-300" : ""}>{p}</span>
        </span>
      ))}</div>
      {isMarkdown(active.fileId) && <button type="button" aria-label={mode === "preview" ? "View Source" : "View Preview"}
        title={mode === "preview" ? "View source" : "View preview"}
        className="ml-auto shrink-0 flex items-center justify-center w-7 h-6 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 focus-visible:outline focus-visible:outline-blue-400"
        onClick={() => useMarkdown.getState().setMode(active.fileId, mode === "preview" ? "source" : "preview")}>
        {mode === "preview" ? <svg aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 20" /></svg>
          : <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>}
      </button>}
    </div>
  );
}
