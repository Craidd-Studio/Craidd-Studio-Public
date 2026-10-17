import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProcessTarget } from "../components/dialogs/AttachProcessDialog";
export interface ProfileSample { atMs: number; cpuMs: number; residentBytes: number; virtualBytes: number; threadCount: number; state: string }
export interface NativeActivity { allocatedBytes: number; freedBytes: number; allocationCount: number; freeCount: number; unmatchedFrees: number }
export interface CohortSummary { allocatedBytes: number; freedBytes: number; liveBytes: number; allocationCount: number }
export interface ProfileCounters { agedSamples: number; evictedCaptures: number; rejectedEvents: number; disconnects: number; sourceGaps: number }
export interface GoldCapture extends CohortSummary { id: string; marker: string; name: string; solo: boolean; thread: number; batch: number; startMs: number; endMs: number | null; cpuMs: number | null; status: string; processStart?: ProfileSample | null; processEnd?: ProfileSample | null; cohortEnd?: CohortSummary | null; windowActivity?: NativeActivity; coverageStart?: ProfileCounters; coverageEnd?: ProfileCounters | null }
export interface ProfileDiagnostic { atMs: number; untilMs: number; kind: string; count: number }
export interface Profile { counters?: ProfileCounters; observedAtMs?: number; nativeActivity?: NativeActivity; nativeLiveBytes?: number; diagnostics?: ProfileDiagnostic[]; diagnosticsEvicted?: number; id: string; target: ProcessTarget; name: string; active: boolean; unityEditor?: boolean; waitingForPlay?: boolean; playGeneration?: number | null; reason: string; batch: number; provider: boolean; pauses: {startMs:number;endMs:number|null;allThreads:boolean;thread:number|null;reason:string}[]; samples: ProfileSample[]; captures: GoldCapture[]; dropped: number }
// Keep identity plus one small descriptor, so eviction cannot silently retarget
// a user's selection. This does not pin another copy of the sample history.
export type RecordingRef = Pick<GoldCapture,"id"|"name"|"solo"|"marker"|"batch"|"thread"|"startMs"|"endMs"> & { profileId: string };
export interface Snapshot { id: string; name: string; profile: Profile; kind?: "manual"|"previousSession"; capturedAtMs?: number; recording?: RecordingRef | null; activeRecordingIds?: string[] }
interface State {
 profile: Profile | null; snapshots: Snapshot[]; selected: string | null; recording: RecordingRef | null;
 bridge: string; error: string | null; benchmarkBySession: Record<string, string | null>;
 focusBenchmark: (session: string, marker: string | null) => void;
 focusRecording: (session: string, capture: GoldCapture) => void;
 clearRecording: () => void;
 start: (target: ProcessTarget) => Promise<void>; stop: () => Promise<void>; again: () => Promise<void>;
 snapshot: () => void; select: (id: string | null) => void;
}
function recordingRef(profileId: string, c: GoldCapture): RecordingRef {
 const {id,name,solo,marker,batch,thread,startMs,endMs}=c;
 return {profileId,id,name,solo,marker,batch,thread,startMs,endMs};
}
export const useProfiling = create<State>((set,get) => ({
 profile: null, snapshots: [], selected: null, recording: null, bridge: "", error: null, benchmarkBySession: {},
 focusBenchmark: (session, marker) => set({benchmarkBySession: Object.fromEntries([
  ...Object.entries(get().benchmarkBySession).filter(([id]) => id !== session), [session, marker],
 ].slice(-9))}),
 focusRecording: (session,capture) => set({recording:recordingRef(session,capture)}),
 clearRecording: () => set({recording:null}),
 start: async target => { set({ error: null, selected: null, recording:null }); await invoke("start_profiling",{target}).catch(e=>{set({error:String(e)});throw e;}); },
 stop: async () => { await invoke("stop_profiling"); },
 again: async () => { await invoke("profile_record_again").catch(e=>set({error:String(e)})); },
 snapshot: () => {
  const {profile:p,recording,selected}=get(); if(!p)return;
  const copy=structuredClone(p), id=crypto.randomUUID();
  const snapshots=[...get().snapshots,{id,name:`Snapshot · ${p.name} · ${new Date().toLocaleTimeString()}`,kind:"manual" as const,profile:copy,
   capturedAtMs:p.observedAtMs ?? p.samples[p.samples.length-1]?.atMs ?? 0,
   recording:!selected&&recording?.profileId===p.id?structuredClone(recording):null,
   activeRecordingIds:p.captures.filter(c=>c.endMs===null).map(c=>c.id)}].slice(-8);
  const evicted=!!selected&&!snapshots.some(s=>s.id===selected);
  set({snapshots,...evicted?{selected:null,recording:null}:{}});
 },
 select: selected=>set({selected,recording:selected?get().snapshots.find(s=>s.id===selected)?.recording??null:null}),
}));
export function receiveProfile(payload: Profile) {
 const state=useProfiling.getState(), old=state.profile;
 let snapshots=state.snapshots, recording=state.recording, selected=state.selected;
 if(old&&old.id!==payload.id&&(old.samples.length||old.captures.length)) {
  snapshots=[...snapshots,{id:crypto.randomUUID(),name:`Previous session · ${old.name}`,kind:"previousSession" as const,profile:structuredClone(old)}].slice(-8);
 }
 if(selected&&!snapshots.some(s=>s.id===selected)){selected=null;recording=null;}
 if(!selected&&recording?.profileId===payload.id) {
  const c=payload.captures.find(c=>c.id===recording!.id);
  if(c)recording=recordingRef(payload.id,c); // Recording -> Recorded, same identity.
 }
 // A new session does not reinterpret an old recording ID as a new capture.
 useProfiling.setState({profile:payload,snapshots,selected,recording});
}
export async function listenToProfiling() {
 let received=false;
 const off=await listen<Profile>("craidd:profile",({payload})=>{received=true;receiveProfile(payload);});
 try {
  const [bridge,profile]=await Promise.all([invoke<string>("profiling_bridge").catch(e=>{useProfiling.setState({error:`Source provider unavailable: ${String(e)}`});return "";}),invoke<Profile|null>("get_profile")]);
  useProfiling.setState(received?{bridge}:{bridge,profile});
 } catch(e){useProfiling.setState({error:String(e)});}return off;
}
