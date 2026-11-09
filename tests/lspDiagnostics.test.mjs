import assert from "node:assert/strict";
import test from "node:test";
import { PullScheduler } from "../src/lib/lsp/pulls.ts";
import { DiagnosticsModel } from "../src/lib/lsp/diagnostics.ts";

/** Manual clock and timers: nothing runs unless the test advances time. */
function clock() {
  let now = 0;
  const timers = new Map();
  let next = 0;
  return {
    timers: {
      now: () => now,
      set: (run, ms) => { const id = ++next; timers.set(id, { at: now + ms, run }); return id; },
      clear: (id) => timers.delete(id),
    },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers].sort(([, a], [, b]) => a.at - b.at)) {
        if (timer.at <= now && timers.has(id)) { timers.delete(id); timer.run(); }
      }
      await settle();
    },
    pending: () => timers.size,
  };
}

const settle = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

function harness({ open = ["a", "b", "c"], visible = ["a"], interFile = true, limits = {}, reply } = {}) {
  const c = clock();
  const sent = [];
  const cancelled = [];
  const accepted = [];
  const degraded = [];
  const versions = new Map(open.map((f) => [f, 1]));
  let inFlight = 0;
  let maxInFlight = 0;
  const gates = [];
  const host = {
    openDocs: () => open, visible: () => visible, recency: (f) => open.indexOf(f),
    uri: (f) => `file:///${f}`, stamp: (f) => (versions.has(f) ? { epoch: 1, versionId: versions.get(f) } : null),
    flush: async () => {}, accept: (f, report) => accepted.push([f, report.kind]), degraded: (m) => degraded.push(m),
  };
  const transport = {
    async pull(session, uri, previous) {
      sent.push([uri.slice(8), previous]);
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      const answer = reply ? await reply(uri.slice(8), previous, gates) : { kind: "report", report: { kind: previous ? "unchanged" : "full", resultId: "r1", items: [] } };
      inFlight--;
      return answer;
    },
    async cancel(session, uri) { cancelled.push(uri.slice(8)); },
  };
  const limitsAll = { debounceMs: 300, concurrency: 2, perWave: 12, waveSpacingMs: 250, focusIntervalMs: 2000, retriggerMax: 2, failureMax: 3, ...limits };
  const scheduler = new PullScheduler(1, interFile, transport, host, c.timers, limitsAll);
  return { scheduler, c, sent, cancelled, accepted, degraded, versions, maxInFlight: () => maxInFlight, gates, open };
}

test("open pulls once; tab switches pull nothing; resultIds are sent only after an accepted report", async () => {
  const h = harness();
  h.scheduler.opened("a");
  await settle();
  assert.deepEqual(h.sent, [["a", null]]);
  h.scheduler.activated("b");
  await settle();
  assert.equal(h.sent.length, 1, "activating a document that is not flagged sends nothing");
  h.scheduler.opened("a");
  await h.c.advance(300);
  assert.deepEqual(h.sent[1], ["a", "r1"]);
  assert.deepEqual(h.accepted, [["a", "full"], ["a", "unchanged"]]);
});

test("changes debounce the pull, restart the timer and cancel the in-flight pull", async () => {
  let release;
  const h = harness({ reply: (f, prev) => new Promise((resolve) => { release = () => resolve({ kind: "report", report: { kind: "full", resultId: "r", items: [] } }); }) });
  h.scheduler.opened("a");
  await settle();
  h.versions.set("a", 2);
  h.scheduler.edited("a");
  assert.deepEqual(h.cancelled, ["a"]);
  release();
  await settle();
  assert.equal(h.accepted.length, 0, "a superseded report is dropped and records no resultId");
  assert.equal(h.scheduler.hasResultId("a"), false);
  await h.c.advance(200);
  h.scheduler.edited("a");
  await h.c.advance(200);
  assert.equal(h.sent.length, 1, "each change restarts the debounce");
  await h.c.advance(100);
  assert.equal(h.sent.length, 2, "one pull after the burst, never one per keystroke");
});

