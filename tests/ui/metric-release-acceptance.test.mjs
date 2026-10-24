// Release-only distributions and owning-window recovery. Run displays serially.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,readlink,stat} from 'node:fs/promises';
import {tmpdir,hostname,release} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {launch,openSolution,switchToLabel,processIdentity} from './lib/harness.mjs';
import {showProfiler} from './lib/profiler.mjs';
const enabled=process.env.CRAIDD_TEST_METRIC_RELEASE==='1';
const file=process.env.CRAIDD_METRIC_MILLION;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function memory(host){
  const all=new Map();
  for(const entry of await readdir('/proc')){
    if(!/^\d+$/.test(entry))continue;
    try{const raw=await readFile(`/proc/${entry}/stat`,'utf8'),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');all.set(+entry,{pid:+entry,parent:+fields[1],rssBytes:+fields[21]*4096,cpuTicks:+fields[11]+ +fields[12],comm:raw.slice(raw.indexOf('(')+1,raw.lastIndexOf(')'))});}catch{}
  }
  const ids=new Set([host.pid]);for(let n=0;n<12;n++)for(const [id,p]of all)if(ids.has(p.parent))ids.add(id);
  const processes=[];
  for(const id of ids){const p=all.get(id);if(!p)continue;try{p.executable=await readlink(`/proc/${id}/exe`);const rollup=await readFile(`/proc/${id}/smaps_rollup`,'utf8');p.pssBytes=Number(/^Pss:\s+(\d+)/m.exec(rollup)?.[1])*1024;}catch{}processes.push(p);}
  return {epochMs:Date.now(),rssBytes:processes.reduce((sum,p)=>sum+p.rssBytes,0),pssBytes:processes.reduce((sum,p)=>sum+(p.pssBytes||0),0),processes};
}
async function setup(name){
  const root=await mkdtemp(join(tmpdir(),`craidd-${name}-`)),runtime=join(root,'runtime');await mkdir(runtime,{mode:0o700});
  const solution=join(root,'Metrics.cln');await writeFile(solution,'[solution]\nname="Release metrics acceptance"\nversion="1.0"\nprojects=[]\n');
  const app=await launch(name,{environment:{XDG_RUNTIME_DIR:runtime,CRAIDD_METRIC_TRACE:'1',JSC_logGC:'1'}});
  app.timestampedLog=[];const push=app.log.push.bind(app.log);app.log.push=(...lines)=>{for(const line of lines)app.timestampedLog.push({epochMs:Date.now(),line});return push(...lines)};
  try {
  let host;
  await app.waitFor('task-owned native host',async()=>{
    for(const name of await readdir('/proc')){
      if(!/^\d+$/.test(name))continue;
      try{if((await readlink(`/proc/${name}/exe`))!==process.env.CRAIDD_UI_APP)continue;
        const args=(await readFile(`/proc/${name}/cmdline`)).toString().split('\0').filter(Boolean);if(args.length!==1)continue;
        const identity=await processIdentity(name);let parent=identity.parent;
        for(let n=0;n<12&&parent>1;n++){if(parent===app.driverPid){host=identity;return {done:true}}parent=(await processIdentity(parent)).parent;}
      }catch{}
    }return {done:false};
  });
  const mainLabel=await app.wd.execute('return window.__TAURI_INTERNALS__.metadata.currentWindow.label');
  await app.wd.command('POST','/window/rect',{width:1600,height:1050});
  const oneWindow=await memory(host),owner=await openSolution(app,solution);
  await app.wd.command('POST','/window/rect',{width:1600,height:1050});
  await showProfiler(app);
  await app.wd.execute('[...document.querySelectorAll("button")].find(b=>b.textContent==="Open metric imports").click()');
  await app.waitFor('metric editor',async()=>({done:await app.wd.execute('return !!document.querySelector(".metric-import-panel")')}));
  await app.invoke('focus_linked_window',{targetLabel:owner});
  await app.wd.click(await app.wd.find('//button[normalize-space()="Focus analysis"]'));
  await app.wd.command('POST','/window/rect',{width:1600,height:1050});
  await sleep(200);
  app.record('measurement-window',await app.wd.execute('return {width:innerWidth,height:innerHeight,outerWidth,outerHeight,visible:document.visibilityState,focused:document.hasFocus(),dpr:devicePixelRatio}'));
  return {app,host,mainLabel,owner,oneWindow,root};
  } catch(error) { await app.close(); throw error; }
}
async function start(app){
  const {id}=await app.invoke('metric_action',{request:{op:'start',paths:[file],snapshot:false}});
  // Populate the public source picker through its actual import action is preferable
  // for measurements; direct IPC is reserved for the close-race recovery case.
  return id;
}
const summary=values=>{const sorted=[...values].sort((a,b)=>a-b);return {n:sorted.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};

test('M1 release: 20 observations per operation with query/render diagnostics',{skip:!enabled,timeout:240000},async t=>{
  assert.ok(file);assert.ok(process.env.CRAIDD_UI_APP?.includes('/release/'),'explicit release binary required');
  const {app,host,oneWindow,owner}=await setup('metric-release-distributions');t.after(async()=>{try{const context=await app.wd.execute('return {visibility:document.visibilityState,focused:document.hasFocus(),width:innerWidth,height:innerHeight,diagnostics:window.__metricDiagnostic,graph:document.querySelector(`[aria-label="Metric range graph"]`)?.dataset}');await writeFile(join(app.dir,'final-diagnostics.json'),JSON.stringify(context,null,2));}finally{await app.close();}});
  let stage="diagnostics";
  t.after(async()=>{await writeFile(join(app.dir,'last-stage.json'),JSON.stringify({stage},null,2));});
  const baseline=await memory(host),input=await stat(file),originalHash=hash(await readFile(file));
  await app.wd.execute(`window.__metricDiagnostic={entries:[],queries:[],gaps:[],last:performance.now()};window.__metricDiagnosticTimer=setInterval(()=>{const now=performance.now(),d=window.__metricDiagnostic;d.gaps.push({start:d.last,end:now,gap:now-d.last});d.last=now;if(d.gaps.length>2000)d.gaps.shift()},16);window.__metricDiagnosticObserver=new PerformanceObserver(list=>{for(const e of list.getEntries())if(e.name.startsWith('craidd.metrics.')||e.entryType==='gc'||e.entryType==='longtask'){window.__metricDiagnostic.entries.push({type:e.entryType,name:e.name,start:e.startTime,ms:e.duration});const detail=e.detail;if(detail?.query){const queries=window.__metricDiagnostic.queries;let q=queries.find(v=>v.query===detail.query);if(!q){q={query:detail.query,op:detail.op,started:e.startTime,ended:null};queries.push(q);if(queries.length>2000)queries.shift();}if(e.entryType==='measure'){q.started=e.startTime;q.ended=e.startTime+e.duration;}}if(window.__metricDiagnostic.entries.length>1000)window.__metricDiagnostic.entries.shift();}});const types=['mark','measure','gc','longtask'].filter(t=>PerformanceObserver.supportedEntryTypes.includes(t));window.__metricDiagnosticObserver.observe({entryTypes:types});`);
  let sampling=true,peak=baseline;const samples=[];t.after(()=>{sampling=false});
  const sampler=(async()=>{while(sampling){const m=await memory(host);samples.push(m);if(m.rssBytes>peak.rssBytes)peak=m;await sleep(50)}})();
  const started=performance.now();
  await app.wd.execute(`document.querySelector('.metric-paths').open=true;const el=document.querySelector('[aria-label="Metric import paths"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,arguments[0]);el.dispatchEvent(new Event('input',{bubbles:true}));`,[file]);
  await app.wd.execute('[...document.querySelectorAll("button")].find(b=>b.textContent==="Import paths").click()');
  let progressSeen=false,loadingUiProbe=null;
  await app.waitFor('million row graph',async()=>{const p=await app.wd.execute('return {loading:!!document.querySelector("[aria-label=\\"Metric import progress\\"]"),graph:!!document.querySelector("[aria-label=\\"Metric range graph\\"]"),error:document.querySelector(".metric-import-panel [role=alert]")?.textContent}');progressSeen ||=p.loading;if(p.loading&&!loadingUiProbe)loadingUiProbe=await app.wd.executeAsync(`const done=arguments[arguments.length-1],button=[...document.querySelectorAll('button')].find(b=>b.textContent==='Cancel import'),start=performance.now();button.focus();requestAnimationFrame(()=>requestAnimationFrame(()=>done({ms:performance.now()-start,focused:document.activeElement===button})));`);if(p.error)throw Error(p.error);return {done:p.graph}},15000,20);
  stage='first view RAF';
  await app.wd.executeAsync(`const done=arguments[arguments.length-1];const p=document.querySelector('.metric-paths');if(p)p.open=false;document.querySelector('[aria-label="Metric range graph"]').scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(done));`);
  const firstViewMs=performance.now()-started;stage='initial summaries';
  await app.waitFor('initial summaries complete',async()=>({done:await app.wd.execute('return document.querySelectorAll(`[aria-label="Metric selection statistics"] tbody tr`).length===4')}),30000);
  await sleep(300);sampling=false;await sampler;
  const loadDiagnostics=await app.wd.execute('return {gaps:window.__metricDiagnostic.gaps.slice(),queries:window.__metricDiagnostic.queries.slice(),visible:document.visibilityState,focused:document.hasFocus()}');
  stage='wheel probe';
  const wheelProbe=await app.wd.execute(`const node=document.querySelector('.metric-table-scroll'),event=new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true});const before=node.scrollTop;node.dispatchEvent(event);const horizontal=new WheelEvent('wheel',{deltaX:120,bubbles:true,cancelable:true});node.dispatchEvent(horizontal);return {defaultPrevented:event.defaultPrevented,horizontalDefaultPrevented:horizontal.defaultPrevented,before,after:node.scrollTop};`);
  app.record('compressed-row-wheel-probe',wheelProbe);assert.equal(wheelProbe.defaultPrevented,true,'compressed row wheel must cancel native default scrolling');assert.equal(wheelProbe.horizontalDefaultPrevented,false,'horizontal wheel must remain available to the browser');
  async function operation(name,target){
    stage=name;return app.wd.executeAsync(`const [name,target,done]=arguments,panel=document.querySelector('.metric-import-panel'),before=panel.querySelector('[aria-label="Metric range graph"]'),old=before?.getAttribute('data-start')+':'+before?.getAttribute('data-end');
    const begin=performance.now();let changed=false,timeout;
    const observer=new MutationObserver(()=>{let ready=false,el=panel.querySelector('[aria-label="Metric range graph"]');if(name==='Row inspection'){el=panel.querySelector('[aria-label="Inspected metric row"]');ready=el?.querySelector('h3')?.textContent==='Row '+target;}else if(name==='Series toggle'){ready=!!el&&el.querySelectorAll('path[stroke]').length===Number(target);}else ready=el&&el.getAttribute('data-start')+':'+el.getAttribute('data-end')!==old;
      if(ready&&!changed){changed=true;observer.disconnect();clearTimeout(timeout);const mutation=performance.now();el.scrollIntoView({block:'center'});requestAnimationFrame(()=>{const frame1=performance.now();requestAnimationFrame(()=>{const end=performance.now(),d=window.__metricDiagnostic;done({operation:name,target,start:begin,end,ms:end-begin,uiMutationMs:mutation-begin,afterMutationMs:end-mutation,frame1Ms:frame1-mutation,native:d.entries.filter(e=>e.start+e.ms>=begin&&e.start<=end),queries:d.queries.filter(q=>q.started<=end&&(q.ended===null||q.ended>=begin)),timerGaps:d.gaps.filter(g=>g.end>=begin&&g.start<=end),heap:performance.memory?{used:performance.memory.usedJSHeapSize,total:performance.memory.totalJSHeapSize}:null})})})}});
    observer.observe(panel,{subtree:true,childList:true,attributes:true});timeout=setTimeout(()=>{observer.disconnect();done({error:'render timeout',name,target})},10000);
    if(name==='Series toggle'){panel.querySelector('[aria-label="Plot metric_3_ms"]').click();}
    else if(name==='Row inspection'){[...panel.querySelectorAll('button')].find(b=>b.textContent==='Inspect row').click();}
    else [...panel.querySelectorAll('button')].find(b=>b.getAttribute('aria-label')===name||b.textContent===name).click();`,[name,target]);
  }
  // Set a reproducible middle-half range so both pan directions always move.
  await operation('Zoom in');
  const observations=[],outliers=[];
  for(let round=0;round<20;round++)for(const name of ['Zoom in','Pan right','Pan left','Zoom out','Series toggle','Row inspection']){
    if(name==='Row inspection')await app.wd.execute(`const el=document.querySelector('[aria-label="Metric row number"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,String(arguments[0]));el.dispatchEvent(new Event('input',{bubbles:true}));`,[500001+round]);
    const result=await operation(name,name==='Series toggle'?(round%2?4:3):name==='Row inspection'?500001+round:null);assert.equal(result.error,undefined,JSON.stringify(result));result.round=round+1;
    observations.push(result);if(result.ms>=100)outliers.push({...result,processesAfter:await memory(host)});
  }
  const diagnostics=await app.wd.execute('clearInterval(window.__metricDiagnosticTimer);window.__metricDiagnosticObserver.disconnect();return {timeOrigin:performance.timeOrigin,supportedPerformanceEntries:PerformanceObserver.supportedEntryTypes,userAgent:navigator.userAgent,gcObservable:PerformanceObserver.supportedEntryTypes.includes("gc"),heapObservable:!!performance.memory}');
  const operations=Object.fromEntries(['Zoom in','Pan right','Pan left','Zoom out','Series toggle','Row inspection'].map(name=>[name,summary(observations.filter(v=>v.operation===name).map(v=>v.ms))]));
  const gcLog=app.timestampedLog.filter(v=>/GC<|GC END|Requesting GC/.test(v.line));
  const evidence={machine:hostname(),kernel:release(),wheelProbe,loadDiagnostics,loadingUiProbe,gcLog,gcLogging:'JSC_logGC=1 (installed jsc --options: Basic); stderr arrival epoch timestamps, may be buffered and cannot establish causal attribution',gate:Object.values(operations).every(v=>v.p95<100)?'PASS':'FAIL',display:process.env.CRAIDD_METRIC_DISPLAY,sessionType:process.env.XDG_SESSION_TYPE,build:process.env.CRAIDD_UI_APP,binarySha256:hash(await readFile(process.env.CRAIDD_UI_APP)),fixture:{path:file,size:input.size,sha256:originalHash},owner,oneWindow,baseline,peak,incrementalRssBytes:peak.rssBytes-baseline.rssBytes,incrementalRatio:(peak.rssBytes-baseline.rssBytes)/input.size,memorySamples:samples,firstViewMs,progressSeen,operations,observations,outliers,diagnostics,method:'20 measured observations per operation, nearest-rank p50/p95, scripted application event to changed UI plus two RAFs, visible graph/inspector, warm file cache. Shared RSS pages double-counted; PSS separately sampled. No hardware input/display or GC attribution inferred.'};
  app.record('release-distributions',evidence);await writeFile(join(app.dir,'release-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({evidence:app.dir,gate:evidence.gate,operations,incrementalRatio:evidence.incrementalRatio}));
  assert.equal(evidence.gate,'PASS');assert.ok(evidence.incrementalRatio<3);assert.ok(firstViewMs<15000);assert.ok(progressSeen);
});

test('M1 release: owning window closes during million-row load',{skip:!enabled||process.env.CRAIDD_METRIC_SKIP_RECOVERY==='1',timeout:120000},async t=>{
  const {app,host,mainLabel,owner,oneWindow,root}=await setup('metric-release-close-recovery');t.after(()=>app.close());
  const before=await memory(host),size=(await stat(file)).size,id=await start(app);let loading;
  await app.waitFor('reader allocated data and still loading',async()=>{loading=await app.invoke('metric_action',{request:{op:'status',id}});assert.equal(loading.state,'loading','close must occur before import completes');return {done:loading.bytesRead>size*.20}},10000,5);
  const during=await memory(host),closeRequestedAt=Date.now();
  // Use the application's Window Manager Close action. W3C Close Window only
  // closes a WebKit browsing context here and is not native-window acceptance.
  await app.wd.execute('const label=arguments[0];setTimeout(()=>window.__TAURI_INTERNALS__.invoke("close_linked_window",{targetLabel:label}).catch(error=>console.error(error)),0);',[owner]);
  await app.waitFor('native owning window disappears',async()=>{
    await switchToLabel(app,mainLabel);const windows=await app.invoke('get_application_windows');return {done:!windows.some(v=>v.label===owner)};
  });
  await app.waitFor('native worker cancelled and storage released',async()=>({done:app.log.some(line=>line.startsWith('craidd:metrics ')&&JSON.parse(line.slice(15)).id===id&&JSON.parse(line.slice(15)).event==='storage-released')}),15000,20);
  const trace=app.log.filter(line=>line.startsWith('craidd:metrics ')).map(line=>JSON.parse(line.slice(15))).filter(v=>v.id===id);
  const cancellation=trace.find(v=>v.event==='owner-close-cancel'),finished=trace.find(v=>v.event==='reader-finished'),released=trace.find(v=>v.event==='storage-released');
  assert.ok(cancellation?.cancelled);assert.equal(finished?.state,'cancelled');assert.ok(released?.cancelled);
  const afterSamples=[];for(let n=0;n<20;n++){afterSamples.push(await memory(host));await sleep(100)}
  const after=afterSamples.at(-1),nativeBefore=during.processes.find(p=>p.pid===host.pid),nativeAfter=after.processes.find(p=>p.pid===host.pid);
  const fds=[];for(const fd of await readdir(`/proc/${host.pid}/fd`))try{if((await readlink(`/proc/${host.pid}/fd/${fd}`))===file)fds.push(fd)}catch{}
  assert.deepEqual(fds,[],'producer reader is closed');assert.ok(after.rssBytes<during.rssBytes,'process tree releases memory after owner close');assert.ok(nativeAfter.rssBytes<nativeBefore.rssBytes,'native parse allocations release RSS');
  const unknown=await app.invoke('metric_action',{request:{op:'status',id}}).then(()=>null,e=>String(e));assert.match(unknown,/unavailable in this window/);
  // Surviving IDE can open a fresh window and import/inspect a small source.
  const usable=await app.wd.execute('return !!document.querySelector("#root")?.childElementCount');assert.ok(usable);
  await openSolution(app,join(root,'Metrics.cln'));await showProfiler(app);
  await app.wd.execute('[...document.querySelectorAll("button")].find(b=>b.textContent==="Open metric imports").click()');
  await app.waitFor('fresh metric editor usable',async()=>({done:await app.wd.execute('return !!document.querySelector(".metric-import-panel")')}));
  const small=join(root,'after-close.csv');await writeFile(small,'time_s,value_ms\n0,1\n1,2\n',{flag:'wx'});
  await app.wd.execute(`document.querySelector('.metric-paths').open=true;const el=document.querySelector('[aria-label="Metric import paths"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,arguments[0]);el.dispatchEvent(new Event('input',{bubbles:true}));`,[small]);
  await app.wd.execute('[...document.querySelectorAll("button")].find(b=>b.textContent==="Import paths").click()');
  await app.waitFor('surviving IDE renders a new import',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Metric range graph\\"]")')}));
  const retryId=await app.wd.execute('return document.querySelector(".metric-import-panel").dataset.sourceId');
  const row=await app.invoke('metric_action',{request:{op:'row',id:retryId,table:0,row:1}});assert.equal(row.row.cells[1],2);
  const result={gate:'PASS',closeMethod:'application Window Manager close_linked_window native destroy path',display:process.env.CRAIDD_METRIC_DISPLAY,build:process.env.CRAIDD_UI_APP,binarySha256:hash(await readFile(process.env.CRAIDD_UI_APP)),fixtureSize:size,id,owner,mainLabel,oneWindow,before,during,afterSamples,after,loading,closeRequestedAt,trace,releaseAfterCloseMs:released.epochMs-closeRequestedAt,producerReaderFds:fds,removedJobError:unknown,producerSizeUnchanged:(await stat(file)).size===size,ideUsable:true,newImportRow:row};
  app.record('close-recovery',result);await writeFile(join(app.dir,'recovery-evidence.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({recoveryEvidence:app.dir,gate:'PASS',releaseAfterCloseMs:result.releaseAfterCloseMs,beforeRss:before.rssBytes,duringRss:during.rssBytes,afterRss:after.rssBytes}));
});
