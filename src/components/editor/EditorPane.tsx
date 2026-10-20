import { useMonaco } from "@monaco-editor/react";
import { useSolution } from "../../store/solutionStore";
import { PROFILER_TAB_ID, isFileTab } from "../../types/project";
import ProfilerPanel from "../panels/ProfilerPanel";
import { setActiveEditor } from "../../lib/activeEditor";
import { useSplit } from "../../store/splitStore";
import { memo, useEffect, useState, useLayoutEffect, useRef } from "react";
import EditorTabs from "./EditorTabs";
import Breadcrumb from "./Breadcrumb";
import DocumentView from "./DocumentView";
import SideEditor from "./SideEditor";
import SaveConfirmDialog from "../dialogs/SaveConfirmDialog";

function EditorPane() {
  const active = useSolution((s) => s.activeTabId);
  const fileIds = useSolution((s) => s.tabs.filter(isFileTab).map(tab => tab.fileId).join("\0"));
  const profilerActive = active === PROFILER_TAB_ID;
  const monaco = useMonaco();
  const previousFiles = useRef<string[]>([]);
  useLayoutEffect(() => {
    const files = fileIds ? fileIds.split("\0") : [];
    // Models survive host switches but are released when their file tab closes.
    for (const file of previousFiles.current) {
      if (!files.includes(file)) monaco?.editor.getModel(monaco.Uri.parse(file))?.dispose();
    }
    previousFiles.current = files;
  }, [fileIds, monaco]);
  const [pendingClose, setPendingClose] = useState<string | null>(null);

  useEffect(() => {
    const onRequest = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (typeof id === "string") setPendingClose(id);
    };
    window.addEventListener("craidd:request-close", onRequest);
    return () => window.removeEventListener("craidd:request-close", onRequest);
  }, []);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 editor-surface bg-editor-bg">
      <div className="flex-1 min-h-0 flex">
        <div className="flex-1 min-w-0 min-h-0 flex flex-col">
          <EditorTabs requestClose={(id) => setPendingClose(id)} />
          {profilerActive ? <div className="flex-1 min-h-0" onFocusCapture={() => { useSplit.getState().setSideFocused(false); setActiveEditor(null); }}
            onPointerDownCapture={() => { useSplit.getState().setSideFocused(false); setActiveEditor(null); }}>
            <ProfilerPanel expanded />
          </div> : <><Breadcrumb /><DocumentView /></>}
        </div>
        <SideEditor />
      </div>
      {pendingClose && (
        <SaveConfirmDialog
          fileId={pendingClose}
          onClose={() => setPendingClose(null)}
        />
      )}
    </div>
  );
}

export default memo(EditorPane);
