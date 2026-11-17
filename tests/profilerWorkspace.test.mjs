import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
const url = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const zustand = import.meta.resolve('zustand');
async function load(file, replacements = {}) {
  let { outputText } = ts.transpileModule(await readFile(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  });
  for (const [from, to] of Object.entries({ zustand, ...replacements })) outputText = outputText.replaceAll(JSON.stringify(from), JSON.stringify(to));
  return url(outputText);
}
const types = await load('../src/types/project.ts');
const { PROFILER_TAB_ID } = await import(types);
const languages = await load('../src/lib/languages.ts');
const calls = globalThis.__workspaceCalls = [];
const core = url(`export async function invoke(command,args){globalThis.__workspaceCalls.push({command,args});
 if(command==='read_file')return 'saved source';
 if(command==='stat_files')return args.paths.map(path=>({path,exists:true,readable:true,mtimeMs:1,size:12}));}`);
const solutionURL = await load('../src/store/solutionStore.ts', {
  '../types/project': types, '../lib/languages': languages,
  './buildStore': url('export const seedMainChoices=()=>{};export const syncMainChoices=()=>{};'),
  '@tauri-apps/api/core': core,
});
const { useSolution } = await import(solutionURL);
const splitURL = await load('../src/store/splitStore.ts', { './solutionStore': solutionURL });
const { useSplit, openInSideGroup } = await import(splitURL);
const preferencesURL = await load('../src/store/preferencesStore.ts');
const { usePreferences } = await import(preferencesURL);
const linkedURL = url(`import {create} from ${JSON.stringify(zustand)};export const useLinkedWindows=create(set=>({windows:[],ownWindowLabel:'own',viewedWindowLabel:'own',remoteEditing:false,setRemoteEditing:remoteEditing=>set({remoteEditing})}));export async function dispatchLinkedWindowCommand(windowLabel,command,payload){globalThis.__workspaceCalls.push({command,args:{windowLabel,payload}});}`);
const { useLinkedWindows } = await import(linkedURL);
const workspaceURL = await load('../src/lib/profilerWorkspace.ts', {
  '../store/solutionStore': solutionURL, '../store/preferencesStore': preferencesURL,
  '../store/linkedWindowsStore': linkedURL, '../store/splitStore': splitURL,
  './activeEditor': await load('../src/lib/activeEditor.ts'),
});
const { openProfilerWorkspace, showProfiler } = await import(workspaceURL);
const { openWorkspaceFile } = await import(await load('../src/lib/openWorkspaceFile.ts', {
  '../types/project': types, '../store/solutionStore': solutionURL, '../store/linkedWindowsStore': linkedURL,
}));
globalThis.window = new EventTarget();
beforeEach(async () => {
  await new Promise(resolve => setImmediate(resolve));
  useSolution.getState().clearSolution();
  usePreferences.setState({ rightPanelVisible: true, rightPanelTab: 'debugger' });
  useSplit.getState().closeSide();
  useLinkedWindows.setState({ windows: [], viewedWindowLabel: 'own', remoteEditing: false });
  calls.length = 0;
});

test('One typed Profiling tab coexists with dirty files and never becomes an active file', async () => {
  const s = useSolution.getState();
  await s.openFile('/test/a.txt', 'a.txt');
  s.updateTabContent('/test/a.txt', 'unsaved source');
  openProfilerWorkspace(); openProfilerWorkspace();
  let state = useSolution.getState();
  assert.equal(state.tabs.length, 2); assert.equal(state.activeTabId, PROFILER_TAB_ID);
  assert.equal(state.activeFileId, null); assert.equal(state.lastSourceFileId, '/test/a.txt');
  assert.deepEqual(state.tabs[1], { kind: 'profiler', id: PROFILER_TAB_ID, name: 'Profiling' });
  state.setActiveFile('/test/a.txt'); state = useSolution.getState();
  assert.equal(state.activeTabId, '/test/a.txt'); assert.equal(state.activeFileId, '/test/a.txt');
  assert.equal(state.tabs[0].content, 'unsaved source'); assert.equal(state.tabs[0].dirty, true);
  state.setActiveTab(PROFILER_TAB_ID); state.closeTab(PROFILER_TAB_ID);
  assert.equal(useSolution.getState().activeFileId, '/test/a.txt');
  assert.equal(useSolution.getState().tabs[0].dirty, true);
  assert.ok(!calls.some(c => /profiling|debug/.test(c.command)));
});

