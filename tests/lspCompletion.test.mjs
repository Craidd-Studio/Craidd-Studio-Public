import assert from "node:assert/strict";
import test from "node:test";
import { contextToLsp, kindToMonaco, needsOwnedAccept, primaryOf, validateEdits, listToMonaco } from "../src/lib/lsp/completion.ts";

const r = (l1, c1, l2, c2) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });
const word = { lineNumber: 5, startColumn: 9, endColumn: 14, text: "HashM" };

test("Monaco's trigger kinds map to the LSP values; a trigger character is carried only for kind 2", () => {
  assert.deepEqual(contextToLsp({ triggerKind: 0 }), { triggerKind: 1, triggerCharacter: null });
  assert.deepEqual(contextToLsp({ triggerKind: 1, triggerCharacter: "." }), { triggerKind: 2, triggerCharacter: "." });
  assert.deepEqual(contextToLsp({ triggerKind: 2 }), { triggerKind: 3, triggerCharacter: null });
  assert.deepEqual(contextToLsp({ triggerKind: 1 }), { triggerKind: 1, triggerCharacter: null }, "a trigger kind without its character is a plain invoke");
  assert.deepEqual(contextToLsp(undefined), { triggerKind: 1, triggerCharacter: null });
});

test("item kinds map from LSP to Monaco; unknown kinds are plain text", () => {
  assert.equal(kindToMonaco(3), 1, "Function");
  assert.equal(kindToMonaco(22), 6, "Struct");
  assert.equal(kindToMonaco(15), 27, "Snippet");
  assert.equal(kindToMonaco(99), 18);
  assert.equal(kindToMonaco(undefined), 18);
});

test("the owned path is chosen from the server's data only: resolve offered, no edits yet, opaque data present", () => {
  const item = { label: "HashMap", data: { x: 1 } };
  assert.equal(needsOwnedAccept(item, true), true);
  assert.equal(needsOwnedAccept(item, false), false, "no resolveProvider: nothing can be gained");
  assert.equal(needsOwnedAccept({ ...item, additionalTextEdits: [] }, true), false, "edits already complete in the list");
  assert.equal(needsOwnedAccept({ label: "x" }, true), false, "no data to resolve with");
});

test("InsertReplaceEdit follows Monaco's mode; a plain TextEdit ignores it", () => {
  const edit = { newText: "HashMap", insert: r(4, 8, 4, 13), replace: r(4, 8, 4, 18) };
  assert.deepEqual(primaryOf({ label: "x", textEdit: edit }, "insert").range, r(4, 8, 4, 13));
  assert.deepEqual(primaryOf({ label: "x", textEdit: edit }, "replace").range, r(4, 8, 4, 18));
  assert.deepEqual(primaryOf({ label: "x", textEdit: { newText: "a", range: r(0, 0, 0, 1) } }, "replace").range, r(0, 0, 0, 1));
  assert.equal(primaryOf({ label: "x", insertText: "t" }, "insert"), null);
  assert.equal(primaryOf({ label: "x", textEdit: { newText: "a", range: { start: {} } } }, "insert"), null);
  assert.equal(primaryOf({ label: "x", insertTextFormat: 2, textEdit: { newText: "f($0)", range: r(0, 0, 0, 1) } }, "insert").snippet, true);
});

test("edits are one set or none: overlap, a shared insertion point and a stale line all reject", () => {
  const primary = r(4, 8, 4, 13);
  const use = { range: r(0, 0, 0, 0), newText: "use a;\n" };
  assert.deepEqual(validateEdits(primary, [use]), { ok: true });
  assert.deepEqual(validateEdits(primary, []), { ok: true });
  assert.equal(validateEdits(primary, [use, { range: r(0, 0, 0, 0), newText: "x" }]).ok, false, "two inserts at one point");
  assert.equal(validateEdits(primary, [{ range: r(0, 0, 2, 3), newText: "" }, { range: r(1, 0, 1, 2), newText: "" }]).ok, false, "overlapping ranges");
  assert.equal(validateEdits(primary, [{ range: r(4, 3, 4, 9), newText: "" }]).ok, false, "reaches the line being completed");
  assert.equal(validateEdits(primary, [{ range: r(4, 8, 4, 8), newText: "" }]).ok, false, "insert at the primary start");
  assert.equal(validateEdits(primary, [{ range: { start: {} }, newText: "" }]).ok, false, "malformed");
  assert.equal(validateEdits(primary, [{ range: r(0, 0, 0, 0), newText: 5 }]).ok, false);
  assert.equal(validateEdits(primary, [{ range: r(0, 0, 0, 3), newText: "" }, { range: r(0, 3, 0, 5), newText: "" }]).ok, true, "touching ranges do not overlap");
});

function map(result, over = {}) {
  const registered = [];
  const out = listToMonaco(result, { word, resolveProvider: true, mode: "insert", ownedCommand: "craidd.accept",
    register: (id, item) => { registered.push([id, item]); return id; }, ...over });
  return { ...out, registered };
}

test("a list maps with its incomplete flag; a bare array is complete", () => {
  assert.equal(map({ isIncomplete: true, items: [{ label: "a" }] }).incomplete, true);
  assert.equal(map({ isIncomplete: false, items: [{ label: "a" }] }).incomplete, false);
  assert.equal(map([{ label: "a" }]).incomplete, false);
  assert.deepEqual(map(null).suggestions, []);
  assert.deepEqual(map({}).suggestions, []);
  assert.equal(map({ items: [{ label: "" }, { label: "ok" }] }).suggestions.length, 1, "an item with no label is dropped");
});

