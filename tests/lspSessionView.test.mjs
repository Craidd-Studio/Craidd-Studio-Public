import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Runs the real bridge, store and status bar; only Tauri IPC and the
// unrelated stores are replaced. Each `fresh()` is a new module instance,
// so the bridge's module state does not leak between tests.
const url = (source) => `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const zustand = import.meta.resolve("zustand");
const mockName = "__craiddLspSessionViewTest";
const g = globalThis[mockName] = {};
Error.stackTraceLimit = 0;
globalThis.window = {
  setTimeout, clearTimeout, setInterval, addEventListener() {}, dispatchEvent() {},
  requestIdleCallback: (run) => { queueMicrotask(() => run({ didTimeout: false })); return 0; }, cancelIdleCallback() {},
};

let instance = 0;
async function load(relative, replacements) {
  const source = await readFile(new URL(relative, import.meta.url), "utf8");
  let { outputText } = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX,
  } });
  const runtime = { react: import.meta.resolve("react"), "react/jsx-runtime": import.meta.resolve("react/jsx-runtime") };
  for (const [name, target] of Object.entries({ ...runtime, ...replacements })) outputText = outputText.replaceAll(JSON.stringify(name), JSON.stringify(target));
  return url(`${outputText}\n// instance ${instance}`);
}

const core = url(`export class Channel { constructor(){ globalThis.${mockName}.channel=this; } }
export async function invoke(command,args) { return globalThis.${mockName}.invoke(command,args); }`);
const FILE = "/lab/fx/src/main.rs";
const solution = url(`import {create} from ${JSON.stringify(zustand)};
export const useSolution=create(()=>({solution:{name:'fx'},clnPath:'/lab/fx/fx.cln',rootPath:'/lab/fx',
  tabs:[{fileId:${JSON.stringify(FILE)},name:'main.rs',language:'rust',content:'fn main() {}',originalContent:'fn main() {}'}],
  activeFileId:${JSON.stringify(FILE)}}));`);
const split = url(`import {create} from ${JSON.stringify(zustand)}; export const useSplit=create(()=>({sideFileId:null}));`);
// Server rendering reads a store's initial-state snapshot; this `create` makes it the live state.
const liveZustand = url(`import {createStore} from ${JSON.stringify(import.meta.resolve("zustand/vanilla"))};
import {useStore} from ${JSON.stringify(zustand)};
export function create(init){ const api=createStore(init); api.getInitialState=api.getState;
  return Object.assign((selector)=>useStore(api,selector), api); }`);
const prefs = url(`import {create} from ${JSON.stringify(zustand)}; export const usePreferences=create(()=>({wordWrap:false,fontSize:13}));`);
const build = url(`import {create} from ${JSON.stringify(zustand)}; export const useBuild=create(()=>({problems:[]}));`);

async function fresh() {
  instance += 1;
  const protocol = await load("../src/lib/lsp/protocol.ts", {});
  const documents = await load("../src/lib/lsp/documents.ts", { "./protocol.ts": protocol });
  const diagnostics = await load("../src/lib/lsp/diagnostics.ts", { "./protocol.ts": protocol });
  const pulls = await load("../src/lib/lsp/pulls.ts", {});
  const metrics = await load("../src/lib/lsp/metrics.ts", {});
  const launch = await load("../src/lib/lsp/launch.ts", {});
  const requests = await load("../src/lib/lsp/requests.ts", {});
  const providersMod = await load("../src/lib/lsp/providers.ts", {});
  const symbols = await load("../src/lib/lsp/symbols.ts", { "./protocol.ts": protocol });
  const hover = await load("../src/lib/lsp/hover.ts", { "./protocol.ts": protocol });
  const languages = await load("../src/lib/languages.ts", {});
  const store = await load("../src/store/lspStore.ts", { zustand: liveZustand });
  const bridge = await load("../src/lib/lsp/bridge.ts", {
    "@tauri-apps/api/core": core, "../../store/solutionStore": solution, "../../store/splitStore": split,
    "../../store/lspStore": store, "../languages": languages, "./documents": documents, "./diagnostics": diagnostics,
    "./pulls": pulls, "./protocol": protocol, "./metrics": metrics, "./launch": launch, "./requests.ts": requests, "./providers.ts": providersMod, "./hover.ts": hover, "./symbols.ts": symbols,
  });
  const boundary = await load("../src/components/layout/ChipBoundary.tsx", {});
  const statusBar = await load("../src/components/layout/StatusBar.tsx", {
    "../../store/solutionStore": solution, "../../store/preferencesStore": prefs, "../../store/buildStore": build,
    "../../store/lspStore": store, "../../lib/lsp/bridge": bridge, "./ChipBoundary": boundary,
  });
  return { bridge: await import(bridge), lsp: await import(store), StatusBar: (await import(statusBar)).default };
}

