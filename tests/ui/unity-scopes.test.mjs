import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {launch,openSolution,evidenceDirectory} from './lib/harness.mjs';
import {disposableUnity} from './lib/unity-copy.mjs';
import {showProfiler,resizeProfiler} from './lib/profiler.mjs';
const click=async(app,x)=>app.wd.click(await app.wd.find(x));
const get=app=>app.invoke('get_profile');
async function waitProfile(app,label,accept){return app.waitFor(label,async()=>{const p=await get(app);return{done:p&&accept(p),value:p};},45000);}
async function tab(app,name){await click(app,`//button[@id='profiler-tab-${name}']`);}
async function chooseMarker(app,marker){
 await app.waitFor('scope marker available',async()=>({done:await app.wd.execute("return [...document.querySelectorAll('#profiler-scope option')].some(o=>o.value===arguments[0])",[marker])}));
 await click(app,`//select[@id='profiler-scope']/option[@value='${marker}']`);
 await app.waitFor('marker scope selected',async()=>({done:await app.wd.execute("return document.getElementById('profiler-scope').value===arguments[0]",[marker])}));
}
const caption=app=>app.wd.execute("return document.querySelector('[data-recording-id]')?.innerText??''");
async function metric(app,label,value){await app.waitFor(label+' '+value,async()=>({done:await app.wd.execute("return [...document.querySelectorAll('.profiler-metrics dt')].some(d=>d.textContent===arguments[0]&&d.nextElementSibling.textContent===arguments[1])",[label,value])}));}

