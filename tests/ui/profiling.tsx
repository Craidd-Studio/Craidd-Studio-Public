// Browser-only presentation fixture: all data and IPC here are synthetic.
// It is never imported by the product entrypoint or production bundle.
import "../../src/monacoSetup";
import CodeView from "../../src/components/editor/CodeView";
import {useSolution} from "../../src/store/solutionStore";
import {useBreakpoints} from "../../src/store/breakpointStore";
import {useGold} from "../../src/store/goldStore";
import {createRoot} from "react-dom/client";
import {useEffect,useState} from "react";
import "../../src/assets/styles/index.css";
import ProfilerPanel from "../../src/components/panels/ProfilerPanel";
import AttachProcessDialog from "../../src/components/dialogs/AttachProcessDialog";
import {useProfiling} from "../../src/store/profilingStore";
const file="/fixture/ProfileDemo.cs";
const content=`using System;
class ProfileDemo
{
    static void Main()
    {
        var values = new byte[1024 * 1024];
        for (var i = 0; i < values.Length; i++)
        {
            values[i] = (byte)(i % 255);
        }
        Console.WriteLine(values.Length);
        values = null;
        GC.Collect();
    }
}`;
useSolution.setState({rootPath:"/fixture",clnPath:"/fixture/fixture.cln",activeFileId:file,tabs:[{fileId:file,name:"ProfileDemo.cs",language:"csharp",monacoLanguage:"csharp",content,originalContent:content,dirty:false,diskState:"inSync",mtimeAtLastSync:0}]});
useBreakpoints.setState({solutionPath:"/fixture/fixture.cln",points:[{file,line:6,scope:"all"}]});
useGold.setState({solutionPath:"/fixture/fixture.cln",points:[{id:"pair",file,start:6,end:11,solo:false,condition:""},{id:"solo",file,start:13,end:null,solo:true,condition:""}]});
const addSolo=()=>{const p=useProfiling.getState().profile!;if(p.captures.some(c=>c.solo))return;useProfiling.setState({profile:{...p,captures:[...p.captures,{id:"solo:session:1",marker:"session",name:"Session overview",solo:true,thread:0,batch:p.batch,startMs:0,endMs:null,cpuMs:null,status:"Recording",allocatedBytes:49152,freedBytes:45056,liveBytes:4096,allocationCount:12}]}});};
const addRange=()=>{const p=useProfiling.getState().profile!;useProfiling.setState({profile:{...p,captures:[...p.captures,{...p.captures.find(c=>!c.solo)!,id:`new:${p.captures.length}`,marker:"new-work",name:"Background work",solo:false,cpuMs:4.2}]}});};
const target={pid:42,birth:300,name:"Unity Editor · UI fixture",executable:"/fixture/Editor/Unity",unityProject:"/fixture",cwd:"/fixture",uid:1000,adapterHint:"LLDB-DAP · native candidate"};
useProfiling.setState({bridge:"/tmp/ui-fixture.sock",profile:{id:"ui-fixture",target,name:target.name,active:true,reason:"",batch:1,provider:true,dropped:0,pauses:[],samples:Array.from({length:40},(_,i)=>({atMs:i*250,cpuMs:i*18+(i%3)*2,residentBytes:10485760+(i<12?i*65536:i<28?786432:262144),virtualBytes:20971520,threadCount:3,state:"R"})),captures:Array.from({length:12},(_,i)=>({id:`work:${i}`,marker:"work",name:"Native scalar work",solo:false,thread:100+i%2,batch:1,startMs:i*750+125,endMs:i*750+450,cpuMs:.8+i*.08,status:"Complete",allocatedBytes:4096,freedBytes:i===11?0:4096,liveBytes:i===11?4096:0,allocationCount:1}))}});
addSolo();
Object.assign(window,{__TAURI_INTERNALS__:{invoke:async(command:string,args:Record<string,unknown>)=>{
 if(command==="edit_gold"){return useGold.getState().points.filter(p=>args.operation!=="remove"||p.id!==args.id).map(p=>p.id===args.id&&args.operation==="condition"?{...p,condition:String(args.condition)}:p);}
 if(command==="save_breakpoints")return;
 if(command==="start_profiling"){const p=useProfiling.getState().profile!;useProfiling.setState({profile:{...p,unityEditor:true,waitingForPlay:true,active:true}});return p.id;}
 if(command==="list_attach_processes")return[target];
 if(command==="attach_adapter_choices")return[{id:"lldb",name:"LLDB-DAP · native",available:true}];
 if(command==="profile_record_again"){const p=useProfiling.getState().profile!;useProfiling.setState({profile:{...p,batch:p.batch+1}});}
 if(command==="stop_profiling"){const p=useProfiling.getState().profile!;useProfiling.setState({profile:{...p,active:false,reason:"Profiling stopped; target left running"}});}
}}});
function Fixture(){const[attach,setAttach]=useState(false);const[wide,setWide]=useState(false);useEffect(()=>{const open=()=>setAttach(true);window.addEventListener("craidd:attach-process",open);return()=>window.removeEventListener("craidd:attach-process",open);},[]);return <main className="h-screen bg-zinc-950 text-zinc-300 flex flex-col"><header className="p-3 border-b border-zinc-800 text-xs">Profiler UI test fixture · synthetic data / mocked IPC <button className="ml-4 border rounded px-2" onClick={()=>setWide(!wide)}>Toggle panel width</button><button className="ml-4 border rounded px-2" onClick={addRange}>New range hit</button><button className="ml-4 border rounded px-2" onClick={addSolo}>Add Solo</button><button className="ml-4 border rounded px-2" onClick={()=>{const p=useProfiling.getState().profile!;useProfiling.setState({profile:{...p,samples:[...p.samples,{...p.samples[p.samples.length-1],atMs:10000,residentBytes:10485760}],captures:p.captures.map(c=>({...c,freedBytes:c.allocatedBytes,liveBytes:0}))}});}}>Simulate free</button></header><div className="flex-1 min-h-0 flex justify-end"><section className="flex flex-col flex-1 min-w-0"><CodeView/></section><aside style={{width:wide?420:288}} className="bg-zinc-900 border-l border-zinc-800"><ProfilerPanel/></aside></div>{attach&&<AttachProcessDialog onClose={()=>setAttach(false)}/>}</main>;}
const root=createRoot(document.getElementById("root")!);
root.render(<Fixture/>);
if(import.meta.hot) import.meta.hot.dispose(()=>root.unmount());
