import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { ProcessTarget } from "../components/dialogs/AttachProcessDialog";
export interface ProfileSample { atMs: number; cpuMs: number; residentBytes: number; virtualBytes: number; threadCount: number; state: string }
export interface GoldCapture { id: string; marker: string; name: string; thread: number; batch: number; startMs: number; endMs: number | null; cpuMs: number | null; status: string; allocatedBytes: number; freedBytes: number; liveBytes: number; allocationCount: number }
export interface Profile { id: string; target: ProcessTarget; name: string; active: boolean; reason: string; batch: number; provider: boolean; pauses: {startMs:number;endMs:number|null;allThreads:boolean;thread:number|null;reason:string}[]; samples: ProfileSample[]; captures: GoldCapture[]; dropped: number }
export interface Snapshot { id: string; name: string; profile: Profile }
interface State { profile: Profile | null; snapshots: Snapshot[]; selected: string | null; bridge: string; error: string | null;
 start: (target: ProcessTarget) => Promise<void>; stop: () => Promise<void>; again: () => Promise<void>; snapshot: () => void; select: (id: string | null) => void;
}
export const useProfiling = create<State>((set,get) => ({
 profile: null, snapshots: [], selected: null, bridge: "", error: null,
 start: async (target) => { set({ error: null, selected: null }); await invoke("start_profiling",{target}).catch(e=>{set({error:String(e)});throw e;}); },
 stop: async () => { await invoke("stop_profiling"); },
 again: async () => { await invoke("profile_record_again").catch(e=>set({error:String(e)})); },
 snapshot: () => {const p=get().profile;if(!p)return;const copy=structuredClone(p);const id=crypto.randomUUID();set({snapshots:[...get().snapshots,{id,name:`${p.name} · ${new Date().toLocaleTimeString()}`,profile:copy}].slice(-8),selected:id});},
 select: selected=>set({selected}),
}));
export async function listenToProfiling() {
 let received=false;
 const off=await listen<Profile>("craidd:profile",({payload})=>{received=true;const old=useProfiling.getState().profile;const snapshots=useProfiling.getState().snapshots;if(old&&old.id!==payload.id&&(old.samples.length||old.captures.length))useProfiling.setState({snapshots:[...snapshots,{id:crypto.randomUUID(),name:`Previous · ${old.name}`,profile:structuredClone(old)}].slice(-8)});useProfiling.setState({profile:payload});});
 try { const [bridge,profile]=await Promise.all([invoke<string>("profiling_bridge").catch(e=>{useProfiling.setState({error:`Source provider unavailable: ${String(e)}`});return "";}),invoke<Profile|null>("get_profile")]);useProfiling.setState(received?{bridge}:{bridge,profile}); }
 catch(e){useProfiling.setState({error:String(e)});}return off;
}
