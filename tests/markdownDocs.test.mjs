import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

async function load(name) {
  const source = await readFile(new URL(`../src/lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}
const { scanDocs, filterDocs, isMarkdown } = await load("docsDiscovery");
const { resolveDocumentLink } = await load("documentLinks");
const { rehypeDocumentBlocks, replaceMarkdownRange, formatMarkdownSelection } = await load("markdownPreview");
const file = (path) => ({ id: path, name: path.split("/").pop(), path, kind: "file" });
const folder = (path, children = []) => ({ ...file(path), kind: "folder", children });
const controller = () => new AbortController();

test("Docs discovers unopened folders, pins only root agents, prunes non-doc ancestors and filters by path", async () => {
  const listings = {
    "/lab": folder(".", [folder("docs"), file("README.md"), file("agent.md"), file("AGENTS.md"), folder("empty")]),
    "/lab/docs": folder("docs", [folder("docs/deep"), file("docs/logo.png"), file("docs/AGENT.md")]),
    "/lab/docs/deep": folder("docs/deep", [file("docs/deep/Guide.MARKDOWN")]),
    "/lab/empty": folder("empty", [file("empty/source.rs")]),
  };
  const visited = [];
  const { tree, warnings } = await scanDocs("/lab", async (path) => { visited.push(path); return listings[path]; }, controller().signal);
  assert.deepEqual(warnings, []);
  assert(visited.includes("/lab/docs/deep"));
  assert.deepEqual(tree.children.map((node) => node.path), ["agent.md", "AGENTS.md", "docs", "README.md"]);
  const filtered = filterDocs(tree, "DEEP/guide");
  assert.equal(filtered.children.length, 1);
  assert.equal(filtered.children[0].children[0].children[0].path, "docs/deep/Guide.MARKDOWN");
  assert(!isMarkdown("thing.md.png"));
});

test("Docs reports traversal limits and errors, and drops cancelled results", async () => {
  const { warnings } = await scanDocs("/lab", async () => folder(".", [file("a.md"), file("b.md")]), controller().signal, undefined, { entries: 1, depth: 1 });
  assert.match(warnings.join(""), /stopped/);
  const inaccessible = await scanDocs("/lab", async () => { throw new Error("Permission denied"); }, controller().signal);
  assert.match(inaccessible.warnings.join(""), /Permission denied/);
  const c = controller();
  await assert.rejects(scanDocs("/lab", async () => { c.abort(); return folder("."); }, c.signal), { name: "AbortError" });
  const deep = await scanDocs("/lab", async () => folder(".", [folder("deep")]), controller().signal, undefined, { entries: 10, depth: 0 });
  assert.match(deep.warnings.join(""), /Depth limit/);
});

test("local Markdown links resolve encoded paths and fragments within workspace boundaries", () => {
  assert.deepEqual(resolveDocumentLink("/lab/docs/start.md", "/lab", "../a%20b.MD#some-heading"), { kind: "local", path: "/lab/a b.MD", fragment: "some-heading" });
  assert.equal(resolveDocumentLink("/outside/doc.md", null, "#heading").path, "/outside/doc.md");
  for (const href of ["../../secret.md", "%2e%2e/%2e%2e/secret.md", "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "//remote/a.md", "a%00.md", "bad%XX.md", "a.md?query"]) {
    assert.throws(() => resolveDocumentLink("/lab/docs/start.md", "/lab", href), undefined, href);
  }
  assert.equal(resolveDocumentLink("/lab/a.md", "/lab", "https://example.com/a").kind, "external");
});

const sample = "# Héllo **world**\r\n\r\nA [reference][doc], ~~old~~ and `code`.\r\n\r\n- [ ] Todo\r\n  - Nested\r\n\r\n| A | B |\r\n|---|---|\r\n| 1 | 2 |\r\n\r\n```js\r\nconst n = 1;\r\n```\r\n\r\n[doc]: other.md#target\r\n\r\n<div onclick=\"bad()\">raw HTML</div>\r\n\r\n+++\r\nliteral plus signs\r\n+++\r\n";

test("GFM rendering handles full-document references, tables, tasks and highlighting while skipping HTML", () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, { skipHtml: true, remarkPlugins: [remarkGfm], rehypePlugins: [rehypeHighlight, rehypeDocumentBlocks] }, sample));
  assert.match(html, /<table>/);
  assert.match(html, /type="checkbox"/);
  assert.match(html, /href="other.md#target"/);
  assert.match(html, /hljs-keyword/);
  assert.match(html, /craidd-md-héllo-world/);
  assert(!html.includes("onclick"));
  assert(!html.includes("raw HTML"));
});

test("each rendered block maps to exact original offsets and editing preserves every untouched byte", () => {
  const ranges = [];
  const capture = () => (tree) => { rehypeDocumentBlocks()(tree); for (const node of tree.children) if (node.type === "element" && "data-md-start" in node.properties) ranges.push([node.properties["data-md-start"], node.properties["data-md-end"]]); };
  renderToStaticMarkup(React.createElement(Markdown, { skipHtml: true, remarkPlugins: [remarkGfm], rehypePlugins: [capture] }, sample));
  const [start, end] = ranges.find(([start]) => sample.slice(start).startsWith("A [reference]"));
  const edited = replaceMarkdownRange(sample, start, end, "Updated **paragraph**.", sample.slice(start, end));
  assert.equal(edited, sample.slice(0, start) + "Updated **paragraph**." + sample.slice(end));
  assert.match(edited, /\[doc\]: other.md#target\r\n/);
  assert.match(edited, /\+\+\+\r\nliteral plus signs\r\n\+\+\+/);
  assert.throws(() => replaceMarkdownRange(sample, start, end, "x", "stale source"));
});

test("duplicate and suffixed headings keep unique fragment identities", () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, { rehypePlugins: [rehypeDocumentBlocks] }, "# A\n\n# A\n\n# A-1\n\n# A\n"));
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, 4);
});


test("block formatting wraps selected text, toggles emphasis and selects a link destination", () => {
  assert.deepEqual(formatMarkdownSelection("some text", 0, 4, "bold"), { value: "**some** text", start: 2, end: 6 });
  assert.deepEqual(formatMarkdownSelection("**some** text", 2, 6, "bold"), { value: "some text", start: 0, end: 4 });
  assert.equal(formatMarkdownSelection("some", 0, 4, "italic").value, "*some*");
  assert.equal(formatMarkdownSelection("some", 0, 4, "code").value, "`some`");
  const linked = formatMarkdownSelection("some", 0, 4, "link");
  assert.equal(linked.value, "[some](https://example.com)");
  assert.equal(linked.value.slice(linked.start, linked.end), "https://example.com");
});


test("italic and bold shortcuts compose and toggle independently", () => {
  assert.equal(formatMarkdownSelection("**word**", 2, 6, "italic").value, "***word***");
  assert.equal(formatMarkdownSelection("***word***", 3, 7, "italic").value, "**word**");
  assert.equal(formatMarkdownSelection("***word***", 3, 7, "bold").value, "*word*");
  assert.equal(formatMarkdownSelection("*word*", 1, 5, "bold").value, "***word***");
  assert.equal(formatMarkdownSelection("**word**", 0, 8, "italic").value, "***word***");
});
