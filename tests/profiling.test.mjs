import {test,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;
Error.stackTraceLimit=0;
const g=globalThis.__profileTest={calls:[],handlers:new Map(),restore:null,bridge:'/tmp/test.sock'};
const zustand=import.meta.resolve('zustand');
const core=url(`export async function invoke(command,args){Error.stackTraceLimit=0;
const g=globalThis.__profileTest;g.calls.push({command,args});if(command==='profiling_bridge')return g.bridge;if(command==='get_profile')return g.restore;}`);
const event=url(`export async function listen(name,cb){globalThis.__profileTest.handlers.set(name,cb);return()=>globalThis.__profileTest.handlers.delete(name);}`);
async function load(file,replacements){let {outputText:s}=ts.transpileModule(await fs.readFile(new URL(file,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});for(const [name,value]of Object.entries({...replacements,react:import.meta.resolve('react'),'react/jsx-runtime':import.meta.resolve('react/jsx-runtime')}))s=s.replaceAll(JSON.stringify(name),JSON.stringify(value));return url(s);}
const storeURL=await load('../src/store/profilingStore.ts',{zustand,'@tauri-apps/api/core':core,'@tauri-apps/api/event':event});
const {useProfiling,listenToProfiling}=await import(storeURL);
const goldURL=await load('../src/store/goldStore.ts',{zustand,'@tauri-apps/api/core':core,'@tauri-apps/api/event':event});
const solution=url(`import{create}from${JSON.stringify(zustand)};export const useSolution=create(()=>({activeFileId:null,tabs:[]}));`);
// SSR uses Zustand's creation-time snapshot; project the real store's current
// state for these presentation assertions. IPC/lifecycle tests above use the actual hook.
const projectedStore=url(`import{useProfiling as store}from${JSON.stringify(storeURL)};export const useProfiling=selector=>selector?selector(store.getState()):store.getState();useProfiling.getState=store.getState;`);
const componentURL=await load('../src/components/panels/ProfilerPanel.tsx',{'../../store/profilingStore':projectedStore,'../../store/goldStore':goldURL,'../../store/solutionStore':solution});
const Panel=(await import(componentURL)).default;
const profile=()=>({id:'process-10-100',target:{pid:10,birth:100},name:'Native probe',active:true,reason:'',batch:1,provider:true,dropped:0,pauses:[],samples:[{atMs:0,cpuMs:1,residentBytes:4096,virtualBytes:8192,threadCount:3,state:'R'},{atMs:250,cpuMs:11,residentBytes:8192,virtualBytes:16384,threadCount:3,state:'R'}],captures:[{id:'r:1:1',marker:'r',name:'Scalar work',thread:20,batch:1,startMs:3,endMs:5,cpuMs:.4,status:'Complete',allocatedBytes:1024,freedBytes:0,liveBytes:1024,allocationCount:1}]});
beforeEach(()=>{g.calls=[];g.handlers.clear();g.restore=null;useProfiling.setState({profile:null,snapshots:[],selected:null,error:null});});
test('Snapshot preserves as-of allocations and rows while live results change',()=>{const p=profile();useProfiling.setState({profile:p});useProfiling.getState().snapshot();const copy=useProfiling.getState().snapshots[0].profile;p.captures[0].liveBytes=0;p.captures.push({...p.captures[0],id:'r:1:2'});assert.equal(copy.captures[0].liveBytes,1024);assert.equal(copy.captures.length,1);assert.equal(useProfiling.getState().profile.captures.length,2);});
test('New process generation archives prior results and listener unsubscribes',async()=>{const off=await listenToProfiling();const emit=p=>g.handlers.get('craidd:profile')({payload:p});emit(profile());emit({...profile(),id:'process-10-101',target:{pid:10,birth:101}});assert.equal(useProfiling.getState().snapshots.length,1);assert.equal(useProfiling.getState().snapshots[0].profile.target.birth,100);assert.equal(useProfiling.getState().profile.target.birth,101);off();assert.equal(g.handlers.size,0);});
test('Record again and Stop address profiling without a debugger control request',async()=>{useProfiling.setState({profile:profile()});await useProfiling.getState().again();await useProfiling.getState().stop();assert.deepEqual(g.calls.map(c=>c.command),['profile_record_again','stop_profiling']);});
test('Real panel labels CPU time, RSS, scoped allocations and unavailable GPU honestly',()=>{useProfiling.setState({profile:profile()});const html=renderToStaticMarkup(createElement(Panel));for(const label of ['CPU time per sample interval','Resident memory','Explicit native allocations','Cohort live as of view','GPU · Planned','Scalar work','Record again'])assert.ok(html.includes(label),label);assert.ok(!html.includes('Record ranges'));assert.ok(html.includes('<svg'));assert.ok(html.includes('<details'));});
test('Unbound provider has no fabricated Gold hits',()=>{useProfiling.setState({profile:{...profile(),provider:false,captures:[]}});const html=renderToStaticMarkup(createElement(Panel));assert.ok(html.includes('Source provider unbound'));assert.ok(html.includes('No Gold hits'));assert.ok(!html.includes('Scalar work'));});
