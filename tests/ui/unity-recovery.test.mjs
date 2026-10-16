import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { launch, openSolution, evidenceDirectory, discoveryDirectory, processIdentity } from "./lib/harness.mjs";
import { disposableUnity } from "./lib/unity-copy.mjs";
import { showProfiler } from "./lib/profiler.mjs";

const exists = path=>access(path).then(()=>true,()=>false);
const sum = p=>p.captures.filter(c=>c.solo).reduce((n,c)=>n+c.liveBytes,0);
const click = async(app,xpath)=>app.wd.click(await app.wd.find(xpath));
const wait = (app,name,accept)=>app.waitFor(name,async()=>{const p=await app.invoke('get_profile');return {done:p&&accept(p),value:p};},45000);
async function attach(app,unity,pid){
  await openSolution(app,join(unity.project,'unity.cln'));await showProfiler(app);
  await click(app,"//button[normalize-space()='Attach…']");
  await app.waitFor('our Editor selected',async()=>({done:await app.wd.execute("return document.querySelector('[role=option][aria-selected=true]')?.innerText.includes(arguments[0])",[String(pid)])}));
  await click(app,"//button[normalize-space()='Profile only']");
  return wait(app,'our source connected',p=>p.target.pid===pid&&p.provider);
}
test('disposable Unity recovers Solo/cohorts after disconnect and cleans abrupt-host artifacts', {skip:process.env.CRAIDD_TEST_UNITY!=='1',timeout:480000},async t=>{
  const dir=await evidenceDirectory('unity-recovery');const namespace=`recovery-${randomUUID()}`;
  const unity=await disposableUnity(dir,namespace);t.after(()=>unity.close());
  await unity.waitFor('Editor ready',()=>readFile(join(unity.signals,'ready'),'utf8'),240000);
  const pid=(await unity.status()).pid;assert.equal(pid,unity.child.pid);
  const app=await launch('unity-recovery',{environment:{CRAIDD_PROFILE_NAMESPACE:namespace}});t.after(()=>app.close());
  await attach(app,unity,pid);await unity.command('play',60);
  await wait(app,'first Solo',p=>p.captures.some(c=>c.solo&&c.endMs===null));
  await unity.command('allocate');const before=await wait(app,'retained before interruption',p=>sum(p)===1048576);
  const oldIds=before.captures.filter(c=>c.solo).map(c=>c.id);
  await unity.command('disconnect');
  const resumed=await wait(app,'same profile reopens a new Solo',p=>p.id===before.id&&p.counters.disconnects>=1&&p.provider&&p.captures.some(c=>c.solo&&c.endMs===null&&!oldIds.includes(c.id)));
  assert.ok(resumed.captures.some(c=>oldIds.includes(c.id)&&c.endMs!==null&&c.liveBytes===1048576));
  await unity.command('clear');const released=await wait(app,'late free reaches pinned interrupted cohort',p=>sum(p)===0&&p.captures.some(c=>oldIds.includes(c.id)&&c.freedBytes>=1048576));
  await unity.command('allocate');await wait(app,'new Solo measures another allocation',p=>sum(p)===1048576);
  await unity.command('clear');await wait(app,'clear before host crash',p=>sum(p)===0);
  app.record('provider-recovery',{before,resumed,released});await app.screenshot('recovered-solo');
  const target=await processIdentity(pid);const scope=discoveryDirectory(namespace);
  const route=join(scope,`${pid}-${target.birth}.endpoint`);const body=(await readFile(route,'utf8')).trim().split('\n');
  const host=await app.hostIdentity();
  assert.equal(Number(body[2]),host.pid);assert.equal(Number(body[3]),host.birth);
  const current=await processIdentity(host.pid);assert.equal(current.birth,host.birth);
  // hostIdentity proves both unique namespace and ancestry under this exact
  // driver before allowing a destructive signal. No user-owned app is chosen.
  process.kill(host.pid,'SIGKILL');app.crashed=true;
  await unity.waitFor('dead host endpoint and socket removed by provider',async()=>!(await exists(route))&&!(await exists(body[1])),15000);
  assert.equal((await unity.status()).playing,true,'disposable Editor survives its profiling host crash');
  app.record('host-crash-cleanup',{host,target,scope,route,socket:body[1],routeExists:await exists(route),socketExists:await exists(body[1])});

  const replacement=await launch('unity-recovery-replacement',{environment:{CRAIDD_PROFILE_NAMESPACE:namespace}});t.after(()=>replacement.close());
  await attach(replacement,unity,pid);
  await wait(replacement,'running Play reconnects without Editor restart',p=>!p.waitingForPlay&&p.captures.some(c=>c.solo&&c.endMs===null));
  await unity.command('allocate');const recovered=await wait(replacement,'replacement host measures 1 MiB',p=>sum(p)===1048576);
  await unity.command('clear');await wait(replacement,'replacement host measures clear',p=>sum(p)===0);
  assert.equal((await unity.status()).pid,pid);
  replacement.record('replacement-host',{originalHost:host,editorPid:pid,profile:recovered});
  await replacement.screenshot('replacement-host-solo');
  await click(replacement,"//button[@aria-label='Stop profiling']");
  await wait(replacement,'replacement stops profiling',p=>!p.active);
  assert.equal(await exists(route),false);
});
