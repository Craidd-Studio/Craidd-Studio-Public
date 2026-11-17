import { isFileTab } from "../../types/project";
import Editor from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { useSolution } from "../../store/solutionStore";
import { usePreferences } from "../../store/preferencesStore";
import { useSplit } from "../../store/splitStore";
import { setActiveEditor, getActiveEditor } from "../../lib/activeEditor";
import { registerDebugHover } from "../../lib/debugHover";
import { CRAIDD_DARK_THEME, defineCraiddDarkTheme } from "../../lib/editorThemes";
import { attachMonaco } from "../../lib/lsp/bridge";
import { attachEditorSync, markCraiddEditor, type MonacoLike } from "../../lib/editorModelSync";
import { editorRouting } from "../../lib/editorRouting";

/**
 * The side editor group. It edits the same Monaco model as the main editor,
 * so both views of one file stay identical, and writes changes to the same
 * tab for dirty tracking and Save. It has no breakpoint gutter or paused-line
 * marker; those stay in the main editor.
 */
export default function SideEditor() {
  const fileId = useSplit((s) => s.sideFileId);
  const tab = useSolution((s) => s.tabs.filter(isFileTab).find((item) => item.fileId === fileId));
  const activeFileId = useSolution((s) => s.activeFileId);
  const fontSize = usePreferences((s) => s.fontSize);
  const tabSize = usePreferences((s) => s.tabSize);
  const wordWrap = usePreferences((s) => s.wordWrap);
  const theme = usePreferences((s) => s.theme);
  const instanceRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  // The tab was closed: close the group.
  useEffect(() => { if (fileId && !tab) useSplit.getState().closeSide(); }, [fileId, tab]);

  // EditorPane releases models only when their file tab closes. Closing a
  // split group must keep the open file's undo history, even beside Profiler.
  if (!fileId || !tab) return null;
  const name = fileId.split("/").pop() ?? fileId;
  return <div role="group" aria-label="Side editor group"
    onFocusCapture={() => { useSplit.getState().setSideFocused(true); if (instanceRef.current) setActiveEditor(instanceRef.current, () => fileId); }}
    className="flex-1 min-w-0 min-h-0 flex flex-col border-l border-zinc-800">
    <div className="h-9 shrink-0 flex items-center gap-2 px-3 bg-zinc-900 border-b border-zinc-800 text-xs">
      <span className="truncate text-zinc-200" title={fileId}>{name}</span>
      {tab.dirty && <span className="text-zinc-400" title="Unsaved changes">●</span>}
      {fileId === activeFileId && <span className="text-zinc-600">also in main</span>}
      <button type="button" title="Close side group" onClick={() => useSplit.getState().closeSide()}
        className="ml-auto text-zinc-500 hover:text-zinc-200">×</button>
    </div>
    <div className="flex-1 min-h-0">
      <Editor
        height="100%"
        path={fileId}
        language={tab.monacoLanguage}
        defaultValue={tab.content}
        keepCurrentModel
        theme={theme === "craidd-dark" ? CRAIDD_DARK_THEME : theme}
        beforeMount={defineCraiddDarkTheme}
        onMount={(instance, monaco) => {
          instanceRef.current = instance;
          markCraiddEditor(instance, tab.readOnly === true);
          attachEditorSync(monaco as unknown as MonacoLike, editorRouting(monaco));
          attachMonaco(monaco);
          if (instance.hasTextFocus()) { useSplit.getState().setSideFocused(true); setActiveEditor(instance, () => fileId); }
          registerDebugHover(monaco);
          instance.onDidFocusEditorText(() => { useSplit.getState().setSideFocused(true); setActiveEditor(instance, () => fileId); });
          instance.onDidDispose(() => { if (getActiveEditor() === instance) setActiveEditor(null); });
        }}
        options={{
          readOnly: tab.readOnly === true, readOnlyMessage: { value: "Read-only: opened by navigation from a language server. Craidd never saves it." },
          fontSize, tabSize, fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
          minimap: { enabled: false }, scrollBeyondLastLine: false, automaticLayout: true,
          glyphMargin: false, wordWrap: wordWrap ? "on" : "off", padding: { top: 8, bottom: 8 },
        }}
      />
    </div>
  </div>;
}
