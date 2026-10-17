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
const {useProfiling,listenToProfiling,receiveProfile,snapshotIncludesRecording,canTakeSnapshot}=await import(storeURL);
const goldURL=await load('../src/store/goldStore.ts',{zustand,'@tauri-apps/api/core':core,'@tauri-apps/api/event':event});
const solution=url(`import{create}from${JSON.stringify(zustand)};export const useSolution=create(()=>({activeFileId:null,tabs:[]}));`);
// SSR uses Zustand's creation-time snapshot; project the real store's current
// state for these presentation assertions. IPC/lifecycle tests above use the actual hook.
const projectedStore=url(`import{useProfiling as store}from${JSON.stringify(storeURL)};export const useProfiling=selector=>selector?selector(store.getState()):store.getState();useProfiling.getState=store.getState;export {canTakeSnapshot,snapshotIncludesRecording} from ${JSON.stringify(storeURL)};`);
const selectionURL=await load('../src/lib/profilingSelection.ts',{});
const {goldBenchmarks,resolveGoldBenchmark,resolveProfileScope,recordingStatus,timelineEntries}=await import(selectionURL);
const componentURL=await load('../src/components/panels/ProfilerPanel.tsx',{'../../store/profilingStore':projectedStore,'../../store/goldStore':goldURL,'../../store/solutionStore':solution,'../../lib/profilingSelection':selectionURL});
const Panel=(await import(componentURL)).default;
const profile=()=>({id:'process-10-100',target:{pid:10,birth:100},name:'Native probe',active:true,reason:'',batch:1,provider:true,dropped:0,pauses:[],samples:[{atMs:0,cpuMs:1,residentBytes:4096,virtualBytes:8192,threadCount:3,state:'R'},{atMs:250,cpuMs:11,residentBytes:8192,virtualBytes:16384,threadCount:3,state:'R'}],captures:[{id:'r:1:1',marker:'r',name:'Scalar work',solo:false,thread:20,batch:1,startMs:3,endMs:5,cpuMs:.4,status:'Complete',allocatedBytes:1024,freedBytes:0,liveBytes:1024,allocationCount:1}]});
beforeEach(()=>{g.calls=[];g.handlers.clear();g.restore=null;useProfiling.setState({profile:null,snapshots:[],selected:null,recording:null,error:null,benchmarkBySession:{}});});
test('Snapshot preserves as-of allocations and rows while live results change',()=>{const p=profile();useProfiling.setState({profile:p});useProfiling.getState().snapshot();assert.equal(useProfiling.getState().selected,null,"taking a snapshot keeps Live selected");const copy=useProfiling.getState().snapshots[0].profile;p.captures[0].liveBytes=0;p.captures.push({...p.captures[0],id:'r:1:2'});assert.equal(copy.captures[0].liveBytes,1024);assert.equal(copy.captures.length,1);assert.equal(useProfiling.getState().profile.captures.length,2);});
test('New process generation archives prior results and listener unsubscribes',async()=>{const off=await listenToProfiling();const emit=p=>g.handlers.get('craidd:profile')({payload:p});emit(profile());emit({...profile(),id:'process-10-101',target:{pid:10,birth:101}});assert.equal(useProfiling.getState().snapshots.length,1);assert.equal(useProfiling.getState().snapshots[0].profile.target.birth,100);assert.equal(useProfiling.getState().profile.target.birth,101);off();assert.equal(g.handlers.size,0);});
test('Record again and Stop address profiling without a debugger control request',async()=>{useProfiling.setState({profile:profile()});await useProfiling.getState().again();await useProfiling.getState().stop();assert.deepEqual(g.calls.map(c=>c.command),['profile_record_again','stop_profiling']);});
test('Full session Summary preserves process context without summing overlapping capture CPU',()=>{
 const p=profile();p.captures.push({...p.captures[0],id:'r:1:2',cpuMs:.8});useProfiling.setState({profile:p});useProfiling.getState().focusBenchmark(p.id,"r");
 const html=renderToStaticMarkup(createElement(Panel));
 for(const label of ['Process Memory (RSS)','Process CPU time (ms / interval)','Recording thread CPU','Observed native live','Take snapshot','Profiling results'])assert.ok(html.includes(label),label);
 assert.ok(!html.includes('Record ranges'));assert.ok(html.includes('<svg'));assert.ok(!html.includes('Native provider setup'));
});
test('Unbound provider does not present missing native allocations as measured zero',()=>{
 useProfiling.setState({profile:{...profile(),provider:false,captures:[]}});const html=renderToStaticMarkup(createElement(Panel));
 assert.ok(html.includes('Process metrics only'));assert.ok(html.includes('Observed native live</dt><dd>—'));assert.ok(!html.includes('Scalar work'));
});

