import * as monaco from "monaco-editor";
import { registerAcceptCommand, ACCEPT_COMMAND } from "../../src/lib/lsp/completionAccept.ts";
import { listToMonaco } from "../../src/lib/lsp/completion.ts";

// Runs the PRODUCT accept command (src/lib/lsp/completionAccept.ts) and list mapping (completion.ts)
// in plain Monaco 0.56 with a fake language server. Nothing here is product code.
(self as any).MonacoEnvironment = { getWorker: () => new Worker(new URL("../../node_modules/monaco-editor/esm/vs/editor/editor.worker.js", import.meta.url), { type: "module" }) };
monaco.languages.register({ id: "probe" });

const log: string[] = [];
const say = (l: string) => log.push(l);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const show = (s: string) => JSON.stringify(s);
const ok = (b: boolean) => (b ? "OK" : "FAIL");
const host = document.getElementById("host")!;
const r = (l1: number, c1: number, l2: number, c2: number) => ({ start: { line: l1, character: c1 }, end: { line: l2, character: c2 } });
const BASE = "fn main() {\n    let x = HashM\n}\n";
const USE = { range: r(0, 0, 0, 0), newText: "use std::collections::HashMap;\n" };

const notices: string[] = [];
const entries = new Map<string, any>();
let resolveImpl: (item: any) => Promise<any> = async (item) => ({ ...item, additionalTextEdits: [USE] });
let fileId = "";

registerAcceptCommand(monaco, {
  entry: (id) => entries.get(id),
  resolve: async (id) => resolveImpl(entries.get(id).item),
  notice: (_f, text) => notices.push(text),
  boundMs: 700,
});

async function scenario(name: string, text: string, pos: { lineNumber: number; column: number }, items: any[], opts: {
  mode?: "insert" | "replace"; setup?: (e: monaco.editor.IStandaloneCodeEditor) => void; before?: (e: monaco.editor.IStandaloneCodeEditor) => Promise<void>; during?: (e: monaco.editor.IStandaloneCodeEditor) => Promise<void>; resolve?: (item: any) => Promise<any>; wait?: number;
} = {}) {
  const model = monaco.editor.createModel(text, "probe", monaco.Uri.file(`/f3/${name}.rs`));
  fileId = model.uri.path;
  const editor = monaco.editor.create(host, { model, quickSuggestions: false, suggest: { insertMode: opts.mode ?? "insert" } });
  editor.focus(); editor.setPosition(pos);
  notices.length = 0; entries.clear();
  resolveImpl = opts.resolve ?? (async (item) => ({ ...item, additionalTextEdits: [USE] }));
  const states = new Set<string>([model.getValue()]);
  const sub = model.onDidChangeContent(() => states.add(model.getValue()));
  const reg = monaco.languages.registerCompletionItemProvider("probe", {
    provideCompletionItems: (m, p) => {
      const w = m.getWordUntilPosition(p);
      return listToMonaco({ isIncomplete: false, items }, {
        word: { lineNumber: p.lineNumber, startColumn: w.startColumn, endColumn: w.endColumn, text: m.getValueInRange({ startLineNumber: p.lineNumber, startColumn: w.startColumn, endLineNumber: p.lineNumber, endColumn: w.endColumn }) },
        resolveProvider: true, mode: opts.mode ?? "insert", ownedCommand: ACCEPT_COMMAND,
        register: (id, item) => { const key = `${name}:${id}`; entries.set(key, { item, fileId, position: { line: p.lineNumber - 1, character: p.column - 1 } }); return key; },
      }) as any;
    },
  });
  opts.setup?.(editor);
  editor.trigger("probe", "editor.action.triggerSuggest", {}); await sleep(400);
  if (opts.before) await opts.before(editor);
  editor.trigger("probe", "acceptSelectedSuggestion", {});
  const right = model.getValue();
  if (opts.during) await opts.during(editor);
  await sleep(opts.wait ?? 900);
  const out = { model, editor, final: model.getValue(), right, states: [...states], pos: editor.getPosition()!, notices: [...notices] };
  sub.dispose(); reg.dispose();
  return out;
}
const done = (o: { editor: monaco.editor.IStandaloneCodeEditor; model: monaco.editor.ITextModel }) => { o.editor.dispose(); o.model.dispose(); };
const hashMap = { label: "HashMap", kind: 22, data: { d: 1 }, textEdit: { newText: "HashMap", range: r(1, 12, 1, 17) } };
const FINAL = "use std::collections::HashMap;\nfn main() {\n    let x = HashMap\n}\n";

