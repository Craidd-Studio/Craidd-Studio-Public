// Acceptance-review regressions in the real embedded app and our own Unity copy.
// The event listeners are passive: no DOM value writes or synthetic change events.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { launch, openSolution, evidenceDirectory } from './lib/harness.mjs';
import { disposableUnity } from './lib/unity-copy.mjs';
import { showProfiler, resizeProfiler } from './lib/profiler.mjs';

const click = async (app, xpath) => app.wd.click(await app.wd.find(xpath));
const endedCount = p => (p.diagnostics ?? []).filter(d => d.kind === 'Unity Play ended').reduce((n,d) => n+d.count,0);
const scopeState = app => app.wd.execute(`const s=document.querySelector('#profiler-scope');return {
  value:s.value,index:s.selectedIndex,recording:document.querySelector('[data-recording-id]')?.getAttribute('data-recording-id')??null,
  caption:document.querySelector('.profiler-scope-caption')?.innerText??null,events:window.__scopeEvents.slice()};`);

test('Unity review: native scope reselection, distinct snapshots, transient confirmation and Play diagnostics',
  {skip:process.env.CRAIDD_TEST_UNITY!=='1',timeout:360000},async t=>{
  const dir=await evidenceDirectory('unity-review-regressions');
  const namespace=`unity-review-${randomUUID()}`;
  const unity=await disposableUnity(dir,namespace);t.after(()=>unity.close());
  await unity.waitFor('Editor ready',()=>readFile(join(unity.signals,'ready'),'utf8'),240000);
  const ready=await unity.status();assert.equal(ready.pid,unity.child.pid);
  const app=await launch('unity-review-regressions',{environment:{CRAIDD_PROFILE_NAMESPACE:namespace}});t.after(()=>app.close());
  await openSolution(app,join(unity.project,'unity.cln'));await showProfiler(app);
  await click(app,"//button[normalize-space()='Attach…']");
  await app.waitFor('only our Editor selected',async()=>({done:await app.wd.execute("return document.querySelector('[role=option][aria-selected=true]')?.innerText.includes(arguments[0])",[String(ready.pid)])}));
  await click(app,"//button[normalize-space()='Profile only']");
  const waitProfile=(description,predicate)=>app.waitFor(description,async()=>{const p=await app.invoke('get_profile');return {done:p&&predicate(p),value:p};});
  await waitProfile('armed provider',p=>p.target.pid===ready.pid&&p.provider&&p.waitingForPlay);
  await unity.command('play',60);
  const first=await waitProfile('first Play',p=>!p.waitingForPlay&&p.captures.some(c=>c.solo&&c.endMs===null));
  app.record('before-any-stop',{diagnostics:first.diagnostics,count:endedCount(first)});
  await app.waitFor('live scope choices rendered',async()=>({done:await app.wd.execute("return [...document.querySelector('#profiler-scope').options].some(o=>o.value==='unity.solo')&&[...document.querySelector('#profiler-scope').options].some(o=>o.value==='unity.native.mix')")}));
  await app.wd.execute(`window.__scopeEvents=[];for(const type of ['pointerdown','click','input','change','focusin'])document.addEventListener(type,e=>{
    if(e.target.id!=='profiler-scope')return;window.__scopeEvents.push({type,trusted:e.isTrusted,value:e.target.value,index:e.target.selectedIndex,at:performance.now()});
    window.__scopeEvents=window.__scopeEvents.slice(-64);
  },true);`);
  await click(app,"//select[@id='profiler-scope']/option[@value='unity.solo']");
  await app.waitFor('first Solo focus',async()=>({done:(await scopeState(app)).recording?.includes('unity.solo')}));
  const initial=await scopeState(app);
  await click(app,"//button[@aria-label='Return to live profiling']");
  const reset=await scopeState(app);assert.equal(reset.value,'session');assert.equal(reset.recording,null);
  await click(app,"//select[@id='profiler-scope']/option[@value='unity.solo']");
  // Observe after the next publication too; no retry that could conceal a lost change.
  await waitProfile('another live sample',p=>p.samples.length>first.samples.length+2);
  const repeated=await scopeState(app);app.record('native-scope-trace',{initial,reset,repeated});
  await app.screenshot('01-native-reselection');
  // A different choice and a keyboard choice provide independent controls.
  await click(app,"//select[@id='profiler-scope']/option[@value='unity.native.mix']");
  const different=await scopeState(app);
  await click(app,"//button[@aria-label='Return to live profiling']");
  const options=await app.wd.execute("return [...document.querySelector('#profiler-scope').options].map(o=>o.value)");
  await click(app,"//select[@id='profiler-scope']");
  await app.wd.keys('\uE011',...Array(options.indexOf('unity.solo')).fill('\uE015'),'\uE007');
  const keyboard=await scopeState(app);app.record('native-scope-controls',{different,keyboard});
  assert.ok(keyboard.recording?.includes('unity.solo'),'keyboard scopes the real recording');
  await click(app,"//select[@id='profiler-scope']");
  await app.wd.keys('\uE011',...Array(options.indexOf('unity.native.mix')).fill('\uE015'),'\uE007');
  assert.ok((await scopeState(app)).recording?.includes('unity.native.mix'),'successive keyboard changes keep working');
  assert.equal(await app.wd.execute("return document.activeElement.id"),'profiler-scope','native keyboard focus is preserved');
  await click(app,"//button[@aria-label='Return to live profiling']");
  await resizeProfiler(app,360);
  for(let i=0;i<3;i++)await click(app,"//button[@aria-label='Take memory snapshot']");
  const labels=await app.wd.execute(`return [...document.querySelector('select[aria-label="Profiler view"]').options].filter(o=>o.value!=='live').map(o=>({id:o.value,label:o.textContent}));`);
  assert.equal(labels.length,3);
  await click(app,`//select[@aria-label='Profiler view']/optgroup/option[@value='${labels[0].id}']`);
  await click(app,"//button[@aria-label='Take memory snapshot']");
  assert.equal(await app.wd.execute(`return document.querySelector('select[aria-label="Profiler view"]').value`),labels[0].id,'capture from history preserves selection');
  const confirmationAt=Date.now();
  assert.match(await app.wd.execute("return document.querySelector('.profiler-scope-caption[role=status]')?.textContent??''"),/Snapshot saved/);
  await click(app,"//button[normalize-space()='Open in Editor Panel']");
  assert.match(await app.wd.execute("return document.querySelector('.profiler-scope-caption[role=status]')?.textContent??''"),/Snapshot saved/,'rehosting preserves unexpired feedback');
  await click(app,"//button[@aria-label='Close Profiling']");
  await app.waitFor('six seconds of publication',async()=>({done:Date.now()-confirmationAt>6000}));
  const note=await app.wd.execute("return document.querySelector('.profiler-scope-caption[role=status]')?.textContent??''");
  app.record('snapshot-labels-and-confirmation',{labels,note,elapsedMs:Date.now()-confirmationAt});
  await app.screenshot('02-snapshots-and-confirmation');
  await click(app,"//button[@aria-label='Return to live profiling']");
  for(let i=0;i<2;i++){
    await unity.command('stop');await waitProfile('real Play exit',p=>p.waitingForPlay);
    if(i===0){await unity.command('play',60);await waitProfile('next Play',p=>!p.waitingForPlay&&p.playGeneration>first.playGeneration);}
  }
  const ended=await app.invoke('get_profile');app.record('two-real-exits',{diagnostics:ended.diagnostics,count:endedCount(ended),counters:ended.counters});
  await click(app,"//button[normalize-space()='Open in Editor Panel']");
  await app.wd.command('POST','/window/rect',{width:1280,height:800});
  const layout=await app.wd.execute(`const p=document.querySelector('.profiler-panel'),t=document.querySelector('.profiler-tabs'),r=p.getBoundingClientRect(),b=t.getBoundingClientRect();return {hostHeight:p.clientHeight,contentHeight:p.scrollHeight,tabsTop:b.top,tabsBottom:b.bottom,hostTop:r.top,hostBottom:r.bottom,tabVisible:b.bottom<=r.bottom};`);
  app.record('expanded-1280x800',layout);await app.screenshot('03-expanded-1280x800');
  // Accumulate observations before assertions so a failure retains the full trace.
  assert.ok(repeated.recording?.includes('unity.solo'),'same native option must scope again after Live');
  assert.ok(different.recording?.includes('unity.native.mix'));
  assert.equal(new Set(labels.map(s=>s.label)).size,labels.length,'rapid snapshots have distinct accessible labels');
  assert.equal(note,'','saved confirmation expires');
  assert.equal(endedCount(first),0,'startup and entry are not Play exits');
  assert.equal(endedCount(ended),2,'only two real Play exits are counted');
  assert.equal(ended.counters.sourceGaps+ended.counters.rejectedEvents+ended.counters.disconnects,0);
});
