import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
export interface GoldMarker { id: string; file: string; start: number; end: number | null; solo: boolean; condition: string }
interface GoldState { solutionPath: string | null; points: GoldMarker[]; load: (path: string | null) => Promise<void>;
 edit: (operation: "start"|"end"|"solo"|"remove"|"condition",file: string,line: number,id?: string,condition?: string)=>Promise<void>;
 prepare: (file: string)=>Promise<string>;
}
export const useGold = create<GoldState>((set,get)=>({
 solutionPath:null,points:[],
 load:async path=>{set({solutionPath:path,points:[]});if(!path)return;const points=await invoke<GoldMarker[]>("load_gold",{solutionPath:path});if(get().solutionPath===path)set({points});},
 edit:async(operation,file,line,id,condition)=>{const path=get().solutionPath;if(!path)throw new Error("Open a solution to place Gold markers");const points=await invoke<GoldMarker[]>("edit_gold",{solutionPath:path,operation,file,line,id:id??null,condition:condition??null});if(get().solutionPath===path)set({points});},
 prepare:async file=>{const solutionPath=get().solutionPath;if(!solutionPath)throw new Error("Open a solution first");return invoke<string>("export_gold_instrumentation",{solutionPath,file});},
}));
export async function listenToGold(){return listen<{solutionPath:string;points:GoldMarker[]}>("craidd:gold-changed",({payload})=>{if(payload.solutionPath===useGold.getState().solutionPath)useGold.setState({points:payload.points});});}
