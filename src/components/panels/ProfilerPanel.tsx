import { useState } from "react";
import { useProfiling, type GoldCapture } from "../../store/profilingStore";
import { useGold } from "../../store/goldStore";
import { useSolution } from "../../store/solutionStore";

const bytes=(n:number)=>n>=1048576?`${(n/1048576).toFixed(2)} MiB`:n>=1024?`${(n/1024).toFixed(1)} KiB`:`${n} B`;
const ms=(n:number|null)=>n===null?"Unavailable":`${n.toFixed(3)} ms`;
function Graph({label,values,color,unit}:{label:string;values:number[];color:string;unit:(v:number)=>string}) {
 const max=Math.max(...values,1);const points=values.map((v,i)=>`${i*300/Math.max(values.length-1,1)},${58-(v/max)*52}`).join(" ");
 return <figure className="my-2"><figcaption className="flex justify-between text-zinc-400"><span>{label}</span><span className="font-mono">{values.length?unit(values[values.length-1]):"Waiting for samples"}</span></figcaption>
 <svg role="img" aria-label={`${label}; ${values.length} samples; maximum ${unit(max)}`} viewBox="0 0 300 64" className="w-full h-16 mt-1 rounded bg-zinc-950 border border-zinc-800" preserveAspectRatio="none"><path d="M0 58H300M0 30H300" stroke="#27272a" fill="none"/><polyline points={points} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke"/></svg></figure>;
}
function Capture({capture:c}:{capture:GoldCapture}){return <details className="border-t border-zinc-800 px-2 py-1.5"><summary className="cursor-pointer text-zinc-300">Batch {c.batch} · thread {c.thread||"all"} · {c.status} <span className="text-zinc-500">{c.endMs===null?"Open":ms(c.endMs-c.startMs)}</span></summary>
 <dl className="grid grid-cols-2 gap-1 my-2 text-zinc-400"><dt>Wall duration</dt><dd>{c.endMs===null?"Recording":ms(c.endMs-c.startMs)}</dd><dt>Thread CPU time</dt><dd>{ms(c.cpuMs)}</dd><dt>Explicit native allocations</dt><dd>{c.allocationCount} · {bytes(c.allocatedBytes)}</dd><dt>Cohort freed as of view</dt><dd>{bytes(c.freedBytes)}</dd><dt>Cohort live as of view</dt><dd>{bytes(c.liveBytes)}</dd></dl>
 <p className="text-zinc-500">Instrumented allocations only. Live bytes may clear after this range ends. Other allocators and managed GC are outside this cohort.</p></details>;}
