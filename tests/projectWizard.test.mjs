import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transpile = (source) => ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext,
} }).outputText;
const catalog = JSON.parse(await readFile(new URL('../src/lib/projectTemplates.json', import.meta.url), 'utf8'));
const wizardSource = (await readFile(new URL('../src/lib/projectWizard.ts', import.meta.url), 'utf8'))
  .replace('import catalog from "./projectTemplates.json";', `const catalog = ${JSON.stringify(catalog)};`);
const { filterProjectTemplates, projectNameError } = await import(dataModule(transpile(wizardSource)));

test('template search stays within the selected language and finds interop options', () => {
  const native = filterProjectTemplates('csharp', 'native console');
  assert.equal(native.length, 2);
  assert(native.every((entry) => entry.language === 'csharp' && !entry.available));
  assert.equal(filterProjectTemplates('rust', 'react').filter((entry) => entry.available).length, 1);
  assert.deepEqual(filterProjectTemplates('cpp', 'no-such-template'), []);
  assert.equal(filterProjectTemplates('csharp', '  WEB   API ').filter((entry) => entry.available)[0].id, 'csharp-webapi');
});

test('project names reject traversal and command/markup characters before preview', () => {
  for (const invalid of ['', '../escape', '/absolute', 'two words', 'a;echo', '<tag>', 'a\nb', 'a'.repeat(65)]) {
    assert(projectNameError(invalid), invalid);
  }
  for (const valid of ['MyApp', 'my-app', 'my_app', 'App2']) assert.equal(projectNameError(valid), null);
});

// Exercise the actual store's reload path with a bounded IPC mock. This guards
// unsaved buffers when the wizard adds a project to an already-open solution.
const languageSource = await readFile(new URL('../src/lib/languages.ts', import.meta.url), 'utf8');
const languageModule = dataModule(transpile(languageSource));
const typesModule = dataModule(transpile(await readFile(new URL('../src/types/project.ts', import.meta.url), 'utf8')));
const buildModule = dataModule('export function seedMainChoices() {} export function syncMainChoices() {}');
const ipcModule = dataModule('export async function invoke(command, args) { return globalThis.__craiddWizardTestInvoke(command, args); }');
let storeSource = await readFile(new URL('../src/store/solutionStore.ts', import.meta.url), 'utf8');
storeSource = storeSource.replace('from "zustand"', `from ${JSON.stringify(import.meta.resolve('zustand'))}`)
  .replaceAll('from "../types/project"', `from ${JSON.stringify(typesModule)}`)
  .replace('from "../lib/languages"', `from ${JSON.stringify(languageModule)}`)
  .replace('from "./buildStore"', `from ${JSON.stringify(buildModule)}`)
  .replaceAll('import("@tauri-apps/api/core")', `import(${JSON.stringify(ipcModule)})`);
const { useSolution } = await import(dataModule(transpile(storeSource)));

test('same-solution reload preserves unsaved tabs; switching solutions clears them', async () => {
  const tab = { kind: 'file', id: '/lab/Program.cs', fileId: '/lab/Program.cs', name: 'Program.cs', content: 'unsaved change', originalContent: 'old', dirty: true };
  globalThis.__craiddWizardTestInvoke = (command, args) => {
    if (command === 'read_dir_children') return { id: args.root, name: 'lab', path: '.', kind: 'folder', children: [] };
    if (command === 'load_solution_named') return { clnPath: `${args.path}/${args.clnName}`, solution: {
      name: 'lab', root: args.path, projects: [], build: [], autostart: [], configs: [], inferredConfigs: [],
    } };
    if (command === 'infer_configs') return [];
    throw new Error(`Unexpected IPC: ${command}`);
  };
  try {
    useSolution.setState({ clnPath: '/lab/demo.cln', rootPath: '/lab', tabs: [tab], activeTabId: tab.id, activeFileId: tab.fileId });
    assert.equal((await useSolution.getState().openSolution('/lab/demo.cln', { preserveTabs: true })).status, 'loaded');
    assert.strictEqual(useSolution.getState().tabs[0], tab);
    assert.equal(useSolution.getState().tabs[0].dirty, true);
    assert.equal(useSolution.getState().activeFileId, tab.fileId);
    assert.equal((await useSolution.getState().openSolution('/other/new.cln', { preserveTabs: true })).status, 'loaded');
    assert.deepEqual(useSolution.getState().tabs, []);
    assert.equal(useSolution.getState().activeFileId, null);
  } finally { delete globalThis.__craiddWizardTestInvoke; }
});

test('automatic disk reload preserves an edit arriving during the pending read', async () => {
  const tab = { kind: 'file', id: '/lab/race.rs', fileId: '/lab/race.rs', name: 'race.rs', content: 'old disk', originalContent: 'old disk', dirty: false, diskState: 'newer', mtimeAtLastSync: 1 };
  let release;
  const disk = new Promise(resolve => { release = resolve; });
  globalThis.__craiddWizardTestInvoke = (command) => command === 'read_file' ? disk : [{ mtimeMs: 2 }];
  try {
    useSolution.setState({ tabs: [tab], activeTabId: tab.id, activeFileId: tab.fileId });
    const pending = useSolution.getState().reloadTabFromDisk(tab.fileId, { ifClean: true });
    useSolution.getState().updateTabContent(tab.fileId, 'new unsaved edit');
    release('external disk version');
    await pending;
    const current = useSolution.getState().tabs[0];
    assert.equal(current.content, 'new unsaved edit');
    assert.equal(current.originalContent, 'old disk');
    assert.equal(current.dirty, true);
  } finally { delete globalThis.__craiddWizardTestInvoke; }
});

test('automatic reload updates an unchanged clean file and never reloads read-only source', async () => {
  const tab = { kind: 'file', id: '/lab/clean.rs', fileId: '/lab/clean.rs', name: 'clean.rs', content: 'old', originalContent: 'old', dirty: false, mtimeAtLastSync: 1 };
  const calls = [];
  globalThis.__craiddWizardTestInvoke = (command) => { calls.push(command); return command === 'read_file' ? 'new disk' : [{ mtimeMs: 2 }]; };
  try {
    useSolution.setState({ tabs: [tab], activeTabId: tab.id, activeFileId: tab.fileId });
    await useSolution.getState().reloadTabFromDisk(tab.fileId, { ifClean: true });
    assert.equal(useSolution.getState().tabs[0].content, 'new disk');
    assert.equal(useSolution.getState().tabs[0].dirty, false);
    const locked = { ...tab, readOnly: true };
    useSolution.setState({ tabs: [locked] }); calls.length = 0;
    await useSolution.getState().reloadTabFromDisk(tab.fileId);
    assert.strictEqual(useSolution.getState().tabs[0], locked);
    assert.deepEqual(calls, []);
  } finally { delete globalThis.__craiddWizardTestInvoke; }
});
