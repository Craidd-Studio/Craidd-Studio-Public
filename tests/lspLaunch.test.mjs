import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { LaunchGate } from "../src/lib/lsp/launch.ts";

function harness() {
  const scheduled = [];
  const launched = [];
  const gate = new LaunchGate((fire) => {
    const entry = { cancelled: false, fired: false };
    entry.fire = (reason) => { entry.fired = true; fire(reason); };
    scheduled.push(entry);
    return { cancel: () => { entry.cancelled = true; } };
  }, (reason) => launched.push(reason), ["rs"]);
  const live = () => scheduled.filter((s) => !s.cancelled && !s.fired);
  return { gate, scheduled, launched, live };
}
const ctx = { enabled: true, boundToLiveSession: false, notRouted: false };

test("nothing launches before startupComplete", () => {
  const h = harness();
  assert.equal(h.gate.onActive("/ws/src/main.rs", ctx), "none");
  h.gate.scheduleLaunch();
  assert.equal(h.scheduled.length, 0);
  assert.equal(h.gate.startupDone, false);
});

test("after startup an active .rs tab schedules exactly one launch; a non-Rust tab schedules none", () => {
  const h = harness();
  h.gate.complete();
  assert.equal(h.gate.onActive("/ws/README.md", ctx), "none");
  assert.equal(h.gate.onActive("/ws/web/main.ts", ctx), "none");
  assert.equal(h.scheduled.length, 0, "non-Rust active tabs schedule nothing");
  assert.equal(h.gate.onActive("/ws/src/main.rs", ctx), "scheduled");
  assert.equal(h.gate.onActive("/ws/src/lib.rs", ctx), "scheduled");
  assert.equal(h.live().length, 1, "a newer request replaces the pending one: one launch waits");
  h.live()[0].fire("idle");
  assert.deepEqual(h.launched, ["idle"]);
  assert.equal(h.gate.onActive("/ws/src/main.rs", { ...ctx, boundToLiveSession: true }), "activate", "a bound document attaches, no launch");
  assert.equal(h.gate.onActive("/ws/src/main.rs", { ...ctx, notRouted: true }), "none");
  assert.equal(h.gate.onActive("/ws/src/main.rs", { ...ctx, enabled: false }), "none", "CRAIDD_LSP=0");
  assert.equal(h.live().length, 0);
});

test("the bridge completes the gate in startupComplete, just before the final onActive", () => {
  const source = readFileSync(new URL("../src/lib/lsp/bridge.ts", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("export async function startupComplete"), source.indexOf("export async function restartSession"));
  assert.match(body, /gate\.complete\(\);\s*onActive\(\);\s*\}\s*(\/\*\*[^]*)?$/, "the gate is opened once wiring is complete, then onActive runs");
  assert.ok(body.indexOf("if (!enabled) return;") < body.indexOf("gate.complete()"), "with CRAIDD_LSP=0 the gate stays closed");
  assert.equal((source.match(/gate\.complete\(\)/g) ?? []).length, 1);
});