export default function ProfilerPanel(){
 const state=useProfiling();const gold=useGold(s=>s.points);const file=useSolution(s=>s.activeFileId);const dirty=useSolution(s=>s.tabs.find(t=>t.fileId===s.activeFileId)?.dirty??false);
 const [thread,setThread]=useState("all");const [batch,setBatch]=useState("all");const [prepared,setPrepared]=useState("");const [error,setError]=useState("");
 const p=state.selected?state.snapshots.find(s=>s.id===state.selected)?.profile:state.profile;
 const captures=(p?.captures??[]).filter(c=>(thread==="all"||String(c.thread)===thread)&&(batch==="all"||String(c.batch)===batch));
 const groups=new Map<string,GoldCapture[]>();for(const c of captures)groups.set(c.marker,[...(groups.get(c.marker)??[]),c]);const threads=[...new Set(p?.captures.map(c=>c.thread)??[])];
 const samples=p?.samples??[];const cpu=samples.slice(1).map((s,i)=>Math.max(0,s.cpuMs-samples[i].cpuMs));
 return <div className="h-full overflow-y-auto text-xs text-zinc-300">
 <section className="p-3 border-b border-zinc-800 space-y-2">
 <div className="flex justify-between items-center"><strong className="text-amber-300">Gold Profiling</strong><span className="text-zinc-500">{state.selected?"Snapshot":p?.active?"Live":"Idle"}</span></div>
 <p className="text-zinc-400">{p?`${p.name} · PID ${p.target.pid} · ${p.target.birth}`:"Select a process, or start Debug to arm profiling automatically."}</p>
 <div className="flex flex-wrap gap-2">
 <button className="rounded border border-zinc-700 px-2 py-1 hover:bg-zinc-800" onClick={()=>window.dispatchEvent(new Event("craidd:attach-process"))}>Select process…</button>
 <button disabled={!state.profile} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40" onClick={state.snapshot}>Snapshot</button>
 <button disabled={!state.profile?.active} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40" onClick={()=>void state.again()}>Record again</button>
 <button disabled={!state.profile?.active} className="rounded border border-zinc-700 px-2 py-1 disabled:opacity-40" onClick={()=>void state.stop().catch(e=>setError(String(e)))}>Stop profiling</button></div>
 <select aria-label="Profiler view" value={state.selected??"live"} onChange={e=>state.select(e.target.value==="live"?null:e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded p-1"><option value="live">Current session</option>{state.snapshots.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
 {p?.reason&&<p>{p.reason}</p>}{(error||state.error)&&<p role="alert" className="text-amber-300 break-words">{error||state.error}</p>}
 </section>
 <section className="p-3 border-b border-zinc-800">
 <h3 className="text-zinc-400 uppercase tracking-wide">Process context</h3>
 <Graph label="CPU time per sample interval" values={cpu} color="#d9b85b" unit={v=>`${v.toFixed(1)} ms`}/>
 <Graph label="Resident memory · RSS" values={samples.map(s=>s.residentBytes)} color="#75b9a3" unit={bytes}/>
 <p className="text-zinc-500">250 ms polling, last 10 minutes. Process-wide gauges include work outside Gold ranges. RSS is not heap retention. CPU time is not hardware cycles.</p>
 {!!p?.pauses.length&&<details className="my-2"><summary className="cursor-pointer text-amber-200">Observed debugger stops · {p.pauses.length}</summary>{p.pauses.map((s,i)=><p key={i} className="my-1 text-zinc-400">{ms(s.startMs)} → {s.endMs===null?"Resume not observed":ms(s.endMs)} · {s.allThreads?"all threads":`DAP thread ${s.thread??"unknown"}`} · {s.reason}</p>)}<p className="text-zinc-500">Wall durations include pauses. DAP thread IDs are not Linux TIDs. No active-time deduction is inferred.</p></details>}
 <p className="mt-2 text-zinc-400">Threads: {samples[samples.length-1]?.threadCount??"—"} · Virtual memory: {samples.length?bytes(samples[samples.length-1].virtualBytes):"—"}</p>
 </section>
 <section className="p-3 space-y-2 border-b border-zinc-800">
 <h3 className="text-amber-300">Gold captures</h3>
 <p className="text-zinc-500">{p?.provider?"Prepared native source events · no debugger pause":"Source provider unbound. Process gauges are available; exact ranges require a prepared instrumented build."}</p>
 <div className="flex gap-2"><select aria-label="Capture thread" value={thread} onChange={e=>setThread(e.target.value)} className="min-w-0 flex-1 bg-zinc-950 rounded border border-zinc-700 p-1"><option value="all">All threads</option>{threads.map(t=><option key={t} value={t}>Thread {t||"all (solo)"}</option>)}</select>
 <select aria-label="Capture batch" value={batch} onChange={e=>setBatch(e.target.value)} className="min-w-0 flex-1 bg-zinc-950 rounded border border-zinc-700 p-1"><option value="all">All batches</option>{Array.from({length:p?.batch??0},(_,i)=><option key={i} value={i+1}>Batch {i+1}</option>)}</select></div>
 <p className="text-zinc-500">Thread filtering inspects captures; it never suspends other threads.</p>
 {Array.from(groups,([id,hits])=><details key={`${p?.id}:${id}`} open className="rounded border border-zinc-700 bg-zinc-950/40"><summary className="p-2 cursor-pointer text-amber-200">◆ {hits[0].name||id} <span className="text-zinc-500">· {hits.length} captures</span></summary>
 <div className="px-2"><Graph label="Completed range CPU time" values={hits.flatMap(c=>c.cpuMs===null?[]:[c.cpuMs])} color="#d9b85b" unit={v=>ms(v)}/><Graph label="Native cohort live · per capture" values={hits.map(c=>c.liveBytes)} color="#75b9a3" unit={bytes}/></div>{hits.map(c=><Capture key={c.id} capture={c}/>)}</details>)}
 {!captures.length&&<p className="text-zinc-500">No Gold hits in this view.</p>}{!!p?.dropped&&<p className="text-amber-300">{p.dropped} discarded events or evicted samples. Coverage is incomplete.</p>}
 <details className="rounded border border-zinc-800"><summary className="p-2 cursor-pointer text-zinc-500">GPU · Planned</summary><p className="p-2 text-zinc-500">No GPU collector is connected. There are no GPU measurements in this session.</p></details>
 </section>
 <section className="p-3 space-y-2">
 <details><summary className="cursor-pointer text-zinc-400">Source markers · {gold.length} definitions</summary><p className="my-2 text-zinc-500">Right-click a source gutter → Profiling. One solo per solution intent; one accepted solo per process session. Pairs require explicit End. Prepared source copies require a rebuild. Export supports explicit C++ anchor statements; arbitrary line tracing is unbound.</p>{gold.map(g=><p key={g.id} className="my-1 break-words text-amber-200">{g.solo?"◆ Solo":`◆ ${g.start} → ${g.end??"Awaiting End"}`} · {g.file.split("/").slice(-1)[0]}{g.condition?` · if ${g.condition}`:""}</p>)}
 <button disabled={!file||dirty} title={dirty?"Save and review marker lines before preparing":"Linux C++ source copy"} className="border border-zinc-700 px-2 py-1 rounded disabled:opacity-40" onClick={()=>{if(file)void useGold.getState().prepare(file).then(setPrepared).catch(e=>setError(String(e)));}}>Prepare current source copy…</button>
 {prepared&&<p className="my-2 text-zinc-400 break-all select-text">Prepared bundle: {prepared} — read README.txt and build the copy.</p>}</details>
 <details><summary className="cursor-pointer text-zinc-400">Native provider setup</summary><p className="my-2 text-zinc-500">Set this environment variable before starting the instrumented target. Debug launches receive it automatically.</p><code className="block break-all select-text text-amber-200">CRAIDD_PROFILE_SOCKET={state.bridge||"Unavailable"}</code><button className="mt-2 border border-zinc-700 px-2 py-1 rounded" onClick={()=>void navigator.clipboard.writeText(`CRAIDD_PROFILE_SOCKET=${state.bridge}`).catch(e=>setError(String(e)))}>Copy environment</button></details>
 </section></div>;
}
