import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

// These read the sources: the store and editors pull in Tauri and Monaco, which the node suites do not load.
// They pin the rules (decision 50), not behaviour; the behaviour is checked in the IDE (U-steps).
const src = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const body = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));

test("a read-only tab can never become dirty, be saved or be disk-checked", async () => {
  const store = await src("src/store/solutionStore.ts");
  assert.match(body(store, "updateTabContent: (fileId, content) => {", "saveFile:"), /current\?\.readOnly \|\|/);
  assert.match(body(store, "saveFile: async (fileId, force = false) => {", "const { invoke }"), /tab\.readOnly\) return "error"/);
  assert.match(body(store, "refreshDiskStateFor: async (fileId) => {", "const { invoke }"), /tab\.readOnly\) return;/);
  const reveal = body(store, "revealReadOnly: (absolutePath, text, line, column) => {", "closeTab:");
  assert.match(reveal, /dirty: false/);
  assert.match(reveal, /readOnly: true/);
  assert.match(reveal, /existing \? state\.tabs : \[\.\.\.state\.tabs, tab\]/, "a tab already open keeps its own editability");
});

test("editability follows the tab's path view, in both editors, and not the shared model", async () => {
  assert.match(await src("src/components/editor/CodeView.tsx"), /readOnly: activeReadOnly,/);
  assert.match(await src("src/components/editor/SideEditor.tsx"), /readOnly: tab\.readOnly === true,/);
  assert.doesNotMatch(await src("src/components/editor/CodeView.tsx"), /model\.updateOptions\(\{ *readOnly/);
});

test("the tab strip shows the lock glyph with its reason, and re-renders when the flag changes", async () => {
  const tabs = await src("src/components/editor/EditorTabs.tsx");
  assert.match(tabs, /tab\.readOnly && <svg role="img" aria-label="Read-only"/);
  assert.match(tabs, /Craidd never saves it/);
  assert.match(tabs, /t\.readOnly \? 1 : 0/);
});

test("the unowned route reads through the originating session only and binds with the canonical path", async () => {
  const bridge = await src("src/lib/lsp/bridge.ts");
  const unowned = body(bridge, "unowned: async (path, line, column, origin) => {", "// ---- Documents and the deferred launch");
  assert.match(unowned, /lsp_read_target/);
  assert.match(unowned, /canonical: target\.path/);
  assert.match(unowned, /fileUri\(target\.path\)/);
  assert.match(unowned, /if \(!binding\)/, "without a session there is no read");
});

test("a rebind goes through the unowned route: bind to the navigating session, replace `ended`, open; a live holder is only focused", async () => {
  const bridge = await src("src/lib/lsp/bridge.ts");
  const unowned = body(bridge, "unowned: async (path, line, column, origin) => {", "// ---- Documents and the deferred launch");
  assert.match(unowned, /held\?\.session === binding\.session/, "already held by the navigating session: focus only");
  assert.match(unowned, /tracker\.bind\(target\.path/);
  assert.match(unowned, /refreshDocInfo\(target\.path\);\s*void activateBound\(target\.path\)/, "the bound entry replaces `ended`, then didOpen");
  assert.match(unowned, /if \(!binding\) \{[^}]*revealFile/s, "without a live session an open read-only tab is focused and keeps its note");
  const commands = await src("src-tauri/src/lsp/commands.rs");
  assert.match(commands, /retired\.insert\(session, tracked\.session\.clone\(\)\)/, "a restarted session stays findable for its acknowledgements");
});

test("step 7 wiring: a symlink alias tab is marked read-only (never one with unsaved edits) and the unowned symlink case shows its reason", async () => {
  const store = await src("src/store/solutionStore.ts");
  assert.match(body(store, "markReadOnlyIfClean: (fileId) =>", "revealReadOnly:"), /!t\.dirty && !t\.readOnly \? \{ \.\.\.t, readOnly: true \}/);
  const bridge = await src("src/lib/lsp/bridge.ts");
  assert.match(bridge, /if \(reply\.viaSymlink\) useSolution\.getState\(\)\.markReadOnlyIfClean\(fileId\);/);
  const bar = await src("src/components/layout/StatusBar.tsx");
  assert.match(bar, /info\.kind === "symlinked"/);
  assert.match(bar, /language server: \{info\.reason\}/);
  const backend = await src("src-tauri/src/lsp/router.rs");
  assert.match(backend, /opened through a symlink; open the real path for language features/);
});
