// Human drives the round. Automation prepares, observes and records its own window only.
import {launch,openSolution,switchToLabel,APP,ROOT} from '../lib/harness.mjs';
import {showProfiler} from '../lib/profiler.mjs';
import {mkdir,writeFile,readFile,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(process.argv[2]);await mkdir(root,{recursive:true});
const fixture=join(root,'csv');await mkdir(fixture);execFileSync('python3',[join(ROOT,'workspaces/profiling-metrics/editor-fixture.py'),fixture]);
const csv=join(fixture,'server-metrics.csv'),solution=join(root,'Acceptance.cln');
await writeFile(solution,'[solution]\nname="CSV acceptance — Round 1"\nversion="1.0"\nprojects=[]\n');
const baseline=createHash('sha256').update(await readFile(csv)).digest('hex');
const app=await launch('human-metric-round-1');let recorder,ended=false;
const state={round:1,title:'Open a CSV and understand the first view',phase:'preparing',binary:APP,binarySha256:createHash('sha256').update(await readFile(APP)).digest('hex'),fixture:csv,solution,sessionDirectory:root,video:join(root,'round-01.mkv'),humanResult:'NOT TESTED',observations:[],scope:'Only the owned Craidd editor window. No audio, whole desktop capture or typed-key logging. Native chooser may be a separate surface.'};
const save=()=>writeFile(join(root,'session.json'),JSON.stringify(state,null,2)+'\n');await save();
async function finish(reason){if(ended)return;ended=true;state.phase='ending';state.endedAt=new Date().toISOString();state.stopReason=reason;
 if(recorder&&recorder.exitCode===null){recorder.stdin.write('q\n');await Promise.race([new Promise(r=>recorder.once('exit',r)),new Promise(r=>setTimeout(r,5000))]);if(recorder.exitCode===null)recorder.kill('SIGINT');}
 state.producerUnchanged=createHash('sha256').update(await readFile(csv)).digest('hex')===baseline;state.phase='awaiting human feedback';await save();
 await app.close().catch(error=>{state.cleanupError=String(error)});await save();
}
process.on('SIGTERM',()=>void finish('controller stopped'));process.on('SIGINT',()=>void finish('controller stopped'));
try{
 const main=await app.wd.execute('return window.__TAURI_INTERNALS__.metadata.currentWindow.label');const owner=await openSolution(app,solution);await app.invoke('focus_linked_window',{targetLabel:owner});await showProfiler(app);await app.wd.click(await app.wd.find('//button[normalize-space()="Open metric imports"]'));await app.wd.command('POST','/window/rect',{width:1600,height:1000});
 const host=await app.hostIdentity();state.host=host;state.owner=owner;const handles=await app.wd.windowHandles();state.ownerHandle=await switchToLabel(app,owner);
 state.nativeTitle=await app.invoke('plugin:window|title',{label:owner});await save();
 const window=JSON.parse(execFileSync('python3',[join(ROOT,'tests/ui/human/owned-x11-window.py'),String(host.pid),state.nativeTitle],{encoding:'utf8'}));state.recordedWindow=window;await app.screenshot('human-round-start');await copyFile(join(app.dir,'human-round-start.png'),join(root,'start.png'));
 let ffmpegLog='';recorder=spawn('ffmpeg',['-hide_banner','-loglevel','warning','-f','x11grab','-framerate','10','-window_id',String(window.windowId),'-i',process.env.DISPLAY,'-an','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','ultrafast','-tune','zerolatency','-g','10','-flush_packets','1','-crf','24','-pix_fmt','yuv420p','-t','600',state.video],{stdio:['pipe','ignore','pipe']});recorder.stderr.on('data',b=>{ffmpegLog=(ffmpegLog+b).slice(-12000)});let recordingExit=null;recorder.on('exit',(code,signal)=>{recordingExit={code,signal};});await new Promise(r=>setTimeout(r,1500));if(recordingExit)throw Error('Window recording failed: '+ffmpegLog);
 state.phase='recording';state.startedAt=new Date().toISOString();state.recorderPid=recorder.pid;await save();console.log(JSON.stringify({ready:true,...state}));
 let previous='';const deadline=Date.now()+600000;
 while(!ended&&Date.now()<deadline){
  const control=await readFile(join(root,'control.json'),'utf8').then(JSON.parse).catch(()=>null);if(control?.op==='stop'){state.userReport=control.report??null;await finish(control.reason??'user stopped');break;}
  const current=await app.wd.windowHandles().catch(()=>[]);if(!current.includes(state.ownerHandle)){await finish('test window closed');break;}
  if(recordingExit){state.recordingExit=recordingExit;state.recordingDiagnostic=ffmpegLog;await finish('recording ended');break;}
  const observation=await app.wd.execute('return {graph:!!document.querySelector(`[aria-label="Metric range graph"]`),source:document.querySelector(".analysis-title strong")?.textContent,alert:document.querySelector(".metric-import-panel [role=alert]")?.textContent?.slice(0,200),renderError:document.body.innerText.includes("This IDE window could not render")?document.querySelector("pre")?.textContent??"Render failed":null}').catch(()=>null);
  if(observation&&JSON.stringify(observation)!==previous){previous=JSON.stringify(observation);state.observations.push({at:new Date().toISOString(),...observation});await save();}
  if(observation?.renderError){state.humanResult='FAIL';state.finding='product render crash';state.renderError=observation.renderError;await finish('render crash observed');break;}
  await new Promise(r=>setTimeout(r,1000));
 }
 if(!ended)await finish('ten-minute recording limit');
 await writeFile(join(root,'recording-log.txt'),ffmpegLog);console.log(JSON.stringify({ended:true,...state}));
}catch(error){state.error=String(error);await finish('setup or recording failure');console.error(error);process.exitCode=1;}