test("a report for an older versionId is stale and dropped", async () => {
  const h = harness({ reply: async () => { h.versions.set("a", 9); return { kind: "report", report: { kind: "full", resultId: "r", items: [] } }; } });
  h.scheduler.opened("a");
  await settle();
  assert.equal(h.accepted.length, 0);
  assert.equal(h.scheduler.stats.stale, 1);
});

test("refresh seeds visible documents first, flags the rest, and a burst of refreshes coalesces", async () => {
  const h = harness({ open: ["a", "b", "c", "d"], visible: ["c"] });
  // V23: refresh arrives in bursts. The first starts a wave; the rest merge into one next wave.
  for (let i = 0; i < 10; i++) h.scheduler.refresh();
  await settle();
  assert.deepEqual(h.sent.map(([f]) => f), ["c"]);
  assert.deepEqual(h.scheduler.flagged().sort(), ["a", "b", "d"]);
  await h.c.advance(250);
  assert.deepEqual(h.sent.map(([f]) => f), ["c", "c"], "ten refreshes cost two pulls, not ten");
  assert.equal(h.scheduler.stats.waves, 2);
  h.scheduler.activated("b");
  await h.c.advance(250);
  assert.deepEqual(h.sent.map(([f]) => f), ["c", "c", "b"], "a flagged document pulls once when it becomes visible");
  await h.c.advance(10_000);
  assert.equal(h.sent.length, 3);
});

test("cross-document seeds follow a changed document's settled pull, bounded by concurrency and the per-wave maximum", async () => {
  const open = Array.from({ length: 20 }, (_, i) => `f${i}`);
  const h = harness({ open, visible: open.slice(0, 8), limits: { perWave: 5, concurrency: 2 } });
  h.scheduler.saved("f0");
  await settle();
  await h.c.advance(250);
  await h.c.advance(250);
  assert.ok(h.maxInFlight() <= 2, `concurrency cap held: ${h.maxInFlight()}`);
  const second = h.sent.slice(1).map(([f]) => f);
  assert.equal(second.length, 5, "the per-wave maximum holds");
  assert.ok(second.every((f) => open.slice(1, 8).includes(f)), "visible documents are pulled first");
  assert.ok(h.scheduler.flagged().length >= 12, "the rest are flagged pull-needed, not pulled");
  const noCross = harness({ open, visible: open, interFile: false });
  noCross.scheduler.saved("f0");
  await noCross.c.advance(1000);
  assert.equal(noCross.sent.length, 1, "interFileDependencies false adds no cross-document seeds");
});

test("no wave runs without an event", async () => {
  const h = harness();
  await h.c.advance(60_000);
  assert.equal(h.sent.length, 0);
  assert.equal(h.c.pending(), 0, "no timer is armed while idle");
});

test("focus is rate-limited", async () => {
  const h = harness({ visible: ["a", "b"] });
  h.scheduler.focused();
  h.scheduler.focused();
  await h.c.advance(250);
  assert.equal(h.sent.length, 2);
  await h.c.advance(2000);
  h.scheduler.focused();
  await h.c.advance(250);
  assert.equal(h.sent.length, 4);
});

test("retrigger re-arms once per debounce window up to the bound; busy waits for writer room", async () => {
  const h = harness({ reply: async () => ({ kind: "retrigger" }) });
  h.scheduler.opened("a");
  await settle();
  for (let i = 0; i < 6; i++) await h.c.advance(300);
  assert.equal(h.sent.length, 3, "the first pull plus two re-arms");
  const busy = harness({ reply: async (f, p) => (busy.sent.length === 1 ? { kind: "busy" } : { kind: "report", report: { kind: "full", items: [] } }) });
  busy.scheduler.opened("a");
  await busy.c.advance(1000);
  assert.equal(busy.sent.length, 1, "a pull that was not admitted is not retried by a timer");
  busy.scheduler.writerRoom();
  await busy.c.advance(250);
  assert.equal(busy.sent.length, 2);
});

