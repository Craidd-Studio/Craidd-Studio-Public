import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface PerfOptions { frequency: number; durationSeconds: number; unwind: {kind:"fp"} | {kind:"dwarf";stackBytes:number} }
export interface PerfFrame { address:string; symbol:string; module:string; resolved:boolean; symbolOrigin:string; source:{path:string;line:number}|null }
export interface PerfChild { frameId:number; frame:PerfFrame; inclusiveWeight:number; selfWeight:number; sampleCount:number; sampledEventSharePct:number }
export interface PerfBranch { children:PerfChild[]; childCount:number; omittedChildren:number; selectedSamples:number; totalWeight:number; pathWeight:number;chainSamples?:number;chainWeight?:number }
export interface UnwindCounts {samples:number;weight:number;chainSamples:number;chainWeight:number;empty:number;truncated:number;mismatch:number}
export interface PerfCapture {
 id:string; label:string; createdMs:number; state:string; target:{pid:number;birth:number}; options:PerfOptions; event:string; pinned:boolean;
 symbolSearch?:{locations:string[];index:{entries:number;elfFiles:number;elapsedMs:number;incomplete:boolean;diagnostics:string[]};served:{module:string;buildId:string;debugFile:{path:string;sha256:string};state:string}[];withheldModules:Record<string,string>;sealed:boolean;privateCache:string}|null;
 rawBytes:number; rawLimit:number; estimatedRawBytes:number; perfVersion:string; clockDomain:string; reasons:string[];
 threadsAtStart:{tid:number;birth:number;name:string}[]; threadsGained:{tid:number;birth:number;name:string}[]; omittedThreadObservations:number; threadPollMs:number;
 coverage:{parsedSamples:number;retainedSamples:number;omittedSamples:number;lostRecords:number;lostCount:number;lostSampleRecords:number;lostSampleCount:number;unparsedLossRecords:number;unknownRecords:number;truncatedStacks:number;lossScanComplete:boolean|null;diagnostics:string[]};
 summary:{threads?:Record<string,string>;firstMonotonicNs?:number;lastMonotonicNs?:number;frameCount?:number;unwindCoverage?:{total:UnwindCounts;byThread:Record<string,UnwindCounts>;byLeafModule:Record<string,UnwindCounts>;basis:string}}|null;
 buildIds:{module:string;state:string;debugFiles:{path:string;state:string}[]}[]; stderr:string; decodeAndParseMs:number;decodeRevision?:number; moduleIdentityMs:number;
}
export interface PerfDiscovery { available:boolean;version:string|null;path:string|null;reason:string|null;perfEventParanoid:string|null;kptrRestrict:string|null;effectiveCapabilitiesHex:string|null }
export interface PerfPlan { target:{pid:number;birth:number}; threadsAtStart:unknown[]; estimatedRawBytes:number; estimateBasis:string; unwindCoverageWarning:string; threadCoverage:string; threadObservationWarning:string; expectedSampleIntervalMs:number }
export const perfAction = <T,>(request:Record<string,unknown>) => invoke<T>("perf_action",{request});
export const perfBusy = (state:string) => ["starting","recording","stopping","parsing","finalizing","decoding"].includes(state);
interface State {
 setup:boolean; tab:string; active:boolean; captures:PerfCapture[]; selected:string; discovery:PerfDiscovery|null; error:string;
 options:PerfOptions; direction:"topDown"|"bottomUp";tid:string;name:string;module:string;range:[string,string];
 set:(patch:Partial<Omit<State,"set"|"refresh">>)=>void; refresh:()=>Promise<void>;
}
export const usePerf=create<State>((set,get)=>({
 setup:true,tab:"Calls",active:false,captures:[],selected:"",discovery:null,error:"",options:{frequency:99,durationSeconds:10,unwind:{kind:"fp"}},direction:"bottomUp",tid:"",name:"",module:"",range:["",""],set,
 refresh:async()=>{const captures=await perfAction<PerfCapture[]>({action:"list"});const selected=get().selected||captures[0]?.id||"";
 const current=captures.find(c=>c.id===selected);if(current) {const status=await perfAction<PerfCapture>({action:"status",id:selected}).catch(()=>null);if(status)captures[captures.findIndex(c=>c.id===selected)]=status;}
 set({captures,selected});},
}));