test('Disk and save paths exclude workspace tabs, including when Profiler is the only tab', async () => {
  const s = useSolution.getState(); s.openProfiler();
  await s.refreshDiskStates(); await s.reloadTabFromDisk(PROFILER_TAB_ID);
  assert.equal(await s.saveFile(PROFILER_TAB_ID), 'error'); assert.equal(calls.length, 0);
  await s.openFile('/test/a.txt', 'a.txt'); s.openProfiler(); calls.length = 0;
  await s.refreshDiskStates();
  assert.deepEqual(calls.map(c => c.args.paths), [['/test/a.txt']]);
  s.closeTab('/test/a.txt'); assert.equal(useSolution.getState().activeTabId, PROFILER_TAB_ID);
  s.closeTab(PROFILER_TAB_ID); assert.equal(useSolution.getState().activeTabId, null);
});

test('Opening Markdown beside Profiling keeps the hidden owning-window guard and routes clean files', async () => {
  openProfilerWorkspace();
  const path='/test/guide.md';
  const hidden={windowLabel:'hidden',visible:false,restoring:false,tabs:[{path,dirty:true}]};
  useLinkedWindows.setState({viewedWindowLabel:'hidden',windows:[hidden]});
  await assert.rejects(openWorkspaceFile(path),/Save this file in its owning window/);
  assert.equal(useSolution.getState().activeTabId,PROFILER_TAB_ID);
  assert.equal(calls.length,0,'a dirty foreign document is never read into this window');
  useLinkedWindows.setState({windows:[{...hidden,tabs:[{path,dirty:false}]}]});
  await openWorkspaceFile(path);
  const state=useSolution.getState();
  assert.equal(state.activeFileId,path);
  assert.equal(state.tabs.length,2);
  assert.equal(state.tabs.find(tab=>tab.id===path).kind,'file');
  assert.equal(useLinkedWindows.getState().remoteEditing,true);
  assert.ok(calls.some(c=>c.command==='reveal_file'&&c.args.windowLabel==='hidden'&&JSON.parse(c.args.payload).file===path));
  openProfilerWorkspace();assert.equal(useSolution.getState().lastSourceFileId,path);
});

test('Split open and focus never expose an intermediate primary source selection', async () => {
  openProfilerWorkspace(); const seen = [];
  const off = useSolution.subscribe(s => seen.push(s.activeTabId));
  await openInSideGroup('/test/side.txt'); useSplit.getState().setSideFocused(true); off();
  assert.equal(useSolution.getState().activeTabId, PROFILER_TAB_ID);
  assert.ok(seen.length > 0); assert.ok(seen.every(id => id === PROFILER_TAB_ID));
  assert.equal(useSplit.getState().sideFileId, '/test/side.txt');
  assert.equal(usePreferences.getState().rightPanelVisible, true);
});

test('Show routing reveals the sidebar or existing primary tab without mutating manual visibility', () => {
  usePreferences.setState({ rightPanelVisible: false }); showProfiler();
  assert.equal(usePreferences.getState().rightPanelTab, 'profiler');
  assert.equal(usePreferences.getState().rightPanelVisible, true);
  openProfilerWorkspace(); usePreferences.setState({ rightPanelVisible: false });
  useLinkedWindows.setState({ viewedWindowLabel: 'hidden' }); showProfiler();
  assert.equal(useSolution.getState().activeTabId, PROFILER_TAB_ID);
  assert.equal(usePreferences.getState().rightPanelVisible, false);
  assert.equal(useLinkedWindows.getState().viewedWindowLabel, 'hidden');
  assert.equal(useLinkedWindows.getState().remoteEditing, true);
  assert.equal(calls.length, 0);
});

test('Profiler navigation preserves read-only source and dirty editable buffer identities', async () => {
  const state = useSolution.getState();
  await state.openFile('/test/main.rs', 'main.rs');
  state.updateTabContent('/test/main.rs', 'unsaved main');
  state.revealReadOnly('/sdk/map.rs', 'external source', 3, 2);
  openProfilerWorkspace();
  state.updateTabContent('/sdk/map.rs', 'attempted external edit');
  state.markReadOnlyIfClean('/test/main.rs');
  assert.equal(await state.saveFile('/sdk/map.rs'), 'error');
  await assert.rejects(state.saveFileAs('/sdk/map.rs', '/test/copied.rs'), /read-only/);
  const current = useSolution.getState();
  assert.equal(current.activeTabId, PROFILER_TAB_ID);
  assert.equal(current.activeFileId, null);
  assert.equal(current.tabs.find(tab => tab.id === '/test/main.rs').content, 'unsaved main');
  assert.equal(current.tabs.find(tab => tab.id === '/test/main.rs').dirty, true);
  assert.equal(current.tabs.find(tab => tab.id === '/test/main.rs').readOnly, undefined);
  const external = current.tabs.find(tab => tab.id === '/sdk/map.rs');
  assert.equal(external.content, 'external source');
  assert.equal(external.dirty, false);
  assert.equal(external.readOnly, true);
  assert.ok(!calls.some(call => /write|overwrite/.test(call.command)));
});