test('unified scopes preserve selected Gold/Solo completion and separate manual snapshot history',{skip:process.env.CRAIDD_TEST_UNITY!=='1',timeout:480000},async t=>{
 const dir=await evidenceDirectory('unity-scopes'),namespace=`scopes-${randomUUID()}`;
 const unity=await disposableUnity(dir,namespace);t.after(()=>unity.close());
 await unity.waitFor('own Editor ready',()=>readFile(join(unity.signals,'ready'),'utf8'),240000);
 const pid=(await unity.status()).pid;assert.equal(pid,unity.child.pid);
 const app=await launch('unity-scopes',{environment:{CRAIDD_PROFILE_NAMESPACE:namespace}});t.after(()=>app.close());
 await openSolution(app,join(unity.project,'unity.cln'));await showProfiler(app);
 await click(app,"//button[normalize-space()='Attach…']");
 await app.waitFor('only our copy preselected',async()=>({done:await app.wd.execute("return document.querySelector('[role=option][aria-selected=true]')?.innerText.includes(arguments[0])",[String(pid)])}));
 await click(app,"//button[normalize-space()='Profile only']");
 await waitProfile(app,'samples before any Gold recording',p=>p.target.pid===pid&&p.provider&&p.captures.length===0&&p.samples.length>=2);
 await click(app,"//button[@aria-label='Take memory snapshot']");
 assert.equal(await app.wd.execute("return document.querySelector('select[aria-label=\"Profiler view\"]').value"),'live');
 assert.equal(await app.wd.execute("return document.querySelectorAll('optgroup[label=\"Manual snapshots\"] option').length"),1);
 app.record('manual-without-gold',{profile:await get(app)});await app.screenshot('manual-without-gold');
 await unity.command('play',60);
 await waitProfile(app,'Solo active',p=>p.captures.some(c=>c.solo&&c.endMs===null));
 await unity.command('begin');await unity.command('begin-inner');await unity.command('allocate');
 const active=await waitProfile(app,'nested live recordings and exact native cohort',p=>p.captures.filter(c=>c.marker.startsWith('harness.')&&c.liveBytes===1048576&&c.endMs===null).length===2);
 const outer=active.captures.find(c=>c.marker==='harness.outer'),inner=active.captures.find(c=>c.marker==='harness.inner');
 await tab(app,'Summary');await metric(app,'Observed native live','1.00 MiB'); // Unique process total, not three overlapping cohorts.
 await chooseMarker(app,'harness.outer');
 await app.waitFor('outer Recording status',async()=>({done:(await caption(app)).includes('Recording')}));
 const initialId=await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')");assert.equal(initialId,outer.id);
 for(const name of ['Summary','Gold','Memory','Events']){await tab(app,name);assert.equal(await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')"),outer.id);}
 await app.waitFor('sampled window extends',async()=>{const p=await get(app);return {done:p.samples.some(s=>s.atMs>outer.startMs+750)};});
 await click(app,"//button[@aria-label='Take memory snapshot']");
 assert.equal(await app.wd.execute("return document.querySelector('select[aria-label=\"Profiler view\"]').value"),'live');
 assert.equal(await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')"),outer.id);
 const snapshotId=await app.wd.execute("return [...document.querySelectorAll('optgroup[label=\"Manual snapshots\"] option')].at(-1).value");
 await app.screenshot('active-gold-snapshot-separate');
 await unity.command('end-inner');await unity.command('end');
 const ended=await waitProfile(app,'Gold End observed',p=>p.captures.some(c=>c.id===outer.id&&c.endMs!==null));const completed=ended.captures.find(c=>c.id===outer.id);
 await app.waitFor('same selected identity visibly Recorded',async()=>({done:(await caption(app)).includes('Recorded')&&!((await caption(app)).includes('Recording'))}));
 assert.equal(await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')"),outer.id);
 await tab(app,'Memory');await metric(app,'Still live at End','1.00 MiB');
 await unity.command('clear');await waitProfile(app,'late free updates current survivor',p=>p.captures.find(c=>c.id===outer.id)?.liveBytes===0);
 await metric(app,'Current observed survivors','0 B');await metric(app,'Still live at End','1.00 MiB');
 await metric(app,'Native frees observed','0 B');
 const ruler=await app.wd.execute("return document.querySelector('.profiler-ruler').innerText");
 assert.ok(ruler.includes((completed.startMs/1000).toFixed(2)+' s'));assert.ok(ruler.includes((completed.endMs/1000).toFixed(2)+' s'));
 const chartLabels=await app.wd.execute("return [...document.querySelectorAll('.profiler-chart svg')].map(s=>s.getAttribute('aria-label'))");
 const retained=await get(app),observed=retained.samples.filter(s=>s.atMs>=completed.startMs&&s.atMs<=completed.endMs);
 assert.ok(chartLabels[0].includes(observed.length+' samples'));assert.ok(chartLabels[1].includes(Math.max(0,observed.length-1)+' samples'));
 app.record('completed-gold',{outer:completed,inner:ended.captures.find(c=>c.id===inner.id),profile:retained,ruler,chartLabels});await app.screenshot('recorded-gold-after-free');
 for(const width of [288,360,420]){for(const name of ['Summary','Gold','Memory','Events']){await tab(app,name);const size=await resizeProfiler(app,width);assert.ok(size.scrollWidth<=size.clientWidth+1,JSON.stringify({name,size}));app.record('compact-'+name+'-'+width,size);await app.screenshot(`scope-${name.toLowerCase()}-${width}px`);}}
 // Timeline and history actions use the same shared scope, not a tab-local filter.
 await click(app,"//div[@aria-label='Gold capture timeline']/button[contains(@aria-label,'Harness inner window')]");
 await app.waitFor('timeline selected nested capture',async()=>({done:await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')===arguments[0]",[inner.id])}));
 await tab(app,'Gold');await click(app,"//details[contains(@class,'profiler-capture-group')]/summary");
 await click(app,`//details[@data-capture-id='${outer.id}']/summary`);
 await click(app,`//details[@data-capture-id='${outer.id}']//button[normalize-space()='Focus recording']`);
 assert.equal(await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')"),outer.id);
 app.record('timeline-and-history-focus',{outer:outer.id,inner:inner.id});await app.screenshot('timeline-and-history-focus');
 // Snapshot dropdown contains saved moments only; the scope picker lists each marker once.
 const menus=await app.wd.execute("return {snapshots:[...document.querySelectorAll('select[aria-label=\"Profiler view\"] option')].map(o=>({value:o.value,text:o.textContent})),scope:[...document.querySelectorAll('#profiler-scope option')].map(o=>({value:o.value,text:o.textContent}))}");
 assert.equal(menus.scope.filter(o=>o.value==='harness.outer').length,1);assert.ok(!menus.snapshots.some(o=>o.text.includes('Harness outer window')));assert.equal(menus.snapshots.length,3);
 // Review the earlier live recording snapshot, then save again without changing review.
 await click(app,`//select[@aria-label='Profiler view']/optgroup/option[@value='${snapshotId}']`);
 assert.ok((await caption(app)).includes('Open at snapshot'));await tab(app,'Memory');await metric(app,'Still live','1.00 MiB');
 const snapshotRuler=await app.wd.execute("return document.querySelector('.profiler-ruler').innerText");await click(app,"//button[@aria-label='Take memory snapshot']");
 assert.equal(await app.wd.execute("return document.querySelector('select[aria-label=\"Profiler view\"]').value"),snapshotId);assert.equal(await app.wd.execute("return document.querySelector('.profiler-ruler').innerText"),snapshotRuler);
 await click(app,"//button[@aria-label='Return to live profiling']");assert.equal(await app.wd.execute("return document.getElementById('profiler-scope').value"),'session');await metric(app,'Still live','0 B');
 await chooseMarker(app,'unity.solo');const soloId=await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')");
 await unity.command('stop');await waitProfile(app,'Ready for Play',p=>p.waitingForPlay);await app.waitFor('Solo visibly Recorded',async()=>({done:(await caption(app)).includes('Recorded')}));
 const soloRuler=await app.wd.execute("return document.querySelector('.profiler-ruler').innerText");await unity.command('play',60);await waitProfile(app,'next Play new batch',p=>!p.waitingForPlay&&p.batch>ended.batch);
 assert.equal(await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')"),soloId);assert.equal(await app.wd.execute("return document.querySelector('.profiler-ruler').innerText"),soloRuler);
 app.record('selected-completed-solo-next-play',{profile:await get(app),soloId,soloRuler,menus});await app.screenshot('recorded-solo-next-play');
 await click(app,"//button[@aria-label='Return to live profiling']");assert.equal(await app.wd.execute("return document.getElementById('profiler-scope').value"),'session');
 await chooseMarker(app,'unity.native.mix');
 const rollingId=await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')");
 await app.waitFor('evicted selected hit explicitly unavailable',async()=>({done:(await caption(app)).includes('Unavailable')}),15000);
 assert.equal(await app.wd.execute("return document.querySelector('[data-recording-id]').getAttribute('data-recording-id')"),rollingId);
 assert.equal(await app.wd.execute("return document.querySelectorAll('.profiler-chart polyline').length"),0);
 app.record('evicted-selection',{rollingId,profile:await get(app)});await app.screenshot('evicted-recording-unavailable');
 await click(app,"//button[@aria-label='Return to live profiling']");
 await click(app,"//button[@aria-label='Stop profiling']");await waitProfile(app,'safe Stop',p=>!p.active);assert.equal((await unity.status()).playing,true);
});
