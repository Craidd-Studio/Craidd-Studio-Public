// Browser-only presentation fixture: all data and IPC here are synthetic.
// It is never imported by the product entrypoint or production bundle.
import {createRoot} from "react-dom/client";
import {useEffect,useState} from "react";
import "../../src/assets/styles/index.css";
import ProfilerPanel from "../../src/components/panels/ProfilerPanel";
import AttachProcessDialog from "../../src/components/dialogs/AttachProcessDialog";
import {useProfiling} from "../../src/store/profilingStore";
const target={pid:42,birth:300,name:"UnityPlayer · UI fixture",executable:"/fixture/CraiddUnityProbe.x86_64",cwd:"/fixture",uid:1000,adapterHint:"LLDB-DAP · native candidate"};
useProfiling.setState({bridge:"/tmp/ui-fixture.sock",profile:{id:"ui-fixture",target,name:target.name,active:true,reason:"",batch:1,provider:true,dropped:0,pauses:[],samples:Array.from({length:40},(_,i)=>({atMs:i*250,cpuMs:i*18+(i%3)*2,residentBytes:10485760+i*4096,virtualBytes:20971520,threadCount:3,state:"R"})),captures:Array.from({length:12},(_,i)=>({id:`work:${i}`,marker:"work",name:"Native scalar work",thread:100+i%2,batch:1,startMs:i*10,endMs:i*10+2,cpuMs:.8+i*.08,status:"Complete",allocatedBytes:4096,freedBytes:i===11?0:4096,liveBytes:i===11?4096:0,allocationCount:1}))}});
Object.assign(window,{__TAURI_INTERNALS__:{invoke:async(command:string)=>{
 if(command==="list_attach_processes")return[target];
 if(command==="attach_adapter_choices")return[{id:"lldb",name:"LLDB-DAP · native",available:true}];
 if(command==="profile_record_again"){const p=useProfiling.getState().profile!;useProfiling.setState({profile:{...p,batch:p.batch+1}});}
 if(command==="stop_profiling"){const p=useProfiling.getState().profile!;useProfiling.setState({profile:{...p,active:false,reason:"Profiling stopped; target left running"}});}
}}});
function Fixture(){const[attach,setAttach]=useState(false);const[wide,setWide]=useState(false);useEffect(()=>{const open=()=>setAttach(true);window.addEventListener("craidd:attach-process",open);return()=>window.removeEventListener("craidd:attach-process",open);},[]);return <main className="h-screen bg-zinc-950 text-zinc-300 flex flex-col"><header className="p-3 border-b border-zinc-800 text-xs">Profiler UI test fixture · synthetic data / mocked IPC <button className="ml-4 border rounded px-2" onClick={()=>setWide(!wide)}>Toggle panel width</button></header><div className="flex-1 min-h-0 flex justify-end"><aside style={{width:wide?420:288}} className="bg-zinc-900 border-l border-zinc-800"><ProfilerPanel/></aside></div>{attach&&<AttachProcessDialog onClose={()=>setAttach(false)}/>}</main>;}
createRoot(document.getElementById("root")!).render(<Fixture/>);
