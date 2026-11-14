import assert from "node:assert/strict";
import test from "node:test";
import { symbolsToMonaco } from "../src/lib/lsp/symbols.ts";

const r = (l1, c1, l2, c2) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });

test("hierarchical symbols keep their tree; ranges become Monaco's 1-based form; LSP kind maps to Monaco's by minus one", () => {
  const { symbols, dropped } = symbolsToMonaco([
    { name: "Foo", kind: 23, range: r(0, 0, 9, 1), selectionRange: r(0, 7, 0, 10), detail: "struct",
      children: [{ name: "x", kind: 8, range: r(1, 4, 1, 10), selectionRange: r(1, 4, 1, 5) }] },
    { name: "main", kind: 12, range: r(11, 0, 13, 1), selectionRange: r(11, 3, 11, 7), tags: [1] },
  ]);
  assert.equal(dropped, 0);
  assert.deepEqual(symbols.map((s) => [s.name, s.kind]), [["Foo", 22], ["main", 11]], "Struct=22 and Function=11 in Monaco");
  assert.equal(symbols[0].children[0].kind, 7);
  assert.deepEqual(symbols[0].selectionRange, { startLineNumber: 1, startColumn: 8, endLineNumber: 1, endColumn: 11 });
  assert.deepEqual(symbols[1].tags, [1]);
  assert.equal(symbols[0].detail, "struct");
});

test("flat SymbolInformation uses its location range and container name", () => {
  const { symbols } = symbolsToMonaco([{ name: "f", kind: 12, location: { uri: "file:///a.rs", range: r(2, 0, 2, 5) }, containerName: "m", deprecated: true }]);
  assert.equal(symbols[0].range.startLineNumber, 3);
  assert.equal(symbols[0].detail, "m");
  assert.deepEqual(symbols[0].tags, [1]);
});

test("malformed input shows nothing and never throws", () => {
  for (const bad of [null, undefined, 5, "x", {}, [null, 3, { name: 1 }, { name: "n" }, { name: "n", range: { start: {} } }]]) {
    assert.deepEqual(symbolsToMonaco(bad).symbols, [], JSON.stringify(bad));
  }
  assert.equal(symbolsToMonaco([{ name: "a", kind: 99, range: r(0, 0, 0, 1) }]).symbols[0].kind, 12, "an unknown kind is a plain variable");
});

test("the cap is visible: dropped nodes are counted, never silently lost", () => {
  const flat = Array.from({ length: 10 }, (_, i) => ({ name: `s${i}`, kind: 12, range: r(i, 0, i, 1) }));
  const out = symbolsToMonaco(flat, 4);
  assert.equal(out.symbols.length, 4);
  assert.equal(out.dropped, 6);
  const nested = symbolsToMonaco([{ name: "p", kind: 2, range: r(0, 0, 9, 0), children: flat.map((c) => ({ ...c })) }], 3);
  assert.equal(nested.symbols[0].children.length, 2);
  assert.equal(nested.dropped, 8);
});

test("a pathologically deep tree is bounded", () => {
  let node = { name: "leaf", kind: 12, range: r(0, 0, 0, 1) };
  for (let i = 0; i < 500; i++) node = { name: `n${i}`, kind: 12, range: r(0, 0, 0, 1), children: [node] };
  const { symbols, dropped } = symbolsToMonaco([node]);
  let depth = 0;
  for (let s = symbols[0]; s; s = s.children?.[0]) depth++;
  assert.ok(depth <= 65);
  assert.ok(dropped > 0);
});
