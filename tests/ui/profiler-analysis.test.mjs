// Real Tauri controls and native data; deliberately separate from human acceptance.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,copyFile} from 'node:fs/promises';
import {tmpdir,hostname,release} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {launch,openSolution,ROOT,APP,processIdentity,switchToLabel} from './lib/harness.mjs';
import {showProfiler} from './lib/profiler.mjs';
const enabled=process.env.CRAIDD_TEST_PROFILER_ANALYSIS==='1';
async function button(app,label){await app.wd.execute('const b=[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===arguments[0]);if(!b)throw Error("Button absent: "+arguments[0]);b.scrollIntoView({block:"nearest"});',[label]);await app.wd.click(await app.wd.find(`//button[normalize-space()=${JSON.stringify(label)}]`));}
async function value(app,label,text){await app.wd.execute('const el=document.querySelector(`[aria-label="${arguments[0]}"]`),p=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,"value").set.call(el,String(arguments[1]));el.dispatchEvent(new Event("input",{bubbles:true}));',[label,text]);}
async function choose(app,label,text){await app.wd.execute('const el=document.querySelector(`[aria-label="${arguments[0]}"]`);el.value=String(arguments[1]);el.dispatchEvent(new Event("change",{bubbles:true}));',[label,text]);}
async function file(app,name){await app.wd.click(await app.wd.find(`//button[contains(@class,'analysis-source')][strong[normalize-space()=${JSON.stringify(name)}]]`));}
async function condition(app,name,script){return app.waitFor(name,async()=>({done:await app.wd.execute(script)}),90000);}