const status = (phase, revision) => ({ generation: 1, phase, terminalReason: null, caps: null, resync: [], refresh: 0, writerRoom: 0,
  unresponsive: false, health: null, workspaceReady: false, readyFallback: false, reloads: 0, watcherWarning: null, revision });
const reply = (replyStatus) => ({ kind: "routed", session: 1, uri: `file://${FILE}`, canonical: FILE, languageId: "rust",
  projectId: "p", projectName: "fx", launched: true, server: "/usr/bin/rust-analyzer", version: "1.0.0", root: "/lab/fx",
  notes: ["note"], status: replyStatus });
const batch = (record, logs = []) => ({ session: 1, batch: { status: record, events: [], logs, droppedLogs: 0 } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Start the bridge and hold the `lsp_attach` reply until `release()`. */
async function started() {
  const env = await fresh();
  const calls = [];
  let release;
  const attached = new Promise((resolve) => { release = resolve; });
  g.invoke = async (command, args) => {
    calls.push(command);
    if (command === "lsp_enabled") return true;
    if (command === "lsp_attach") return attached;
    return null;
  };
  await env.bridge.startupComplete();
  for (let i = 0; i < 5 && !calls.includes("lsp_attach"); i += 1) await settle();
  assert.ok(calls.includes("lsp_attach"), "the active .rs tab attaches");
  return { ...env, calls, release, deliver: (event) => g.channel.onmessage(event) };
}

function assertDescribed(view) {
  assert.equal(view.server, "/usr/bin/rust-analyzer");
  assert.equal(view.version, "1.0.0");
  assert.equal(view.root, "/lab/fx");
  assert.deepEqual(view.notes, ["note"]);
}

test("status before registration: the reply's description is merged, the newer Channel status kept", async () => {
  const env = await started();
  env.deliver(batch(status("initializing", 2), [{ severity: 3, text: "hello" }]));
  const early = env.lsp.useLsp.getState().sessions[1];
  assert.equal(early.status.phase, "initializing");
  assert.equal(early.server, undefined, "no description before the reply");
  assert.ok(env.calls.includes("lsp_ack"), "the early batch is still acknowledged");
  assert.equal(env.lsp.useLsp.getState().output.at(-1).text, "[lsp:language server] hello");
  // A document bound to the session while the view still has no description.
  const fileId = FILE;
  env.lsp.useLsp.setState((st) => ({ docs: { ...st.docs, [fileId]: { kind: "bound", session: 1, alias: null, state: "pending" } } }));
  const earlyMarkup = renderToStaticMarkup(createElement(env.StatusBar));
  assert.doesNotMatch(earlyMarkup, /undefined/, "the hover never prints an undefined server, version or root");
  assert.match(earlyMarkup, /Phase: initializing/);
  env.release(reply(status("spawning", 1)));
  await settle();
  const view = env.lsp.useLsp.getState().sessions[1];
  assertDescribed(view);
  assert.equal(view.status.phase, "initializing", "the reply's older status does not replace the newer one");
  assert.deepEqual(view.progress, {});
  assert.equal(view.pullDegraded, null);
  const markup = renderToStaticMarkup(createElement(env.StatusBar));
  assert.match(markup, /rust-analyzer: starting/);
  assert.match(markup, /\/usr\/bin\/rust-analyzer \(1\.0\.0\)/);
});

test("registration before status: the reply creates the view and later statuses update it", async () => {
  const env = await started();
  env.release(reply(status("spawning", 1)));
  await settle();
  assertDescribed(env.lsp.useLsp.getState().sessions[1]);
  assert.equal(env.lsp.useLsp.getState().sessions[1].status.phase, "spawning");
  env.deliver(batch(status("initializing", 2)));
  const view = env.lsp.useLsp.getState().sessions[1];
  assertDescribed(view);
  assert.equal(view.status.phase, "initializing");
  assert.match(renderToStaticMarkup(createElement(env.StatusBar)), /rust-analyzer: starting/);
});

test("repeated updates keep the description, and a second reply never rolls status or progress back", () => {
  return fresh().then(({ lsp }) => {
    let view = lsp.viewWithStatus(undefined, 1, status("spawning", 1));
    view = lsp.viewWithStatus(view, 1, status("initializing", 2));
    view = lsp.viewWithAttach(view, { ...reply(status("spawning", 1)), generation: 1 });
    assertDescribed(view);
    assert.equal(view.status.revision, 2);
    view = { ...view, progress: { t: "indexing" }, pullDegraded: "slow" };
    view = lsp.viewWithStatus(view, 1, status("ready", 3));
    view = lsp.viewWithAttach(view, { ...reply(status("initializing", 2)), generation: 1, notes: [] });
    assert.equal(view.status.revision, 3);
    assert.deepEqual(view.progress, { t: "indexing" });
    assert.equal(view.pullDegraded, "slow");
    assert.deepEqual(view.notes, [], "the latest reply's description wins");
    assert.equal(lsp.serverName(view), "rust-analyzer");
    assert.equal(lsp.serverName(lsp.viewWithStatus(undefined, 1, status("spawning", 1))), "language server");
  });
});

test("a chip rendering failure is contained to an inert fallback", async () => {
  const boundaryURL = await load("../src/components/layout/ChipBoundary.tsx", {});
  const ChipBoundary = (await import(boundaryURL)).default;
  const failure = new TypeError("undefined is not an object (evaluating 'view.server.split')");
  const boundary = new ChipBoundary({ children: "chip" });
  assert.equal(boundary.render(), "chip");
  boundary.state = ChipBoundary.getDerivedStateFromError(failure);
  const markup = renderToStaticMarkup(boundary.render());
  assert.match(markup, /^<span[^>]*>language server<\/span>$/);
  assert.doesNotMatch(markup, /button|could not render|view\.server/);
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args);
  try { boundary.componentDidCatch(failure, { componentStack: "" }); } finally { console.error = original; }
  assert.equal(logged[0][1], failure);
  // Only the chip is wrapped, keyed so it retries on the next document; the window keeps AppErrorBoundary.
  const source = await readFile(new URL("../src/components/layout/StatusBar.tsx", import.meta.url), "utf8");
  assert.match(source, /<ChipBoundary key=\{activeFileId \?\? ""\}><LanguageServerChip fileId=\{activeFileId\} \/><\/ChipBoundary>/);
  const main = await readFile(new URL("../src/main.tsx", import.meta.url), "utf8");
  assert.match(main, /<AppErrorBoundary><App \/><\/AppErrorBoundary>/);
});

test("↻ Restart is offered when a live session's health is error, not for a warning (decision 38)", async () => {
  const env = await started();
  env.release(reply(status("ready", 1)));
  await settle();
  const ready = (health, revision) => ({ ...status("ready", revision), workspaceReady: true, health });
  const restart = () => /Restart rust-analyzer/.test(renderToStaticMarkup(createElement(env.StatusBar)));
  env.deliver(batch(ready(null, 2)));
  assert.equal(restart(), false, "a healthy ready session shows no Restart");
  env.deliver(batch(ready({ health: "warning", quiescent: true, message: "slow" }, 3)));
  assert.equal(restart(), false, "a warning keeps the bar quiet");
  env.deliver(batch(ready({ health: "error", quiescent: true, message: "Failed to load workspaces" }, 4)));
  assert.equal(restart(), true, "an error offers the manual restart");
  env.deliver(batch(ready({ health: "ok", quiescent: true, message: null }, 5)));
  assert.equal(restart(), false, "it goes away when the server recovers");
  env.deliver(batch({ ...ready(null, 6), watcherWarning: "OS file watch limit reached" }));
  assert.equal(restart(), true, "a recorded watcher failure offers the restart (decision 28)");
  env.deliver(batch(ready(null, 7)));
  assert.equal(restart(), false, "and it goes away when the watcher failure clears");
  assert.equal(env.lsp.restartOffered("ready", "warning", null), false);
  assert.equal(env.lsp.restartOffered("ready", "ok", "limit"), true);
  assert.equal(env.lsp.restartOffered("crashed", null), true);
  assert.equal(env.lsp.restartOffered("unresponsive", null), true);
  assert.equal(env.lsp.restartOffered("ready", "ok"), false);
});
