import {useEffect,useId,useMemo,useRef,useState} from "react";
import type {MetricAxis,MetricColumn,MetricGraph,MetricRow} from "../../types/profileSource";
import {graphPath,metricNumber,metricTime,seriesColor} from "./metricPresentation";
type Range={startX:number;endX:number}|null;
interface Props{
 graphs:MetricGraph[];columns:MetricColumn[];axis:MetricAxis;unit:string;mode:"line"|"points"|"windows";
 selection:Range;selected:MetricRow|null;thresholds:{column:number;value:number;label:string}[];
 onPick:(x:number)=>void;onSelect:(a:number,b:number)=>void;onZoom:(a:number,b:number)=>void;onHover:(x:number)=>Promise<MetricRow>;
}
export default function MetricPlot({graphs,columns,axis,unit,mode,selection,selected,thresholds,onPick,onSelect,onZoom,onHover}:Props){
 const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),[size,setSize]=useState({width:700,height:260});
 const [hover,setHover]=useState<{x:number;y:number;row:MetricRow|null}|null>(null),[draft,setDraft]=useState<Range>(null);
 const drag=useRef<{x:number;px:number;handle:string|null}|null>(null),timer=useRef<ReturnType<typeof setTimeout>|null>(null),seq=useRef(0),hoverRef=useRef(hover);hoverRef.current=hover;
 const id=useId().replace(/:/g,"");
 useEffect(()=>{const node=host.current;if(!node)return;const observer=new ResizeObserver(([v])=>setSize({width:Math.max(260,v.contentRect.width),height:Math.max(140,v.contentRect.height)}));observer.observe(node);return()=>observer.disconnect();},[]);
 useEffect(()=>{seq.current++;setHover(null);if(timer.current)clearTimeout(timer.current);},[graphs]);
 useEffect(()=>()=>{seq.current++;if(timer.current)clearTimeout(timer.current);},[]);
 const g=graphs[0];
 const geometry=useMemo(()=>{
  const left=56,right=size.width-18,top=18,bottom=size.height-36;
  const points=graphs.flatMap(v=>v.points),values=points.flatMap(p=>[p.min,p.max]);thresholds.forEach(t=>values.push(t.value));
  let low=Math.min(...values),high=Math.max(...values);if(!Number.isFinite(low)){low=0;high=1;}if(low>=0)low=0;if(high<=0)high=0;if(high===low)high=low+1;high+=(high-low)*.05;
  const start=g?.xStart??0,end=(g?.xEnd??1)+(axis.windowSeconds??0),width=end-start;
  const x=(v:number)=>left+(width?(v-start)/width:.5)*(right-left),y=(v:number)=>bottom-(v-low)/(high-low)*(bottom-top);
  return {left,right,top,bottom,low,high,start,end,x,y,paths:graphs.map(v=>graphPath(v,x,y))};
 },[graphs,size.width,size.height,axis.windowSeconds,thresholds]);
 if(!g)return null;
 const {left,right,top,bottom,low,high,start,end,x,y}=geometry;
 const position=(event:React.PointerEvent<SVGSVGElement>)=>{const r=event.currentTarget.getBoundingClientRect(),px=(event.clientX-r.left)*size.width/r.width;return {px,x:start+Math.max(0,Math.min(1,(px-left)/(right-left)))*(end-start),y:event.clientY-r.top};};
 const commit=draft??selection;
 const hoverAt=(point:{px:number;x:number;y:number})=>{
  const n=++seq.current;setHover({x:point.px,y:point.y,row:null});if(timer.current)clearTimeout(timer.current);
  timer.current=setTimeout(()=>{void onHover(point.x).then(row=>{if(n===seq.current)setHover({x:point.px,y:point.y,row});}).catch(()=>{if(n===seq.current)setHover(null);});},35);
 };
 return <figure className="metric-plot" aria-label="Imported metric timeline">
  <figcaption id={id}><strong>{unit}{graphs.some(v=>columns[v.column].unitSuggested)?" *":""}</strong><span>{graphs.map(v=><span key={v.column}><i style={{background:seriesColor(v.column)}}/>{columns[v.column].name}</span>)}</span></figcaption>
  <div ref={host} className="metric-plot-surface">
   <svg ref={svg} role="img" aria-label="Metric range graph" aria-describedby={id} data-start={g.start} data-end={g.end} data-column={g.column} viewBox={`0 0 ${size.width} ${size.height}`} onPointerDown={e=>{const p=position(e);drag.current={x:p.x,px:p.px,handle:(e.target as Element).getAttribute("data-handle")};setHover(null);seq.current++;e.currentTarget.setPointerCapture(e.pointerId);}}
    onPointerMove={e=>{const p=position(e),d=drag.current;if(d){const a=d.handle==="end"?(selection?.startX??d.x):d.handle==="start"?p.x:d.x,b=d.handle==="start"?(selection?.endX??d.x):p.x;setDraft({startX:Math.min(a,b),endX:Math.max(a,b)});}else hoverAt(p);}}
    onPointerUp={e=>{const d=drag.current,p=position(e);drag.current=null;const r=draft;setDraft(null);if(!d)return;if(Math.abs(p.px-d.px)<4&&!d.handle)onPick(p.x);else{const a=r?.startX??Math.min(d.x,p.x),b=r?.endX??Math.max(d.x,p.x);if(e.shiftKey)onZoom(a,b);else onSelect(a,b);}}}
    onPointerCancel={()=>{drag.current=null;setDraft(null);}} onPointerLeave={()=>{if(!drag.current){seq.current++;setHover(null);if(timer.current)clearTimeout(timer.current);}}}>
    <defs><clipPath id={`${id}-clip`}><rect x={left} y={top} width={right-left} height={bottom-top}/></clipPath></defs>
    {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={left} x2={right} y1={top+t*(bottom-top)} y2={top+t*(bottom-top)} className="metric-gridline"/><text x={left-10} y={top+4+t*(bottom-top)} textAnchor="end" className="metric-tick">{metricNumber(Number((high-(high-low)*t).toPrecision(3)))}</text></g>)}
    {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={left+t*(right-left)} x2={left+t*(right-left)} y1={top} y2={bottom} className="metric-gridline is-vertical"/><text x={left+t*(right-left)} y={size.height-14} textAnchor={t===0?"start":t===1?"end":"middle"} className="metric-tick">{metricTime(axis.kind==="ordinal"?Math.round(start+(end-start)*t):start+(end-start)*t,axis.kind,true)}</text></g>)}
    <g clipPath={`url(#${id}-clip)`}>
     {commit&&<rect x={x(commit.startX)} width={Math.max(2,x(commit.endX)-x(commit.startX))} y={top} height={bottom-top} className="metric-selection-fill"/>}
     {graphs.map((v,n)=><g key={v.column}>
      {mode==="line"&&<path d={geometry.paths[n]} fill="none" stroke={seriesColor(v.column)} strokeWidth={1.6} vectorEffect="non-scaling-stroke"/>}
      {mode==="windows"&&axis.windowSeconds&&columns[v.column].meaning==="window statistic"?v.points.map((p,i)=><rect key={i} x={x(p.x)} width={Math.max(2,x(p.until+axis.windowSeconds!)-x(p.x))} y={y(p.max)} height={Math.max(2,y(p.min)-y(p.max))} fill={seriesColor(v.column)} opacity={.48}/>):v.points.map((p,i)=><line key={i} x1={x((p.x+p.until)/2)} x2={x((p.x+p.until)/2)} y1={y(p.max)} y2={y(p.min)+(mode==="line"?1:2)} stroke={seriesColor(v.column)} opacity={mode==="line"?.45:1} strokeWidth={mode==="line"?1:2.6} strokeLinecap="round" vectorEffect="non-scaling-stroke"/>)}
     </g>)}
     {thresholds.map((t,i)=><g key={i}><line x1={left} x2={right} y1={y(t.value)} y2={y(t.value)} stroke="#e8bf6b" strokeDasharray="6 4"/><text x={right-5} y={y(t.value)-5} textAnchor="end" className="metric-budget-label">{t.label||"Threshold"} · {metricNumber(t.value)} {unit}</text></g>)}
     {selected&&selected.index>=g.start&&selected.index<g.end&&<line x1={x(selected.x)} x2={x(selected.x)} y1={top} y2={bottom} className="metric-committed-line"/>}
     {hover&&<line x1={hover.row?x(hover.row.x):hover.x} x2={hover.row?x(hover.row.x):hover.x} y1={top} y2={bottom} className="metric-hover-line"/>}
     {hover?.row&&graphs.map(v=>{const value=hover.row!.cells[v.column];return typeof value==="number"&&<circle key={v.column} cx={x(hover.row!.x)} cy={y(value)} r={3} fill={seriesColor(v.column)} stroke="#17202c"/>;})}
    </g>
    {commit&&["start","end"].map(handle=><g key={handle}><line x1={x(handle==="start"?commit.startX:commit.endX)} x2={x(handle==="start"?commit.startX:commit.endX)} y1={top} y2={bottom} className="metric-selection-edge"/><rect data-handle={handle} x={x(handle==="start"?commit.startX:commit.endX)-4} y={top-3} width={8} height={12} rx={2} className="metric-selection-handle"/><rect data-handle={handle} x={x(handle==="start"?commit.startX:commit.endX)-4} y={bottom-9} width={8} height={12} rx={2} className="metric-selection-handle"/></g>)}
   </svg>
   {hover&&<div className="metric-hover-card" role="status" aria-label="Metric hover values" style={{left:Math.max(4,Math.min(size.width-246,hover.x+14)),top:Math.max(4,Math.min(size.height-40-graphs.length*23,hover.y+12))}}>{hover.row?<><header>{metricTime(hover.row.x,axis.kind)}<small>Original row {hover.row.index+1}</small></header>{graphs.map(v=><div key={v.column}><i style={{background:seriesColor(v.column)}}/><span>{columns[v.column].name}</span><strong>{typeof hover.row!.cells[v.column]==="number"?String(hover.row!.cells[v.column]):"Empty"}</strong><small>{columns[v.column].unit}</small></div>)}</>:<span>Reading nearest original row…</span>}</div>}
  </div>
 </figure>;
}

