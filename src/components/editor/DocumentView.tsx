import { useCallback, useEffect, useRef, useState } from "react";
import type { editor } from "monaco-editor";
import { useSolution } from "../../store/solutionStore";
import { useMarkdown } from "../../store/markdownStore";
import { useSplit } from "../../store/splitStore";
import { setActiveEditor } from "../../lib/activeEditor";
import { isMarkdown } from "../../lib/docsDiscovery";
import { formatMarkdownSelection, markdownFormatKey, markdownTextEdit, replaceMarkdownRange } from "../../lib/markdownPreview";
import CodeView from "./CodeView";
import MarkdownPreview from "./MarkdownPreview";

export default function DocumentView() {
  const tab = useSolution((s) => s.tabs.find((item) => item.fileId === s.activeFileId));
  const root = useSolution((s) => s.rootPath);
  const navigation = useSolution((s) => s.navigation);
  const mode = useMarkdown((s) => tab ? s.modes[tab.fileId] ?? "preview" : "source");
  const surface = useRef<HTMLDivElement>(null);
  const mainEditor = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [ready, setReady] = useState(false);
  const mounted = useCallback((instance: editor.IStandaloneCodeEditor) => { mainEditor.current = instance; setReady(true); }, []);
  const markdown = Boolean(tab && isMarkdown(tab.fileId));
  const preview = markdown && mode === "preview";
  useEffect(() => {
    if (navigation && isMarkdown(navigation.fileId)) useMarkdown.getState().setMode(navigation.fileId, "source");
  }, [navigation]);
  const model = () => {
    const current = mainEditor.current?.getModel();
    if (!current || current.uri.path !== useSolution.getState().activeFileId) throw new Error("The document editor is still loading. Try again in a moment.");
    return current;
  };
  const boundary = () => { mainEditor.current?.getModel()?.pushStackElement(); };
  const undo = (redo = false) => { const current = model(); boundary(); void (redo ? current.redo() : current.undo()); };
  const focusPreview = () => {
    useSplit.getState().setSideFocused(false);
    if (mainEditor.current) setActiveEditor(mainEditor.current, () => useSolution.getState().activeFileId, undo);
  };
  useEffect(() => {
    boundary();
    if (!markdown || !ready) return;
    if (preview) {
      focusPreview();
      surface.current?.querySelector<HTMLElement>('[aria-label="Markdown preview"]')?.focus({ preventScroll: true });
    } else mainEditor.current?.focus();
    // Keep keyboard focus in the selected surface after using the view button.
  }, [preview, ready, tab?.fileId]);
  return <div ref={surface} className="flex-1 min-h-0 flex flex-col" data-markdown-document={markdown ? "" : undefined}
    onKeyDownCapture={(event) => {
      const format = markdownFormatKey(event);
      if (!markdown || preview || !format || format === "link") return;
      event.preventDefault(); event.stopPropagation();
      const current = model();
      const selection = mainEditor.current?.getSelection();
      if (!selection) return;
      const source = current.getValue();
      const result = formatMarkdownSelection(source, current.getOffsetAt(selection.getStartPosition()), current.getOffsetAt(selection.getEndPosition()), format);
      const { start, end, text } = markdownTextEdit(source, result.value);
      const from = current.getPositionAt(start), to = current.getPositionAt(end);
      boundary();
      current.pushEditOperations(null, [{ range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, text }], () => null);
      boundary();
      const selectedFrom = current.getPositionAt(result.start), selectedTo = current.getPositionAt(result.end);
      mainEditor.current?.setSelection({ startLineNumber: selectedFrom.lineNumber, startColumn: selectedFrom.column, endLineNumber: selectedTo.lineNumber, endColumn: selectedTo.column });
    }}>
    <div className="flex-1 min-h-0 flex-col" style={{ display: preview ? "none" : "flex" }}><CodeView onReady={mounted} /></div>
    {preview && tab && <MarkdownPreview key={tab.fileId} file={tab.fileId} root={root} content={tab.content} ready={ready}
      boundary={boundary} undo={undo} onFocus={focusPreview}
      replace={(start, end, replacement, expected) => {
        const latest = useSolution.getState().tabs.find((item) => item.fileId === tab.fileId);
        if (!latest || latest.content !== expected) throw new Error("This document changed. Reopen the block before editing it.");
        const next = replaceMarkdownRange(expected, start, end, replacement, expected.slice(start, end));
        const current = model();
        if (current.getValue() !== expected) throw new Error("The source editor and document are synchronizing. Try View Source before editing this block.");
        const from = current.getPositionAt(start), to = current.getPositionAt(end);
        current.pushEditOperations(null, [{ range: { startLineNumber: from.lineNumber, startColumn: from.column, endLineNumber: to.lineNumber, endColumn: to.column }, text: replacement }], () => null);
        // Monaco's onChange updates the existing tab and dirty/save/conflict path.
        return next;
      }} />}
  </div>;
}
