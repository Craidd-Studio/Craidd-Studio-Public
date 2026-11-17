import assert from "node:assert/strict";
import test from "node:test";
import { locationsToTargets, openTarget, referencesToTargets, REFERENCES_CAP } from "../src/lib/lsp/navigation.ts";

const range = { start: { line: 4, character: 1 }, end: { line: 4, character: 6 } };

test("Location, Location[] and LocationLink[] all become targets in Monaco's 1-based form", () => {
  const one = locationsToTargets({ uri: "file:///ws/a.rs", range });
  assert.deepEqual(one, [{ path: "/ws/a.rs", range: { startLineNumber: 5, startColumn: 2, endLineNumber: 5, endColumn: 7 } }]);
  assert.equal(locationsToTargets([{ uri: "file:///ws/a.rs", range }, { uri: "file:///ws/b%20c.rs", range }]).map((t) => t.path).join("|"), "/ws/a.rs|/ws/b c.rs");
  const link = locationsToTargets([{ targetUri: "file:///ws/t.rs", targetRange: range, targetSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } } }]);
  assert.equal(link[0].path, "/ws/t.rs");
  assert.equal(link[0].range.startLineNumber, 1, "the selection range wins for a LocationLink");
});

test("non-file URIs, malformed ranges and junk are skipped; null and empty give nothing", () => {
  assert.deepEqual(locationsToTargets(null), []);
  assert.deepEqual(locationsToTargets([]), []);
  assert.deepEqual(locationsToTargets([{ uri: "http://x/a.rs", range }, { uri: "file:///a.rs", range: { start: {} } }, 3, null, { uri: 5, range }]), []);
});

function deps({ open = [], owners = {}, readOnly = [], holders = {} } = {}) {
  const log = [];
  return {
    log,
    deps: {
      isOpen: (p) => open.includes(p),
      isReadOnly: (p) => readOnly.includes(p),
      holder: (p) => holders[p] ?? null,
      owner: async (p) => { log.push(["owner", p]); return owners[p] ?? null; },
      reveal: async (...a) => { log.push(["reveal", ...a]); },
      unowned: async (...a) => { log.push(["unowned", ...a]); },
    },
  };
}

test("an open tab is the holder: it is focused and the resolver is not even asked", async () => {
  const d = deps({ open: ["/ws/a.rs"] });
  assert.equal(await openTarget(d.deps, "file", "/ws/a.rs", { lineNumber: 7, column: 3 }), "holder");
  assert.deepEqual(d.log, [["reveal", "/ws/a.rs", 7, 3]]);
});

test("an owned path opens in its own (project) form through reveal; the position accepts a range or a point", async () => {
  const d = deps({ owners: { "/ws/lib.rs": { projectId: "p" } } });
  assert.equal(await openTarget(d.deps, "file", "/ws/lib.rs", { startLineNumber: 12, startColumn: 5 }), "owned");
  assert.deepEqual(d.log.at(-1), ["reveal", "/ws/lib.rs", 12, 5]);
});

test("an unowned path never reaches the editable reveal; it goes to the read-only route", async () => {
  const d = deps({ owners: { "/ws/ext.rs": { projectId: null } } });
  assert.equal(await openTarget(d.deps, "file", "/ws/ext.rs", undefined), "unowned");
  assert.equal(await openTarget(d.deps, "file", "/home/u/.cargo/registry/x.rs", { lineNumber: 2 }), "unowned");
  assert.ok(d.log.every(([kind]) => kind !== "reveal"));
  assert.deepEqual(d.log.at(-1), ["unowned", "/home/u/.cargo/registry/x.rs", 2, 1, null]);
  await openTarget(d.deps, "file", "/home/u/.cargo/registry/y.rs", { lineNumber: 3 }, "/ws/origin.rs");
  assert.deepEqual(d.log.at(-1), ["unowned", "/home/u/.cargo/registry/y.rs", 3, 1, "/ws/origin.rs"], "the originating file is passed so the session can be found");
});