const soloCapture=()=>({...profile().captures[0],id:'solo:s:1',marker:'s',name:'Whole session',solo:true,cpuMs:null,endMs:null});
test('Solo is classified without guessing names, and unset selection stays Full session',()=>{
 const misleading={...profile().captures[0],name:'Solo',id:'solo-looking-but-a-range'};
 assert.equal(resolveGoldBenchmark(goldBenchmarks([misleading]),undefined),null);
 const choices=goldBenchmarks([misleading,soloCapture()]);
 assert.equal(choices[0].marker,'s');assert.equal(resolveGoldBenchmark(choices,undefined),null);
});
test('Explicit range and process overview choices survive new hits, Solo and record-again batches',async()=>{
 const p=profile();useProfiling.setState({profile:p});
 useProfiling.getState().focusBenchmark(p.id,'r');
 const first=resolveGoldBenchmark(goldBenchmarks(p.captures),useProfiling.getState().benchmarkBySession[p.id]);
 assert.equal(first,'r');assert.equal(g.calls.length,0);
 p.captures.push(soloCapture(),{...soloCapture(),id:'solo:s:2',batch:2});
 await useProfiling.getState().again();
 assert.equal(resolveGoldBenchmark(goldBenchmarks(p.captures),useProfiling.getState().benchmarkBySession[p.id]),'r');
 useProfiling.getState().focusBenchmark(p.id,null);
 assert.equal(resolveGoldBenchmark(goldBenchmarks(p.captures),useProfiling.getState().benchmarkBySession[p.id]),null);
 assert.deepEqual(g.calls.map(c=>c.command),['profile_record_again']);
});
test('Snapshot views keep chosen identity even without its hits; another process gets its own default',()=>{
 const p=profile();useProfiling.setState({profile:p});useProfiling.getState().snapshot();
 useProfiling.getState().focusBenchmark(p.id,'s');
 assert.equal(resolveGoldBenchmark(goldBenchmarks(p.captures),useProfiling.getState().benchmarkBySession[p.id]),'s');
 const next={...profile(),id:'another-process',captures:[soloCapture()]};useProfiling.setState({profile:next});
 assert.equal(resolveGoldBenchmark(goldBenchmarks(next.captures),useProfiling.getState().benchmarkBySession[next.id]),null);
 assert.equal(useProfiling.getState().benchmarkBySession[next.id],undefined);
 assert.equal(useProfiling.getState().benchmarkBySession[p.id],'s');
});

test('Unity between Play sessions stays armed and presents Ready for Play',()=>{
 useProfiling.setState({profile:{...profile(),unityEditor:true,waitingForPlay:true}});
 const html=renderToStaticMarkup(createElement(Panel));
 assert.ok(html.includes('Ready for Play'));assert.ok(html.includes('Unity · ready for Play'));
 assert.ok(/aria-label="Snapshot and record again" disabled/.test(html));
});

test('Evicting a reviewed snapshot returns to Live instead of leaving a missing view',()=>{
 useProfiling.setState({profile:profile()});
 useProfiling.getState().snapshot();const oldest=useProfiling.getState().snapshots[0].id;
 useProfiling.getState().select(oldest);
 for(let i=0;i<8;i++)useProfiling.getState().snapshot();
 assert.equal(useProfiling.getState().snapshots.length,8);
 assert.equal(useProfiling.getState().selected,null);
 assert.ok(useProfiling.getState().profile);
});

