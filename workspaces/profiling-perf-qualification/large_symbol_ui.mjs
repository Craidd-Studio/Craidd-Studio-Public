// Existing Tauri IPC and webview heartbeat only; no new profiler UI is built.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {launch,openSolution,processIdentity,APP} from '../../tests/ui/lib/harness.mjs';
const [buildArg,outputArg]=process.argv.slice(2);
assert.ok(buildArg&&outputArg,'Usage: node large_symbol_ui.mjs BUILD FRESH_OUTPUT');
const build=resolve(buildArg),output=resolve(outputArg);
await mkdir(output,{recursive:false});
const fixture=spawn(join(build,'fixture'),[join(build,'libscale-no-fp.so'),'2'],{stdio:['pipe','pipe','pipe']});
let targetLog='',stderr='';fixture.stdout.on('data',v=>targetLog+=v);fixture.stderr.on('data',v=>stderr+=v);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const distribution=values=>{if(!values.length)return {n:0};const sorted=[...values].sort((a,b)=>a-b);return {n:values.length,p50:sorted[Math.ceil(sorted.length*.5)-1],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)};};
let app;const result={scope:'Existing perf IPC and webview heartbeat on Xvfb; no profiling controls, chart/tree UI or human usability acceptance',build,output,cases:[]};
try{
  const deadline=Date.now()+10000;
  while(!targetLog.includes('READY')){assert.ok(Date.now()<deadline&&fixture.exitCode===null,'fixture startup');await sleep(25)}
  app=await launch('perf-large-symbol-thread-independence');
  result.applicationBinary={path:APP,sha256:createHash('sha256').update(await readFile(APP)).digest('hex')};
  result.owner=await openSolution(app,join(build,'Scale.cln'));
  const target=await processIdentity(fixture.pid);
  await app.invoke('start_profiling',{target:{pid:target.pid,birth:target.birth}});
  result.backendHost=await app.hostIdentity();
  await app.wd.execute(`window.__scalePulse={ticks:[],frames:[],last:performance.now(),frameLast:performance.now(),state:'baseline'};
    window.__scaleTimer=setInterval(()=>{const p=window.__scalePulse,now=performance.now();p.ticks.push({time:now,gapMs:now-p.last,state:p.state});p.last=now},16);
    window.__scaleRafActive=true;const loop=()=>{if(!window.__scaleRafActive)return;const p=window.__scalePulse,now=performance.now();p.frames.push({time:now,gapMs:now-p.frameLast,state:p.state});p.frameLast=now;requestAnimationFrame(loop)};requestAnimationFrame(loop);`);
  await sleep(500);
  const options={frequency:99,durationSeconds:3,unwind:{kind:'dwarf',stackBytes:8192}};
  const started=await app.invoke('perf_action',{request:{action:'start',options}});result.id=started.id;
  const observations=[];let seenParsing=false,final;
  const limit=Date.now()+90000;
  while(Date.now()<limit){
    const value=await app.wd.executeAsync(`const done=arguments[arguments.length-1],id=arguments[0],begin=performance.now();window.__TAURI_INTERNALS__.invoke('perf_action',{request:{action:'status',id}}).then(value=>{const end=performance.now();window.__scalePulse.state=value.state;done({begin,end,requestMs:end-begin,state:value.state,manifest:value})},error=>done({error:String(error)}));`,[started.id]);
    assert.equal(value.error,undefined);observations.push({begin:value.begin,end:value.end,requestMs:value.requestMs,state:value.state});
    seenParsing||=value.state==='parsing';
    if(['complete','partial','failed'].includes(value.state)){final=value.manifest;break}
    await sleep(10);
  }
  assert.ok(final,'capture finalized');
  await app.wd.execute('window.__scalePulse.state="complete"');await sleep(250);
  const pulses=await app.wd.execute('clearInterval(window.__scaleTimer);window.__scaleRafActive=false;return {timeOrigin:performance.timeOrigin,ticks:window.__scalePulse.ticks,frames:window.__scalePulse.frames,viewport:{width:innerWidth,height:innerHeight,dpr:devicePixelRatio},visibility:document.visibilityState,userAgent:navigator.userAgent}');
  const parsing=observations.filter(v=>v.state==='parsing');
  const ticks=pulses.ticks.filter(v=>v.state==='parsing'),frames=pulses.frames.filter(v=>v.state==='parsing');
  const query={direction:'bottomUp',path:[],limit:200,tid:null,threadName:null,module:join(build,'libscale-no-fp.so'),startNs:null,endNs:null};
  const bottom=await app.invoke('perf_action',{request:{action:'tree',id:started.id,query}});query.direction='topDown';const top=await app.invoke('perf_action',{request:{action:'tree',id:started.id,query}});
  result.cases.push({capture:final,observations,pulses,seenParsing,parsingStatusLatencyMs:distribution(parsing.map(v=>v.requestMs)),parsingTimerGapMs:distribution(ticks.map(v=>v.gapMs)),parsingAnimationGapMs:distribution(frames.map(v=>v.gapMs)),bottomUp:bottom,topDown:top});
  result.targetSurvived=fixture.exitCode===null;
  result.gates={existingIpcCapture:final.state==='complete'?'PASS':'PARTIAL',uiThreadIndependence:seenParsing&&ticks.length>=3&&frames.length>=3&&parsing.every(v=>v.requestMs<100)&&ticks.every(v=>v.gapMs<100)&&frames.every(v=>v.gapMs<100)?'PASS':'PARTIAL',humanUsability:'NOT TESTED',newProfilerUi:'NOT TESTED'};
  await app.invoke('stop_profiling');
  await app.screenshot('large-symbol-qualification');result.uiEvidenceDirectory=app.dir;
}finally{
  if(fixture.exitCode===null){fixture.stdin.end('stop\n');await new Promise((r,j)=>{const timer=setTimeout(()=>j(Error('fixture normal stop timeout')),15000);fixture.once('exit',()=>{clearTimeout(timer);r()})})}
  result.normalTargetExit=fixture.exitCode;await writeFile(join(output,'target.log'),targetLog);await writeFile(join(output,'target.stderr'),stderr);
  if(app)await app.close();
  await writeFile(join(output,'results.json'),JSON.stringify(result,null,2)+'\n');
}
console.log(JSON.stringify({output,gates:result.gates,parsing:result.cases[0]&&{status:result.cases[0].parsingStatusLatencyMs,timer:result.cases[0].parsingTimerGapMs,animation:result.cases[0].parsingAnimationGapMs}}));
