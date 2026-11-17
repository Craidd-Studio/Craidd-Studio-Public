import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir,hostname,release} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {launch,openSolution,ROOT,APP} from './lib/harness.mjs';
import {showProfiler} from './lib/profiler.mjs';
const enabled=process.env.CRAIDD_TEST_METRIC_ROW_UX==='1';
async function button(app,label){await app.wd.click(await app.wd.find(`//button[normalize-space()=${JSON.stringify(label)}]`));}
async function value(app,label,text){await app.wd.execute('const e=document.querySelector(`[aria-label="${arguments[0]}"]`);Object.getOwnPropertyDescriptor(e.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,"value").set.call(e,String(arguments[1]));e.dispatchEvent(new Event("input",{bubbles:true}));',[label,text]);}
test('Human metric findings: complete row identities, clear scope, honest jump field, selection-free dividers',{skip:!enabled,timeout:90000},async t=>{
 const dir=await mkdtemp(join(tmpdir(),'craidd-metric-row-ux-'));execFileSync('python3',[join(ROOT,'workspaces/profiling-metrics/editor-fixture.py'),dir]);const solution=join(dir,'Rows.cln');await writeFile(solution,'[solution]\nname="Row usability findings"\nversion="1.0"\nprojects=[]\n');
 const app=await launch('metric-row-usability');let evidence={machine:hostname(),kernel:release(),binary:{path:APP,sha256:createHash('sha256').update(await readFile(APP)).digest('hex')},gate:'FAIL'};
 t.after(async()=>{await app.screenshot('final-state').catch(()=>{});await writeFile(join(app.dir,'row-usability.json'),JSON.stringify(evidence,null,2)+'\n');await app.close();});
 const owner=await openSolution(app,solution);await app.invoke('focus_linked_window',{targetLabel:owner});await showProfiler(app);await button(app,'Open metric imports');await app.wd.command('POST','/window/rect',{width:1600,height:1000});
 await app.wd.execute('document.querySelector(".metric-paths").open=true');await value(app,'Metric import paths',join(dir,'server-metrics.csv'));await button(app,'Import paths');await app.waitFor('loaded graph',async()=>({done:await app.wd.execute('return !!document.querySelector(".metric-plot svg")')}));
 evidence.normalWindow=await app.wd.execute(`const main=document.querySelector('.metric-analysis').getBoundingClientRect(),dock=document.querySelector('.metric-row-dock'),viewport=dock.querySelector('.metric-table-scroll').getBoundingClientRect();return {focusAnalysis:[...document.querySelectorAll('.analysis-toolbar button')].find(b=>b.textContent==='Focus analysis')?.getAttribute('aria-pressed')==='true',dockDisplay:getComputedStyle(dock).display,visibleDataPixels:Math.max(0,Math.min(viewport.bottom,main.bottom)-Math.max(viewport.top+38,main.top)),viewportHeight:innerHeight};`);
 await app.screenshot('normal-window');
 assert.equal(evidence.normalWindow.focusAnalysis,false);
 assert.notEqual(evidence.normalWindow.dockDisplay,'none','table must not disappear in an ordinary window');
 assert.ok(evidence.normalWindow.visibleDataPixels>=29,'ordinary editor must show table data without Focus analysis or resizing Output');
 // Test ordinary small windows before any drag can enlarge the editor.
 evidence.shortWindows=[];
 for(const [width,height] of [[1280,800],[900,700]]){
  await app.wd.command('POST','/window/rect',{width,height});
  await app.waitFor('short editor layout settled',async()=>({done:await app.wd.execute('return !!document.querySelector(".metric-analysis.is-compact")')}));
  const split=await app.wd.execute(`const main=document.querySelector('.metric-analysis'),dock=document.querySelector('.metric-row-dock');return {display:getComputedStyle(dock).display,overflow:getComputedStyle(main).overflowY,scrollHeight:main.scrollHeight,height:main.clientHeight};`);
  assert.notEqual(split.display,'none');assert.ok(['auto','scroll'].includes(split.overflow));
  await button(app,'Table');
  const table=await app.wd.execute(`const host=document.querySelector('.metric-table-scroll'),r=host.getBoundingClientRect();return {height:r.height,bottom:r.bottom,viewportHeight:innerHeight,full:document.querySelector('.metric-row-dock').classList.contains('is-full')};`);
  assert.ok(table.full&&table.height>=96&&table.bottom<=table.viewportHeight);evidence.shortWindows.push({width,height,split,table});
  await app.screenshot('table-'+width);await button(app,'Time series');
 }
 await app.wd.command('POST','/window/rect',{width:1600,height:1000});
 // Match the human's viewed slice through public zoom/pan controls.
 for(let n=0;n<3;n++)await app.wd.click(await app.wd.find('//button[@aria-label="Zoom in"]'));
 for(let n=0;n<4;n++)await app.wd.click(await app.wd.find('//button[@aria-label="Pan right"]'));
 const box=await app.wd.execute('const e=[...document.querySelectorAll(`[class~="cursor-row-resize"]`)].find(e=>e.getBoundingClientRect().width>500),r=e.getBoundingClientRect();getSelection().removeAllRanges();window.__rowUxDown=[];document.addEventListener("pointerdown",e=>{if(e.target.closest(`[class~="cursor-row-resize"]`))window.__rowUxDown.push(e.defaultPrevented)});return {x:r.left+r.width*.6,y:r.top+r.height/2};');
 await app.wd.command('POST','/actions',{actions:[{type:'pointer',id:'mouse',parameters:{pointerType:'mouse'},actions:[{type:'pointerMove',duration:60,origin:'viewport',x:Math.round(box.x),y:Math.round(box.y)},{type:'pointerDown',button:0},{type:'pointerMove',duration:400,origin:'viewport',x:Math.round(box.x),y:Math.round(box.y+75)},{type:'pointerUp',button:0}]}]});
 evidence.nativeTextSelection=await app.wd.execute('return {pointerDefaultPrevented:window.__rowUxDown?.at(-1),collapsed:getSelection().isCollapsed,text:getSelection().toString().slice(0,300)}');
 await app.waitFor('row dock visible',async()=>({done:await app.wd.execute('return document.querySelector(".metric-row-dock")?.getBoundingClientRect().height>100&&document.querySelectorAll(".metric-virtual-table tbody tr").length>0')}));
 evidence.rows=await app.wd.execute(`const host=document.querySelector('.metric-table-scroll'),r=host.getBoundingClientRect(),cells=[...host.querySelectorAll('tbody tr')].filter(e=>{const b=e.getBoundingClientRect();return b.bottom>r.top+38&&b.top<r.bottom-1});const e=cells[0].querySelector('td'),b=e.querySelector('button'),br=b.getBoundingClientRect(),er=e.getBoundingClientRect();return {first:cells[0].textContent.split('\\n')[0],last:Number(cells.at(-1).getAttribute('aria-rowindex')),lastLabel:cells.at(-1).querySelector('button').textContent,fullRowLabel:b.scrollWidth<=e.clientWidth-parseFloat(getComputedStyle(e).paddingLeft)-parseFloat(getComputedStyle(e).paddingRight)&&br.right<=er.right-2,cellWidth:er.width,buttonWidth:br.width,footer:document.querySelector('.metric-virtual-rows footer').textContent,jump:document.querySelector('[aria-label="Metric row number"]').value};`);
 const footer=evidence.rows.footer.replace(/[,\u00a0\u202f]/g,'');const checks={resizeDoesNotSelectText:evidence.nativeTextSelection.collapsed,resizeCancelsNativeSelection:evidence.nativeTextSelection.pointerDefaultPrevented===true,rowIdentityFits:evidence.rows.fullRowLabel,jumpStartsEmpty:evidence.rows.jump==='',rangeExplicit:footer.includes('13751–16250')&&footer.includes('(2500)'),visibleLastRowIncluded:footer.includes(evidence.rows.lastLabel.replace('Row ',''))};evidence.checks=checks;app.record('human-row-findings',evidence);
 await app.screenshot('range-labels');
 assert.ok(Object.values(checks).every(Boolean),JSON.stringify(evidence,null,2));
 await value(app,'Metric row number',15001);await button(app,'Inspect row');await app.waitFor('original row inspected',async()=>({done:await app.wd.execute('return document.querySelector(`[aria-label="Inspected metric row"] h3`)?.textContent==="Row 15001"')}));
 evidence.gate='PASS';console.log(JSON.stringify({evidence:app.dir,...evidence}));
});
