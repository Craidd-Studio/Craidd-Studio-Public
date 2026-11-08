import * as monaco from "monaco-editor";

(self as any).MonacoEnvironment = { getWorker: () => new Worker(new URL("../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" }) };
monaco.languages.register({ id: "probe" });

const log: string[] = [];
const say = (line: string) => log.push(line);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BASE = "fn main() {\n    let x = Fo\n}\n";
const host = document.getElementById("host")!;

function fresh(text = BASE) {
  const model = monaco.editor.createModel(text, "probe");
  const editor = monaco.editor.create(host, { model, quickSuggestions: false, suggest: { snippetsPreventQuickSuggestions: false } });
  editor.focus();
  editor.setPosition({ lineNumber: 2, column: 15 });
  return { model, editor, done() { editor.dispose(); model.dispose(); } };
}
const show = (s: string) => JSON.stringify(s);
const at = (editor: monaco.editor.IStandaloneCodeEditor) => editor.trigger("probe", "editor.action.triggerSuggest", {});
const accept = (editor: monaco.editor.IStandaloneCodeEditor) => editor.trigger("probe", "acceptSelectedSuggestion", {});
const undo = (editor: monaco.editor.IStandaloneCodeEditor) => editor.trigger("probe", "undo", {});
const redo = (editor: monaco.editor.IStandaloneCodeEditor) => editor.trigger("probe", "redo", {});
const importEdit = { range: new monaco.Range(1, 1, 1, 1), text: "use foo::Foo;\n" };
const primaryRange = (m: monaco.editor.ITextModel) => ({ startLineNumber: 2, startColumn: 13, endLineNumber: 2, endColumn: 15 });

function itemFor(model: monaco.editor.ITextModel, extra: Partial<monaco.languages.CompletionItem> = {}): monaco.languages.CompletionItem {
  return { label: "Foo", kind: monaco.languages.CompletionItemKind.Struct, insertText: "Foo", range: primaryRange(model), ...extra };
}

async function withProvider(opts: {
  provide: (model: monaco.editor.ITextModel, ctx: monaco.languages.CompletionContext) => monaco.languages.CompletionList;
  resolve?: (item: monaco.languages.CompletionItem) => Promise<monaco.languages.CompletionItem>;
  triggerCharacters?: string[];
}, body: (env: ReturnType<typeof fresh>) => Promise<void>) {
  const env = fresh();
  const reg = monaco.languages.registerCompletionItemProvider("probe", {
    triggerCharacters: opts.triggerCharacters,
    provideCompletionItems: (model, _p, ctx) => opts.provide(model, ctx),
    resolveCompletionItem: opts.resolve ? (item) => opts.resolve!(item) : undefined,
  });
  try { await body(env); } finally { reg.dispose(); env.done(); }
}

async function openList(env: ReturnType<typeof fresh>) { at(env.editor); await sleep(400); }

// ---- V10 --------------------------------------------------------------------
async function v10() {
  say("## V10 — does accept wait for a pending resolveCompletionItem?");
  // A: lazy edits, resolve takes 800 ms.
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model)] }),
    resolve: async (item) => { await sleep(800); return { ...item, additionalTextEdits: [importEdit] }; },
  }, async (env) => {
    await openList(env);
    const t0 = performance.now(); accept(env.editor); await sleep(50);
    say(`A lazy edits, resolve 800ms: 50ms after accept doc=${show(env.model.getValue())}`);
    say(`A   -> primary applied before resolve finished: ${env.model.getValue().includes("let x = Foo")} (waited for resolve: ${!env.model.getValue().includes("let x = Foo")})`);
    await sleep(1000);
    say(`A   after resolve (${Math.round(performance.now() - t0)}ms): doc=${show(env.model.getValue())}`);
    undo(env.editor);
    say(`A   after ONE undo: doc=${show(env.model.getValue())} (V12 lazy case; original=${show(BASE)})`);
  });
  // B: resolve rejects.
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model)] }),
    resolve: async () => { await sleep(100); throw new Error("resolve failed"); },
  }, async (env) => {
    await openList(env); accept(env.editor); await sleep(500);
    say(`B resolve rejects: doc=${show(env.model.getValue())} -> primary alone stays: ${env.model.getValue().includes("let x = Foo") && !env.model.getValue().includes("use foo")}`);
  });
  // C: resolve never settles.
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model)] }),
    resolve: () => new Promise(() => {}),
  }, async (env) => {
    await openList(env); accept(env.editor); await sleep(1500);
    say(`C resolve never settles (1.5s): doc=${show(env.model.getValue())} -> accept did not wait: ${env.model.getValue().includes("let x = Foo")}`);
  });
  // D1: the list item was already resolved on focus (Monaco resolves the selected item) when it carries an
  // edit that touches the insertion line after the cursor: applied synchronously BEFORE the primary edit.
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model)] }),
    resolve: async (item) => { await sleep(100); return { ...item, additionalTextEdits: [{ range: new monaco.Range(2, 16, 2, 16), text: " /*after*/" }] }; },
  }, async (env) => {
    await openList(env); accept(env.editor); await sleep(300);
    say(`D1 resolved before accept, edit located after the insertion point: doc=${show(env.model.getValue())} -> garbled (both edits applied, text mixed): ${/\/\*after\*\//.test(env.model.getValue()) === false}`);
  });
  // D2: same edit, accept while the resolve is still pending: Monaco's async path silently drops it.
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model)] }),
    resolve: async (item) => { await sleep(800); return { ...item, additionalTextEdits: [{ range: new monaco.Range(2, 16, 2, 16), text: " /*after*/" }] }; },
  }, async (env) => {
    await openList(env); accept(env.editor); await sleep(1200);
    say(`D2 pending at accept, edit after the insertion point: doc=${show(env.model.getValue())} -> additional edit dropped, primary kept, no signal: ${!env.model.getValue().includes("/*after*/") && env.model.getValue().includes("Foo")}`);
  });
  // E: a Monaco-local item.command as post-accept hook that waits for Craidd's own resolve result and reverts.
  let commandRan = 0, revertOk = false;
  let gate!: { promise: Promise<boolean>; settle: (ok: boolean) => void };
  const newGate = () => { let settle!: (ok: boolean) => void; const promise = new Promise<boolean>((r) => (settle = r)); gate = { promise, settle }; return gate; };
  monaco.editor.registerCommand("probe.postAccept", async (_acc) => {
    commandRan++;
    const ok = await gate.promise;
    if (!ok) { for (const ed of monaco.editor.getEditors()) { undo(ed as any); revertOk = true; } }
  });
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model, { command: { id: "probe.postAccept", title: "" } })] }),
    resolve: async (item) => item,
  }, async (env) => {
    await openList(env);
    newGate();
    accept(env.editor); await sleep(100);
    say(`E command runs immediately after primary applied: commandRan=${commandRan}, doc at 100ms (gate still closed)=${show(env.model.getValue())}`);
    gate.settle(false); await sleep(300);
    say(`E after the command awaited a failed Craidd resolve and undid: doc=${show(env.model.getValue())} reverted to original: ${env.model.getValue() === BASE} (revert attempted: ${revertOk})`);
  });
  // E2: a user keystroke after accept, before the revert, defeats a plain undo.
  let revertDoc = "";
  let gate2!: () => void; const gate2p = () => new Promise<void>((r) => (gate2 = r));
  let g2: Promise<void>;
  monaco.editor.registerCommand("probe.postAccept2", async (_acc) => { await g2; for (const ed of monaco.editor.getEditors()) undo(ed as any); });
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model, { command: { id: "probe.postAccept2", title: "" } })] }),
  }, async (env) => {
    await openList(env); g2 = gate2p(); accept(env.editor); await sleep(50);
    env.editor.trigger("keyboard", "type", { text: "Z" }); gate2(); await sleep(300);
    revertDoc = env.model.getValue();
    say(`E2 user types 'Z' before the revert fires, then undo: doc=${show(revertDoc)} -> document matches original: ${revertDoc === BASE}`);
  });
}