const counters=()=>({agedSamples:0,evictedCaptures:0,rejectedEvents:0,sourceGaps:0,disconnects:0});
const activity=(allocatedBytes=0,freedBytes=0)=>({allocatedBytes,freedBytes,allocationCount:1,freeCount:0,unmatchedFrees:0});
function scopedProfile(){
 const p=profile();p.observedAtMs=1000;p.counters=counters();p.nativeActivity=activity(2048);p.nativeLiveBytes=2048;
 p.samples=[0,250,500,750,1000].map(atMs=>({atMs,cpuMs:atMs*2,residentBytes:900000000+atMs,virtualBytes:1000000000,threadCount:4,state:'R'}));
 p.captures=[{...p.captures[0],startMs:250,endMs:null,coverageStart:counters(),windowActivity:activity(1024),processStart:p.samples[1]}];
 p.pauses=[{startMs:100,endMs:200,reason:'outside',allThreads:true,thread:null},{startMs:300,endMs:600,reason:'inside',allThreads:true,thread:null}];
 p.diagnostics=[{atMs:100,untilMs:120,kind:'outside',count:1},{atMs:400,untilMs:410,kind:'inside',count:1}];return p;
}
const ref=(p,c=p.captures[0])=>({...c,profileId:p.id});
test('One resolver scopes active CPU/RSS, captures, pauses and diagnostics while Full Live restores all samples',()=>{
 const p=scopedProfile(),r=ref(p);let s=resolveProfileScope(p,r);
 assert.deepEqual(s.bounds,[250,1000]);assert.deepEqual(s.samples.map(s=>s.atMs),[250,500,750,1000]);assert.equal(s.cpu.length,3);
 assert.deepEqual(s.pauses.map(s=>s.reason),['inside']);assert.deepEqual(s.diagnostics.map(d=>d.kind),['inside']);assert.equal(s.status,'Recording');
 s=resolveProfileScope(p,null);assert.equal(s.samples.length,5);assert.equal(s.cpu.length,4);assert.equal(s.pauses.length,2);assert.equal(s.activity.allocatedBytes,2048);
});
test('Completed Gold keeps its identity, fixed boundaries and frozen End cohort after late frees',()=>{
 const p=scopedProfile();useProfiling.setState({profile:p});useProfiling.getState().focusRecording(p.id,p.captures[0]);
 const completed=structuredClone(p);Object.assign(completed.captures[0],{endMs:650,status:'Complete',cohortEnd:{allocatedBytes:1024,freedBytes:0,liveBytes:1024,allocationCount:1},coverageEnd:counters(),processEnd:p.samples[2]});
 receiveProfile(completed);const chosen=useProfiling.getState().recording;assert.equal(chosen.id,p.captures[0].id);assert.equal(chosen.endMs,650);assert.equal(useProfiling.getState().selected,null);
 completed.observedAtMs=4000;completed.captures[0].liveBytes=0;completed.captures[0].freedBytes=1024;
 const s=resolveProfileScope(completed,chosen);assert.deepEqual(s.bounds,[250,650]);assert.equal(s.status,'Recorded');assert.equal(s.cohort.liveBytes,1024);assert.equal(s.recording.liveBytes,0);assert.deepEqual(s.samples.map(s=>s.atMs),[250,500]);assert.equal(s.cpu.length,1);
});
test('A crossing CPU interval and a sub-poll recording do not invent function CPU or RSS change',()=>{
 const p=scopedProfile();Object.assign(p.captures[0],{startMs:260,endMs:270,status:'Complete',processStart:p.samples[1],processEnd:p.samples[1]});
 const s=resolveProfileScope(p,ref(p));assert.equal(s.cpu.length,0);assert.equal(s.samples.length,0);assert.equal(s.rssDelta,null);assert.match(s.history,/unavailable/);assert.equal(s.recording.cpuMs,.4);
});
test('Sample aging and capture eviction remain explicit and never fall back to Full Live',()=>{
 const p=scopedProfile();p.samples=p.samples.slice(2);p.counters.agedSamples=2;
 let s=resolveProfileScope(p,ref(p));assert.match(s.history,/Partial history/);
 const r=ref(p);p.captures=[];s=resolveProfileScope(p,r);assert.equal(s.missing,true);assert.equal(s.samples.length,0);assert.equal(s.activity,null);assert.match(s.history,/evicted/);
});
test('Snapshot creation in a recording preserves selection; the saved source and context remain immutable',()=>{
 const p=scopedProfile();useProfiling.setState({profile:p});useProfiling.getState().focusRecording(p.id,p.captures[0]);useProfiling.getState().snapshot();
 let state=useProfiling.getState();assert.equal(state.selected,null);assert.equal(state.recording.id,p.captures[0].id);const snap=state.snapshots[0];assert.equal(snap.recording.id,p.captures[0].id);assert.ok(snap.activeRecordingIds.includes(p.captures[0].id));
 p.observedAtMs=5000;p.captures[0].endMs=3000;
 useProfiling.getState().select(snap.id);state=useProfiling.getState();const s=resolveProfileScope(snap.profile,state.recording,true);assert.deepEqual(s.bounds,[250,1000]);assert.equal(s.status,'Open at snapshot');
 useProfiling.getState().select(null);assert.equal(useProfiling.getState().recording,null);assert.equal(resolveProfileScope(p,null).samples.length,5);
});
test('Manual snapshots work without Gold and preserve explicit snapshot review when another is saved',()=>{
 const p=scopedProfile();p.captures=[];useProfiling.setState({profile:p});useProfiling.getState().snapshot();let state=useProfiling.getState();assert.equal(state.selected,null);const id=state.snapshots[0].id;
 useProfiling.getState().select(id);useProfiling.getState().snapshot();assert.equal(useProfiling.getState().selected,id);assert.equal(state.snapshots[0].profile.nativeLiveBytes,2048);
});
test('Completed Solo remains selected across another Play generation and Record again',async()=>{
 const p=scopedProfile();p.captures[0].solo=true;useProfiling.setState({profile:p});useProfiling.getState().focusRecording(p.id,p.captures[0]);
 const next=structuredClone(p);Object.assign(next.captures[0],{endMs:600,status:'Unity Play ended'});next.captures.push({...p.captures[0],id:'new-solo',startMs:800,batch:2});next.playGeneration=2;
 receiveProfile(next);await useProfiling.getState().again();assert.equal(useProfiling.getState().recording.id,p.captures[0].id);assert.equal(recordingStatus(next.captures[0]),'Recorded');assert.deepEqual(resolveProfileScope(next,useProfiling.getState().recording).bounds,[250,600]);
});
test('Coverage before a recording is not reattributed to it; missing metadata stays unknown',()=>{
 const p=scopedProfile();p.counters.sourceGaps=5;p.captures[0].coverageStart={...counters(),sourceGaps:5};assert.equal(resolveProfileScope(p,ref(p)).coverageLost,false);
 p.counters.sourceGaps=6;assert.equal(resolveProfileScope(p,ref(p)).coverageLost,true);
 p.captures[0].endMs=600;assert.equal(resolveProfileScope(p,ref(p)).cohort,null);
});
test('Custom graph subwindows cannot fabricate allocation totals from cumulative counters',()=>{
 const p=scopedProfile();const s=resolveProfileScope(p,ref(p),false,[300,700]);assert.deepEqual(s.window,[300,700]);assert.equal(s.activity,null);assert.deepEqual(s.samples.map(s=>s.atMs),[500]);
});

