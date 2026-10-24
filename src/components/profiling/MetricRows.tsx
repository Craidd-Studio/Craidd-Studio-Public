import {useEffect,useLayoutEffect,useRef,useState} from "react";
import {metricAction} from "../../store/metricStore";
import type {MetricColumn,MetricRow} from "../../types/profileSource";
interface Props{id:string;table:number;revision:number;columns:MetricColumn[];range:[number,number];selected:number|null;onSelect:(row:number)=>void;}
const ROW=29,HEADER=38,MAX_HEIGHT=12_000_000;
export default function MetricRows({id,table,revision,columns,range,selected,onSelect}:Props){
 const host=useRef<HTMLDivElement>(null),[height,setHeight]=useState(180),[top,setTop]=useState(0),[rows,setRows]=useState<MetricRow[]>([]),[error,setError]=useState("");
 const count=Math.max(0,range[1]-range[0]),visible=Math.max(1,Math.floor((height-HEADER)/ROW)),canvasHeight=Math.min(MAX_HEIGHT,Math.max(count*ROW,height-HEADER));
 const scrollMax=Math.max(1,canvasHeight+HEADER-height),first=range[0]+Math.round(top/scrollMax*Math.max(0,count-visible));
 const start=Math.max(range[0],first-5),end=Math.min(range[1],first+visible+7),seq=useRef(0),cache=useRef(new Map<string,MetricRow[]>()),lastRange=useRef("");
 const template=`72px ${columns.map(c=>`${Math.max(110,Math.min(210,c.name.length*7+24))}px`).join(" ")}`;
 useEffect(()=>{const node=host.current;if(!node)return;const observer=new ResizeObserver(([e])=>setHeight(e.contentRect.height));observer.observe(node);return()=>observer.disconnect();},[]);
 useLayoutEffect(()=>{const key=`${id}:${table}:${revision}:${range[0]}:${range[1]}`;if(lastRange.current!==key){lastRange.current=key;cache.current.clear();if(host.current)host.current.scrollTop=0;setTop(0);setRows([]);}},[id,table,revision,range[0],range[1]]);
 useEffect(()=>{const n=++seq.current;if(!count)return;const key=`${id}:${table}:${revision}:${start}:${end}`;const found=cache.current.get(key);setError("");if(found){setRows(found);return;}
  void metricAction<MetricRow[]>({op:"page",id,table,start,count:Math.min(100,end-start)}).then(v=>{if(n===seq.current){cache.current.set(key,v);while(cache.current.size>3)cache.current.delete(cache.current.keys().next().value!);setRows(v);}}).catch(e=>{if(n===seq.current)setError(String(e));});return()=>{seq.current++;};
 },[id,table,revision,start,end,count]);
 const previousSelected=useRef<number|null>(null);
 useLayoutEffect(()=>{if(selected===null||selected===previousSelected.current)return;previousSelected.current=selected;if(selected<range[0]||selected>=range[1])return;const node=host.current;if(!node)return;if(selected<first||selected>=first+visible){const fraction=(selected-range[0])/Math.max(1,count-visible);node.scrollTop=Math.max(0,Math.min(scrollMax,fraction*scrollMax));setTop(node.scrollTop);}},[selected,range[0],range[1],scrollMax,visible]);
 const jump=(n:number)=>{const node=host.current;if(!node)return;node.scrollTop=Math.max(0,Math.min(scrollMax,(n-range[0])/Math.max(1,count-visible)*scrollMax));setTop(node.scrollTop);};
 const onKey=(event:React.KeyboardEvent)=>{const base=selected??first;if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();onSelect(Math.max(range[0],Math.min(range[1]-1,base+(event.key==="ArrowDown"?1:-1))));}else if(event.key==="Home"||event.key==="End"){event.preventDefault();const index=event.key==="Home"?range[0]:range[1]-1;jump(index);onSelect(index);}};
 return <div className="metric-virtual-rows"><div className="metric-table-scroll" ref={host} onScroll={e=>setTop(e.currentTarget.scrollTop)} tabIndex={0} onKeyDown={onKey} aria-label="Metric rows viewport" onWheel={e=>{if(count*ROW>MAX_HEIGHT&&host.current&&!e.shiftKey){e.preventDefault();host.current.scrollTop+=e.deltaY/(count*ROW/MAX_HEIGHT);}}}>
  <table className="analysis-table metric-virtual-table" aria-label="Original metric rows" aria-rowcount={count+1} aria-colcount={columns.length+1}>
   <thead><tr style={{gridTemplateColumns:template}}><th>Row</th>{columns.map((c,i)=><th key={i} title={`${c.name} · ${c.unit} · ${c.meaning}`}>{c.name}<small>{c.unit}{c.unitSuggested?" *":""}</small></th>)}</tr></thead>
   <tbody style={{height:canvasHeight}}>{rows.map(row=><tr key={row.index} aria-rowindex={row.index-range[0]+2} aria-selected={row.index===selected} className={row.index===selected?"is-selected":""} style={{gridTemplateColumns:template,top:top+(row.index-first)*ROW}} onClick={()=>onSelect(row.index)}>
    <td><button onClick={e=>{e.stopPropagation();onSelect(row.index);}}>Row {row.index+1}</button></td>{row.cells.map((value,i)=><td key={i} title={row.truncatedColumns?.includes(i)?"Text preview · inspect this row for its complete original value":String(value??"Empty")}>{typeof value==="number"?String(value):value===null||value===""?<span className="metric-empty-cell">Empty</span>:String(value).slice(0,100)}</td>)}
   </tr>)}</tbody>
  </table>
  {error&&<div className="analysis-alert" role="alert">{error}</div>}
 </div><footer><span>{count.toLocaleString()} rows in range · showing {count?first+1:0}–{Math.min(range[1],first+visible).toLocaleString()}</span><button aria-label="First metric row" onClick={()=>jump(range[0])}>|‹</button><button aria-label="Previous metric rows" onClick={()=>jump(Math.max(range[0],first-visible))}>‹</button><button aria-label="Next metric rows" onClick={()=>jump(Math.min(range[1]-1,first+visible))}>›</button><button aria-label="Last metric row" onClick={()=>jump(range[1]-1)}>›|</button><small>Virtual rows · text previews</small></footer></div>;
}
