import assert from "node:assert/strict";
import test from "node:test";
import { createMetrics } from "../src/lib/lsp/metrics.ts";
import { DocumentTracker } from "../src/lib/lsp/documents.ts";
import { PullScheduler } from "../src/lib/lsp/pulls.ts";
import { DiagnosticsModel } from "../src/lib/lsp/diagnostics.ts";
import { fileUri } from "../src/lib/lsp/protocol.ts";

function scriptedHost() {
  const page = { t: 0, frames: [], keys: [], ticks: [], exposed: null };
  return {
    page,
    factory: () => ({
      now: () => page.t,
      frame: (run) => page.frames.push(run),
      onKey: (run) => page.keys.push(run),
      every: (ms, run) => page.ticks.push(run),
      expose: (snapshot) => { page.exposed = snapshot; },
    }),
    frameAt(t) { page.t = t; const runs = page.frames.splice(0); for (const run of runs) run(t); },
    key(t) { page.t = t; for (const run of page.keys) run(); },
    tick() { for (const run of page.ticks) run(); },
  };
}

test("inputToPaint is measured to the second frame after the key press (the visible paint)", () => {
  const host = scriptedHost();
  const metrics = createMetrics(true, host.factory);
  const lines = [];
  metrics.install((line) => lines.push(line), () => ({ pullNeeded: 0 }));
  host.frameAt(0);
  host.key(100);
  host.frameAt(108);
  assert.equal(metrics.snapshot().inputToPaint.count, 0, "the first frame callback runs before the paint");
  host.frameAt(124);
  assert.deepEqual(metrics.snapshot().inputToPaint, { max: 24, p95: 24, count: 1 });
  host.tick();
  assert.ok(lines.every((line) => line.startsWith("[lsp:metrics] ")));
  const last = JSON.parse(lines.at(-1).slice("[lsp:metrics] ".length));
  for (const field of ["channelMessages", "storeWrites", "frameWrites", "markerCalls", "stored", "arrivals", "lastArrivalMs", "pullNeeded", "frameGap", "inputToPaint", "channelRatePerS"]) {
    assert.ok(field in last, field);
  }
});

test("in a production build the hooks are inert: nothing is installed or exposed", () => {
  let created = 0;
  const metrics = createMetrics(false, () => { created++; return scriptedHost().factory(); });
  const lines = [];
  for (const hook of ["channelMessage", "frameWrite", "markerCall", "startupInteractive", "launchScheduled"]) assert.equal(metrics[hook](), undefined);
  metrics.arrival("push"); metrics.storeWrite("pull"); metrics.stored(1, 2); metrics.pullReport("full"); metrics.launched("idle");
  metrics.install((line) => lines.push(line), () => ({}));
  assert.equal(created, 0, "no listeners, frames or timers");
  assert.deepEqual(lines, []);
  assert.equal(metrics.snapshot(), null);
});

