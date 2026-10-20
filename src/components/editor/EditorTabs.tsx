import { useSplit } from "../../store/splitStore";
import { setActiveEditor } from "../../lib/activeEditor";
import { openProfilerWorkspace } from "../../lib/profilerWorkspace";
import { useEffect } from "react";
import { useSolution } from "../../store/solutionStore";
import { languageMeta } from "../../lib/languages";
import type { EditorTab } from "../../types/project";

// Returns the CSS colour for a tab's status dot, or null for "no dot".
// Precedence: deleted > newer > dirty > saved.
function dotClass(tab: EditorTab): string | null {
  if (tab.kind !== "file") return null;
  if (tab.diskState === "deleted") return "bg-red-500";
  if (tab.diskState === "newer") return "bg-yellow-500";
  if (tab.dirty) return "bg-zinc-200";
  return null;
}

export default function EditorTabs({
  requestClose,
}: {
  requestClose: (fileId: string) => void;
}) {
  // Editing changes tab content on every keystroke. Tab chrome only needs
  // to repaint when its label or status changes.
  useSolution((s) => s.tabs.map((t) =>
    t.kind === "file" ? `${t.id}\u0000${t.name}\u0000${t.language}\u0000${t.dirty}\u0000${t.diskState}` : `${t.id}\u0000${t.name}`
  ).join("\u0001"));
  const tabs = useSolution.getState().tabs;
  const activeTabId = useSolution((s) => s.activeTabId);
  const setActiveTab = useSolution((s) => s.setActiveTab);
  const closeTab = useSolution((s) => s.closeTab);
  const activate = (tab: EditorTab) => {
    useSplit.getState().setSideFocused(false);
    setActiveEditor(null);
    if (tab.kind === "profiler") openProfilerWorkspace(); else setActiveTab(tab.id);
  };

  // When the active tab changes, scroll it into view horizontally.
  useEffect(() => {
    if (!activeTabId) return;
    const el = document.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(activeTabId)}"]`
    );
    el?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [activeTabId]);

  return (
    <div role="tablist" aria-label="Editor tabs" className="h-9 bg-zinc-900 border-b border-zinc-800 flex items-stretch overflow-x-auto scroll-thin shrink-0">
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const langColor =
          tab.kind === "profiler" || tab.language === "plaintext"
            ? "text-zinc-500"
            : languageMeta(tab.language).color;
        const dot = dotClass(tab);

        const onClose = (e: React.MouseEvent) => {
          e.stopPropagation();
          if (tab.kind === "file" && (tab.dirty || tab.diskState === "deleted")) {
            requestClose(tab.id);
          } else {
            closeTab(tab.id);
          }
        };

        return (
          <div
            role="tab" aria-selected={isActive} tabIndex={isActive ? 0 : -1}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); activate(tab); } }}
            key={tab.id}
            data-tab-id={tab.id}
            onClick={() => activate(tab)}
            onAuxClick={(e) => {
              if (e.button === 1) {
                e.preventDefault();
                if (tab.kind === "file" && (tab.dirty || tab.diskState === "deleted")) requestClose(tab.id);
                else closeTab(tab.id);
              }
            }}
            title={tab.kind === "file" ? tab.fileId : "Profiling"}
            className={
              "group flex items-center gap-2 px-3 border-r border-zinc-800 cursor-pointer select-none " +
              (isActive
                ? "bg-editor-bg text-zinc-100 border-t-2 border-t-blue-500"
                : "text-zinc-400 hover:bg-zinc-800 border-t-2 border-t-transparent")
            }
          >
            <svg aria-hidden="true" className={"w-3 h-3 shrink-0 " + langColor} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              {tab.kind === "profiler" ? <path d="M2 14h12M3 11V7M7 11V2M11 11V5" /> : <><path d="M3 1.75h6l4 4v8.5H3z" /><path d="M9 1.75v4h4" /></>}
            </svg>
            <span className="text-xs whitespace-nowrap">{tab.name}</span>
            {dot && <span title={tab.kind === "file" && tab.diskState === "deleted" ? "Deleted on disk" : tab.kind === "file" && tab.diskState === "newer" ? "Changed on disk" : "Unsaved changes"} className={"w-2 h-2 rounded-full shrink-0 " + dot} />}
            <button
              onClick={onClose}
              title={`Close ${tab.name}`}
              aria-label={`Close ${tab.name}`}
              className="w-4 h-4 flex items-center justify-center opacity-70 group-hover:opacity-100"
            >
              <span className="text-zinc-600 hover:text-zinc-200 text-sm leading-none">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