test("consecutive failures mark pull degraded; a later success clears it", async () => {
  let fail = true;
  const h = harness({ reply: async () => (fail ? { kind: "error", code: -32603, message: "boom" } : { kind: "report", report: { kind: "full", items: [] } }) });
  for (let i = 0; i < 3; i++) { h.scheduler.opened("a"); await h.c.advance(300); }
  assert.ok(h.degraded.some((m) => m && m.includes("boom")));
  fail = false;
  h.scheduler.opened("a");
  await h.c.advance(300);
  assert.equal(h.degraded.at(-1), null);
});

const diag = (message, line = 0) => ({ message, range: { start: { line, character: 0 }, end: { line, character: 1 } } });

test("push and pull sets are stored apart; empty sets clear; equal sets cause no write", () => {
  const model = new DiagnosticsModel();
  const open = () => true;
  const who = { projectId: "p", projectName: "app" };
  assert.equal(model.apply(1, "file:///a.rs", "pull", [diag("E0061")], open), true);
  assert.equal(model.apply(1, "file:///a.rs", "push", [diag("rustc")], open), true);
  assert.equal(model.apply(1, "file:///a.rs", "push", [diag("rustc")], open), false, "identical republish: no write");
  assert.deepEqual(model.get(1, "file:///a.rs", "pull").map((d) => d.message), ["E0061"]);
  assert.equal(model.apply(1, "file:///a.rs", "push", [], open), true, "an empty set is a real update");
  assert.deepEqual(model.get(1, "file:///a.rs", "push"), []);
  assert.deepEqual(model.get(1, "file:///a.rs", "pull").map((d) => d.message), ["E0061"], "a push never alters the pull set");
  assert.equal(model.apply(1, "file:///a.rs", "push", [], open), false);
});

test("closing clears the pull set and keeps the push set; session end clears only that session", () => {
  const model = new DiagnosticsModel();
  const who = { projectId: "p", projectName: "app" };
  model.apply(1, "file:///a.rs", "pull", [diag("pulled")], () => true);
  model.apply(1, "file:///a.rs", "push", [diag("pushed")], () => true);
  model.apply(2, "file:///b.rs", "push", [diag("other session")], () => true);
  model.clearPull(1, "file:///a.rs");
  assert.deepEqual(model.problems(() => who).map((p) => p.message).sort(), ["other session", "pushed"]);
  assert.deepEqual(model.clearSession(1), ["file:///a.rs"]);
  assert.deepEqual(model.problems(() => who).map((p) => p.message), ["other session"]);
});

test("retention caps per file and evicts least recent closed sets visibly; open sets are never evicted", () => {
  const model = new DiagnosticsModel({ perFile: 2, closedFiles: 2, closedTotal: 100 });
  const who = { projectId: null, projectName: null };
  const openUris = new Set(["file:///open.rs"]);
  const isOpen = (uri) => openUris.has(uri);
  model.apply(1, "file:///open.rs", "push", [diag("a"), diag("b"), diag("c")], isOpen);
  assert.equal(model.notRetained(), 1, "+N not retained is visible");
  for (const name of ["x", "y", "z"]) model.apply(1, `file:///${name}.rs`, "push", [diag(name)], isOpen);
  assert.equal(model.evictedFiles(), 1);
  assert.deepEqual(model.get(1, "file:///x.rs", "push"), [], "the least recently published closed set went first");
  assert.equal(model.get(1, "file:///open.rs", "push").length, 2, "open sets are never evicted");
  model.apply(1, "file:///x.rs", "push", [diag("x again")], isOpen);
  assert.ok(model.problems(() => who).some((p) => p.message === "x again" && p.external), "returns when republished; external attribution");
});

test("decision 20: becoming ready drops reports of earlier pulls and seeds every open document", async () => {
  let release;
  const h = harness({ open: ["a", "b", "c"], visible: ["b"], reply: (f) => (f === "a" && !release
    ? new Promise((resolve) => { release = () => resolve({ kind: "report", report: { kind: "full", items: [] } }); })
    : Promise.resolve({ kind: "report", report: { kind: "full", items: [] } })) });
  h.scheduler.opened("a");
  await settle();
  h.scheduler.ready();
  release();
  await settle();
  assert.equal(h.scheduler.stats.stale, 1, "a report from before readiness is dropped, never stored");
  await h.c.advance(250);
  assert.deepEqual(h.sent.slice(1).map(([f]) => f), ["b", "c", "a"], "every open document is pulled, visible first, then by recency");
});

