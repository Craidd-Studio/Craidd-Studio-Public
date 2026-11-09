import assert from "node:assert/strict";
import test from "node:test";
import { providerAvailable, triggerCharacters } from "../src/lib/lsp/providers.ts";

const caps = (over = {}) => ({ sync: "incremental", syncUnusable: null, save: "plain", completion: { triggerCharacters: [".", ":"], resolve: true },
  hover: true, definition: true, references: true, documentSymbol: true, pull: null, serverName: "x", serverVersion: "1", notes: [], ...over });

test("each provider is available only when negotiated and sync is usable (table over all five)", () => {
  const kinds = ["completion", "hover", "definition", "references", "documentSymbol"];
  for (const kind of kinds) {
    assert.equal(providerAvailable(caps(), kind), true, kind);
    assert.equal(providerAvailable(caps({ [kind]: kind === "completion" ? null : false }), kind), false, `${kind} absent`);
    assert.equal(providerAvailable(caps({ syncUnusable: "no change kind" }), kind), false, `${kind} with unusable sync`);
    assert.equal(providerAvailable(null, kind), false);
    assert.equal(providerAvailable(undefined, kind), false);
  }
});

test("only the negotiated providers are on; the others stay off independently", () => {
  const only = caps({ completion: null, hover: true, definition: false, references: false, documentSymbol: true });
  assert.deepEqual(["completion", "hover", "definition", "references", "documentSymbol"].map((k) => providerAvailable(only, k)),
    [false, true, false, false, true]);
});

test("trigger characters come from the server's list and are copied", () => {
  const c = caps();
  const chars = triggerCharacters(c);
  assert.deepEqual(chars, [".", ":"]);
  chars.push("!");
  assert.deepEqual(c.completion.triggerCharacters, [".", ":"], "the stored list is not aliased");
  assert.deepEqual(triggerCharacters(caps({ completion: null })), []);
  assert.deepEqual(triggerCharacters(caps({ syncUnusable: "x" })), []);
});
