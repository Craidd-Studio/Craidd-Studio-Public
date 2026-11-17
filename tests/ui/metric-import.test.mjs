// Opt-in real Tauri/WebKit metric import acceptance. No producer process control.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, unlink, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { launch, openSolution } from './lib/harness.mjs';
import { showProfiler } from './lib/profiler.mjs';

const enabled = process.env.CRAIDD_TEST_METRICS === '1';
const setValue = (app, selector, value) => app.wd.execute(`const el=document.querySelector(arguments[0]);
 const p=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
 Object.getOwnPropertyDescriptor(p,'value').set.call(el,arguments[1]);el.dispatchEvent(new Event('input',{bubbles:true}));`, [selector, String(value)]);
const button = async (app, text) => {
  await app.wd.execute('const button=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);button?.scrollIntoView({block:"center"});',[text]);
  return app.wd.click(await app.wd.find(`//button[normalize-space()=${JSON.stringify(text)}]`));
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('GR-001 M1 real desktop import, joins, immutable reopen, recovery and scale', { skip: !enabled, timeout: 240000 }, async t => {
  const root=await mkdtemp(join(tmpdir(),'craidd-gr001-ui-'));
  const runtime=join(root,'runtime');await (await import('node:fs/promises')).mkdir(runtime,{mode:0o700});
  const solution=join(root,'Metrics.cln');
  await writeFile(solution,'[solution]\nname="Metric acceptance"\nversion="1.0"\nprojects=[]\n');
  const main=join(root,'run.csv'),companion=join(root,'run-sections.csv'),snapshot=join(root,'saved.crmetrics');
  await writeFile(main,'elapsed_s,p99_ms,note\n0,10,first\n1,70,slow\n2,bad,rejected\n3,20,unjoined\n4,30\n5,,empty\n6,40,"multiline\n7,999,not-a-record\nend"\n8,50,last\n');
  await writeFile(companion,'time_s,section_ms\n1,60\n0,8\n8,45\n');
  const original=await readFile(main),originalHash=hash(original);
  const env={XDG_RUNTIME_DIR:runtime};
  let app=await launch('metric-import',{environment:env});t.after(async()=>{if(app)await app.close();});
  await openSolution(app,solution);await showProfiler(app);await button(app,'Open in Editor Panel');await button(app,'Imported metrics');
  await app.wd.execute("document.querySelector('.metric-paths').open=true");
  await setValue(app,'[aria-label="Metric import paths"]',main+'\n'+companion);await button(app,'Import paths');
  await app.waitFor('CSV groups ready',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Metric range graph\\"]")')}));
  const sourceId=await app.wd.execute('return document.querySelector("[aria-label=\\"Metric source set\\"]").value');
  const action=request=>app.invoke('metric_action',{request});
  const status=await action({op:'status',id:sourceId});
  assert.deepEqual(status.rows,[5,3]);assert.equal(status.tables[0].coverage.invalid,2);assert.equal(status.tables[0].coverage.unsupported,1);
  assert.equal(status.tables[0].sha256,originalHash);assert.equal(status.tables[0].axis.windowSeconds,null);
  await app.wd.execute('const s=document.querySelector("[aria-label=\\"Metric series\\"]");s.value="1";s.dispatchEvent(new Event("change",{bubbles:true}));');
  await button(app,'Find worst windows / largest values');
  await app.waitFor('worst values',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Worst metric windows\\"] tbody tr")?.textContent.includes("70")')}));
  await setValue(app,'[aria-label="Metric row number"]',2);await button(app,'Inspect row');
  await app.waitFor('original row inspector',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Inspected metric row\\"]")?.textContent.includes("slow")')}));
  await button(app,'Interpretation and joins');await button(app,'Set join rule');await button(app,'Inspect row');
  await app.waitFor('named key companion',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Inspected metric row\\"]")?.textContent.includes("60")')}));
  await setValue(app,'[aria-label="Metric row number"]',3);await button(app,'Inspect row');
  await app.waitFor('unjoined row visible',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Inspected metric row\\"]")?.textContent.includes("Unjoined; no unique match")')}));
  await setValue(app,'[aria-label="Metric snapshot path"]',snapshot);await button(app,'Save snapshot path');
  await app.waitFor('snapshot persisted',async()=>({done:await stat(snapshot).then(()=>true).catch(()=>false)}));
  // Editing the import later must not rewrite the saved artifact.
  await setValue(app,'[aria-label="Unit p99_ms"]','us');await button(app,'Apply interpretation');
  await app.waitFor('new interpretation',async()=>({done:(await action({op:'status',id:sourceId})).tables[0].columns[1].unit==='us'}));
  assert.equal(hash(await readFile(main)),originalHash,'import never modifies producer bytes');
  app.record('small-file-acceptance',{source:status,snapshot,producerHashUnchanged:true});
  await app.screenshot('01-import-inspection');await app.close();
  await unlink(main);await unlink(companion);
  app=await launch('metric-snapshot-reopen',{environment:env});
  await openSolution(app,solution);await showProfiler(app);await button(app,'Open in Editor Panel');await button(app,'Imported metrics');
  await app.wd.execute("document.querySelector('.metric-paths').open=true");
  await setValue(app,'[aria-label="Metric import paths"]',snapshot);await button(app,'Open snapshot path');
  await app.waitFor('snapshot reopened without CSVs',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Metric range graph\\"]")')}));
  const snapId=await app.wd.execute('return document.querySelector("[aria-label=\\"Metric source set\\"]").value');
  const reopened=await action({op:'status',id:snapId});assert.equal(reopened.tables[0].columns[1].unit,'ms');assert.equal(reopened.tables[0].snapshot,true);assert.equal(reopened.joins.length,1);
  await assert.rejects(action({op:'interpret',id:snapId,table:0,columns:reopened.tables[0].columns,axis:reopened.tables[0].axis}),/immutable/);
  app.record('snapshot-reopen',{source:reopened,originalFilesDeleted:true,restartedApp:true});
  await button(app,'Remove source set');
  await setValue(app,'[aria-label="Metric import paths"]',join(root,'missing.csv'));await button(app,'Import paths');
  await app.waitFor('missing file state',async()=>({done:await app.wd.execute('return !!document.querySelector("[role=alert]")')}));

  const million=process.env.CRAIDD_METRIC_MILLION;
  if (!million) {app.record('scale',{gate:'NOT TESTED',reason:'CRAIDD_METRIC_MILLION not set'});return;}
  await app.wd.execute(`window.__metricHeartbeat={ticks:0,maxGap:0,last:performance.now()};window.__metricHeartbeatTimer=setInterval(()=>{const h=window.__metricHeartbeat;const now=performance.now();h.ticks++;h.maxGap=Math.max(h.maxGap,now-h.last);h.last=now;},16);`);
  const host=await app.hostIdentity();
  let peak=0,baseline=0,samples=0;
  async function processMemory(){
    const tasks=new Map();
    for(const entry of await readdir('/proc')){if(!/^\d+$/.test(entry))continue;try{const s=await readFile(`/proc/${entry}/stat`,'utf8');const tail=s.slice(s.lastIndexOf(')')+2).split(' ');tasks.set(Number(entry),{parent:Number(tail[1]),rss:Number(tail[21])*4096});}catch{}}
    const ids=new Set([host.pid]);for(let pass=0;pass<8;pass++)for(const [id,p]of tasks)if(ids.has(p.parent))ids.add(id);
    return [...ids].reduce((sum,id)=>sum+(tasks.get(id)?.rss??0),0);
  }
  baseline=await processMemory();let sampling=true;
  t.after(()=>{sampling=false;});
  const sampler=(async()=>{while(sampling){peak=Math.max(peak,await processMemory());samples++;await new Promise(r=>setTimeout(r,50));}})();
  const started=performance.now();
  await setValue(app,'[aria-label="Metric import paths"]',million);await button(app,'Import paths');
  let progressSeen=false;
  await app.waitFor('million rows first rendered graph',async()=>{
    const view=await app.wd.execute('return {progress:!!document.querySelector("[aria-label=\\"Metric import progress\\"]"),graph:!!document.querySelector("[aria-label=\\"Metric range graph\\"]"),alert:document.querySelector("[role=alert]")?.textContent}');
    progressSeen ||= view.progress;
    if(view.alert)throw new Error(view.alert);
    return {done:view.graph};
  },90000,50);
  const graphVisible=await app.wd.executeAsync(`const done=arguments[arguments.length-1];document.querySelector('.metric-paths').open=false;const graph=document.querySelector('[aria-label="Metric range graph"]');graph.scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(()=>{const r=graph.getBoundingClientRect(),clip=document.querySelector('.metric-import-panel .profiler-results').getBoundingClientRect();done(r.top>=clip.top&&r.bottom<=clip.bottom&&r.left>=clip.left&&r.right<=clip.right);}));`);
  assert.equal(graphVisible,true,'first view requires the plot to be inside the visible scroll viewport');
  const firstViewMs=performance.now()-started;
  const millionId=await app.wd.execute('return document.querySelector("[aria-label=\\"Metric source set\\"]").value');
  const millionStatus=await action({op:'status',id:millionId});assert.equal(millionStatus.rows[0],1000000);
  const interactions=[];
  await app.wd.execute(`window.__metricRoundTrips=[];window.__metricPerformanceObserver=new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.name.startsWith('craidd.metrics.')&&window.__metricRoundTrips.length<100)window.__metricRoundTrips.push({op:entry.name,ms:entry.duration});});window.__metricPerformanceObserver.observe({entryTypes:['measure']});`);
  for (const text of ['Zoom in','Pan right','Pan left','Zoom out']) {
    const timing=await app.wd.executeAsync(`const [text,done]=arguments;const begin=performance.now();const before=document.querySelector('[aria-label="Metric range graph"]');const old=before?.getAttribute('data-start')+':'+before?.getAttribute('data-end');
    const observer=new MutationObserver(()=>{const graph=document.querySelector('[aria-label="Metric range graph"]');if(graph&&graph.getAttribute('data-start')+':'+graph.getAttribute('data-end')!==old){observer.disconnect();graph.scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(()=>done(performance.now()-begin)));}});observer.observe(document.querySelector('.metric-import-panel'),{subtree:true,childList:true,attributes:true});[...document.querySelectorAll('button')].find(b=>b.textContent===text).click();`,[text]);
    interactions.push({interaction:text,ms:timing});
  }
  const seriesMs=await app.wd.executeAsync(`const done=arguments[arguments.length-1],begin=performance.now();const observer=new MutationObserver(()=>{const graph=document.querySelector('[aria-label="Metric range graph"]');if(graph?.getAttribute('data-column')==='2'){observer.disconnect();graph.scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(()=>done(performance.now()-begin)));}});observer.observe(document.querySelector('.metric-import-panel'),{subtree:true,childList:true});const s=document.querySelector('[aria-label="Metric series"]');s.value='2';s.dispatchEvent(new Event('change',{bubbles:true}));`);
  interactions.push({interaction:'Series toggle',ms:seriesMs});
  const repeatedSeries=[];
  for (const column of [1,2,1,2,1,2]) {
    const ms=await app.wd.executeAsync(`const [column,done]=arguments,begin=performance.now();const observer=new MutationObserver(()=>{const graph=document.querySelector('[aria-label="Metric range graph"]');if(graph?.getAttribute('data-column')===String(column)){observer.disconnect();graph.scrollIntoView({block:'center'});requestAnimationFrame(()=>requestAnimationFrame(()=>done(performance.now()-begin)));}});observer.observe(document.querySelector('.metric-import-panel'),{subtree:true,childList:true});const s=document.querySelector('[aria-label="Metric series"]');s.value=String(column);s.dispatchEvent(new Event('change',{bubbles:true}));`,[column]);
    repeatedSeries.push({column,ms});
  }
  await setValue(app,'[aria-label="Metric row number"]',500001);
  const rowMs=await app.wd.executeAsync(`const done=arguments[arguments.length-1],begin=performance.now();const observer=new MutationObserver(()=>{if(document.querySelector('[aria-label="Inspected metric row"] h3')?.textContent.startsWith('Row 500001')){observer.disconnect();document.querySelector('[aria-label="Inspected metric row"]').scrollIntoView({block:'start'});requestAnimationFrame(()=>requestAnimationFrame(()=>done(performance.now()-begin)));}});observer.observe(document.querySelector('.metric-import-panel'),{subtree:true,childList:true});[...document.querySelectorAll('button')].find(b=>b.textContent==='Inspect row').click();`);
  interactions.push({interaction:'Row inspection',ms:rowMs});
  sampling=false;await sampler;
  const heartbeat=await app.wd.execute('clearInterval(window.__metricHeartbeatTimer);return window.__metricHeartbeat;');
  const nativeRoundTrips=await app.wd.execute('window.__metricPerformanceObserver.disconnect();return window.__metricRoundTrips');
  const scale={firstViewMs,progressSeen,graphVisible,baselineRssBytes:baseline,peakProcessTreeRssBytes:peak,peakIncrementalRssBytes:peak-baseline,memorySamples:samples,heartbeat,interactions,repeatedSeries,nativeRoundTrips,source:millionStatus,build:process.env.CRAIDD_UI_APP,display:process.env.XDG_SESSION_TYPE,method:'sum process-tree RSS sampled every ~50 ms; shared pages double-counted; visible graph/inspector event-to-two-RAF timings; warm file cache; build path recorded separately'};
  app.record('million-row-scale',scale);await app.screenshot('02-million-rows');
  // Cancel a second load; the already loaded source and producer bytes survive.
  await app.wd.execute("document.querySelector('.metric-paths').open=true");
  await setValue(app,'[aria-label="Metric import paths"]',million);await button(app,'Import paths');
  await app.waitFor('cancel control',async()=>({done:await app.wd.execute('return [...document.querySelectorAll("button")].some(b=>b.textContent==="Cancel import")')}));
  await button(app,'Cancel import');
  await app.waitFor('cancelled import',async()=>({done:await app.wd.execute('return document.body.textContent.includes("cancelled")')}));
  assert.equal((await stat(million)).size,millionStatus.totalBytes);
  app.record('cancel-recovery',{producerSizeUnchanged:true,priorSourceRetained:(await action({op:'status',id:millionId})).rows[0]===1000000});
  console.log(JSON.stringify({evidence:app.dir,scale},null,2));
});