test("a non-file resource is left to Monaco, and a bad position falls back to 1:1", async () => {
  const d = deps();
  assert.equal(await openTarget(d.deps, "http", "/x", undefined), "ignored");
  assert.equal(await openTarget(d.deps, "file", "relative.rs", undefined), "ignored");
  const e = deps({ open: ["/a.rs"] });
  await openTarget(e.deps, "file", "/a.rs", { lineNumber: 0, column: -4 });
  assert.deepEqual(e.log[0], ["reveal", "/a.rs", 1, 1]);
});

test("references across several files keep every location, owned or not; the opener decides later", () => {
  const refs = [
    { uri: "file:///ws/a.rs", range }, { uri: "file:///ws/b.rs", range }, { uri: "file:///home/u/.cargo/registry/x.rs", range },
  ];
  const { targets, dropped } = referencesToTargets(refs);
  assert.deepEqual(targets.map((t) => t.path), ["/ws/a.rs", "/ws/b.rs", "/home/u/.cargo/registry/x.rs"]);
  assert.equal(dropped, 0);
});

test("a large reference list is capped with the remainder counted, never silently lost", () => {
  const many = Array.from({ length: REFERENCES_CAP + 37 }, (_, i) => ({ uri: `file:///ws/f${i}.rs`, range }));
  const { targets, dropped } = referencesToTargets(many);
  assert.equal(targets.length, REFERENCES_CAP);
  assert.equal(dropped, 37);
  assert.equal(referencesToTargets(many, 5).dropped, REFERENCES_CAP + 32);
  assert.deepEqual(referencesToTargets(null), { targets: [], dropped: 0 });
});

test("navigating to an open read-only tab rebinds it through the navigating session; an editable holder is only focused (decision 51)", async () => {
  const d = deps({ open: ["/ro/x.rs", "/ws/a.rs"], readOnly: ["/ro/x.rs"] });
  assert.equal(await openTarget(d.deps, "file", "/ro/x.rs", { lineNumber: 4, column: 2 }, "/ws/origin.rs"), "rebound");
  assert.deepEqual(d.log.at(-1), ["unowned", "/ro/x.rs", 4, 2, "/ws/origin.rs"], "the unowned route re-reads, rebinds and clears `ended`");
  assert.equal(await openTarget(d.deps, "file", "/ws/a.rs", undefined, "/ws/origin.rs"), "holder");
  assert.deepEqual(d.log.at(-1), ["reveal", "/ws/a.rs", 1, 1]);
  assert.ok(d.log.every(([kind, p]) => !(kind === "unowned" && p === "/ws/a.rs")), "an editable file never goes through the read-only route");
});

test("navigation to a file another tab holds under a different path form focuses that holder, no second tab (case d)", async () => {
  // The symlinked tab /ws/app/linked/deep.rs holds the registration for /ws/app/real_mods/deep.rs.
  const d = deps({ open: ["/ws/app/linked/deep.rs"], holders: { "/ws/app/real_mods/deep.rs": "/ws/app/linked/deep.rs" }, owners: { "/ws/app/real_mods/deep.rs": { projectId: "p" } } });
  assert.equal(await openTarget(d.deps, "file", "/ws/app/real_mods/deep.rs", { lineNumber: 3, column: 4 }, "/ws/app/main.rs"), "holder");
  assert.deepEqual(d.log, [["reveal", "/ws/app/linked/deep.rs", 3, 4]], "the holder is focused; the owner resolver is not even asked, and nothing new is opened");
  // With no holder the owned spelling opens in its own form.
  const e = deps({ owners: { "/ws/app/real_mods/deep.rs": { projectId: "p" } } });
  assert.equal(await openTarget(e.deps, "file", "/ws/app/real_mods/deep.rs", undefined, null), "owned");
});
