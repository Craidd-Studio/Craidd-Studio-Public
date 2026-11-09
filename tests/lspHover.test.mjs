import assert from "node:assert/strict";
import test from "node:test";
import { hoverToMonaco, neutraliseCommandLinks, escapeMarkdown } from "../src/lib/lsp/hover.ts";

const range = { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } };

test("markdown, plaintext, marked strings and arrays all map; the range moves to Monaco's 1-based form", () => {
  const md = hoverToMonaco({ contents: { kind: "markdown", value: "```rust\nfn f()\n```" }, range });
  assert.deepEqual(md.range, { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 });
  assert.equal(md.contents[0].value, "```rust\nfn f()\n```");
  assert.equal(hoverToMonaco({ contents: "plain marked string" }).contents[0].value, "plain marked string");
  assert.match(hoverToMonaco({ contents: { language: "rust", value: "let x = 1;" } }).contents[0].value, /^```rust\nlet x = 1;\n```$/);
  const many = hoverToMonaco({ contents: ["a", { language: "rust", value: "b" }, { kind: "markdown", value: "c" }] });
  assert.equal(many.contents.length, 3);
});

test("nothing shows for null, empty and malformed results", () => {
  for (const bad of [null, undefined, 3, "x", {}, { contents: "" }, { contents: [] }, { contents: [null, "  "] }, { contents: { language: 1, value: 2 } }]) {
    assert.equal(hoverToMonaco(bad), null, JSON.stringify(bad));
  }
  assert.equal(hoverToMonaco({ contents: "x", range: { start: {}, end: {} } }).range, undefined, "a malformed range is dropped, the text stays");
});

test("every string is untrusted: no command links, no HTML support, whatever the server sends", () => {
  const hostile = "[run](command:workbench.action.reloadWindow) and [also]( COMMAND:x?%5B1%5D ) <a href='command:evil'>x</a> [ok](https://example.com)";
  const out = hoverToMonaco({ contents: [hostile, { kind: "markdown", value: hostile }] });
  for (const item of out.contents) {
    assert.equal(item.isTrusted, false);
    assert.equal(item.supportHtml, false);
    assert.doesNotMatch(item.value, /command:/i);
    assert.match(item.value, /\[ok\]\(https:\/\/example\.com\)/, "ordinary links are untouched");
  }
  assert.equal(neutraliseCommandLinks("[a](command:x)"), "a");
});

test("plaintext is shown literally: Markdown characters are escaped, line breaks kept", () => {
  const out = hoverToMonaco({ contents: { kind: "plaintext", value: "*bold* <b>x</b> [l](command:y)\nnext" } });
  assert.doesNotMatch(out.contents[0].value, /(^|[^\\])\*bold/);
  assert.match(out.contents[0].value, /\\<b\\>/);
  assert.match(out.contents[0].value, /  \nnext$/);
  assert.equal(escapeMarkdown("a_b"), "a\\_b");
});

test("a code fence grows past any backtick run inside the code", () => {
  const out = hoverToMonaco({ contents: { language: "rust", value: "let s = \"```\";" } });
  assert.match(out.contents[0].value, /^````rust\n/);
});

test("reference-style links, autolinks and bare command URIs are dropped as well", () => {
  const text = "see [x][1] and <command:evil.run> and command:bare.thing and [y][z]\n\n[1]: command:workbench.action.reload\n[z]: <command:other>\n[ok]: https://example.com";
  const out = neutraliseCommandLinks(text);
  assert.doesNotMatch(out, /command:/i);
  assert.match(out, /\[ok\]: https:\/\/example\.com/);
  assert.match(out, /see \[x\]\[1\]/, "the text around them stays");
  const hover = hoverToMonaco({ contents: { kind: "markdown", value: text } });
  assert.doesNotMatch(hover.contents[0].value, /command:/i);
});