export function MetricOverview({graph,column,viewport,rowRange,onViewport,onRows}:{graph:MetricGraph;axis:MetricAxis;column:MetricColumn;viewport:[number,number];rowRange:[number,number];onViewport:(a:number,b:number)=>void;onRows:(a:number,b:number)=>void}){
 const host=useRef<SVGSVGElement>(null),drag=useRef<{part:string;a:number;b:number;x:number}|null>(null),[draft,setDraft]=useState<[number,number]|null>(null);
 const low=Math.min(...graph.points.map(p=>p.min)),high=Math.max(...graph.points.map(p=>p.max)),width=graph.xEnd-graph.xStart;
 const x=(v:number)=>width?(v-graph.xStart)/width*1000:500,y=(v:number)=>high===low?24:36-(v-low)/(high-low)*26;
 const [a,b]=draft??viewport,position=(e:React.PointerEvent<SVGSVGElement>)=>{const r=e.currentTarget.getBoundingClientRect();return graph.xStart+Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*width;};
 const keyboard=(event:React.KeyboardEvent,part:string)=>{const step=event.shiftKey?10:1;if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();const delta=event.key==="ArrowLeft"?-step:step;onRows(part==="start"?rowRange[0]+delta:rowRange[0],part==="end"?rowRange[1]+delta:rowRange[1]);}};
 return <div className="metric-overview" aria-label="Metric file overview"><div><span>Overview · {column.name}</span><small>{column.unit} · full file</small></div><svg ref={host} viewBox="0 0 1000 46" preserveAspectRatio="none" aria-label="Metric viewport navigator" onPointerDown={e=>{const value=position(e),part=(e.target as Element).getAttribute("data-handle")??"pan";drag.current={part,a,b,x:value};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{const d=drag.current;if(!d)return;const value=position(e),span=d.b-d.a;let left=d.part==="start"?value:d.part==="end"?d.a:d.a+value-d.x;let right=d.part==="end"?value:d.part==="start"?d.b:left+span;if(left<graph.xStart){left=graph.xStart;if(d.part==="pan")right=left+span;}if(right>graph.xEnd){right=graph.xEnd;if(d.part==="pan")left=right-span;}setDraft([Math.min(left,right),Math.max(left,right)]);}} onPointerUp={e=>{const d=drag.current;drag.current=null;if(!d)return;if(draft)onViewport(...draft);else{const value=position(e),span=b-a;onViewport(Math.max(graph.xStart,value-span/2),Math.min(graph.xEnd,value+span/2));}setDraft(null);}} onPointerCancel={()=>{drag.current=null;setDraft(null);}}>
  <path d={graphPath(graph,x,y)} fill="none" stroke={seriesColor(graph.column)} strokeWidth={1} vectorEffect="non-scaling-stroke"/>
  <rect x={x(a)} y={2} width={Math.max(2,x(b)-x(a))} height={42} fill="#448dd52e" stroke="#579fe9"/>
  {["start","end"].map(part=><rect key={part} data-handle={part} role="slider" tabIndex={0} aria-label={`Metric overview ${part}`} aria-valuemin={graph.xStart} aria-valuemax={graph.xEnd} aria-valuenow={part==="start"?a:b} onKeyDown={e=>keyboard(e,part)} x={x(part==="start"?a:b)-4} y={5} width={8} height={36} rx={2} className="metric-selection-handle"/>)}
 </svg></div>;
}