// ---- V12 --------------------------------------------------------------------
async function v12() {
  say("## V12 — one undo step for primary + additional edits");
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model, { additionalTextEdits: [importEdit] })] }),
  }, async (env) => {
    await openList(env); accept(env.editor); await sleep(100);
    const accepted = env.model.getValue();
    say(`eager edits in the list, accepted: doc=${show(accepted)}`);
    undo(env.editor);
    say(`  after ONE undo: ${show(env.model.getValue())} -> single undo step: ${env.model.getValue() === BASE}`);
    redo(env.editor);
    say(`  after ONE redo: back to accepted: ${env.model.getValue() === accepted}`);
  });
  await withProvider({
    provide: (model) => ({ suggestions: [itemFor(model, { additionalTextEdits: [importEdit] })] }),
  }, async (env) => {
    env.editor.setPosition({ lineNumber: 2, column: 15 });
    env.editor.trigger("keyboard", "type", { text: " " }); env.editor.trigger("keyboard", "type", { text: "" });
    env.editor.executeEdits("probe", [{ range: new monaco.Range(2, 16, 2, 17), text: "" }]);
    await openList(env); accept(env.editor); await sleep(100);
    undo(env.editor);
    say(`  with prior user edits: after ONE undo doc=${show(env.model.getValue())} (the prior user edit must survive)`);
  });
}

// ---- V11 --------------------------------------------------------------------
async function v11() {
  say("## V11 — incomplete-list flag, re-request behaviour, completion context");
  for (const incomplete of [true, false]) {
    const calls: string[] = [];
    await withProvider({
      triggerCharacters: ["."],
      provide: (model, ctx) => { calls.push(`kind=${ctx.triggerKind}${ctx.triggerCharacter ? `(${ctx.triggerCharacter})` : ""}`); return { suggestions: [itemFor(model), itemFor(model, { label: "Fob", insertText: "Fob" })], incomplete }; },
    }, async (env) => {
      await openList(env);
      for (const ch of ["o", "o"]) { env.editor.trigger("keyboard", "type", { text: ch }); await sleep(300); }
      env.editor.trigger("keyboard", "type", { text: "." }); await sleep(300);
      say(`incomplete=${incomplete}: provider calls = [${calls.join(", ")}]`);
    });
  }
  say(`CompletionList flag name on 0.56.0: 'incomplete' (monaco.d.ts); CompletionTriggerKind: Invoke=${monaco.languages.CompletionTriggerKind.Invoke}, TriggerCharacter=${monaco.languages.CompletionTriggerKind.TriggerCharacter}, TriggerForIncompleteCompletions=${monaco.languages.CompletionTriggerKind.TriggerForIncompleteCompletions}`);
}

(async () => {
  try { await v10(); await v12(); await v11(); } catch (e) { say("PROBE ERROR: " + (e as Error).stack); }
  document.getElementById("result")!.textContent = log.join("\n");
})();
