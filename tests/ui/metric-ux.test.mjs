// Native M1 usability checks. File chooser/screen-reader/human gates stay separate.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {launch,openSolution} from './lib/harness.mjs';
import {showProfiler,resizeProfiler} from './lib/profiler.mjs';
const enabled=process.env.CRAIDD_TEST_METRICS==='1';
async function button(app,text){
  await app.wd.execute('const el=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);el?.scrollIntoView({block:"center"});',[text]);
  await app.wd.click(await app.wd.find(`//button[normalize-space()=${JSON.stringify(text)}]`));
}
async function value(app,selector,text){await app.wd.execute(`const el=document.querySelector(arguments[0]);const proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,arguments[1]);el.dispatchEvent(new Event('input',{bubbles:true}));`,[selector,String(text)]);}
async function choose(app,selector,text){await app.wd.execute('const el=document.querySelector(arguments[0]);el.value=arguments[1];el.dispatchEvent(new Event("change",{bubbles:true}));',[selector,String(text)]);}

test('Metric M1 public-release UX: compact widths, keyboard, retained inspection and retries',{skip:!enabled,timeout:120000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'craidd-metric-ux-'));const runtime=join(root,'runtime');await mkdir(runtime,{mode:0o700});
  const solution=join(root,'Metrics.cln'),csv=join(root,'run.csv'),sections=join(root,'run-sections.csv'),notes=join(root,'notes.txt');
  await writeFile(notes,'Return to metric inspection without losing its range.\n');
  await writeFile(solution,'[solution]\nname="Metric UX"\nversion="1.0"\nprojects=[]\n');
  await writeFile(csv,`time_s,value_ms,note\n0,1,start\n1,99,${'LongAttribute'.repeat(45)}\n2,bad,rejected\n3,2,end\n`);
  await writeFile(sections,'time_s,section_ms\n0,1\n1,80\n3,1\n');const original=await readFile(csv);
  const app=await launch('metric-ux',{environment:{XDG_RUNTIME_DIR:runtime}});t.after(()=>app.close());
  await openSolution(app,solution);await showProfiler(app);
  assert.equal(await app.wd.execute('return !!document.querySelector(".metric-import-panel")'),false);
  for(const width of [288,360,420]){
    await resizeProfiler(app,width);
    const sidebar=await app.wd.execute('const p=document.querySelector("[aria-label=\\"Profiler sidebar\\"]");return {width:p.getBoundingClientRect().width,csv:!!p.querySelector(".metric-import-panel"),standard:!!p.querySelector("[aria-label=\\"Compact Profiler\\"]")};');
    assert.equal(sidebar.csv,false);assert.equal(sidebar.standard,true);await app.screenshot(`00-standard-sidebar-${width}`);app.record('standard-sidebar',{requestedWidth:width,...sidebar});
  }
  await app.wd.execute('const b=[...document.querySelectorAll("button")].find(b=>b.textContent==="Open metric imports");b.focus()');await app.wd.keys('\uE007');
  await app.waitFor('keyboard opens editor-only analysis',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Profiler editor\\"] .metric-empty")&&!document.querySelector("[aria-label=\\"Right panel\\"]")')}));
  const focus={action:'Open metric imports',method:'native Enter key'};
  await app.screenshot('01-empty-editor');
  await app.wd.execute('document.querySelector(".metric-paths").open=true');
  await value(app,'[aria-label="Metric import paths"]',join(root,'missing.csv'));await button(app,'Import paths');
  await app.waitFor('error visible',async()=>({done:await app.wd.execute('return !!document.querySelector(".metric-import-panel [role=alert]")')}));
  await value(app,'[aria-label="Metric import paths"]',csv+'\n'+sections);await button(app,'Import paths');
  await app.waitFor('retry imported',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Metric range graph\\"]")')}));
  assert.equal(await app.wd.execute('return !!document.querySelector(".metric-import-panel [role=alert]")'),false);
  const id=await app.wd.execute('return document.querySelector("[aria-label=\\"Metric source set\\"]").value');
  const action=request=>app.invoke('metric_action',{request});
  await app.wd.execute('document.querySelector(".metric-paths").open=false');
  await choose(app,'[aria-label="Metric series"]',1);await button(app,'Zoom in');
  await app.waitFor('selected range',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Metric range graph\\"]")?.getAttribute("data-start")==="1"')}));
  await value(app,'[aria-label="Metric row number"]',2);
  await app.wd.execute('document.querySelector("[aria-label=\\"Metric row number\\"]").focus()');await app.wd.keys('\uE007');
  await app.waitFor('keyboard row inspection',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Inspected metric row\\"] h3")?.textContent.startsWith("Row 2")')}));
  await button(app,'Process / Gold');await button(app,'Imported metrics');
  await app.waitFor('retained source inspection',async()=>({done:await app.wd.execute('const g=document.querySelector("[aria-label=\\"Metric range graph\\"]");return g?.getAttribute("data-start")==="1"&&g?.getAttribute("data-end")==="2"&&g?.getAttribute("data-column")==="1"&&document.querySelector("[aria-label=\\"Inspected metric row\\"] h3")?.textContent.startsWith("Row 2")')}));
  assert.equal(await app.invoke('get_profile'),null,'source switching never starts a collector');
  await app.wd.click(await app.wd.find("//*[@title='"+notes+"']"));
  await app.waitFor('code restores standard sidebar',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Profiler sidebar\\"] [aria-label=\\"Compact Profiler\\"]")&&!document.querySelector(".metric-import-panel")')}));
  await button(app,'Open metric imports');
  await app.waitFor('code to metrics retains range and row',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Metric range graph\\"]")?.getAttribute("data-start")==="1"&&document.querySelector("[aria-label=\\"Inspected metric row\\"] h3")?.textContent.startsWith("Row 2")')}));
  for(const width of [900,1280,1600]){
    await app.wd.command('POST','/window/rect',{width,height:1000});
    const layout=await app.wd.execute(`const panel=document.querySelector('.metric-import-panel'),results=panel.querySelector('.profiler-results'),graph=panel.querySelector('[aria-label="Metric range graph"]'),rect=results.getBoundingClientRect();
    const outside=[...panel.querySelectorAll('button,input,select')].filter(el=>!el.closest('.metric-settings')).filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height&&(r.left<rect.left-2||r.right>rect.right+2);}).map(el=>el.textContent||el.getAttribute('aria-label'));
    return {panelWidth:panel.getBoundingClientRect().width,clientWidth:results.clientWidth,scrollWidth:results.scrollWidth,chartHeight:graph.getBoundingClientRect().height,outside};`);
    assert.ok(layout.scrollWidth<=layout.clientWidth+2,JSON.stringify(layout));assert.deepEqual(layout.outside,[]);assert.equal(layout.chartHeight,150);
    await app.wd.execute('document.querySelector("[aria-label=\\"Imported metric timeline\\"]").scrollIntoView({block:"center"})');await app.screenshot(`02-editor-${width}`);
    app.record('import-editor-layout',{windowWidth:width,...layout});
  }
  assert.ok(await app.wd.execute('const l=document.querySelector("[aria-label=\\"Metric range graph\\"] line");return l.getAttribute("vector-effect")==="non-scaling-stroke"&&l.getAttribute("x1")==="500";'),'single-row chart stays visible and centred');
  assert.ok(await app.wd.execute('return !!document.querySelector(".metric-long-value summary")'),'long attributes have an explicit full-value disclosure');
  await button(app,'Interpretation and joins');await value(app,'[aria-label="Metric join tolerance"]','0.5');await button(app,'Set join rule');
  await app.waitFor('toleranced rule',async()=>({done:(await action({op:'status',id})).joins[0]?.tolerance===0.5}));
  const before=(await action({op:'status',id})).tables[0];
  await value(app,'[aria-label="Unit time_s"]','ms');await button(app,'Apply interpretation');
  await app.waitFor('unit conflict',async()=>({done:await app.wd.execute('return document.querySelector(".metric-import-panel [role=alert]")?.textContent.includes("conflicts")')}));
  assert.equal((await action({op:'status',id})).tables[0].interpretationRevision,before.interpretationRevision);
  await value(app,'[aria-label="Unit time_s"]','s');await button(app,'Apply interpretation');
  await app.waitFor('corrected retry rendered',async()=>{const revision=(await action({op:'status',id})).tables[0].interpretationRevision;const ui=await app.wd.execute('return {alerts:[...document.querySelectorAll(".metric-import-panel [role=alert]")].map(el=>el.textContent),notices:[...document.querySelectorAll(".metric-import-panel [role=status]")].map(el=>el.textContent)}');return {done:revision>before.interpretationRevision&&!ui.alerts.length&&ui.notices.some(v=>v.startsWith("Interpretation applied.")),revision,before:before.interpretationRevision,...ui};});
  assert.equal(await app.wd.execute('return !!document.querySelector(".metric-import-panel [role=alert]")'),false);
  const final=await app.wd.execute(`const p=document.querySelector('.metric-import-panel'),r=p.querySelector('.profiler-results');return {clientWidth:r.clientWidth,scrollWidth:r.scrollWidth,snapshotScope:p.querySelector('.metric-snapshot-scope')?.textContent,join:p.querySelector('.metric-join-rules')?.textContent,description:p.querySelector('svg[aria-describedby]')?.getAttribute('aria-describedby')};`);
  assert.ok(final.scrollWidth<=final.clientWidth+2,JSON.stringify(final));assert.ok(final.snapshotScope.includes('rows 2–2'));assert.ok(final.join.includes('±0.5 s'));assert.equal(final.description,'metric-chart-description');
  assert.deepEqual(await readFile(csv),original);
  await app.wd.execute('document.querySelector("[aria-label=\\"Imported metric timeline\\"]").scrollIntoView({block:"center"})');await app.screenshot('03-editor-analysis');
  app.record('keyboard-state-error-recovery',{focus,final,producerBytesUnchanged:true,rangeAndRowSurvivedSourceAndHostSwitch:true});
  console.log(JSON.stringify({evidence:app.dir,final},null,2));
});
