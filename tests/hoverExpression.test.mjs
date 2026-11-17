import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/hoverExpression.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
const { expressionAt } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

const at = (line, word) => expressionAt(line, line.indexOf(word) + 1)?.expression ?? null;

test("a plain identifier", () => {
  assert.equal(at("int marker = number * 10;", "marker"), "marker");
  assert.equal(at("int marker = number * 10;", "number"), "number");
});

test("member access chains up to the hovered name", () => {
  assert.equal(at("var x = item.Value.Count;", "Value"), "item.Value");
  assert.equal(at("var x = item.Value.Count;", "Count"), "item.Value.Count");
  assert.equal(at("node->next->value", "value"), "node->next->value");
  assert.equal(at("let s = self.items.len();", "items"), "self.items");
});

test("operators, literals and whitespace are not evaluated", () => {
  assert.equal(expressionAt("a + b", 2), null);
  assert.equal(at("sleep(400);", "400"), null);
});

test("the range covers the whole expression (1-based, end exclusive)", () => {
  assert.deepEqual(expressionAt("x = item.Value;", 10), { expression: "item.Value", start: 5, end: 15 });
});
