import * as monaco from "monaco-editor";

(self as any).MonacoEnvironment = { getWorker: () => new Worker(new URL("../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" }) };
monaco.languages.register({ id: "probe" });

const log: string[] = [];
const say = (line: string) => log.push(line);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const show = (s: string) => JSON.stringify(s);
const BASE = "fn main() {\n    let x = HashM\n}\n";
const FINAL = "use std::collections::HashMap;\nfn main() {\n    let x = HashMap\n}\n";
const USE_EDIT = { range: new monaco.Range(1, 1, 1, 1), text: "use std::collections::HashMap;\n" };
const host = document.getElementById("host")!;
const RESOLVE_BOUND_MS = 1000;
const notices: string[] = [];

type Edit = { range: monaco.IRange; text: string };
type Variant = "emptyRange" | "prefixRange";
interface Pending { prefixRange: monaco.IRange; resolve: () => Promise<Edit[]>; done: () => void }
const pendings = new Map<string, Pending>();
let doneSignal: Promise<void> = Promise.resolve();

const overlaps = (a: monaco.IRange, b: monaco.IRange) => {
  const A = monaco.Range.lift(a), B = monaco.Range.lift(b);
  if (A.isEmpty() && B.isEmpty()) return A.getStartPosition().equals(B.getStartPosition());
  return !A.isEmpty() && !B.isEmpty() ? monaco.Range.areIntersecting(A, B) : monaco.Range.areIntersecting(A, B) || A.containsPosition(B.getStartPosition()) || B.containsPosition(A.getStartPosition());
};

// The Craidd-owned accept command: awaits Craidd's own resolve (never Monaco's), validates, applies as ONE edit or nothing.
monaco.editor.registerCommand("f3.accept", async (_acc, id: string) => {
  const pending = pendings.get(id)!;
  const editor = monaco.editor.getEditors()[0];
  const model = editor.getModel()!;
  const versionAtAccept = model.getVersionId();
  // The typed prefix is read at accept time (word start to cursor), not taken from when the list was built.
  const cursor = editor.getPosition()!;
  const prefixAtAccept = { startLineNumber: cursor.lineNumber, startColumn: model.getWordUntilPosition(cursor).startColumn, endLineNumber: cursor.lineNumber, endColumn: cursor.column };
  const reject = (why: string) => { notices.push(why); pending.done(); };
  let additional: Edit[];
  try {
    additional = await Promise.race([pending.resolve(), sleep(RESOLVE_BOUND_MS).then(() => { throw new Error("resolve timed out"); })]);
  } catch (error) { return reject(`resolve failed: ${(error as Error).message}`); }
  if (model.getVersionId() !== versionAtAccept) return reject("document changed since accept");
  const primary: Edit = { range: prefixAtAccept, text: "HashMap" };
  const all = [primary, ...additional];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    if (overlaps(all[i].range, all[j].range)) return reject("edits overlap");
  }
  model.pushStackElement();                                   // undo stop before
  model.pushEditOperations(editor.getSelections(), all.map((e) => ({ range: e.range, text: e.text })), () => null);
  model.pushStackElement();                                   // undo stop after
  const end = monaco.Range.lift(pending.prefixRange).getStartPosition();
  editor.setPosition({ lineNumber: end.lineNumber + (additional.some((e) => e.text.includes("\n")) ? 1 : 0), column: end.column + "HashMap".length });
  pending.done();
});

function itemFor(id: string, variant: Variant, label = "HashMap"): monaco.languages.CompletionItem {
  const prefixRange = { startLineNumber: 2, startColumn: 13, endLineNumber: 2, endColumn: 18 };
  return {
    label, kind: monaco.languages.CompletionItemKind.Struct,
    // Variant A: empty range at the cursor, empty text. Variant B: range covers the typed prefix, text = that prefix.
    insertText: variant === "emptyRange" ? "" : "HashM",
    range: variant === "emptyRange" ? { startLineNumber: 2, startColumn: 18, endLineNumber: 2, endColumn: 18 } : prefixRange,
    filterText: label,
    command: { id: "f3.accept", title: "", arguments: [id] },
  };
}