test("an item that may gain edits gets the no-op prefix edit and the owned command; its range keeps filtering", () => {
  const { suggestions, registered } = map({ items: [{ label: "HashMap", kind: 22, data: { d: 1 }, filterText: "HashMap" }] });
  const s = suggestions[0];
  assert.equal(s.insertText, "HashM", "the typed prefix replaced by itself: no text change");
  assert.deepEqual(s.range, { startLineNumber: 5, startColumn: 9, endLineNumber: 5, endColumn: 14 });
  assert.equal(s.command.id, "craidd.accept");
  assert.equal(s.kind, 6);
  assert.deepEqual(registered[0][1].data, { d: 1 }, "the original server item, data untouched, is what resolve will receive");
});

test("a plain item uses its own edit and snippet flag; complete additional edits go to Monaco, overlapping ones drop the item", () => {
  const plain = map({ items: [{ label: "f", insertTextFormat: 2, textEdit: { newText: "f($0)", range: r(4, 8, 4, 13) } }] }, { resolveProvider: false }).suggestions[0];
  assert.equal(plain.insertText, "f($0)");
  assert.equal(plain.insertTextRules, 4);
  assert.equal(plain.command, undefined);
  const withEdits = map({ items: [{ label: "g", textEdit: { newText: "g", range: r(4, 8, 4, 13) }, additionalTextEdits: [{ range: r(0, 0, 0, 0), newText: "use g;\n" }] }] }).suggestions[0];
  assert.equal(withEdits.additionalTextEdits.length, 1);
  const bad = map({ items: [{ label: "h", textEdit: { newText: "h", range: r(4, 8, 4, 13) }, additionalTextEdits: [{ range: r(4, 9, 4, 12), newText: "" }] }] }).suggestions;
  assert.equal(bad.length, 0, "never degraded to the primary edit alone");
});

test("trigger characters are not in this module: nothing here names a language's characters", async () => {
  const { readFile } = await import("node:fs/promises");
  const text = await readFile(new URL("../src/lib/lsp/completion.ts", import.meta.url), "utf8");
  assert.doesNotMatch(text, /["'`]::["'`]|triggerCharacters *[:=] *\[/);
});

import { hasSeveralCursors, guardMultiCursor } from "../src/lib/lsp/completionAccept.ts";

test("with several cursors owned items are not offered at all; plain items still are", () => {
  const items = { items: [{ label: "Owned", data: { d: 1 } }, { label: "Plain", textEdit: { newText: "Plain", range: r(4, 8, 4, 13) } }] };
  const some = (allowOwned) => map(items, { allowOwned }).suggestions.map((s) => s.label);
  assert.deepEqual(some(true), ["Owned", "Plain"]);
  assert.deepEqual(some(false), ["Plain"], "the no-op prefix edit would be applied at every cursor, so no owned item is offered");
  assert.deepEqual(map(items).suggestions.map((s) => s.label), ["Owned", "Plain"], "the default offers them");
});

function fakeMonaco(editors) {
  const created = [];
  return { created, editor: { getEditors: () => editors, onDidCreateEditor: (fn) => { created.push(fn); return { dispose() {} }; } } };
}
const fakeEditor = (model, selections) => {
  const e = { model, selections, listeners: [], triggered: [],
    getModel: () => e.model, getSelections: () => e.selections,
    onDidChangeCursorSelection: (fn) => { e.listeners.push(fn); return { dispose() {} }; },
    trigger: (...args) => e.triggered.push(args) };
  return e;
};

test("hasSeveralCursors looks at every editor showing the model", () => {
  const model = {};
  assert.equal(hasSeveralCursors(fakeMonaco([fakeEditor(model, [1])]), model), false);
  assert.equal(hasSeveralCursors(fakeMonaco([fakeEditor(model, [1, 2])]), model), true);
  assert.equal(hasSeveralCursors(fakeMonaco([fakeEditor({}, [1, 2])]), model), false, "another model's cursors do not count");
  assert.equal(hasSeveralCursors(fakeMonaco([fakeEditor(model, [1]), fakeEditor(model, [1, 2, 3])]), model), true, "a split view counts too");
});

test("a second cursor added while one of our lists is open closes the suggest widget; otherwise nothing happens", () => {
  const model = {};
  const editor = fakeEditor(model, [1]);
  let open = true;
  guardMultiCursor(fakeMonaco([editor]), () => open);
  editor.listeners[0]();
  assert.deepEqual(editor.triggered, [], "one cursor: left alone");
  editor.selections = [1, 2];
  editor.listeners[0]();
  assert.deepEqual(editor.triggered, [["craidd", "hideSuggestWidget", {}]]);
  open = false;
  editor.listeners[0]();
  assert.equal(editor.triggered.length, 1, "no list of ours is open: Monaco's own completion is untouched");
  const m = fakeMonaco([]);
  guardMultiCursor(m, () => true);
  const late = fakeEditor(model, [1, 2]);
  m.created[0](late);
  late.listeners[0]();
  assert.equal(late.triggered.length, 1, "editors created later are watched too");
});
