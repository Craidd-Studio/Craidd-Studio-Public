import assert from "node:assert/strict";
import test from "node:test";
import { contentChanges, fileUri, textHash, toLspPosition, toMonacoRange, uriToPath } from "../src/lib/lsp/protocol.ts";
import { DocumentTracker } from "../src/lib/lsp/documents.ts";

test("paths and URIs round-trip with the backend's encoding", () => {
  assert.equal(fileUri("/home/a b/λ.rs"), "file:///home/a%20b/%CE%BB.rs");
  for (const path of ["/home/a b/λ.rs", "/x/%41/😀.rs", "/plain/src/main.rs"]) assert.equal(uriToPath(fileUri(path)), path);
});

test("positions map 1-based UTF-16 to 0-based UTF-16, including after non-BMP characters", () => {
  // "a😀b": b is at Monaco column 4 (😀 is two UTF-16 units) and LSP character 3.
  assert.deepEqual(toLspPosition(1, 4), { line: 0, character: 3 });
  assert.deepEqual(toMonacoRange({ start: { line: 2, character: 0 }, end: { line: 2, character: 5 } }),
    { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 6 });
  // A combining character is its own UTF-16 unit; no normalisation happens.
  assert.deepEqual(contentChanges([{ range: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 3 }, text: "́" }]),
    [{ range: { start: { line: 0, character: 2 }, end: { line: 0, character: 2 } }, text: "́" }]);
  assert.notEqual(textHash("ab"), textHash("ba"));
});