async function scenario(variant: Variant, name: string, resolve: () => Promise<Edit[]>,
  act: (editor: monaco.editor.IStandaloneCodeEditor, model: monaco.editor.ITextModel) => Promise<void>, wait = 1500,
  beforeAccept?: (editor: monaco.editor.IStandaloneCodeEditor) => Promise<void>) {
  const model = monaco.editor.createModel(BASE, "probe");
  const editor = monaco.editor.create(host, { model, quickSuggestions: false });
  editor.focus(); editor.setPosition({ lineNumber: 2, column: 18 });
  notices.length = 0;
  let calls = 0;
  const id = `${name}-${variant}`;
  let finish!: () => void; doneSignal = new Promise<void>((r) => (finish = r));
  pendings.set(id, { prefixRange: { startLineNumber: 2, startColumn: 13, endLineNumber: 2, endColumn: 18 }, resolve, done: finish });
  // Craidd declares lazy edits; Monaco's own resolve hook is NOT used for edits (it would apply them itself).
  const reg = monaco.languages.registerCompletionItemProvider("probe", {
    provideCompletionItems: () => { calls++; return { suggestions: [itemFor(id, variant)] }; },
  });
  const states = new Set<string>([model.getValue()]);
  const sub = model.onDidChangeContent(() => states.add(model.getValue()));
  editor.trigger("probe", "editor.action.triggerSuggest", {}); await sleep(400);
  if (beforeAccept) await beforeAccept(editor);
  const atAccept = model.getValue();
  editor.trigger("probe", "acceptSelectedSuggestion", {});
  const afterAcceptSync = model.getValue();
  await act(editor, model);
  await Promise.race([doneSignal, sleep(wait)]);
  await sleep(50);
  const finalText = model.getValue();
  sub.dispose(); reg.dispose();
  const result = { finalText, afterAcceptSync, atAccept, states: [...states], notices: [...notices], calls, editor, model };
  return result;
}
function cleanup(r: { editor: monaco.editor.IStandaloneCodeEditor; model: monaco.editor.ITextModel }) { r.editor.dispose(); r.model.dispose(); }

const ok = (b: boolean) => (b ? "OK" : "FAIL");