test('Snapshot history stays separate from the one-entry-per-marker scope picker',()=>{
 const p=scopedProfile();p.captures.push({...p.captures[0],id:'repeat',startMs:750});useProfiling.setState({profile:p});useProfiling.getState().snapshot();
 const html=renderToStaticMarkup(createElement(Panel));const history=html.match(/<select aria-label="Profiler view"[\s\S]*?<\/select>/)[0];const scopes=html.match(/<select id="profiler-scope"[\s\S]*?<\/select>/)[0];
 assert.ok(history.includes('Manual snapshots'));assert.ok(!history.includes('Scalar work'));assert.equal((scopes.match(/value="r"/g)||[]).length,1);assert.ok(!scopes.includes('Snapshot ·'));
});

test('Timeline reserves selected capture and separates three overlapping intervals into distinct lanes',()=>{
 const p=scopedProfile(),c=p.captures[0];const entries=timelineEntries([c,{...c,id:'nested',startMs:300,endMs:500},{...c,id:'parent',startMs:0,endMs:1000}],c.id,[0,1000]);
 assert.equal(entries.length,3);assert.equal(new Set(entries.map(e=>e.lane)).size,3);assert.equal(entries[0].capture.id,c.id);
});


test('One live snapshot belongs to all active overlaps regardless of the historical viewing scope',()=>{
 const p=scopedProfile(),outer=p.captures[0];p.captures.push({...outer,id:'inner',marker:'inner',startMs:500},{...outer,id:'completed',marker:'completed',endMs:600,status:'Complete'});
 useProfiling.setState({profile:p});useProfiling.getState().focusRecording(p.id,p.captures[2]);
 useProfiling.getState().snapshot();let state=useProfiling.getState();const first=state.snapshots[0];
 assert.deepEqual(first.activeRecordingIds,[outer.id,'inner']);assert.equal(first.recording,null);assert.equal(state.recording.id,'completed');assert.equal(state.snapshots.length,1);
 assert.equal(snapshotIncludesRecording(first,ref(p,outer)),true);assert.equal(snapshotIncludesRecording(first,ref(p,p.captures[1])),true);assert.equal(snapshotIncludesRecording(first,ref(p,p.captures[2])),false);
 const html=renderToStaticMarkup(createElement(Panel));assert.ok(!html.includes('Snapshots for this recording'));assert.ok(!/aria-label="Take memory snapshot" disabled/.test(html));
 useProfiling.getState().focusRecording(p.id,outer);useProfiling.getState().snapshot();assert.equal(useProfiling.getState().snapshots.length,2);
 useProfiling.getState().select(first.id);const saved=JSON.stringify(first);p.nativeLiveBytes=4096;p.captures[0].endMs=1100;p.captures[1].endMs=1100;p.captures.push({...outer,id:'new',endMs:null,startMs:1200});
 useProfiling.getState().snapshot();state=useProfiling.getState();assert.equal(state.selected,first.id);assert.equal(state.snapshots[2].profile.nativeLiveBytes,4096);assert.deepEqual(state.snapshots[2].activeRecordingIds,['new']);assert.equal(JSON.stringify(first),saved);
 assert.equal(snapshotIncludesRecording(first,ref(p,p.captures[0])),true);assert.equal(snapshotIncludesRecording(state.snapshots[2],ref(p,p.captures[0])),false);
 assert.equal(snapshotIncludesRecording(first,{...ref(p,p.captures[0]),profileId:'different-session'}),false);
});
test('Related snapshot grouping keeps every saved identity once in global history after completion',()=>{
 const p=scopedProfile();useProfiling.setState({profile:p});useProfiling.getState().snapshot();useProfiling.getState().snapshot();p.captures[0].endMs=900;useProfiling.getState().focusRecording(p.id,p.captures[0]);useProfiling.getState().snapshot();
 const state=useProfiling.getState(),html=renderToStaticMarkup(createElement(Panel));const menu=html.match(/<select aria-label="Profiler view"[\s\S]*?<\/select>/)[0];
 assert.ok(menu.includes('Snapshots for this recording'));assert.ok(menu.includes('Other manual snapshots'));for(const s of state.snapshots)assert.equal(menu.split(`value="${s.id}"`).length-1,1);
 assert.equal(state.snapshots.filter(s=>snapshotIncludesRecording(s,state.recording)).length,2);
});
test('Snapshot availability depends on live process rather than viewed recording',()=>{
 const p=scopedProfile();assert.equal(canTakeSnapshot(p),true);assert.equal(canTakeSnapshot({...p,active:false}),false);assert.equal(canTakeSnapshot({...p,samples:[]}),false);
 useProfiling.setState({profile:{...p,active:false}});useProfiling.getState().snapshot();assert.equal(useProfiling.getState().snapshots.length,0);
});
test('Missing open recording has an unknown End and duration rather than a fabricated zero',()=>{
 const p=scopedProfile(),r=ref(p);p.captures=[];useProfiling.setState({profile:p,recording:r});const html=renderToStaticMarkup(createElement(Panel));
 assert.ok(html.includes('End unavailable'));assert.ok(html.includes('Recording duration</dt><dd>—'));assert.ok(!html.includes('Recording duration</dt><dd>0.00 ms'));
});
