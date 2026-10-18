import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launch, openSolution, evidenceDirectory } from "./lib/harness.mjs";
import { disposableUnity } from "./lib/unity-copy.mjs";
import { showProfiler, visibleIcons, resizeProfiler } from "./lib/profiler.mjs";

const enabled = process.env.CRAIDD_TEST_UNITY === "1";
const longRun = process.env.CRAIDD_TEST_LONG === "1";
const liveBytes = (p, marker="unity.solo") => p.captures.filter(c=>c.marker===marker).reduce((n,c)=>n+c.liveBytes,0);
const profile = app => app.invoke("get_profile");
const click = async (app,xpath) => app.wd.click(await app.wd.find(xpath));

async function selectBenchmark(app, marker) {
  await click(app, `//select[@aria-label='Gold benchmark']/option[@value='${marker}']`);
  await app.waitFor("benchmark selected",async()=>({done:await app.wd.execute("return document.getElementById('profiler-benchmark').value === arguments[0]",[marker])}));
}
async function selectInspectionFilter(app, label, value) {
  // Clicking an <option> cannot scroll its offscreen <select> into the results
  // viewport. Focus the real control and use its native keyboard interaction.
  const values=await app.wd.execute("return [...document.querySelector('select[aria-label='+JSON.stringify(arguments[0])+']').options].map(o=>o.value)",[label]);
  assert.ok(values.includes(String(value)),`${label} contains ${value}`);
  await click(app,`//select[@aria-label='${label}']`);
  await app.wd.keys('\uE011',...Array(values.indexOf(String(value))).fill('\uE015'),'\uE007');
  assert.equal(await app.wd.execute("return document.querySelector('select[aria-label='+JSON.stringify(arguments[0])+']').value",[label]),String(value));
}
async function waitProfile(app, description, predicate, timeout=30000) {
  return app.waitFor(description,async()=>{const p=await profile(app);return {done:!!p&&predicate(p),value:p};},timeout);
}
async function openHitHistory(app) {
  const open=await app.wd.execute("return document.querySelector('.profiler-capture-group')?.open");
  assert.equal(typeof open,'boolean','the chosen marker has a history group');
  if(!open)await click(app,"//details[contains(@class,'profiler-capture-group')]/summary");
  await app.waitFor('hit group stays expanded',async()=>({done:await app.wd.execute("return document.querySelector('.profiler-capture-group')?.open")}));
}
async function inspectRetainedHit(app) {
  // Oldest-first rows are evicted by the bounded live history. Choose a recent
  // identity, then prove exactly that identity opened. Retry only a proven
  // eviction between acquisition and click; never swallow other UI errors.
  for(let attempt=0;attempt<3;attempt++){
    const id=await app.wd.execute("return [...document.querySelectorAll('.profiler-hit[data-capture-id]')].at(-1)?.dataset.captureId");
    assert.ok(id,'a retained hit is available');
    try {
      await click(app,`//details[@data-capture-id='${id}']/summary`);
      assert.equal(await app.wd.execute("return [...document.querySelectorAll('.profiler-hit')].find(e=>e.dataset.captureId===arguments[0])?.open",[id]),true);
      app.record('inspected-hit',{id,attempt});return;
    } catch(error) {
      if((await profile(app)).captures.some(c=>c.id===id))throw error;
      app.record('hit-evicted-before-inspection',{id,attempt,error:String(error)});
    }
  }
  assert.fail('no retained hit could be inspected in three attempts');
}

