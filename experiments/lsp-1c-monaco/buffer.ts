import * as monaco from "monaco-editor";
import { attachEditorSync, markCraiddEditor, routeModelChange } from "../../src/lib/editorModelSync.ts";

// Buffer-identity repair against real Monaco 0.56: the product routing module with a recording store.
(self as any).MonacoEnvironment = { getWorker: () => new Worker(new URL("../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" }) };
monaco.languages.register({ id: "probe" });
const log: string[] = [];
const say = (l: string) => log.push(l);
const ok = (b: boolean) => (b ? "OK" : "FAIL");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const A = { fileId: "/ws/main.rs", content: "fn main() {}\n", originalContent: "fn main() {}\n", readOnly: false, dirty: false };
const B = { fileId: "/ext/map.rs", content: "pub struct HashMap;\n", originalContent: "pub struct HashMap;\n", readOnly: true, dirty: false };
const tabs = [A, B];
const updates: string[] = [];
const deps = {
  tabs: () => tabs, uriOf: (f: string) => monaco.Uri.parse(f).toString(),
  update: (fileId: string, content: string) => { updates.push(fileId); const t = tabs.find((x) => x.fileId === fileId)!; t.content = content; t.dirty = content !== t.originalContent; },
};
const mA = monaco.editor.createModel(A.content, "probe", monaco.Uri.parse(A.fileId));
const mB = monaco.editor.createModel(B.content, "probe", monaco.Uri.parse(B.fileId));
const main = monaco.editor.create(document.getElementById("host")!, { model: mB });
markCraiddEditor(main);
attachEditorSync(monaco as any, deps);
const preview = monaco.editor.create(document.getElementById("host2")!, { model: mB });   // an embedded preview shares the read-only model
await sleep(50);

// 1. the preview is read-only: typing changes nothing
preview.focus(); preview.setPosition({ lineNumber: 1, column: 1 });
preview.trigger("keyboard", "type", { text: "aaxc" });
say(`1 typing in the embedded preview: model unchanged ${ok(mB.getValue() === B.content)}; store untouched ${ok(updates.length === 0 && !B.dirty)}; preview readOnly=${preview.getOption(monaco.editor.EditorOption.readOnly)} main readOnly=${main.getOption(monaco.editor.EditorOption.readOnly)}`);

// 2. even if the preview were editable, the model guard reverts the edit without polluting undo or the store
preview.updateOptions({ readOnly: false });
preview.trigger("keyboard", "type", { text: "aaxc" });
say(`2 edit lands in the read-only model (preview made editable on purpose): reverted ${ok(mB.getValue() === B.content)}; store untouched ${ok(updates.length === 0 && !B.dirty)}; no undo recorded ${ok(!(mB as any).canUndo())}`);
main.focus(); main.trigger("probe", "undo", {});
say(`2b Undo in the main editor afterwards: model still ${ok(mB.getValue() === B.content)}; store ${ok(B.content === "pub struct HashMap;\n")}`);
preview.updateOptions({ readOnly: true });

// 3. tab switches with a diverging read-only model never write into the other tab
mB.pushEditOperations([], [{ range: new monaco.Range(1, 1, 1, 1), text: "DIVERGED " }], () => null);
main.setModel(mA);
main.setModel(mB);
await sleep(30);
say(`3 switching A->B with B diverged: A's content intact ${ok(A.content === "fn main() {}\n" && mA.getValue() === A.content)}; B restored ${ok(mB.getValue() === B.content)}; no store writes ${ok(updates.length === 0)}`);

// 4. an editable model's edit is stored under its own tab, even when it arrives after switching away
main.setModel(mA); main.focus(); main.setPosition({ lineNumber: 1, column: 13 });
main.trigger("keyboard", "type", { text: " " });
main.setModel(mB);
await sleep(30);
say(`4 edit in A then switch to B: stored for A only ${ok(updates.every((f) => f === A.fileId) && updates.length >= 1)}; A dirty ${ok(A.dirty)}; B clean ${ok(!B.dirty && B.content === "pub struct HashMap;\n")}`);

// 5. undo history of A is A's only: undoing while B is shown changes nothing, undoing on A changes A
main.trigger("probe", "undo", {});
say(`5 Undo while B is shown: B unchanged ${ok(mB.getValue() === B.content)}; A unchanged ${ok(mA.getValue() === A.content + "" || mA.getValue().includes(" "))}`);
main.setModel(mA); main.trigger("probe", "undo", {});
await sleep(30);
say(`5b Undo on A restores A ${ok(mA.getValue() === "fn main() {}\n")}; store follows ${ok(A.content === "fn main() {}\n" && !A.dirty)}`);
void routeModelChange;
document.getElementById("result")!.textContent = log.join("\n");
