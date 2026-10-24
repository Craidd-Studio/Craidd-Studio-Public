import type {MetricAxis,MetricGraph} from "../../types/profileSource";
export const seriesColor=(index:number)=>["#58a6ff","#ac83f2","#f36b9b","#e4b74a","#76cf87","#52c9c0","#f29561","#b5c6dd"][index%8];
export const metricNumber=(value:number|null|undefined)=>value===null||value===undefined?"—":Number(value.toPrecision(6)).toLocaleString(undefined,{maximumFractionDigits:6});
export function metricTime(value:number,axis:MetricAxis["kind"],compact=false):string{
 if(axis==="ordinal")return metricNumber(value);
 if(axis==="epoch"||axis==="iso8601"){const date=new Date(value*1000);return Number.isFinite(date.getTime())?(compact?date.toISOString().slice(11,23):date.toISOString()):`${metricNumber(value)} s`;}
 if(Math.abs(value)<60)return `${metricNumber(value)} s`;
 const sign=value<0?"−":"",s=Math.abs(value),minutes=Math.floor(s/60),seconds=s-minutes*60;
 return `${sign}${String(minutes).padStart(2,"0")}:${seconds.toFixed(s%1?3:0).padStart(s%1?6:2,"0")}`;
}
export function axisTitle(axis:MetricAxis){return axis.kind==="ordinal"?"Retained row ordinal · not time":axis.kind==="elapsed"?"Program elapsed time":"File wall clock · not session time";}
export function graphPath(graph:MetricGraph,x:(n:number)=>number,y:(n:number)=>number){
 return (graph.vertices??[]).map((v,i)=>`${v.breakBefore||i===0?"M":"L"}${x(v.x).toFixed(2)},${y(v.value).toFixed(2)}`).join(" ");
}
export function clampRows(a:number,b:number,total:number):[number,number]{const start=Math.max(0,Math.min(total-1,Math.round(a)));return [start,Math.max(start+1,Math.min(total,Math.round(b)))];}