test("decision 20: the pull route is unknown until a report is accepted; an accepted empty report is authoritative", () => {
  const model = new DiagnosticsModel();
  assert.equal(model.isKnown(1, "file:///a.rs"), false);
  model.markKnown(1, "file:///a.rs");
  assert.equal(model.isKnown(1, "file:///a.rs"), true);
  model.clearPull(1, "file:///a.rs");
  assert.equal(model.isKnown(1, "file:///a.rs"), false, "closing makes it unknown again");
  model.markKnown(1, "file:///a.rs");
  model.clearSession(1);
  assert.equal(model.isKnown(1, "file:///a.rs"), false);
});

test("attribution is looked up at display time: pending, owned, ambiguous and external", () => {
  const model = new DiagnosticsModel();
  for (const name of ["pending", "owned", "both", "outside"]) model.apply(1, `file:///${name}.rs`, "push", [diag(name)], () => false);
  const who = { "file:///owned.rs": { projectId: "p", projectName: "app" },
    "file:///both.rs": { projectId: null, projectName: null, ambiguous: ["a", "b"] },
    "file:///outside.rs": { projectId: null, projectName: null } };
  const rows = Object.fromEntries(model.problems((uri) => who[uri] ?? null).map((p) => [p.message, p]));
  assert.deepEqual([rows.pending.projectName, rows.pending.external], [null, false], "unresolved yet: neither a project nor external");
  assert.equal(rows.owned.projectName, "app");
  assert.deepEqual([rows.both.projectName, rows.both.external], ["ambiguous: a, b", false]);
  assert.equal(rows.outside.external, true);
});

test("decision 31: an empty report counts only if its pull was sent after readiness", async () => {
  const { isAuthoritative, gateOpen } = await import("../src/lib/lsp/diagnostics.ts");
  assert.equal(isAuthoritative(false, 0), false, "an empty report from before readiness is discarded; the route stays unknown");
  assert.equal(isAuthoritative(false, 2), true, "a non-empty report is evidence whenever it arrives");
  assert.equal(isAuthoritative(true, 0), true, "after readiness an empty report clears a non-empty set");
  assert.equal(gateOpen({ workspaceReady: false, readyFallback: false }), false);
  assert.equal(gateOpen({ workspaceReady: false, readyFallback: true }), true, "status-less after the timeout");
  assert.equal(gateOpen({ workspaceReady: true, readyFallback: false }), true);
  assert.equal(gateOpen({ workspaceReady: null, readyFallback: false }), true, "a server with no status declared is not gated");
});

test("decision 33: a reload re-arms the gate and the next ready report runs one wave over every open document", async () => {
  const { gateOpened } = await import("../src/lib/lsp/pulls.ts");
  const at = (workspaceReady, readyFallback = false) => ({ workspaceReady, readyFallback });
  const timeline = [at(false), at(true), at(false) /* reload re-armed */, at(false), at(true) /* ready again */, at(true)];
  const opened = timeline.map((status, i) => gateOpened(timeline[i - 1], status));
  assert.deepEqual(opened, [false, true, false, false, true, false], "one opening per ready report; re-arming seeds nothing");
  assert.equal(gateOpened(at(false), at(false, true)), true, "the status-less fallback opens the gate");
  assert.equal(gateOpened(at(false, true), at(false, false)), false, "a status arriving later closes it again without seeding");
  // The opening seeds one wave over every open document, visible first.
  const h = harness({ open: ["a", "b", "c"], visible: ["c"] });
  if (opened[4]) h.scheduler.ready();
  await h.c.advance(250);
  assert.deepEqual(h.sent.map(([f]) => f), ["c", "b", "a"]);
  assert.equal(h.scheduler.stats.waves, 1);
});