/** The same scripted session, instrumented the way the bridge instruments it. */
async function run(dev) {
  const metrics = createMetrics(dev, scriptedHost().factory);
  metrics.install(() => {}, () => ({}));
  const wire = [];
  const transport = {
    async open(s, uri, l, text) { metrics.channelMessage(); wire.push(["open", uri, text]); return { uri, version: 1, epoch: 1, sync: { state: "synced" } }; },
    async change(s, uri, epoch, changes) { wire.push(["change", uri, JSON.stringify(changes)]); return { uri, version: 2, epoch, sync: { state: "synced" } }; },
    async markDesynced() { throw new Error("unused"); }, async resync() { throw new Error("unused"); },
    async save(s, uri) { wire.push(["save", uri]); return { uri, version: 2, epoch: 1, sync: { state: "synced" } }; },
    async close(s, uri) { wire.push(["close", uri]); },
  };
  const text = { value: "fn main() {}", version: 1 };
  const model = { getValue: () => text.value, getVersionId: () => text.version, getEOL: () => "\n" };
  const store = new DiagnosticsModel();
  let scheduler;
  const tracker = new DocumentTracker(transport, () => model, {
    opened: (f) => scheduler.opened(f), edited: (f) => scheduler.edited(f), resynced() {}, saved: (f) => scheduler.saved(f), closed() {}, failed() {},
  }, (flush) => queueMicrotask(flush));
  const uri = fileUri("/ws/src/main.rs");
  const timers = { now: () => 0, set: (fn) => { queueMicrotask(fn); return 1; }, clear() {} };
  scheduler = new PullScheduler(1, true, {
    async pull(s, u, prev) { wire.push(["pull", u, prev]); return { kind: "report", report: { kind: "full", resultId: "rust-analyzer", items: [{ message: "E0061", range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }] } }; },
    async cancel(s, u) { wire.push(["cancel", u]); },
  }, {
    openDocs: () => (tracker.state("/ws/src/main.rs") === "open" ? ["/ws/src/main.rs"] : []), visible: () => ["/ws/src/main.rs"], recency: () => 1,
    uri: () => uri, stamp: () => ({ epoch: tracker.epoch("/ws/src/main.rs"), versionId: text.version }), flush: (f) => tracker.flush(f),
    accept: (f, report) => { metrics.pullReport(report.kind); metrics.arrival("pull"); if (store.apply(1, uri, "pull", report.items, () => true)) { metrics.storeWrite("pull"); metrics.frameWrite(); metrics.markerCall(); } },
    degraded() {},
  }, timers, { debounceMs: 0, concurrency: 2, perWave: 12, waveSpacingMs: 0, focusIntervalMs: 0, retriggerMax: 3, failureMax: 5 });
  tracker.bind("/ws/src/main.rs", { session: 1, uri, canonical: "/ws/src/main.rs", languageId: "rust", projectId: "p", projectName: "app", syncKind: "incremental" });
  await tracker.activate("/ws/src/main.rs");
  for (let i = 0; i < 3; i++) {
    text.value += " "; text.version++;
    tracker.modelChanged("/ws/src/main.rs", { changes: [{ range: { startLineNumber: 1, startColumn: 13 + i, endLineNumber: 1, endColumn: 13 + i }, text: " " }], isFlush: false, eol: "\n" });
    for (let n = 0; n < 20; n++) await new Promise((r) => setTimeout(r, 0));
  }
  await tracker.saved("/ws/src/main.rs");
  for (let n = 0; n < 20; n++) await new Promise((r) => setTimeout(r, 0));
  await tracker.close("/ws/src/main.rs");
  return { wire, stored: store.problems(() => null).map((p) => p.message), stats: { ...scheduler.stats, seeds: { ...scheduler.stats.seeds } } };
}

test("metrics on and off produce identical wire traffic and outcomes", async () => {
  const off = await run(false);
  const on = await run(true);
  assert.ok(off.wire.length > 5, "the scenario exercised open, changes, pulls, save and close");
  assert.deepEqual(on.wire, off.wire);
  assert.deepEqual(on.stored, off.stored);
  assert.deepEqual(on.stats, off.stats);
});

import { ProviderRequests } from "../src/lib/lsp/requests.ts";

test("provider requests are counted per kind and outcome with a latency window; nothing is installed when the hooks are off", async () => {
  const on = createMetrics(true, scriptedHost().factory);
  assert.equal(on.enabled, true);
  on.provider("hover", "applied", 12); on.provider("hover", "stale", 40); on.provider("references", "busy", 3); on.channelBytes(1000); on.channelBytes(500);
  const snap = on.snapshot();
  assert.deepEqual(snap.providers.hover, { sent: 2, applied: 1, stale: 1, busy: 0, empty: 0, cancelled: 0 });
  assert.equal(snap.providers.references.busy, 1);
  assert.deepEqual(snap.providerLatencyMs.hover, { max: 40, p95: 40, count: 2 });
  assert.equal(snap.channelBytes, 1500);
  const off = createMetrics(false, scriptedHost().factory);
  off.provider("hover", "applied", 1); off.channelBytes(9);
  assert.equal(off.snapshot(), null);
  assert.equal(off.enabled, false);
});

test("the hooks only count: ProviderRequests behaves the same with and without an observer", async () => {
  const mk = (onSettle) => {
    const state = { versionId: 1 };
    const host = { binding: () => ({ session: 1, uri: "u" }), stamp: () => ({ epoch: 1, versionId: state.versionId }), flush: async () => {},
      call: async (c) => (c === "lsp_hover" ? { kind: "result", epoch: 1, uri: "u", value: 7 } : { kind: "busy" }), cancel: async () => {} };
    return new ProviderRequests(host, onSettle);
  };
  const seen = [];
  const observed = mk((kind, outcome, ms) => seen.push([kind, outcome, typeof ms]));
  const plain = mk();
  for (const requests of [observed, plain]) {
    assert.equal(await requests.request("hover", "f", {}), 7);
    assert.equal(await requests.request("references", "f", {}), null);
  }
  assert.deepEqual(seen, [["hover", "applied", "number"], ["references", "busy", "number"]]);
  assert.deepEqual(observed.stats, plain.stats, "identical behaviour either way");
});