async function main() {
  { // 1 idle accept, cursor and undo
    const o = await scenario("idle", BASE, { lineNumber: 2, column: 18 }, [hashMap]);
    say(`1 idle accept: final=${show(o.final)} ${ok(o.final === FINAL)}; unchanged right after accept ${ok(o.right === BASE)}; cursor=${o.pos.lineNumber}:${o.pos.column} (expect 3:20) ${ok(o.pos.lineNumber === 3 && o.pos.column === 20)}; notices=${show(o.notices)}`);
    o.editor.trigger("probe", "undo", {});
    say(`1   one undo restores exactly: ${ok(o.model.getValue() === BASE)}; states seen: ${o.states.length} (partial: ${o.states.filter((s) => s !== BASE && s !== FINAL).length})`);
    done(o);
  }
  { // 2 user types a character during the resolve (detail 2)
    const o = await scenario("typing", BASE, { lineNumber: 2, column: 18 }, [hashMap], { resolve: async (i) => { await sleep(500); return { ...i, additionalTextEdits: [USE] }; }, during: async (e) => { await sleep(150); e.trigger("keyboard", "type", { text: "Z" }); }, wait: 1000 });
    say(`2 type during resolve: final=${show(o.final)} ${ok(o.final === BASE.replace("HashM", "HashMZ"))}; notice=${show(o.notices)} ${ok(o.notices.length === 1)}`);
    done(o);
  }
  { // 3 resolve fails / never settles
    const a = await scenario("fail", BASE, { lineNumber: 2, column: 18 }, [hashMap], { resolve: async () => { throw new Error("nope"); } });
    say(`3a resolve rejects: ${ok(a.final === BASE)} notices=${show(a.notices)}`); done(a);
    const b = await scenario("hang", BASE, { lineNumber: 2, column: 18 }, [hashMap], { resolve: () => new Promise(() => {}), wait: 1200 });
    say(`3b resolve never settles: ${ok(b.final === BASE)} notices=${show(b.notices)}`); done(b);
  }
  { // 4 overlapping edits, and an edit that reaches the completed line
    for (const [label, edits] of [["overlap", [USE, { range: r(0, 0, 0, 0), newText: "x" }]], ["same line", [{ range: r(1, 4, 1, 9), newText: "" }]]] as any) {
      const o = await scenario("ov" + label.length, BASE, { lineNumber: 2, column: 18 }, [hashMap], { resolve: async (i) => ({ ...i, additionalTextEdits: edits }) });
      say(`4 ${label}: rejected whole ${ok(o.final === BASE)} notice=${show(o.notices)}`); done(o);
    }
  }
  { // 7 typed after the list opened, then accept (detail 1: cursor from the accept-time prefix)
    const o = await scenario("late", BASE, { lineNumber: 2, column: 18 }, [hashMap], { before: async (e) => { e.trigger("keyboard", "type", { text: "a" }); await sleep(300); } });
    say(`7 'a' typed before accept: final=${show(o.final)} ${ok(o.final === FINAL)}; cursor=${o.pos.lineNumber}:${o.pos.column} (expect 3:20) ${ok(o.pos.lineNumber === 3 && o.pos.column === 20)}`);
    done(o);
  }
  { // 8 InsertReplaceEdit: text after the cursor is replaced only in replace mode
    const item = { label: "HashMap", kind: 22, data: { d: 1 }, textEdit: { newText: "HashMap", insert: r(1, 12, 1, 17), replace: r(1, 12, 1, 19) } };
    const text = "fn main() {\n    let x = HashMxx\n}\n";
    for (const mode of ["insert", "replace"] as const) {
      const o = await scenario("ir" + mode, text, { lineNumber: 2, column: 18 }, [item], { mode });
      const want = mode === "insert" ? "use std::collections::HashMap;\nfn main() {\n    let x = HashMapxx\n}\n" : FINAL;
      say(`8 InsertReplaceEdit (${mode}): final=${show(o.final)} ${ok(o.final === want)}`); done(o);
    }
  }
  { // 9 snippet primary: placeholder handling and one undo
    const item = { label: "HashMap", kind: 3, data: { d: 1 }, insertTextFormat: 2, textEdit: { newText: "HashMap::new(${1:cap})$0", range: r(1, 12, 1, 17) } };
    const o = await scenario("snip", BASE, { lineNumber: 2, column: 18 }, [item]);
    say(`9 snippet: final=${show(o.final)} ${ok(o.final === "use std::collections::HashMap;\nfn main() {\n    let x = HashMap::new(cap)\n}\n")}; selection on placeholder: ${show(o.model.getValueInRange(o.editor.getSelection()!))}`);
    o.editor.trigger("probe", "undo", {});
    say(`9   one undo: ${ok(o.model.getValue() === BASE)} (${show(o.model.getValue())})`);
    done(o);
  }
  { // 10 several cursors: rejected, nothing applied
    const o = await scenario("multi", "fn a() {\n    let x = HashM\n    let y = HashM\n}\n", { lineNumber: 2, column: 18 }, [hashMap], { setup: (e) => e.setSelections([new monaco.Selection(2, 18, 2, 18), new monaco.Selection(3, 18, 3, 18)]) });
    say(`10 two cursors: final unchanged ${ok(o.final === "fn a() {\n    let x = HashM\n    let y = HashM\n}\n")}; notice=${show(o.notices)}`);
    done(o);
  }
  { // 11 a second completion opens right after accept
    const o = await scenario("second", BASE, { lineNumber: 2, column: 18 }, [hashMap], { resolve: async (i) => { await sleep(300); return { ...i, additionalTextEdits: [USE] }; },
      during: async (e) => { await sleep(50); e.trigger("probe", "editor.action.triggerSuggest", {}); }, wait: 900 });
    say(`11 second completion opened during the resolve: final=${show(o.final)} ${ok(o.final === FINAL || o.final === BASE)}; partial states: ${o.states.filter((s) => s !== BASE && s !== FINAL).length}; notices=${show(o.notices)}`);
    done(o);
  }
}
main().catch((e) => say("PROBE ERROR: " + (e as Error).stack)).finally(() => { document.getElementById("result")!.textContent = log.join("\n"); });