test('Profiler chart-first metrics and real timed perf controls',{skip:!enabled,timeout:240000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'craidd-profiler-analysis-')),solution=process.env.CRAIDD_PERF_UI_BUILD?join(resolve(process.env.CRAIDD_PERF_UI_BUILD),root.split("/").pop()+".cln"):join(root,'Analysis.cln');
 await writeFile(solution,'[solution]\nname="Profiler analysis UI"\nversion="1.0"\nprojects=[]\n');
 const app=await launch('profiler-analysis');t.after(async()=>{await app.screenshot('final-state').catch(()=>{});await writeFile(join(app.dir,'final-dom.txt'),await app.wd.execute('return document.body.innerText')).catch(()=>{});await app.close();});
 const gates={automated:'PASS',desktopMetrics:'NOT TESTED',desktopPerf:'NOT TESTED',captureWindowRecovery:'NOT TESTED',targetSurvival:'NOT TESTED',responsive:'NOT TESTED',humanUsability:'NOT TESTED',releaseMillionRowPerformance:'NOT TESTED'};
 const result={machine:hostname(),kernel:release(),binary:{path:APP,sha256:createHash('sha256').update(await readFile(APP)).digest('hex')},gates};
 const mainLabel=await app.wd.execute('return window.__TAURI_INTERNALS__.metadata.currentWindow.label');const owner=await openSolution(app,solution);await showProfiler(app);await button(app,'Open metric imports');
 const main=join(ROOT,'workspaces/profiling-metrics/fixtures/program-shaped/run.csv'),companion=join(ROOT,'workspaces/profiling-metrics/fixtures/program-shaped/run-sections.csv');
 const original=await readFile(main);
 await value(app,'Metric import paths',main+'\n'+companion);await button(app,'Import paths');
 await condition(app,'chart visible','return !!document.querySelector("[aria-label=\\\"Metric range graph\\\"]")');
 const id=await app.wd.execute('return document.querySelector("[aria-label=\\\"Metric source set\\\"]").value'),action=request=>app.invoke('metric_action',{request:{id,...request}});
 assert.deepEqual((await action({op:'status'})).tables[0].columns.map(c=>c.unit),['s','ms','ms','ms','ms','us','kb_s']);
 await app.screenshot('01-metric-chart');
 await button(app,'Column meanings');await button(app,'Set join rule');
 await file(app,'run-sections.csv');await condition(app,'companion selected','return !!document.querySelector("[aria-label=\\\"Unit recv\\\"]")');
 await value(app,'Metric bulk unit','ms');await choose(app,'Metric bulk meaning','window statistic');await button(app,'Apply bulk interpretation');
 await app.waitFor('bulk saved',async()=>({done:(await action({op:'status'})).tables[1].columns[1].unit==='ms'}));
 await file(app,'run.csv');await button(app,'Largest values');await choose(app,'Metric series',3);await button(app,'Find worst windows / largest values');
 await condition(app,'ranked elapsed value','return document.querySelector("[aria-label=\\\"Worst metric windows\\\"] tbody tr")?.innerText.includes("2.25")');
 await button(app,'Row 3');await condition(app,'joined inspection','return document.querySelector("[aria-label=\\\"Inspected metric row\\\"]")?.innerText.includes("run-sections.csv · joined")');
 const inspected=await app.wd.execute('return document.querySelector("[aria-label=\\\"Inspected metric row\\\"]").innerText');assert.ok(inspected.includes('60'));await app.screenshot('02-ranked-joined-row');
 await button(app,'Time series');
 // Native pointer click on the chart, not a synthetic private-state selection.
 const chart=await app.wd.execute('const r=document.querySelector("[aria-label=\\\"Metric range graph\\\"]").getBoundingClientRect();return {x:r.left+r.width*.52,y:r.top+r.height*.5}');
 await app.wd.command('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:100,origin:'viewport',x:Math.round(chart.x),y:Math.round(chart.y)},{type:'pointerDown',button:0},{type:'pointerUp',button:0}]}]});
 await condition(app,'direct chart row selection','return !!document.querySelector("[aria-label=\\\"Original metric rows\\\"] tr.is-selected")');
 const snapshot=join(root,'analysis.crmetrics');await action({op:'save',path:snapshot,ranges:[[0,4],[0,4]]});
 const snapHash=createHash('sha256').update(await readFile(snapshot)).digest('hex');
 await button(app,'Column meanings');await value(app,'Unit loop_ms_p99','us');await button(app,'Apply interpretation');await app.waitFor('edit saved',async()=>({done:(await action({op:'status'})).tables[0].columns[3].unit==='us'}));
 assert.equal(createHash('sha256').update(await readFile(snapshot)).digest('hex'),snapHash);
 await button(app,'File details');await value(app,'Metric import paths',snapshot);await button(app,'Open snapshot path');await condition(app,'snapshot reopened','return document.querySelector(".analysis-title span")?.innerText.includes("immutable snapshot")');
 await button(app,'Column meanings');assert.equal(await app.wd.execute('return document.querySelector("[aria-label=\\\"Unit loop_ms_p99\\\"]").disabled'),true);
 assert.deepEqual(await readFile(main),original);gates.desktopMetrics='PASS';
 const layouts=[];await button(app,'Time series');
 for(const width of [900,1280,1600]){await app.wd.command('POST','/window/rect',{width,height:1000});await new Promise(r=>setTimeout(r,200));const layout=await app.wd.execute('const p=document.querySelector(".metric-workbench"),g=p.querySelector("svg"),r=g.getBoundingClientRect();return {panel:p.clientWidth,scroll:p.scrollWidth,chart:{width:r.width,height:r.height,top:r.top,bottom:r.bottom},viewport:{width:innerWidth,height:innerHeight},sidebarCsv:!!document.querySelector("[aria-label=\\\"Profiler sidebar\\\"] .metric-import-panel")}');assert.ok(layout.scroll<=layout.panel+2);assert.ok(layout.chart.height>=200&&layout.chart.width>200);assert.ok(layout.chart.bottom<layout.viewport.height);assert.equal(layout.sidebarCsv,false);layouts.push({width,...layout});await app.screenshot('03-layout-'+width);}
 result.layouts=layouts;gates.responsive='PASS';
 const build=process.env.CRAIDD_PERF_UI_BUILD;
 if(build){
  const fixture=spawn(join(build,'fixture'),[join(build,'libscale-no-fp.so'),'2'],{stdio:['pipe','pipe','pipe']});let log='';fixture.stdout.on('data',v=>log+=v);fixture.stderr.on('data',v=>log+=v);
  t.after(async()=>{if(fixture.exitCode===null){fixture.stdin.end('stop\n');await new Promise(r=>fixture.once('exit',r));}});
  await app.waitFor('native target ready',async()=>({done:log.includes('READY')}));
  const target=await processIdentity(fixture.pid);result.fixture={build:resolve(build),target};
  await button(app,'CPU sampling');await button(app,'Choose target…');await value(app,'Search processes',fixture.pid);
  await app.waitFor('target in attach list',async()=>({done:await app.wd.execute('return document.querySelectorAll("[aria-label=\\\"Running processes\\\"] [role=option]").length===1')}));
  await app.wd.click(await app.wd.find('//*[@aria-label="Running processes"]//*[@role="option"]'));await button(app,'Profile only');
  await button(app,'CPU sampling');
  await value(app,'Perf duration',10);await choose(app,'Perf unwinding','dwarf');
  await button(app,'Review capture');await condition(app,'cost reviewed','return !!document.querySelector(".perf-plan")');await app.screenshot('04-perf-review');await button(app,'Start capture');
  await condition(app,'native recording','return document.querySelector(".analysis-capture-heading strong")?.innerText==="RECORDING"');await new Promise(r=>setTimeout(r,1500));await button(app,'Stop capture');
  await condition(app,'native decoded tree','return !!document.querySelector("[aria-label=\\\"Perf call tree\\\"] .perf-symbol")');
  const captures=await app.invoke('perf_action',{request:{action:'list'}}),capture=captures[0];result.capture=capture;
  assert.ok(capture.coverage.retainedSamples>0);assert.equal(fixture.exitCode,null);assert.equal((await processIdentity(fixture.pid)).birth,target.birth);gates.targetSurvival='PASS';
  await choose(app,'Perf module',join(build,'libscale-no-fp.so'));await condition(app,'known hot frame in tree','return [...document.querySelectorAll(".perf-symbol")].some(b=>b.innerText.includes("scale_fn_"))');
  const tid=Object.keys(capture.summary.threads).find(t=>capture.summary.threads[t]==='busy-worker');assert.ok(tid);await choose(app,'Perf thread',tid);await condition(app,'filtered tree ready','return !!document.querySelector(".perf-symbol")');
  await app.screenshot('05-perf-bottom-up');
  await app.wd.click(await app.wd.find('//button[contains(@class,"perf-symbol")][contains(.,"scale_fn_")]'));
  const sourceAvailable=await app.wd.execute('return [...document.querySelectorAll("button")].some(b=>b.textContent.startsWith("Open source ·"))');
  if(sourceAvailable){await app.wd.click(await app.wd.find('//button[starts-with(normalize-space(),"Open source ·")]'));await condition(app,'verified source opened','return !!document.querySelector(".monaco-editor")');await app.wd.click(await app.wd.find('//*[@role="tab"][@title="Profiling"]'));result.sourceNavigation='PASS';}else result.sourceNavigation='NOT TESTED';
  await choose(app,'Perf tree direction','topDown');await condition(app,'top down tree ready','return !!document.querySelector(".perf-symbol")');
  await app.wd.click(await app.wd.find('//button[starts-with(@aria-label,"Expand ")]'));await condition(app,'expanded branch','return document.querySelectorAll(".perf-symbol").length>1');await app.screenshot('06-perf-top-down');
  await button(app,'Pin capture');await button(app,'Coverage & details');const coverage=await app.wd.execute('return document.querySelector(".perf-coverage").innerText');assert.ok(coverage.includes('LOST records / reported count'));assert.ok(coverage.includes('100 ms polling'));result.coverageText=coverage;await app.screenshot('07-perf-coverage');
  await button(app,'Reopen raw data');await button(app,'Calls');await condition(app,'raw reopened tree','return !!document.querySelector(".perf-symbol")');gates.desktopPerf='PASS';
  await button(app,'Capture settings');await choose(app,'Perf unwinding','fp');await choose(app,'Perf frequency',999);await value(app,'Perf duration',30);await button(app,'Review capture');await condition(app,'FP capture review','return !!document.querySelector(".perf-plan")');await button(app,'Start capture');await condition(app,'FP recording before close','return document.querySelector(".analysis-capture-heading strong")?.innerText==="RECORDING"');
  await new Promise(r=>setTimeout(r,350));const closing=(await app.invoke('perf_action',{request:{action:'list'}}))[0];assert.equal(closing.options.unwind.kind,'fp');
  await app.wd.execute('const label=arguments[0];setTimeout(()=>window.__TAURI_INTERNALS__.invoke("close_linked_window",{targetLabel:label}),0);',[owner]);
  await app.waitFor('owning window closed',async()=>{await switchToLabel(app,mainLabel);return {done:!(await app.invoke('get_application_windows')).some(w=>w.label===owner)};});
  assert.equal(fixture.exitCode,null);assert.equal((await processIdentity(fixture.pid)).birth,target.birth);
  await openSolution(app,solution);await showProfiler(app);await button(app,'CPU sampling');
  await app.waitFor('closed capture finalized',async()=>{const list=await app.invoke('perf_action',{request:{action:'list'}});return {done:list.find(v=>v.id===closing.id)?.reasons.includes('Owning window or IDE closed')};});
  const closeManifest=(await app.invoke('perf_action',{request:{action:'list'}})).find(v=>v.id===closing.id);result.closedCapture=closeManifest;await button(app,'Reopen raw data');await button(app,'Calls');await condition(app,'closed capture raw reopened','return !!document.querySelector(".perf-symbol")');assert.equal(fixture.exitCode,null);result.closedCaptureReopened=await app.invoke('perf_action',{request:{action:'status',id:closing.id}});assert.ok(result.closedCaptureReopened.coverage.retainedSamples>0);gates.captureWindowRecovery='PASS';await app.screenshot('08-owner-close-recovery');

 }
 await writeFile(join(app.dir,'analysis-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({evidence:app.dir,gates}));
});
