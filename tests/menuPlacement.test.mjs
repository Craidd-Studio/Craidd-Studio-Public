import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/menuPlacement.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { placeMenu } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("opens at the click point when it fits", () => {
  assert.deepEqual(placeMenu(100, 100, 200, 150, 1280, 800), { left: 100, top: 100, maxHeight: 792 });
});

test("flips left and up near the right and bottom edges", () => {
  const placed = placeMenu(1200, 750, 200, 150, 1280, 800);
  assert.equal(placed.left, 1000);
  assert.equal(placed.top, 600);
});

test("never leaves the viewport, even when taller than the space above", () => {
  const placed = placeMenu(50, 120, 250, 300, 280, 320);
  assert.ok(placed.left >= 4 && placed.left + 250 <= 280 - 4 + 1e-9, `left ${placed.left}`);
  assert.equal(placed.top, 4);
});