/** A scripted backend that rebuilds the server's text from what it was sent. */
function harness({ room = Infinity, syncKind = "incremental" } = {}) {
  const calls = [];
  const server = new Map();
  const state = { room, epoch: new Map(), desynced: new Set() };
  const models = new Map();
  const view = (uri, sync = { state: "synced" }) => ({ uri, version: 1, epoch: state.epoch.get(uri) ?? 1, sync });
  const apply = (uri, change) => {
    if (!("range" in change)) { server.set(uri, change.text); return; }
    const lines = server.get(uri).split("\n");
    const offset = ({ line, character }) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + character;
    const text = server.get(uri);
    server.set(uri, text.slice(0, offset(change.range.start)) + change.text + text.slice(offset(change.range.end)));
  };
  const transport = {
    async open(session, uri, languageId, text) { calls.push(["open", uri]); server.set(uri, text); state.epoch.set(uri, 1); return view(uri); },
    async change(session, uri, epoch, changes) {
      calls.push(["change", uri, changes.length]);
      if (state.desynced.has(uri)) return view(uri, { state: "desynced", reason: "x", changed: true });
      if (state.room <= 0) { state.desynced.add(uri); state.epoch.set(uri, epoch + 1); return view(uri, { state: "desynced", reason: "full", changed: false }); }
      state.room--;
      for (const change of changes) apply(uri, change);
      return view(uri);
    },
    async markDesynced(session, uri) { calls.push(["markDesynced", uri]); state.desynced.add(uri); state.epoch.set(uri, (state.epoch.get(uri) ?? 1) + 1); return view(uri, { state: "desynced", reason: "x", changed: false }); },
    async resync(session, uri, text) {
      calls.push(["resync", uri]);
      if (state.room < 2) return view(uri, { state: "desynced", reason: "x", changed: true });
      state.room -= 2; state.desynced.delete(uri); server.set(uri, text); return view(uri);
    },
    async save(session, uri) { calls.push(["save", uri]); return view(uri); },
    async close(session, uri) { calls.push(["close", uri]); server.delete(uri); },
  };
  const events = { opened: [], edited: [], resynced: [], saved: [], closed: [], failed: [] };
  const sink = Object.fromEntries(Object.keys(events).map((k) => [k, (fileId) => events[k].push(fileId)]));
  const tracker = new DocumentTracker(transport, (fileId) => models.get(fileId) ?? null, sink, (run) => queueMicrotask(run));
  const model = (fileId, text) => {
    const m = { text, version: 1, eol: "\n", getValue: () => m.text, getVersionId: () => m.version, getEOL: () => m.eol };
    models.set(fileId, m);
    return m;
  };
  const edit = (fileId, startColumn, endColumn, text) => {
    const m = models.get(fileId);
    m.text = m.text.slice(0, startColumn - 1) + text + m.text.slice(endColumn - 1);
    m.version++;
    tracker.modelChanged(fileId, { changes: [{ range: { startLineNumber: 1, startColumn, endLineNumber: 1, endColumn }, text }], isFlush: false, eol: m.eol });
  };
  const binding = (fileId, session = 1, canonical = fileId) =>
    ({ session, uri: fileUri(fileId), canonical, languageId: "rust", projectId: "p", projectName: "app", syncKind });
  return { tracker, calls, server, state, models, model, edit, binding, events };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("restored tabs stay Pending; activation opens once; tab switches send nothing", async () => {
  const h = harness();
  h.model("/ws/a.rs", "fn a() {}");
  h.model("/ws/b.rs", "fn b() {}");
  h.tracker.bind("/ws/a.rs", h.binding("/ws/a.rs"));
  h.tracker.bind("/ws/b.rs", h.binding("/ws/b.rs"));
  assert.equal(h.tracker.state("/ws/b.rs"), "pending");
  await h.tracker.activate("/ws/a.rs");
  await h.tracker.activate("/ws/b.rs");
  await h.tracker.activate("/ws/a.rs");
  assert.deepEqual(h.calls.map(([kind]) => kind), ["open", "open"], "re-activation of an open document sends nothing");
  assert.equal(h.tracker.state("/ws/a.rs"), "open");
});

test("changes in one turn batch into one didChange, in order, and flush before save and close", async () => {
  const h = harness();
  h.model("/ws/a.rs", "abc");
  h.tracker.bind("/ws/a.rs", h.binding("/ws/a.rs"));
  await h.tracker.activate("/ws/a.rs");
  h.edit("/ws/a.rs", 4, 4, "d");
  h.edit("/ws/a.rs", 5, 5, "😀");
  h.edit("/ws/a.rs", 1, 2, "");
  await h.tracker.saved("/ws/a.rs");
  assert.deepEqual(h.calls.slice(1), [["change", fileUri("/ws/a.rs"), 3], ["save", fileUri("/ws/a.rs")]]);
  assert.equal(h.server.get(fileUri("/ws/a.rs")), "bcd😀");
  h.edit("/ws/a.rs", 1, 1, "x");
  await h.tracker.close("/ws/a.rs");
  assert.deepEqual(h.calls.at(-1), ["close", fileUri("/ws/a.rs")]);
  assert.equal(h.calls.filter(([kind]) => kind === "close").length, 1, "one didClose");
});

test("a writer overflow desyncs, edits are not queued, and the resync carries the model text exactly once", async () => {
  const h = harness({ room: 1 });
  h.model("/ws/a.rs", "a");
  h.tracker.bind("/ws/a.rs", h.binding("/ws/a.rs"));
  await h.tracker.activate("/ws/a.rs");
  h.edit("/ws/a.rs", 2, 2, "b");
  await h.tracker.flush("/ws/a.rs");
  h.edit("/ws/a.rs", 3, 3, "c");
  await h.tracker.flush("/ws/a.rs");
  assert.equal(h.tracker.state("/ws/a.rs"), "desynced");
  h.edit("/ws/a.rs", 4, 4, "d");
  await h.tracker.flush("/ws/a.rs");
  assert.equal(h.calls.filter(([kind]) => kind === "change").length, 2, "nothing is sent while desynced");
  await h.tracker.retryResyncs("/ws/a.rs");
  assert.equal(h.tracker.state("/ws/a.rs"), "desynced", "the pair was not admitted");
  h.state.room = 2;
  await h.tracker.retryResyncs("/ws/a.rs");
  assert.equal(h.tracker.state("/ws/a.rs"), "open");
  assert.equal(h.server.get(fileUri("/ws/a.rs")), "abcd");
  assert.deepEqual(h.events.resynced, ["/ws/a.rs"]);
});

test("model disposal suspends; an identical resume sends nothing; a different one resyncs", async () => {
  const h = harness();
  h.model("/ws/a.rs", "same");
  h.tracker.bind("/ws/a.rs", h.binding("/ws/a.rs"));
  await h.tracker.activate("/ws/a.rs");
  h.edit("/ws/a.rs", 5, 5, "!");
  h.tracker.modelWillDispose("/ws/a.rs");
  assert.equal(h.tracker.state("/ws/a.rs"), "suspended");
  await h.tracker.flush("/ws/a.rs");
  assert.equal(h.server.get(fileUri("/ws/a.rs")), "same!", "edits made before disposal are still sent");
  h.tracker.modelCreated("/ws/a.rs");
  await settle();
  assert.equal(h.tracker.state("/ws/a.rs"), "open");
  const sent = h.calls.length;
  h.tracker.modelWillDispose("/ws/a.rs");
  h.models.get("/ws/a.rs").text = "reloaded from disk";
  h.tracker.modelCreated("/ws/a.rs");
  await settle(); await settle();
  assert.deepEqual(h.calls.slice(sent).map(([kind]) => kind), ["markDesynced", "resync"]);
  assert.equal(h.server.get(fileUri("/ws/a.rs")), "reloaded from disk");
});

test("an EOL change is a full resync; a model with no tab is never registered", async () => {
  const h = harness();
  h.model("/ws/a.rs", "a\nb");
  h.tracker.bind("/ws/a.rs", h.binding("/ws/a.rs"));
  await h.tracker.activate("/ws/a.rs");
  h.models.get("/ws/a.rs").eol = "\r\n";
  h.models.get("/ws/a.rs").text = "a\r\nb";
  h.tracker.modelChanged("/ws/a.rs", { changes: [], isFlush: false, eol: "\r\n" });
  await settle(); await settle();
  assert.deepEqual(h.calls.slice(1).map(([kind]) => kind), ["markDesynced", "resync"]);
  h.model("/tmp/diff", "x");
  h.tracker.modelChanged("/tmp/diff", { changes: [], isFlush: false, eol: "\n" });
  await h.tracker.activate("/tmp/diff");
  assert.equal(h.calls.filter(([, uri]) => uri === fileUri("/tmp/diff")).length, 0);
});

test("alias tabs: one registration per filesystem identity, promotion on holder close", async () => {
  const h = harness();
  h.model("/ws/vendor/lib.rs", "x");
  h.model("/ws/link/lib.rs", "x");
  h.tracker.bind("/ws/vendor/lib.rs", h.binding("/ws/vendor/lib.rs", 1, "/real/lib.rs"));
  h.tracker.bind("/ws/link/lib.rs", h.binding("/ws/link/lib.rs", 1, "/real/lib.rs"));
  await h.tracker.activate("/ws/vendor/lib.rs");
  await h.tracker.activate("/ws/link/lib.rs");
  assert.equal(h.tracker.state("/ws/link/lib.rs"), "alias");
  assert.equal(h.tracker.aliasOf("/ws/link/lib.rs"), "/ws/vendor/lib.rs");
  h.edit("/ws/link/lib.rs", 1, 1, "y");
  await settle();
  assert.equal(h.calls.filter(([kind]) => kind === "open").length, 1);
  assert.equal(h.calls.filter(([kind]) => kind === "change").length, 0, "aliases never send text");
  await h.tracker.close("/ws/vendor/lib.rs");
  assert.equal(h.tracker.state("/ws/link/lib.rs"), "pending", "the alias is promoted");
  await h.tracker.activate("/ws/link/lib.rs");
  assert.equal(h.tracker.state("/ws/link/lib.rs"), "open");
});

test("session end returns documents to Pending without sending anything", async () => {
  const h = harness();
  h.model("/ws/a.rs", "a");
  h.tracker.bind("/ws/a.rs", h.binding("/ws/a.rs"));
  await h.tracker.activate("/ws/a.rs");
  assert.deepEqual(h.tracker.sessionEnded(1), ["/ws/a.rs"]);
  assert.equal(h.tracker.state("/ws/a.rs"), "pending");
  assert.equal(h.tracker.binding("/ws/a.rs"), null);
  await h.tracker.close("/ws/a.rs");
  assert.equal(h.calls.filter(([kind]) => kind === "close").length, 0);
});

test("symlinked-vendor cases (b)-(d): a symlink tab and its owned file are one registration; the alias is read-only in effect and promoted when the holder closes", async () => {
  const h = harness();
  const real = "/ws/app/real_mods/deep.rs", link = "/ws/app/linked/deep.rs";
  h.model(real, "fn a() {}"); h.model(link, "fn a() {}");
  // Both bound to one filesystem identity (the attach step canonicalised the symlink path to the real one).
  h.tracker.bind(real, h.binding(real, 1, real));
  h.tracker.bind(link, { ...h.binding(link, 1, real), uri: fileUri(real) });
  await h.tracker.activate(real);
  await h.tracker.activate(link);
  assert.equal(h.tracker.state(real), "open");
  assert.equal(h.tracker.state(link), "alias");
  assert.equal(h.tracker.aliasOf(link), real, "the note reads 'Also open as' the holder");
  assert.deepEqual(h.calls.filter(([kind]) => kind === "open").length, 1, "one registration: the alias sends no didOpen");
  assert.equal(h.tracker.holderTab(real), real, "navigation to either spelling focuses the holder");
  // Edits in the alias are never sent (the server never sees two models of one file).
  h.edit(link, 1, 1, "x");
  await settle();
  assert.equal(h.calls.filter(([kind]) => kind === "change").length, 0);
  // When the holder closes, the alias is promoted to Pending and can register.
  await h.tracker.close(real);
  assert.equal(h.tracker.state(link), "pending");
  await h.tracker.activate(link);
  assert.equal(h.tracker.state(link), "open");
  assert.equal(h.tracker.holderTab(real), link, "the promoted tab now holds it");
  // (c) the reverse order: the symlink tab first holds it; the owned tab opened later is the alias, per 'earlier-activated holds'.
  const g = harness();
  g.model(real, "x"); g.model(link, "x");
  g.tracker.bind(link, { ...g.binding(link, 1, real), uri: fileUri(real) });
  g.tracker.bind(real, g.binding(real, 1, real));
  await g.tracker.activate(link);
  await g.tracker.activate(real);
  assert.equal(g.tracker.state(link), "open");
  assert.equal(g.tracker.state(real), "alias");
  assert.equal(g.tracker.holderTab(real), link);
});
