// Real Tauri regression for program-shaped CSV headers and row location context.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {launch,openSolution,ROOT,APP} from './lib/harness.mjs';
import {showProfiler} from './lib/profiler.mjs';
const enabled=process.env.CRAIDD_TEST_METRIC_DEFECTS==='1',reproduce=process.env.CRAIDD_M1_DEFECT_REPRO==='1';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function button(app,label){await app.wd.execute('const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);b.scrollIntoView({block:"center"})',[label]);await app.wd.click(await app.wd.find(`//button[normalize-space()=${JSON.stringify(label)}]`));}
async function value(app,label,text){await app.wd.execute('const el=document.querySelector(`[aria-label="${arguments[0]}"]`),p=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(el,String(arguments[1]));el.dispatchEvent(new Event("input",{bubbles:true}));',[label,text]);}
async function choose(app,label,text){await app.wd.execute('const el=document.querySelector(`[aria-label="${arguments[0]}"]`);el.value=String(arguments[1]);el.dispatchEvent(new Event("change",{bubbles:true}));',[label,text]);}

test('M1 program-shaped units, bulk edits, worst keys and joined row',{skip:!enabled,timeout:120000},async t=>{
  const root=await mkdtemp(join(tmpdir(),'craidd-m1-program-defects-'));
  const main=join(ROOT,'workspaces/profiling-metrics/fixtures/program-shaped/run.csv'),sections=join(ROOT,'workspaces/profiling-metrics/fixtures/program-shaped/run-sections.csv');
  const originals=await Promise.all([readFile(main),readFile(sections)]);
  const solution=join(root,'Metrics.cln');await writeFile(solution,'[solution]\nname="Program-shaped metric regression"\nversion="1.0"\nprojects=[]\n');
  const app=await launch(reproduce?'metric-program-reproduction':'metric-program-fixed');t.after(()=>app.close());
  await openSolution(app,solution);await showProfiler(app);await button(app,'Open metric imports');
  await app.waitFor('metric editor',async()=>({done:await app.wd.execute('return !!document.querySelector(".metric-import-panel")')}));
  await app.wd.execute('document.querySelector(".metric-paths").open=true');await value(app,'Metric import paths',main+'\n'+sections);await button(app,'Import paths');
  await app.waitFor('imported set',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Metric range graph\\"]")')}));
  const id=await app.wd.execute('return document.querySelector("[aria-label=\\"Metric source set\\"]").value'),action=request=>app.invoke('metric_action',{request:{id,...request}});
  await choose(app,'Metric series',3);await button(app,'Find worst windows / largest values');
  await app.waitFor('worst rows',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Worst metric windows\\"] tbody tr")')}));
  const baselineStatus=await action({op:'status'}),worstBefore=await app.wd.execute('return document.querySelector("[aria-label=\\"Worst metric windows\\"]").innerText');
  await button(app,'Interpretation and joins');
  const bulkPresent=await app.wd.execute('return !!document.querySelector("[aria-label=\\"Metric bulk unit\\"]")');
  if(reproduce){
    assert.equal(baselineStatus.tables[0].columns[1].unit,'unitless');assert.equal(baselineStatus.tables[0].columns[1].meaning,'unknown');assert.ok(!worstBefore.includes('elapsed_s'));assert.equal(bulkPresent,false);
    const evidence={gate:'PASS',scope:'Reproduced requested defects before production edits',binary:{path:APP,sha256:hash(await readFile(APP))},status:baselineStatus,worstBefore,bulkPresent,fixtureHashes:originals.map(hash)};
    await app.screenshot('reproduced-program-defects');await writeFile(join(app.dir,'program-defects.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({evidence:app.dir,reproduced:true}));return;
  }
  assert.deepEqual(baselineStatus.tables[0].columns.map(c=>c.unit),['s','ms','ms','ms','ms','us','kb_s']);
  assert.ok(baselineStatus.tables[0].columns.slice(1,6).every(c=>c.meaning==='window statistic'&&c.unitSuggested&&c.meaningSuggested));
  assert.ok(await app.wd.execute('return [...document.querySelectorAll("[aria-label=\\"Metric column interpretation\\"] tbody tr")].find(r=>r.textContent.includes("loop_ms_p95"))?.textContent.includes("Suggested")'));
  assert.ok(worstBefore.includes('elapsed_s')&&worstBefore.includes('2.25'));
  await app.wd.execute('document.querySelector(arguments[0]).scrollIntoView({block:"center"})',['[aria-label="Metric column interpretation"]']);await app.screenshot('01-unit-and-meaning-suggestions');
  const ranked=await action({op:'worst',table:0,column:3,start:0,end:4,count:20});assert.equal(ranked[0].index,2);
  await choose(app,'Metric worst key',6);assert.ok(await app.wd.execute('return document.querySelector("[aria-label=\\"Worst metric windows\\"] tbody tr").textContent.includes("128")'));
  await choose(app,'Metric worst key','auto');
  await choose(app,'Metric clock domain','elapsed');await choose(app,'Metric time column',0);await button(app,'Apply interpretation');
  await app.waitFor('axis saved',async()=>({done:(await action({op:'status'})).tables[0].axis.kind==='elapsed'}));
  await app.waitFor('axis in worst table',async()=>({done:await app.wd.execute('const t=document.querySelector("[aria-label=\\"Worst metric windows\\"]");return t?.textContent.includes("axis")&&t?.textContent.includes("2.25")')}));
  await button(app,'Set join rule');await app.waitFor('exact named join',async()=>({done:(await action({op:'status'})).joins.length===1}));
  const snapshot=join(root,'before-bulk.crmetrics');await action({op:'save',path:snapshot,ranges:[[0,4],[0,4]]});const savedHash=hash(await readFile(snapshot));
  await choose(app,'Metric file group',1);
  if(!await app.wd.execute('return !!document.querySelector(".metric-settings")'))await button(app,'Interpretation and joins');
  await app.waitFor('companion settings',async()=>({done:await app.wd.execute('return !!document.querySelector("[aria-label=\\"Unit recv\\"]")')}));
  await choose(app,'Metric bulk scope','unitless');await value(app,'Metric bulk unit','ms');await choose(app,'Metric bulk meaning','window statistic');await button(app,'Apply bulk interpretation');
  await app.waitFor('bulk saved',async()=>({done:(await action({op:'status'})).tables[1].columns.slice(1).every(c=>c.unit==='ms'&&c.meaning==='window statistic'&&!c.unitSuggested&&!c.meaningSuggested)}));
  assert.equal((await action({op:'status'})).tables[1].columns[0].unit,'s');
  await app.wd.execute('document.querySelector(arguments[0]).scrollIntoView({block:"center"})',['[aria-label="Metric column interpretation"]']);await app.screenshot('02-bulk-companion-ms');
  await choose(app,'Metric file group',0);await button(app,'Find worst windows / largest values');
  await app.waitFor('worst main',async()=>({done:await app.wd.execute('return document.querySelector("[aria-label=\\"Worst metric windows\\"] tbody tr button")?.textContent==="Row 3"')}));
  await app.wd.click(await app.wd.find('//table[@aria-label="Worst metric windows"]//button[normalize-space()="Row 3"]'));
  await app.waitFor('joined row',async()=>({done:await app.wd.execute('const a=document.querySelector("[aria-label=\\"Inspected metric row\\"]");return a?.textContent.includes("run-sections.csv · joined")&&a?.textContent.includes("60")')}));
  await app.wd.execute('document.querySelector(arguments[0]).scrollIntoView({block:"center"})',['[aria-label="Inspected metric row"]']);await app.screenshot('03-worst-row-with-joined-companion');
  const inspection=await action({op:'row',table:0,row:2});assert.equal(inspection.companions[0].row.cells[2],60);assert.equal(inspection.companions[0].row.index,3,'join by key, not position');
  assert.equal(hash(await readFile(snapshot)),savedHash);
  await app.wd.execute('document.querySelector(".metric-paths").open=true');await value(app,'Metric import paths',snapshot);await button(app,'Open snapshot path');
  await app.waitFor('snapshot reopened',async()=>({done:await app.wd.execute('return document.querySelector(".metric-source-heading")?.textContent.includes("Saved snapshot")')}));
  const snapshotId=await app.wd.execute('return document.querySelector("[aria-label=\\"Metric source set\\"]").value');const reopened=await app.invoke('metric_action',{request:{op:'status',id:snapshotId}});
  assert.ok(reopened.tables[1].columns.slice(1).every(c=>c.unit==='unitless'&&c.meaning==='unknown'));
  await choose(app,'Metric file group',1);
  if(!await app.wd.execute('return !!document.querySelector(".metric-settings")'))await button(app,'Interpretation and joins');
  assert.equal(await app.wd.execute('return document.querySelector("[aria-label=\\"Metric bulk unit\\"]")?.disabled'),true);
  assert.deepEqual(await readFile(main),originals[0]);assert.deepEqual(await readFile(sections),originals[1]);
  const evidence={gate:'PASS',binary:{path:APP,sha256:hash(await readFile(APP))},fixtureHashes:originals.map(hash),imported:baselineStatus,final:await action({op:'status'}),rankedIdentity:ranked.map(r=>r.index),inspection,reopened,savedHash,snapshotUnchanged:hash(await readFile(snapshot))===savedHash,producerFilesUnchanged:true,desktopEnvironment:{display:process.env.DISPLAY,sessionType:process.env.XDG_SESSION_TYPE,gdkBackend:process.env.GDK_BACKEND},uiRedesign:'NOT TESTED: on hold'};
  await app.screenshot('fixed-program-defects');await writeFile(join(app.dir,'program-defects.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify({evidence:app.dir,gate:'PASS'}));
});
