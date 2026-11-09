import assert from "node:assert/strict";
import test from "node:test";
import { fileUri } from "../src/lib/lsp/protocol.ts";
import { DocumentTracker } from "../src/lib/lsp/documents.ts";
import { PullScheduler, PULL_LIMITS } from "../src/lib/lsp/pulls.ts";

// A browser's queueMicrotask throws "Illegal invocation" when `this` is not the window.
// Node's does not, which is how the default scheduler slipped through the other tests.
const nativeQueueMicrotask = globalThis.queueMicrotask;
function withBrowserBrandCheck(run) {
  globalThis.queueMicrotask = function (callback) {
    if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
    return nativeQueueMicrotask(callback);
  };
  return run().finally(() => { globalThis.queueMicrotask = nativeQueueMicrotask; });
}

const F = "/ws/a.rs";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setup({ withPulls = false } = {}) {
  const calls = [];
  const view = (uri) => ({ uri, version: 1, epoch: 1, sync: { state: "synced" } });
  let slowChange = null;
  const transport = {
    async open(s, uri) { calls.push(["open"]); return view(uri); },
    async change(s, uri, e, changes) { calls.push(["change", changes.length]); if (slowChange) await slowChange; return view(uri); },
    async markDesynced(s, uri) { calls.push(["markDesynced"]); return { ...view(uri), epoch: 2, sync: { state: "desynced", reason: "x", changed: false } }; },
    async resync(s, uri) { calls.push(["resync"]); return { ...view(uri), epoch: 2 }; },
    async save(s, uri) { calls.push(["save"]); return view(uri); },
    async close() { calls.push(["close"]); },
  };
  const m = { text: "abc", version: 1, eol: "\n", getValue: () => m.text, getVersionId: () => m.version, getEOL: () => m.eol };
  let scheduler = null;
  // No schedule argument: the production default.
  const tracker = new DocumentTracker(transport, () => m,
    { opened() {}, edited: (f) => scheduler?.edited(f), resynced() {}, saved() {}, closed() {}, failed: (f, e) => calls.push(["failed", String(e)]) });
  tracker.bind(F, { session: 1, uri: fileUri(F), canonical: F, languageId: "rust", projectId: "p", projectName: "n", syncKind: "incremental" });
  await tracker.activate(F);
  if (withPulls) {
    const host = { openDocs: () => [F], visible: () => [F], recency: () => 1, uri: () => fileUri(F), stamp: () => ({ epoch: 1, versionId: m.version }),
      flush: (f) => tracker.flush(f), accept() {}, degraded() {} };
    const pullTransport = { async pull() { calls.push(["pull"]); return { kind: "report", report: { kind: "full", items: [] } }; }, async cancel() {} };
    scheduler = new PullScheduler(1, true, pullTransport, host, undefined, { ...PULL_LIMITS, debounceMs: 80, waveSpacingMs: 0 });
  }
  const type = (ch = "x") => {
    const at = m.text.length + 1;
    m.text += ch; m.version++;
    tracker.modelChanged(F, { changes: [{ range: { startLineNumber: 1, startColumn: at, endLineNumber: 1, endColumn: at }, text: ch }], isFlush: false, eol: "\n" });
  };
  return { tracker, calls, type, m, setSlowChange: (p) => { slowChange = p; } };
}

test("continuous typing with a pull scheduled sends one didChange per turn, not one at the end", () => withBrowserBrandCheck(async () => {
  const h = await setup({ withPulls: true });
  for (let i = 0; i < 6; i++) { h.type(); await sleep(15); }   // each key is its own task, well inside the pull debounce
  const changesBeforePull = h.calls.filter(([k]) => k === "change");
  assert.equal(changesBeforePull.length, 6, `six turns, six didChange (got ${JSON.stringify(h.calls)})`);
  assert.ok(changesBeforePull.every(([, n]) => n === 1), "one change each, not one batch of everything");
  assert.equal(h.calls.some(([k]) => k === "pull"), false, "the pull is still debounced: the changes did not wait for it");
  assert.equal(h.calls.some(([k]) => k === "failed"), false);
  await sleep(150);
  assert.equal(h.calls.filter(([k]) => k === "pull").length, 1);
}));

test("changes in one turn are still one didChange (batching within a turn is kept)", () => withBrowserBrandCheck(async () => {
  const h = await setup();
  h.type("a"); h.type("b"); h.type("c");
  await sleep(5);
  assert.deepEqual(h.calls.filter(([k]) => k === "change"), [["change", 3]]);
}));

test("didChange stays ahead of a dependent save and pull; close supersedes queued edits", () => withBrowserBrandCheck(async () => {
  for (const [name, act, expected] of [
    ["save", (h) => h.tracker.saved(F), ["change", "save"]],
    ["close", (h) => h.tracker.close(F), ["close"]],   // queued edits are superseded by didClose (documents.ts close)
  ]) {
    const h = await setup();
    h.type("q");
    await act(h);
    assert.deepEqual(h.calls.slice(1).map(([k]) => k), expected, name);
  }
  const h = await setup({ withPulls: true });
  h.type("q");
  await sleep(150);
  assert.deepEqual(h.calls.slice(1).map(([k]) => k), ["change", "pull"], "the pull's flush finds nothing left to send: change first, then pull");
}));

test("a failing scheduler cannot wedge the document: the next edit schedules again", async () => {
  const h = await setup();
  const real = h.tracker.schedule;
  let fail = true;
  h.tracker.schedule = (run) => { if (fail) { fail = false; throw new TypeError("Illegal invocation"); } return real.call(h.tracker, run); };
  assert.throws(() => h.type("a"), /Illegal invocation/);
  h.type("b");
  await sleep(5);
  assert.equal(h.calls.filter(([k]) => k === "change").length, 1, "the second edit flushed the queue (both changes in one didChange)");
  assert.equal(h.calls.find(([k]) => k === "change")[1], 2);
});