for (const fps of [60,-1]) test(`disposable Unity profiling via real menu actions at ${fps===60?'60 fps':'uncapped fps'}`, { skip:!enabled,timeout:longRun&&fps<0?1000000:480000 },async t=>{
  const name=fps===60?'unity-60fps':'unity-uncapped';
  const dir=await evidenceDirectory(name);
  const namespace=`${name}-${randomUUID()}`;
  const unity=await disposableUnity(dir,namespace);
  t.after(()=>unity.close());
  await unity.waitFor("Editor ready",()=>readFile(join(unity.signals,'ready'),'utf8'),240000);
  const ready=await unity.status();
  assert.equal(ready.pid,unity.child.pid,"the controller belongs to our spawned copy");
  console.log(`${name}: disposable Editor ${ready.pid} ready at ${unity.project}`);
  const app=await launch(name,{environment:{CRAIDD_PROFILE_NAMESPACE:namespace}});
  t.after(()=>app.close());
  app.record("environment",{unityVersion:unity.version,editor:unity.editor,editorPid:ready.pid,project:unity.project,namespace,requestedFps:fps});
  await openSolution(app,join(unity.project,'unity.cln'));
  await showProfiler(app);
  await click(app,"//button[normalize-space()='Attach…']");
  await app.waitFor("matching disposable Editor selected",async()=>({done:await app.wd.execute("const row=document.querySelector('[role=option][aria-selected=true]');return !!row&&row.innerText.includes(arguments[0])",[String(ready.pid)])}));
  await click(app,"//button[normalize-space()='Profile only']");
  const armed=await waitProfile(app,"prepared provider ready",p=>p.target.pid===ready.pid&&p.active&&p.waitingForPlay&&p.provider);
  assert.equal(armed.unityEditor,true);
  assert.equal(armed.captures.length,0,"Editor idle state does not manufacture Gold hits");
  await app.screenshot('attached-ready-for-play');
  console.log(`${name}: selected and profiled only the disposable Editor`);

  await unity.command('play',fps);
  await unity.waitFor("Play started",async()=>{const s=await unity.status();return s.playing&&s.frames>2?s:false;});
  const first=await waitProfile(app,"first Solo and range",p=>!p.waitingForPlay&&p.captures.some(c=>c.solo&&c.endMs===null)&&p.captures.some(c=>c.marker==='unity.native.mix'));
  assert.equal(await app.wd.execute("return document.getElementById('profiler-scope').value"),'session');
  assert.ok((await visibleIcons(app)).every(i=>i.width>0&&i.path&&!i.iconFont));
  app.record('first-play',{batch:first.batch,generation:first.playGeneration,profile:first});
  await app.screenshot('playing-solo');

  const allocated=await unity.command('allocate');
  assert.equal(allocated.menuExecuted,true);
  assert.equal(allocated.nativeLiveBytes,1048576);
  const retained=await waitProfile(app,"Solo retains exactly 1 MiB",p=>liveBytes(p)===1048576&&liveBytes(p,'unity.native.alloc')===1048576);
  await app.waitFor("retained value rendered before snapshot",async()=>({done:await app.wd.execute("return [...document.querySelectorAll('.profiler-metrics dt')].some(dt=>dt.textContent==='Observed native live'&&dt.nextElementSibling.textContent==='1.00 MiB')")}));
  await click(app,"//button[@aria-label='Take memory snapshot']");
  assert.equal(await app.wd.execute("return document.querySelector('select[aria-label=\"Profiler view\"]').value"),'live',"snapshot keeps Live selected");
  assert.equal(await app.wd.execute("return document.querySelector('.profiler-tabs [role=tab][aria-selected=true]').textContent"),'Summary',"snapshot preserves the selected tab");
  await click(app,"//button[@id='profiler-tab-Memory']");
  await app.waitFor('retained snapshot table',async()=>({done:await app.wd.execute("return document.querySelectorAll('.profiler-table-scroll tbody tr').length===1")}));
  app.record('retained-memory',{unity:allocated,profile:retained});
  await app.screenshot('retained-1MiB-live-snapshot');

  const cleared=await unity.command('clear');
  assert.equal(cleared.menuExecuted,true);
  assert.equal(cleared.nativeLiveBytes,0);
  const freed=await waitProfile(app,"original cohorts observe the free",p=>liveBytes(p)===0&&p.captures.some(c=>c.marker==='unity.native.alloc'&&c.freedBytes>=1048576));
  await app.waitFor("released value rendered before snapshot",async()=>({done:await app.wd.execute("return [...document.querySelectorAll('.profiler-metrics dt')].some(dt=>dt.textContent==='Still live'&&dt.nextElementSibling.textContent==='0 B')")}));
  await click(app,"//button[@aria-label='Take memory snapshot']");
  const snapshots=await app.wd.execute("return [...document.querySelectorAll('.profiler-table-scroll tbody tr')].map(r=>r.innerText)");
  assert.equal(snapshots.length,2);
  assert.ok(snapshots[0].includes('1.00 MiB'),"first snapshot remains retained after the free");
  assert.ok(snapshots[1].includes('0 B'),"second snapshot records released cohort: "+JSON.stringify(snapshots));
  await click(app,"//tbody/tr[1]//button");
  assert.equal(await app.wd.execute("return document.querySelector('.profiler-target').innerText.includes('Snapshot')"),true);
  await click(app,"//button[@aria-label='Return to live profiling']");
  app.record('cleared-memory',{unity:cleared,profile:freed,snapshots});
  await app.screenshot('cleared-two-snapshots');

  if(fps===60){
    for(const width of [288,360,420]){
      await click(app,"//button[@id='profiler-tab-Summary']");
      const summary=await resizeProfiler(app,width);
      assert.ok(summary.scrollWidth<=summary.clientWidth+1,'no Summary horizontal overflow: '+JSON.stringify(summary));
      await app.screenshot(`summary-${width}px`);
      await click(app,"//button[@id='profiler-tab-Memory']");
      const memory=await resizeProfiler(app,width);
      assert.ok(memory.scrollWidth<=memory.clientWidth+1,'no Memory panel overflow: '+JSON.stringify(memory));
      app.record('width-'+width,{summary,memory});await app.screenshot(`memory-${width}px`);
    }
    await click(app,"//button[@aria-label='Take memory snapshot']");
    await app.wd.keys('\uE004');
    assert.equal(await app.wd.execute("return document.activeElement.getAttribute('aria-label')"),'Snapshot and record again');
    await app.screenshot('toolbar-keyboard-focus');
  }

  await click(app,"//button[@id='profiler-tab-Gold']");
  await selectBenchmark(app,'unity.native.mix');
  await openHitHistory(app);
  await inspectRetainedHit(app);
  await app.screenshot('range-and-expanded-hit');
  await waitProfile(app,"new hits while range selection stays deliberate",p=>p.counters.evictedCaptures>0,60000);
  assert.equal(await app.wd.execute("return document.getElementById('profiler-benchmark').value"),'unity.native.mix');
  assert.equal(await app.wd.execute("return document.querySelector('.profiler-capture-group').open"),true);
  await selectBenchmark(app,'unity.solo');
  await unity.command('allocate');
  await waitProfile(app,'retained allocation before batch boundary',p=>liveBytes(p)===1048576);
  await click(app,"//button[@aria-label='Snapshot and record again']");
  const again=await waitProfile(app,"new Solo segment after record again",p=>p.batch>first.batch&&p.captures.filter(c=>c.solo).length>=2);
  assert.ok(again.captures.some(c=>c.solo&&c.endMs!==null&&c.liveBytes===1048576),'older segment owns the retained allocation');
  await unity.command('clear');
  await waitProfile(app,'late free updates the older segment across Record again',p=>liveBytes(p)===0&&p.captures.some(c=>c.solo&&c.endMs!==null&&c.freedBytes>=1048576));
  assert.equal(await app.wd.execute("return document.querySelector('select[aria-label=\"Profiler view\"]').value"),'live');
  app.record('record-again',{batch:again.batch,profile:again});

  if(fps===60){
    await unity.command('workers',1);
    const threaded=await waitProfile(app,'three native work threads',p=>new Set(p.captures.filter(c=>c.marker==='unity.native.mix').map(c=>c.thread)).size>=3);
    await selectBenchmark(app,'unity.native.mix');
    await openHitHistory(app);
    const tids=[...new Set(threaded.captures.filter(c=>c.marker==='unity.native.mix').map(c=>c.thread))];
    const chosen=tids[1];
    await app.waitFor('worker thread option rendered',async()=>({done:await app.wd.execute("return [...document.querySelectorAll('select[aria-label=\"Capture thread\"] option')].some(o=>o.value===arguments[0])",[String(chosen)])}));
    await selectInspectionFilter(app,'Capture thread',chosen);
    await app.waitFor('thread inspection filter',async()=>({done:await app.wd.execute("return [...document.querySelectorAll('.profiler-hit > summary')].length>0&&[...document.querySelectorAll('.profiler-hit > summary')].every(s=>s.innerText.startsWith('Thread '+arguments[0]+' ·'))",[String(chosen)]),value:await app.wd.execute("return {selected:document.querySelector('select[aria-label=\"Capture thread\"]').value,hits:[...document.querySelectorAll('.profiler-hit > summary')].slice(0,3).map(s=>s.innerText)}")}));
    const newestOther=Math.max(...threaded.captures.filter(c=>c.marker==='unity.native.mix'&&c.thread!==chosen).map(c=>c.startMs));
    const stillRunning=await waitProfile(app,'other native threads continue while filtering',p=>p.captures.some(c=>c.marker==='unity.native.mix'&&c.thread!==chosen&&c.startMs>newestOther+250));
    await selectInspectionFilter(app,'Capture batch',again.batch);
    await app.waitFor('batch inspection filter',async()=>({done:await app.wd.execute("return [...document.querySelectorAll('.profiler-hit > summary')].length>0&&[...document.querySelectorAll('.profiler-hit > summary')].every(s=>s.innerText.includes('batch '+arguments[0]))",[String(again.batch)])}));
    app.record('thread-and-batch-inspection',{chosen,tids,profile:stillRunning});await app.screenshot('thread-and-batch-inspection');
    await selectInspectionFilter(app,'Capture thread','all');
    await selectInspectionFilter(app,'Capture batch','all');
    await unity.command('workers',0);
    await selectBenchmark(app,'unity.solo');
    await click(app,"//button[@aria-label='Profiling settings']");
    const coverage=await app.wd.execute("return document.querySelector('.profiler-settings').innerText");
    assert.ok(coverage.includes('Managed heap / GC')&&coverage.includes('Unavailable')&&coverage.includes('GPU / hardware cycles')&&coverage.includes('Planned'));
    assert.ok(coverage.includes('Unity managed C# markers are not instrumented'));
    app.record('coverage-limits',{text:coverage});await app.screenshot('coverage-limits');
    await click(app,"//button[normalize-space()='Done']");
  }

  if(fps<0){
    const active=await waitProfile(app,"uncapped provider survives >2,000 hot captures",p=>p.counters.evictedCaptures>=2000,120000);
    const state=await unity.status();
    app.record('uncapped-sustained',{unity:state,profile:active});
    assert.equal(active.counters.disconnects,0);
    assert.equal(active.counters.sourceGaps,0);
    assert.equal(active.counters.rejectedEvents,0);
    if(longRun){
      console.log(`${name}: sustained capture passed; continuing past the 2,400-sample window`);
      let lastCounterAt=0;
      const aged=await waitProfile(app,"real sample window rolls past ten minutes",p=>{
        if(Date.now()-lastCounterAt>=15000){
          lastCounterAt=Date.now();app.record('long-counter-sample',{observedAtMs:p.observedAtMs,counters:p.counters,dropped:p.dropped,samples:p.samples.length,captures:p.captures.length,batch:p.batch,generation:p.playGeneration});
        }
        return p.counters.agedSamples>0;
      },650000);
      app.record('long-rolling-history',{unity:await unity.status(),profile:aged,renderedFooter:await app.wd.execute("return document.querySelector('.profiler-footer').innerText")});
      await app.screenshot('long-rolling-history');
      assert.equal(aged.counters.sourceGaps+aged.counters.rejectedEvents+aged.counters.disconnects,0);
    }
  }
  // A rare retained cohort must remain visible after the hot hit history rolls.
  await unity.command('allocate');
  const tailRetained=await waitProfile(app,"retained memory after history eviction",p=>liveBytes(p)===1048576);
  let tailSnapshot;
  if(longRun&&fps<0){
    await click(app,"//button[@aria-label='Take memory snapshot']");
    tailSnapshot=await app.wd.execute(`return [...document.querySelector('select[aria-label="Profiler view"]').options].at(-1).value`);
    await click(app,"//button[@aria-label='Snapshot and record again']");
    await waitProfile(app,'Record again after sample rollover retains the old cohort',p=>p.batch>tailRetained.batch&&p.captures.some(c=>c.solo&&c.endMs!==null&&c.liveBytes===1048576));
    await click(app,`//select[@aria-label='Profiler view']/optgroup/option[@value='${tailSnapshot}']`);
    await click(app,"//button[@id='profiler-tab-Memory']");
    await app.waitFor('historical retained snapshot after rollover',async()=>({done:await app.wd.execute("return [...document.querySelectorAll('.profiler-table-scroll tbody tr')].some(r=>r.innerText.includes('1.00 MiB'))")}));
  }
  await unity.command('clear');
  const tailFreed=await waitProfile(app,"late free after history eviction",p=>liveBytes(p)===0);
  if(longRun&&fps<0){
    await click(app,"//button[@aria-label='Take memory snapshot']");
    assert.equal(await app.wd.execute(`return document.querySelector('select[aria-label="Profiler view"]').value`),tailSnapshot,'post-rollover capture from history preserves the reviewed identity');
    app.record('post-rollover-snapshot-record-again-free',{snapshotId:tailSnapshot,profile:tailFreed});
    await app.screenshot('post-rollover-historical-capture');
    await click(app,"//button[@aria-label='Return to live profiling']");
  }
  await unity.command('stop');
  const ended=await waitProfile(app,"Ready for Play through repeated native state",p=>p.active&&p.waitingForPlay&&p.captures.every(c=>c.endMs!==null));
  await app.screenshot('ready-after-play');
  await unity.command('play',fps);
  const replay=await waitProfile(app,"next Play opens new batch/generation",p=>!p.waitingForPlay&&p.batch>ended.batch&&p.playGeneration>ended.playGeneration&&p.captures.some(c=>c.solo&&c.endMs===null));
  assert.equal(replay.counters.disconnects+replay.counters.sourceGaps+replay.counters.rejectedEvents,0);
  app.record('second-play',{previousBatch:ended.batch,generation:replay.playGeneration,profile:replay});
  await app.screenshot('next-play-new-batch');
  await click(app,"//button[@aria-label='Stop profiling']");
  await waitProfile(app,"explicit profiler stop",p=>!p.active);
  assert.equal((await unity.status()).playing,true,"Stop profiling leaves our Unity process playing");
  const text=await readFile(join(dir,'unity.log'),'utf8');
  assert.ok(text.includes('[Craidd Probe] Allocate retained native 1 MiB: 0 -> 1048576 bytes'));
  assert.ok(text.includes('[Craidd Probe] Clear native allocations: 1048576 -> 0 bytes'));
  console.log(`${name}: allocation, immutable snapshots, late free, Record again, repeated Play and foreign-process Stop passed`);
});
