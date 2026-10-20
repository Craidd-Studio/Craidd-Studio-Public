import type { GoldCapture } from "../store/profilingStore";

export interface GoldBenchmark { marker: string; name: string; solo: boolean; hits: number }

// Use recorded identities, not current source intent: editing a marker must not
// relabel captures already recorded by another build or in a snapshot.
export function goldBenchmarks(captures: GoldCapture[]): GoldBenchmark[] {
  const groups = new Map<string, GoldBenchmark>();
  for (const capture of captures) {
    const group = groups.get(capture.marker);
    if (group) group.hits++;
    else groups.set(capture.marker, {
      marker: capture.marker, name: capture.name || capture.marker, solo: capture.solo, hits: 1,
    });
  }
  return [...groups.values()].sort((a, b) => Number(b.solo) - Number(a.solo));
}

// Marker browsing is independent of the global scope. Unset means all markers;
// preserve an explicit marker even when a filtered view has none of its hits.
export function resolveGoldBenchmark(_benchmarks: GoldBenchmark[], chosen: string | null | undefined): string | null {
  return chosen ?? null;
}

import type { Profile, ProfileSample, RecordingRef } from "../store/profilingStore";
export type ProfileSpan = [number,number];
export function recordingStatus(c: Pick<GoldCapture,"endMs"|"status">, snapshot=false): string {
 return c.endMs===null ? snapshot?"Open at snapshot":"Recording" : c.status.startsWith("Incomplete")||c.status==="Invalid provider clock"?"Recorded · Incomplete":"Recorded";
}
export function recordingLabel(c: GoldCapture, snapshot=false): string {
 return `${c.solo?"Solo":"Gold"} · ${c.name} · B${c.batch} · T${c.thread||"all"} · ${(c.startMs/1000).toFixed(3)}s · ${recordingStatus(c,snapshot)}`;
}
export function observationTime(p: Profile): number {
 return p.observedAtMs ?? Math.max(p.samples[p.samples.length-1]?.atMs??0,...p.captures.map(c=>c.endMs??c.startMs));
}
export function resolveProfileScope(p: Profile|null, chosen: RecordingRef|null, snapshot=false, subrange:ProfileSpan|null=null) {
 const now=p?observationTime(p):0;
 const recording=chosen && chosen.profileId===p?.id?p?.captures.find(c=>c.id===chosen.id)??null:null;
 const missing=!!chosen&&!recording;
 const bounds:ProfileSpan=chosen?[recording?.startMs??chosen.startMs,recording?.endMs??chosen.endMs??(missing?chosen.startMs:now)]:[p?.samples[0]?.atMs??0,now];
 bounds[1]=Math.max(bounds[0],bounds[1]);
 const window:ProfileSpan=subrange?[Math.max(bounds[0],Math.min(bounds[1],subrange[0])),Math.max(bounds[0],Math.min(bounds[1],subrange[1]))]:bounds;
 const within=(at:number)=>at>=window[0]&&at<=window[1];
 const overlaps=(start:number,end:number|null)=>start<=window[1]&&(end??now)>=window[0];
 const samples=missing?[]:(p?.samples??[]).filter(s=>within(s.atMs));
 // Delta first, filter second. Never charge a crossing CPU bucket wholly to
 // the selected recording; an interval shorter than polling may have no data.
 const cpu=missing?[]:(p?.samples??[]).slice(1).flatMap((s,i)=>{
  const before=p!.samples[i];return within(before.atMs)&&within(s.atMs)?[{sample:s,value:Math.max(0,s.cpuMs-before.cpuMs)}]:[];
 });
 const captures=missing?[]:(p?.captures??[]).filter(c=>overlaps(c.startMs,c.endMs));
 const pauses=missing?[]:(p?.pauses??[]).filter(s=>overlaps(s.startMs,s.endMs));
 const diagnostics=missing?[]:(p?.diagnostics??[]).filter(e=>overlaps(e.atMs,e.untilMs));
 const first=p?.samples[0]?.atMs;
 const history=missing?"Recording unavailable · evicted or belongs to another session":chosen&&first!==undefined&&first>bounds[0]&&!!p?.counters?.agedSamples?"Partial history · older process samples were evicted":chosen&&!samples.length?"Process samples unavailable in this recording window":null;
 const start=recording?.processStart??(chosen?null:p?.samples[0]??null);
 const end=recording?.endMs!==null&&recording?.processEnd?recording.processEnd:samples[samples.length-1]??null;
 // Same old observation at both endpoints is not proof of a zero RSS change.
 const rssDelta=start&&end&&end.atMs>start.atMs&&end.atMs>=bounds[0]?end.residentBytes-start.residentBytes:null;
 const from=recording?.coverageStart,to=recording?.coverageEnd??p?.counters;
 const coverageLost=!!recording&&(!from||!to||["sourceGaps","rejectedEvents","disconnects"].some(k=>to[k as keyof typeof to]>from[k as keyof typeof from]));
 return {recording,missing,bounds,window,samples,cpu,captures,pauses,diagnostics,start,end,rssDelta,history,coverageLost,
  latest:samples[samples.length-1] as ProfileSample|undefined,
  cohort:recording?(recording.endMs!==null?recording.cohortEnd??null:recording):null,
  activity:subrange||missing?null:recording?.windowActivity??(!chosen?p?.nativeActivity:null),
  status:chosen?recording?recordingStatus(recording,snapshot):"Unavailable":snapshot?"Snapshot":p?.waitingForPlay?"Ready for Play":p?.active?"Live":p?"Stopped":"Idle",
 };
}

// Reserve the selected interval, then fit long/nested intervals into three
// non-overlapping lanes. Dense hits remain in the complete bounded history.
export function timelineEntries(captures: GoldCapture[], selected: string|undefined, bounds: ProfileSpan) {
 const lanes: ProfileSpan[][]=[[],[],[]];
 const duration=(c:GoldCapture)=>Math.min(c.endMs??bounds[1],bounds[1])-Math.max(c.startMs,bounds[0]);
 const ordered=[...captures].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected)||duration(b)-duration(a)||b.startMs-a.startMs);
 const result:{capture:GoldCapture;lane:number}[]=[];
 for(const c of ordered){
  const span:ProfileSpan=[Math.max(c.startMs,bounds[0]),Math.min(c.endMs??bounds[1],bounds[1])];
  const lane=lanes.findIndex(intervals=>intervals.every(s=>span[1]<s[0]||span[0]>s[1]));
  if(lane<0)continue;lanes[lane].push(span);result.push({capture:c,lane});if(result.length===128)break;
 }
 return result;
}
