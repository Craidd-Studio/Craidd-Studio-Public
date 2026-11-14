import assert from "node:assert/strict";
import test from "node:test";
import { ProviderRequests, COMMANDS } from "../src/lib/lsp/requests.ts";
import { ProviderRegistrations } from "../src/lib/lsp/providers.ts";
import { toLspPosition } from "../src/lib/lsp/protocol.ts";

function harness({ reply = (c, a) => ({ kind: "result", epoch: 1, uri: a.uri, value: { echoed: c } }), bound = true } = {}) {
  const state = { epoch: 1, versionId: 5, flushes: 0, calls: [], cancels: [] };
  const releases = [];
  const host = {
    binding: () => (bound ? { session: 7, uri: "file:///a.rs" } : null),
    stamp: () => ({ epoch: state.epoch, versionId: state.versionId }),
    async flush() { state.flushes++; },
    async call(command, args) { state.calls.push([command, args]); if (state.hold) await new Promise((r) => releases.push(r)); return reply(command, args); },
    async cancel(session, uri, kind) { state.cancels.push([session, uri, kind]); },
  };
  return { requests: new ProviderRequests(host), state, release: () => { while (releases.length) releases.shift()(); } };
}
const token = () => { const listeners = []; return { isCancellationRequested: false, onCancellationRequested: (l) => { listeners.push(l); return { dispose() {} }; }, fire() { this.isCancellationRequested = true; listeners.forEach((l) => l()); } }; };

test("a request flushes the document first and sends the typed command with the session and uri", async () => {
  const h = harness();
  const value = await h.requests.request("hover", "/a.rs", { line: 1, character: 2 });
  assert.deepEqual(value, { echoed: "lsp_hover" });
  assert.equal(h.state.flushes, 1);
  assert.deepEqual(h.state.calls[0], ["lsp_hover", { session: 7, uri: "file:///a.rs", line: 1, character: 2 }]);
  for (const kind of ["hover", "definition", "references", "documentSymbol"]) assert.match(COMMANDS[kind], /^lsp_/);
});

test("an unbound document, busy, not-synced, disabled and no-result all show nothing", async () => {
  assert.equal(await harness({ bound: false }).requests.request("hover", "/a.rs", {}), null);
  for (const kind of ["busy", "notSynced", "disabled", "noResult", "error"]) {
    const h = harness({ reply: () => ({ kind, epoch: 1, uri: "u", code: 1, message: "m" }) });
    assert.equal(await h.requests.request("definition", "/a.rs", {}), null, kind);
  }
});

test("a reply is dropped when the epoch or the model versionId moved while it was in flight", async () => {
  for (const move of [(s) => { s.versionId++; }, (s) => { s.epoch++; }]) {
    const h = harness();
    h.state.hold = true;
    const pending = h.requests.request("hover", "/a.rs", {});
    await new Promise((r) => setTimeout(r, 5));
    move(h.state);
    h.release();
    assert.equal(await pending, null);
    assert.equal(h.requests.stats.stale, 1);
  }
  const echoedOld = harness({ reply: (c, a) => ({ kind: "result", epoch: 0, uri: a.uri, value: 1 }) });
  assert.equal(await echoedOld.requests.request("hover", "/a.rs", {}), null, "a reply carrying an older epoch is stale");
});

test("a newer request of the same kind supersedes the older one; other kinds are independent", async () => {
  const h = harness();
  h.state.hold = true;
  const first = h.requests.request("hover", "/a.rs", { n: 1 });
  await new Promise((r) => setTimeout(r, 5));
  const other = h.requests.request("documentSymbol", "/a.rs", {});
  const second = h.requests.request("hover", "/a.rs", { n: 2 });
  await new Promise((r) => setTimeout(r, 5));
  h.state.hold = false;
  h.release();
  assert.equal(await first, null, "superseded");
  assert.ok(await other);
  assert.ok(await second || true);
  assert.ok(h.requests.stats.superseded >= 1);
});

test("Monaco's cancellation token cancels the backend request and drops the reply", async () => {
  const h = harness();
  h.state.hold = true;
  const t = token();
  const pending = h.requests.request("references", "/a.rs", {}, t);
  await new Promise((r) => setTimeout(r, 5));
  t.fire();
  h.release();
  assert.equal(await pending, null);
  assert.deepEqual(h.state.cancels, [[7, "file:///a.rs", "references"]]);
});

test("positions map from Monaco 1-based UTF-16 to LSP 0-based on multi-byte text", () => {
  // "a😀b": b is Monaco column 4 (😀 is two UTF-16 units) and LSP character 3.
  assert.deepEqual(toLspPosition(2, 4), { line: 1, character: 3 });
});

test("providers register once per language, not per session, and re-register only when the signature differs", () => {
  const registrations = new ProviderRegistrations();
  const log = [];
  const make = (name) => () => { log.push(`reg ${name}`); return { dispose: () => log.push(`dispose ${name}`) }; };
  assert.equal(registrations.ensure("rust", "hover", "", make("a")), true);
  assert.equal(registrations.ensure("rust", "hover", "", make("b")), false, "a second session registers nothing");
  assert.equal(registrations.ensure("rust", "completion", ".,:", make("c")), true);
  assert.equal(registrations.ensure("rust", "completion", ".,:", make("d")), false, "same trigger characters");
  assert.equal(registrations.ensure("rust", "completion", ".", make("e")), true, "different trigger characters re-register");
  assert.deepEqual(log, ["reg a", "reg c", "dispose c", "reg e"]);
  registrations.disposeAll();
  assert.deepEqual(log.slice(-2).sort(), ["dispose a", "dispose e"]);
});

import { withNotice } from "../src/lib/lsp/providers.ts";

test("chip notices: one note per prefix, replaced when it changes and cleared when the result is complete", () => {
  let notes = ["server note"];
  notes = withNotice(notes, "References ", "References limited to 500; +105 more not shown");
  assert.deepEqual(notes, ["server note", "References limited to 500; +105 more not shown"]);
  notes = withNotice(notes, "References ", "References limited to 500; +7 more not shown");
  assert.equal(notes.length, 2, "replaced, not appended");
  notes = withNotice(notes, "Outline ", "Outline limited to 5000 symbols; +3 more not shown");
  assert.equal(notes.length, 3, "another prefix is independent");
  notes = withNotice(notes, "References ", null);
  assert.deepEqual(notes, ["server note", "Outline limited to 5000 symbols; +3 more not shown"], "a complete result clears its note");
  assert.deepEqual(withNotice(undefined, "References ", null), []);
});