async function main() {
  for (const variant of ["prefixRange", "emptyRange"] as Variant[]) {
    say(`## variant ${variant}`);
    // 1. idle accept, resolve 10 ms and 800 ms
    for (const ms of [10, 800]) {
      const r = await scenario(variant, `idle${ms}`, async () => { await sleep(ms); return [USE_EDIT]; }, async () => {});
      const syncUnchanged = r.afterAcceptSync === BASE;
      say(`1 idle resolve ${ms}ms: final=${show(r.finalText)} ${ok(r.finalText === FINAL)}; text right after accept (before command) unchanged: ${ok(syncUnchanged)}; notices=${show(r.notices)}`);
      r.editor.trigger("probe", "undo", {});
      say(`1   one undo -> ${show(r.model.getValue())} restores original exactly: ${ok(r.model.getValue() === BASE)}`);
      // 5. no partial edit: only the states {BASE, FINAL} (and the no-op accept) ever existed
      const partial = r.states.filter((s) => s !== BASE && s !== FINAL);
      say(`5   states ever observed: ${r.states.length}; partial states: ${show(partial)} ${ok(partial.length === 0)}`);
      cleanup(r);
    }
    // 2. user types during an 800 ms resolve
    {
      const r = await scenario(variant, "typing", async () => { await sleep(800); return [USE_EDIT]; }, async (editor) => {
        await sleep(200); editor.trigger("keyboard", "type", { text: "Z" });
      });
      const expected = BASE.replace("HashM", "HashMZ");
      say(`2 type 'Z' during resolve: final=${show(r.finalText)} (original + typed char only) ${ok(r.finalText === expected)}; notices=${show(r.notices)} ${ok(r.notices.length === 1)}`);
      cleanup(r);
    }
    // 3a. resolve rejects; 3b. never settles (bounded)
    {
      const r = await scenario(variant, "reject", async () => { await sleep(100); throw new Error("server said no"); }, async () => {});
      say(`3a resolve rejects: final=${show(r.finalText)} ${ok(r.finalText === BASE)}; notices=${show(r.notices)} ${ok(r.notices.length === 1)}`);
      cleanup(r);
      const h = await scenario(variant, "hang", () => new Promise(() => {}), async () => {}, RESOLVE_BOUND_MS + 800);
      say(`3b resolve never settles (bound ${RESOLVE_BOUND_MS}ms): final=${show(h.finalText)} ${ok(h.finalText === BASE)}; notices=${show(h.notices)} ${ok(h.notices.length === 1)}`);
      cleanup(h);
    }
    // 7. the user keeps typing after the list opened, then accepts: the prefix in effect at accept is replaced
    {
      const r = await scenario(variant, "late-prefix", async () => { await sleep(10); return [USE_EDIT]; }, async () => {}, 1500, async (editor) => {
        editor.trigger("keyboard", "type", { text: "a" }); await sleep(300);
      });
      say(`7 typed 'a' after the list opened, then accept: final=${show(r.finalText)} ${ok(r.finalText === FINAL)}; notices=${show(r.notices)}`);
      cleanup(r);
    }
    // 4. overlapping edits
    for (const [label, edit] of [
      ["overlaps the typed prefix", { range: new monaco.Range(2, 15, 2, 17), text: "X" }],
      ["inserts at the primary start", { range: new monaco.Range(2, 13, 2, 13), text: "std::" }],
      ["two additional edits overlap", null],
    ] as [string, Edit | null][]) {
      const r = await scenario(variant, "overlap", async () => (edit ? [edit] : [USE_EDIT, { range: new monaco.Range(1, 1, 1, 1), text: "// dup\n" }]), async () => {});
      say(`4 ${label}: final=${show(r.finalText)} rejected whole ${ok(r.finalText === BASE)}; notices=${show(r.notices)}`);
      cleanup(r);
    }
  }
  // 6. filtering and prefix behaviour of the no-op edit
  say("## 6 filtering with the no-op edit (3 items: HashMap, HashSet, Hello; prefix typed: 'HashM' then more)");
  for (const variant of ["prefixRange", "emptyRange"] as Variant[]) {
    const model = monaco.editor.createModel(BASE, "probe");
    const editor = monaco.editor.create(host, { model, quickSuggestions: false });
    editor.focus(); editor.setPosition({ lineNumber: 2, column: 18 });
    let calls = 0;
    const reg = monaco.languages.registerCompletionItemProvider("probe", {
      provideCompletionItems: () => { calls++; return { suggestions: ["HashMap", "HashSet", "Hello", "Zebra"].map((l, i) => itemFor(`f${i}`, variant, l)) }; },
    });
    editor.trigger("probe", "editor.action.triggerSuggest", {}); await sleep(500);
    const rows = () => [...document.querySelectorAll(".suggest-widget .monaco-list-row")].map((r) => (r.querySelector(".label-name")?.textContent ?? r.textContent ?? "").trim());
    const first = rows();
    editor.trigger("keyboard", "type", { text: "a" }); await sleep(400);
    const second = rows();
    say(`6 ${variant}: after list opens with prefix 'HashM': rows=${show(first)}; after typing 'a' (doc ${show(model.getValue().split("\n")[1])}): rows=${show(second)}; provider calls=${calls}`);
    reg.dispose(); editor.dispose(); model.dispose();
  }
}

main().catch((e) => say("PROBE ERROR: " + (e as Error).stack)).finally(() => { document.getElementById("result")!.textContent = log.join("\n"); });
