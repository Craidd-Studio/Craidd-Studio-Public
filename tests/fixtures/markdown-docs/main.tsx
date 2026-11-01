// Browser-only regression harness. IPC is mocked; this is not desktop acceptance.
import "../../../src/monacoSetup";
import ReactDOM from "react-dom/client";
import { mockIPC } from "@tauri-apps/api/mocks";
import ActivityBar from "../../../src/components/layout/ActivityBar";
import Sidebar from "../../../src/components/sidebar/Sidebar";
import SaveConflictDialog from "../../../src/components/dialogs/SaveConflictDialog";
import EditorPane from "../../../src/components/editor/EditorPane";
import { useSolution } from "../../../src/store/solutionStore";
import { usePreferences } from "../../../src/store/preferencesStore";
import { useMarkdown } from "../../../src/store/markdownStore";
import { useKeyboardShortcuts } from "../../../src/hooks/useKeyboardShortcuts";
import { saveActiveFile } from "../../../src/lib/fileActions";
import { triggerEditorCommand } from "../../../src/lib/activeEditor";
import { useLayout } from "../../../src/store/layoutStore";
import design from "../../../docs/feats/editor/docs-viewer/design-markdown-projects.md?raw";
import "../../../src/assets/styles/index.css";

const content = "# Markdown Docs\r\n\r\nA **bold** paragraph with [guide](docs/deep/Guide.MARKDOWN#details).\r\n\r\n- [ ] Task\r\n  - Nested list\r\n\r\n| A | B |\r\n|---|---|\r\n| One | Two |\r\n\r\n```js\r\nconst value = 1;\r\n```\r\n\r\n![Local](image.png)\r\n\r\n![Remote](https://example.com/tracker.png)\r\n\r\n<script>window.bad = true</script>\r\n\r\n[Unsafe](javascript:alert(1))\r\n";
const files: Record<string, string> = { "/lab/empty.md": "", "/lab/README.md": content, "/lab/AGENT.md": "# Agent\n\nInstructions", "/lab/docs/deep/Guide.MARKDOWN": "# Guide\n\n## Details\n\nRead the [missing link](missing.md).", "/lab/docs/design.md": design };
const mtimes: Record<string, number> = {};
const calls: { cmd: string; args: unknown }[] = [];
const file = (path: string) => ({ id: path, path, name: path.split("/").pop(), kind: "file" });
const folder = (path: string, children?: unknown[]) => ({ ...file(path), kind: "folder", children });
const listings: Record<string, unknown> = { "/lab": folder(".", [folder("docs"), file("README.md"), file("empty.md"), file("AGENT.md"), file("image.png")]), "/lab/docs": folder("docs", [folder("docs/deep"), file("docs/design.md")]), "/lab/docs/deep": folder("docs/deep", [file("docs/deep/Guide.MARKDOWN")]) };
const bytes = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/e8cAAAAASUVORK5CYII="), (char) => char.charCodeAt(0)).buffer;
mockIPC((cmd, args: any) => {
  calls.push({ cmd, args });
  if (cmd === "read_dir_children") { if (!listings[args.path]) throw new Error("Folder not found"); return listings[args.path]; }
  if (cmd === "read_file") { if (!(args.path in files)) throw new Error("File not found"); return files[args.path]; }
  if (cmd === "stat_files") return args.paths.map((path: string) => ({ path, exists: path in files, readable: true, mtimeMs: mtimes[path] ?? 1, size: files[path]?.length ?? 0 }));
  if (cmd === "resolve_document_path") { if (!(args.path in files)) throw new Error("File not found"); return; }
  if (cmd === "read_document_image") return bytes;
  if (cmd === "overwrite_file") { files[args.path] = args.content; return; }
  return null;
}, { shouldMockEvents: true });
useSolution.setState({ rootPath: "/lab", discovery: listings["/lab"] as any, tabs: [{ kind: "file", id: "/lab/README.md", fileId: "/lab/README.md", name: "README.md", language: "plaintext", monacoLanguage: "markdown", content, originalContent: content, dirty: false, diskState: "inSync", mtimeAtLastSync: 1 }], activeTabId: "/lab/README.md", activeFileId: "/lab/README.md" });
useLayout.getState().setActiveView("docs");
usePreferences.setState({ sidebarVisible: true, theme: "craidd-dark", ideTheme: "craidd-dark" });
Object.assign(window, { docsTest: { files, mtimes, calls, original: content, solution: useSolution, markdown: useMarkdown, layout: useLayout, preferences: usePreferences } });
function Harness() {
  useKeyboardShortcuts(() => {}, () => {});
  const sidebar = usePreferences((s) => s.sidebarVisible);
  const pending = useSolution((s) => s.pendingSave);
  return <div className="flex h-full"><ActivityBar />{sidebar && <aside className="w-72 flex"><Sidebar /></aside>}<div className="flex flex-1 min-w-0 flex-col"><div className="flex gap-4 p-2 border-b border-zinc-800"><button onClick={() => void saveActiveFile()}>Save document</button><button onClick={() => triggerEditorCommand("undo")}>Menu Undo</button><button onClick={() => triggerEditorCommand("redo")}>Menu Redo</button></div><EditorPane /></div>{pending && <SaveConflictDialog fileId={pending.fileId} onClose={() => useSolution.getState().setPendingSave(null)} />}</div>;
}
ReactDOM.createRoot(document.getElementById("root")!).render(<Harness />);
