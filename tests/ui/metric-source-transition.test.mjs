import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir,hostname,release} from 'node:os';
import {join,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {launch,openSolution,APP} from './lib/harness.mjs';
import {showProfiler} from './lib/profiler.mjs';
const enabled=process.env.CRAIDD_TEST_METRIC_TRANSITIONS==='1';
async function button(app,label){await app.wd.click(await app.wd.find(`//button[normalize-space()=${JSON.stringify(label)}]`));}
async function value(app,text){await app.wd.execute('const e=document.querySelector(`[aria-label="Metric import paths"]`);Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value").set.call(e,arguments[0]);e.dispatchEvent(new Event("input",{bubbles:true}));',[text]);}
async function healthy(app,label,file=null){await app.waitFor(label,async()=>{const state=await app.wd.execute('return {crash:document.body.innerText.includes("This IDE window could not render"),plot:!!document.querySelector(".metric-plot svg"),title:document.querySelector(".analysis-title")?.textContent,text:document.body.innerText}');assert.equal(state.crash,false,state.text);return {done:state.plot&&(!file||state.title?.includes(file))};},30000);}
async function importPath(app,path){if(await app.wd.execute('return !!document.querySelector(".metric-plot svg")'))await button(app,'File details');await app.wd.execute('document.querySelector(".metric-paths").open=true');await value(app,path);await button(app,'Import paths');await healthy(app,'replacement source loads',basename(path));}
test('CSV replacement, schema switches and removal never render another source’s cached columns',{skip:!enabled,timeout:120000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'craidd-metric-transitions-'));
 const first=join(dir,'sections.csv'),second=join(dir,'main.csv'),solution=join(dir,'Transitions.cln');
 await writeFile(first,'elapsed_s,recv,update,send,other\n0,1,2,3,4\n1,2,3,4,5\n');
 await writeFile(second,'elapsed_s,loop_ms_p99\n0,10\n1,70\n');
 await writeFile(solution,'[solution]\nname="Metric source transitions"\nversion="1.0"\nprojects=[]\n');
 const app=await launch('metric-source-transitions');
 const evidence={machine:hostname(),kernel:release(),binary:{path:APP,sha256:createHash('sha256').update(await readFile(APP)).digest('hex')},gate:'FAIL'};
 t.after(async()=>{await app.screenshot('final-state').catch(()=>{});evidence.dom=await app.wd.execute('return document.body.innerText').catch(String);await writeFile(join(app.dir,'transition-results.json'),JSON.stringify(evidence,null,2));await app.close();});
 const owner=await openSolution(app,solution);await app.invoke('focus_linked_window',{targetLabel:owner});await showProfiler(app);await button(app,'Open metric imports');await button(app,'Focus analysis');await app.wd.command('POST','/window/rect',{width:1600,height:1050});
 await importPath(app,first);await app.wd.execute('const e=document.querySelector(`[aria-label="Metric row number"]`);Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"1");e.dispatchEvent(new Event("input",{bubbles:true}));');await button(app,'Inspect row');
 await app.waitFor('original row inspected',async()=>({done:await app.wd.execute('return document.querySelector(`[aria-label="Inspected metric row"] h3`)?.textContent==="Row 1"')}));
 await importPath(app,second);
 assert.equal(await app.wd.execute('return document.querySelector(`[aria-label="Inspected metric row"] h3`)?.textContent'),'Original row','the preceding source’s inspection must not leak');
 await app.wd.execute('const e=document.querySelector(`[aria-label="Metric source set"]`);e.selectedIndex=0;e.dispatchEvent(new Event("change",{bubbles:true}));');await button(app,'Time series');await healthy(app,'switch to original schema');
 await button(app,'File details');await button(app,'Remove source set');await healthy(app,'remaining source after removal');
 assert.ok(await app.wd.execute('return document.querySelector(".analysis-title").innerText.includes("main.csv")'));
 evidence.gate='PASS';console.log(JSON.stringify({evidence:app.dir,...evidence}));
});
