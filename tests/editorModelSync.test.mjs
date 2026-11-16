import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { routeModelChange, attachEditorSync, markCraiddEditor } from "../src/lib/editorModelSync.ts";

// A tiny world: tabs in a store, models with the path-derived uri, and a routing dependency set over them.
function world(tabs) {
  const store = new Map(tabs.map((t) => [t.fileId, { ...t }]));
  const updates = [];
  const deps = {
    tabs: () => [...store.values()],
    uriOf: (fileId) => `file://${fileId}`,
    update: (fileId, content) => { updates.push([fileId, content]); const t = store.get(fileId); store.set(fileId, { ...t, content, dirty: content !== t.originalContent }); },
  };
  const model = (fileId, text) => {
    const m = { uri: { toString: () => `file://${fileId}` }, text, disposed: false, setValues: 0,
      getValue: () => m.text, isDisposed: () => m.disposed, setValue(v) { m.setValues++; m.text = v; routeModelChange(m, deps); } };
    return m;
  };
  return { store, updates, deps, model };
}
const A = { fileId: "/ws/main.rs", content: "fn main() {}", originalContent: "fn main() {}" };
const B = { fileId: "/ext/map.rs", content: "pub struct HashMap;", originalContent: "pub struct HashMap;", readOnly: true };

test("a change is stored under the CHANGED model's own tab, never a file id captured elsewhere", () => {
  const w = world([A, B]);
  const a = w.model(A.fileId, "fn main() { 1 }");
  assert.equal(routeModelChange(a, w.deps), "stored");
  assert.deepEqual(w.updates, [["/ws/main.rs", "fn main() { 1 }"]]);
  assert.equal(w.store.get(B.fileId).content, B.content, "the other buffer is untouched");
});

test("a delayed change event after a switch cannot write through the old file identity", () => {
  const w = world([A, B]);
  const a = w.model(A.fileId, "fn main() { late }");
  // The user switched to B before A's event was delivered: the event still belongs to A's model.
  const bModel = w.model(B.fileId, B.content);
  routeModelChange(a, w.deps);                    // delivered late
  assert.deepEqual(w.updates, [["/ws/main.rs", "fn main() { late }"]], "stored for A only");
  assert.equal(routeModelChange(bModel, w.deps), "echo", "B's model matches its store: nothing is written for B");
  assert.equal(w.store.get(B.fileId).content, B.content);
  assert.equal(w.store.get(A.fileId).dirty, true);
  assert.equal(w.store.get(B.fileId).dirty, undefined, "the read-only tab is never dirty");
});

test("two buffers never cross-contaminate when a read-only model diverges from its store (the switch-time setValue echo)", () => {
  const w = world([A, B]);
  const b = w.model(B.fileId, "HASHMAP SOURCE EDITED ELSEWHERE");   // diverged model, as after an edit in a preview
  assert.equal(routeModelChange(b, w.deps), "reverted");
  assert.equal(b.text, B.content, "the model is put back to the stored source");
  assert.deepEqual(w.updates, [], "nothing reached the store, so nothing can reach another tab");
  assert.equal(w.store.get(A.fileId).content, A.content);
});

test("typing in a peek preview of a read-only model changes neither the model, nor the store, nor the dirty state", () => {
  const w = world([A, B]);
  const b = w.model(B.fileId, B.content);
  b.text = B.content + "aaxc";                   // an embedded editor's edit lands in the shared model
  assert.equal(routeModelChange(b, w.deps), "reverted");
  assert.equal(b.text, B.content);
  assert.deepEqual(w.updates, []);
  assert.equal(w.store.get(B.fileId).dirty, undefined);
  assert.equal(b.setValues, 1, "reverted once; the revert's own echo is not routed again");
});

test("echoes, disposed models and models no tab owns write nothing", () => {
  const w = world([A, B]);
  assert.equal(routeModelChange(w.model(A.fileId, A.content), w.deps), "echo");
  const gone = w.model(A.fileId, "x"); gone.disposed = true;
  assert.equal(routeModelChange(gone, w.deps), "ignored");
  assert.equal(routeModelChange(w.model("/scratch/widget.rs", "x"), w.deps), "ignored");
  assert.deepEqual(w.updates, []);
});

function fakeMonaco(models) {
  const created = { models: [], editors: [] };
  const monaco = { editor: { getModels: () => models,
    onDidCreateModel: (fn) => { created.models.push(fn); return { dispose() {} }; },
    onDidCreateEditor: (fn) => { created.editors.push(fn); return { dispose() {} }; } } };
  return { monaco, created };
}
const fakeModelWithEvents = (m) => Object.assign(m, { listeners: [], onDidChangeContent(fn) { m.listeners.push(fn); return { dispose() {} }; } });
const fakeEditor = () => ({ options: null, updateOptions(o) { this.options = o; } });

test("every model is watched, existing and future, and embedded editors become read-only while Craidd's own do not", async () => {
  const w = world([A, B]);
  const existing = fakeModelWithEvents(w.model(A.fileId, A.content));
  const { monaco, created } = fakeMonaco([existing]);
  attachEditorSync(monaco, w.deps);
  attachEditorSync(monaco, w.deps);                      // idempotent
  assert.equal(created.models.length, 1, "attached once per Monaco");
  assert.equal(existing.listeners.length, 1);
  const later = fakeModelWithEvents(w.model(B.fileId, B.content));
  created.models[0](later);
  later.text = "tampered";
  later.listeners[0]();
  assert.equal(later.text, B.content, "a model created later is routed too");
  const main = fakeEditor(), preview = fakeEditor();
  created.editors[0](main); created.editors[0](preview);
  markCraiddEditor(main);                                 // the creator registers right after create
  await Promise.resolve();
  assert.equal(main.options, null, "Craidd's own editor stays editable");
  assert.equal(preview.options.readOnly, true, "an embedded preview is read-only");
  assert.match(preview.options.readOnlyMessage.value, /Read-only/);
});

test("both editors register as Craidd's and neither routes edits through a captured file id", async () => {
  for (const file of ["src/components/editor/CodeView.tsx", "src/components/editor/SideEditor.tsx"]) {
    const text = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(text, /markCraiddEditor\(instance\)/, file);
    assert.match(text, /attachEditorSync\(monaco as unknown as MonacoLike, editorRouting\(monaco\)\)/, file);
    assert.doesNotMatch(text, /onChange=|updateTabContent/, `${file} no longer sends changes by a captured file id`);
  }
  const store = await readFile(new URL("../src/store/solutionStore.ts", import.meta.url), "utf8");
  assert.match(store.slice(store.indexOf("saveFileAs: async"), store.indexOf("saveFileAs: async") + 400), /tab\.readOnly\) throw/);
});
