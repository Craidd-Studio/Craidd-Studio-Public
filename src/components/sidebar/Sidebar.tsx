import { memo } from "react";
import { useLayout } from "../../store/layoutStore";
import SolutionExplorer from "./solution/SolutionExplorer";
import FileDiscovery from "./discovery/FileDiscovery";
import SearchPanel from "./search/SearchPanel";
import DocsBrowser from "./docs/DocsBrowser";

function Sidebar() {
  const activeView = useLayout((s) => s.activeView);

  return (
    <div className="bg-zinc-900 border-r border-zinc-800 flex flex-col overflow-hidden shrink-0 h-full w-full">
      {activeView === "search" && <SearchPanel />}
      <div className="flex-1 min-h-0 flex-col" style={{ display: activeView === "docs" ? "flex" : "none" }}><DocsBrowser active={activeView === "docs"} /></div>
      <div className="flex-1 min-h-0 flex-col" style={{ display: activeView !== "docs" && activeView !== "search" ? "flex" : "none" }}>
        <SolutionExplorer />
        <FileDiscovery />
      </div>
    </div>
  );
}

export default memo(Sidebar);
