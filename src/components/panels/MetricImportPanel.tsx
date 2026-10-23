import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { metricAction, useMetrics, type MetricView } from "../../store/metricStore";
import type { MetricAxis, MetricColumn, MetricGraph, MetricInspection, MetricJoin, MetricRow } from "../../types/profileSource";

import { worstKeyColumn, worstKeyValue } from "../../lib/metricRowKey";

const filename = (path: string) => path.split("/").pop() ?? path;
const cell = (value: number | string | null) => value === null || value === "" ? "Empty" : String(value);
const palette = ["#62a9ff", "#e890bd", "#8dd5a1", "#e9c76b", "#bba2f4", "#7cd5dc", "#f4a16f", "#c3cbd5"];
const format = (value: number) => Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));

export default function MetricImportPanel() {
  const state = useMetrics();
  const source = state.sources.find(s => s.id === state.selected);
  const group = source?.tables[state.table];
  const rows = source?.rows[state.table] ?? 0;
  const ready = !!group && rows > 0;
  const [tab, setTab] = useState("Time series");
  const [visible, setVisible] = useState<number[]>([]);
  const [search, setSearch] = useState("");
  const [charts, setCharts] = useState<MetricGraph[]>([]);
  const [pageStart, setPageStart] = useState(0);
  const [pageRows, setPageRows] = useState<MetricRow[]>([]);
  const [showSources, setShowSources] = useState(true);
  const [showInspector, setShowInspector] = useState(false);
  const [paths, setPaths] = useState("");
  const [savePath, setSavePath] = useState("");
  const [column, setColumn] = useState(0);
  const [span, setSpan] = useState<[number, number]>([0, 0]);
  const [graph, setGraph] = useState<MetricGraph | null>(null);
  const [inspection, setInspection] = useState<MetricInspection | null>(null);
  const [keyChoice, setKeyChoice] = useState<number | null>(null);
  const [bulkSelection, setBulkSelection] = useState<number[]>([]);
  const [bulkScope, setBulkScope] = useState("unitless");
  const [bulkUnit, setBulkUnit] = useState("ms");
  const [bulkMeaning, setBulkMeaning] = useState("");
  const [worst, setWorst] = useState<MetricRow[]>([]);
  const [rowIndex, setRowIndex] = useState(1);
  const [settings, setSettings] = useState(false);
  const [columns, setColumns] = useState<MetricColumn[]>([]);
  const [axis, setAxis] = useState<MetricAxis>({ kind: "ordinal", column: null, windowSeconds: null });
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  const [join, setJoin] = useState<MetricJoin>({ left: 0, right: 1, leftColumn: 0, rightColumn: 0, tolerance: null });
  const graphSequence = useRef(0), rowSequence = useRef(0);
  const key = `${source?.id}:${state.table}:${group?.interpretationRevision}`;
  const currentKey = useRef(key); currentKey.current = key;
  const viewKey = `${source?.id}:${state.table}`;
  const [loadedKey, setLoadedKey] = useState("");
  const resultRef = useRef<HTMLDivElement | null>(null);
  const errorRef = useRef<HTMLParagraphElement | null>(null);
  const scrollTop = useRef(0), restoreTop = useRef<number | null>(null), restoreRow = useRef<number | null>(null);
  const lastView = useRef<MetricView>({ column: 0, span: [0, 0], rowIndex: 1, inspected: null, settings: false, scrollTop: 0, showWorst: false });
  if (loadedKey === key) lastView.current = { column, span, rowIndex, inspected: inspection?.row.index ?? restoreRow.current, settings, scrollTop: scrollTop.current, showWorst: worst.length > 0, worstKeyColumn: keyChoice, visibleColumns: visible, analysisTab: tab, pageStart, showSources, showInspector };
  const fail = (e: unknown) => state.setError(String(e));
  useLayoutEffect(() => {
    const saved = useMetrics.getState().views[viewKey];
    const view: MetricView = saved ?? { column: group?.columns.findIndex(c => c.numeric) ?? 0, span: [0, rows], rowIndex: 1, inspected: null, settings: false, scrollTop: 0, showWorst: false };
    setSpan(view.span); setInspection(null); setWorst([]); setGraph(null); setRowIndex(view.rowIndex); setSettings(view.settings);
    setColumns(group?.columns ?? []); setAxis(group?.axis ?? { kind: "ordinal", column: null, windowSeconds: null });
    setKeyChoice(view.worstKeyColumn ?? null); setBulkSelection([]);
    const numeric = group?.columns.map((c,i)=>({c,i})).filter(({c,i})=>c.numeric && i!==group.axis.column && !/^(elapsed|time|timestamp)(_|$)/i.test(c.name)) ?? [];
    const first = saved?.column ?? numeric[0]?.i ?? view.column;
    setColumn(first); setVisible(view.visibleColumns ?? numeric.filter(v=>v.c.unit===group?.columns[first]?.unit).slice(0,4).map(v=>v.i));
    setTab(view.analysisTab ?? tab); setPageStart(view.pageStart ?? 0);setShowSources(view.showSources ?? true);setShowInspector(view.showInspector ?? false);
    setLoadedKey(key); lastView.current = view;
    restoreTop.current = view.scrollTop; restoreRow.current = view.inspected; scrollTop.current = view.scrollTop;
    setJoin({ left: state.table, right: state.table === 0 ? 1 : 0, leftColumn: 0, rightColumn: 0, tolerance: null });
    rowSequence.current++;
    if (source && group && view.inspected !== null) void inspect(view.inspected, false);
    if (source && group && view.showWorst) void metricAction<MetricRow[]>({ op: "worst", id: source.id, table: state.table, column: view.column, start: view.span[0], end: view.span[1], count: 20 }).then(v => { if (currentKey.current === key) setWorst(v); }).catch(fail);
    return () => { if (group) state.saveView(viewKey, { ...lastView.current, scrollTop: scrollTop.current }); };
    // Metadata updates are the dependency; row payloads never participate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rows]);
  useLayoutEffect(() => {
    if (restoreTop.current !== null && graph && (restoreRow.current === null || inspection?.row.index === restoreRow.current)) {
      if (resultRef.current) resultRef.current.scrollTop = restoreTop.current;
      restoreTop.current = null; restoreRow.current = null;
    }
  }, [graph, inspection]);
  useEffect(() => { if (state.error || source?.error) errorRef.current?.scrollIntoView({ block: "nearest" }); }, [state.error, source?.error]);
  useEffect(() => {
    const sequence = ++graphSequence.current;
    if (!source || !ready || loadedKey !== key || column < 0 || span[0] >= span[1]) return;
    setGraph(null);setCharts([]);
    const chosen = [...new Set([column,...visible])].filter(i=>group?.columns[i]?.numeric).slice(0,8);
    void Promise.all(chosen.map(i=>metricAction<MetricGraph>({ op: "graph", id: source.id, table: state.table, column:i, start: span[0], end: span[1] })))
      .then(g => { if (sequence === graphSequence.current) {setGraph(g[0]);setCharts(g);} }).catch(e => { if (sequence === graphSequence.current) fail(e); });
    return () => { graphSequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadedKey, ready, column, visible.join(","), span[0], span[1]]);
  const inspect = async (index: number, reveal = true) => {
    if (!source) return;
    state.setError("");
    const seq = ++rowSequence.current;
    try {
      const result = await metricAction<MetricInspection>({ op: "row", id: source.id, table: state.table, row: index });
      if (seq === rowSequence.current) { setInspection(result); setRowIndex(index + 1);if(reveal){setPageStart(Math.floor(index/50)*50);setShowInspector(true);} }
    } catch (e) { if (seq === rowSequence.current) fail(e); }
  };
  const chooseFiles = async (snapshot: boolean) => {
    try {
      const result = await open({ multiple: !snapshot, filters: [{ name: snapshot ? "Metric snapshot" : "Metric CSV", extensions: snapshot ? ["crmetrics"] : ["csv"] }] });
      if (result) void state.start(Array.isArray(result) ? result : [result], snapshot);
    } catch (e) { fail(e); }
  };
  const persist = async (path: string) => {
    if (!source) return;
    setPending(true); state.setError("");
    try {
      await metricAction({ op: "save", id: source.id, path, ranges: source.rows.map((n, i) => i === state.table ? span : [0, n]) });
      setNotice(`Immutable snapshot saved: ${path}. Selected rows in this group; all retained rows in companion groups.`);
    } catch (e) { fail(e); }
    finally { setPending(false); }
  };
  const saveDialog = async () => {
    try {
      const path = await save({ defaultPath: `${filename(group?.path ?? "metrics").replace(/\.[^.]*$/, "")}-${new Date().toISOString().replace(/[:.]/g, "-")}.crmetrics`, filters: [{ name: "Metric snapshot", extensions: ["crmetrics"] }] });
      if (path) await persist(path);
    } catch (e) { fail(e); }
  };
  const changeView = (start: number, end: number) => {
    const a = Math.max(0, Math.min(rows - 1, Math.round(start)));
    const b=Math.max(a+1,Math.min(rows,Math.round(end)));
    rowSequence.current++;setSpan([a,b]); setPageStart(a);setWorst([]);if(inspection && (inspection.row.index<a||inspection.row.index>=b)){setInspection(null);rowSequence.current++;}
  };
  const coverage = group?.coverage;
  const duration = group?.axis.windowSeconds;
  const xLabel = group?.axis.kind === "ordinal" ? "Retained row ordinal · not time" : `${group?.axis.kind} seconds · ${group?.columns[group.axis.column ?? 0]?.name}`;
  const rowKey = worstKeyColumn(group?.columns ?? [], group?.axis ?? axis, keyChoice);
  const axisKey = group?.axis.kind !== "ordinal" && rowKey !== null && rowKey === group?.axis.column;
  const keyHeading = rowKey === null ? "Key value" : `${group?.columns[rowKey]?.name} · ${axisKey ? `${group?.axis.kind === "elapsed" ? "s" : "ISO 8601"} (axis)` : group?.columns[rowKey]?.unit}`;
  const bulkApply = async () => {
    if (!source) return;
    setPending(true); state.setError("");
    try {
      await metricAction({ op: "bulkInterpret", id: source.id, table: state.table, selection: bulkScope === "unitless" ? null : bulkSelection, unit: bulkUnit, meaning: bulkMeaning || null });
      await state.refresh(source.id); setNotice("Bulk interpretation applied. Existing snapshots are unchanged.");
    } catch (e) { fail(e); } finally { setPending(false); }
  };
  useEffect(()=>{
    let alive=true;if(!source||!ready||loadedKey!==key)return;
    const start=Math.max(span[0],Math.min(pageStart,span[1]-1));
    void metricAction<MetricRow[]>({op:"page",id:source.id,table:state.table,start,count:Math.min(50,span[1]-start)}).then(v=>{if(alive)setPageRows(v);}).catch(fail);
    return()=>{alive=false;};
  },[key,loadedKey,ready,pageStart,span[0],span[1]]);
  const joinKey=JSON.stringify(source?.joins??[]);
  useEffect(()=>{if(loadedKey===key&&inspection)void inspect(inspection.row.index,false);},[joinKey]);
  const pickPoint=async(x:number)=>{
    if(!source)return;const n=++rowSequence.current;
    try{const result=await metricAction<MetricInspection>({op:"nearest",id:source.id,table:state.table,start:span[0],end:span[1],x});
      if(n===rowSequence.current){setInspection(result);setRowIndex(result.row.index+1);setPageStart(Math.floor(result.row.index/50)*50);setShowInspector(true);}}
    catch(e){if(n===rowSequence.current)fail(e);}
  };
  const rank=async()=>{if(!source)return;state.setError("");const k=key;try{const values=await metricAction<MetricRow[]>({op:"worst",id:source.id,table:state.table,column,start:span[0],end:span[1],count:20});if(currentKey.current===k){setWorst(values);setTab("Largest values");}}catch(e){fail(e);}};
  const renderRow = (r: MetricRow, cols: MetricColumn[]) => <dl className="metric-row">{cols.map((c, i) => <div key={c.name}><dt>{c.name} <small>{c.unit}{c.unitSuggested ? " (suggested)" : ""} · {c.meaning}{c.meaningSuggested ? " (suggested)" : ""}</small></dt><dd><MetricCell value={r.cells[i]} /></dd></div>)}</dl>;
  const plotted=charts.filter(g=>visible.includes(g.column));
  const units=[...new Set(plotted.map(g=>group?.columns[g.column]?.unit ?? "unitless"))];
  const issues=(coverage?.invalid??0)+(coverage?.unsupported??0);
  return <section className="metric-import-panel profiler-panel analysis-panel metric-workbench" aria-label="Imported metric sources">
    <header className="analysis-toolbar profiler-toolbar"><div className="analysis-title"><strong>{group?filename(group.path):"Imported measurements"}</strong><span>{group?`${rows.toLocaleString()} retained rows · ${group.completion}${group.snapshot?" · immutable snapshot":""}`:"Explore a program's recorded numbers"}</span></div>
      <button disabled={state.busy} onClick={()=>void chooseFiles(false)}>Import CSV files…</button><button disabled={state.busy} onClick={()=>void chooseFiles(true)}>Open metric snapshot…</button><button disabled={!ready||pending} onClick={()=>void saveDialog()}>Save metric snapshot…</button>
    </header>
    {state.error&&<p className="analysis-alert" role="alert" ref={errorRef}>{state.error}</p>}{notice&&<p className="metric-notice" role="status">{notice}<button aria-label="Dismiss metric notice" onClick={()=>setNotice("")}>×</button></p>}
    {source?.state==="loading"&&<div role="status" className="analysis-progress" aria-label="Metric import progress"><progress max={source.totalBytes||1} value={source.bytesRead}/>{source.bytesRead.toLocaleString()} / {source.totalBytes.toLocaleString()} bytes<button onClick={()=>void metricAction({op:"cancel",id:source.id}).catch(fail)}>Cancel import</button></div>}
    {source?.error&&<p role="alert" className="analysis-alert">{source.state}: {source.error}</p>}
    <nav className="analysis-tabs" aria-label="Metric analysis views">{["Time series","Largest values","Rows","Column meanings","Import issues","File details"].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>{setTab(t);if(t==="Largest values")void rank();}}>{t}{t==="Import issues"&&issues?` (${issues})`:""}</button>)}</nav>
    <div className="metric-workspace profiler-results" ref={resultRef}>
      {showSources&&<aside className="analysis-sources metric-sources" aria-label="Metric sources and columns">
       <header><strong>Sources</strong><button aria-label="Collapse metric sources" onClick={()=>setShowSources(false)}>‹</button></header>
       {!!state.sources.length&&<label>Source set<select aria-label="Metric source set" value={state.selected} title={source?.paths.join("\n")} onChange={e=>state.choose(e.target.value)}>{state.sources.map(v=><option key={v.id} value={v.id}>{filename(v.paths[0]??"Import")} · {v.state}</option>)}</select></label>}
       <div className="metric-file-list">{source?.tables.map((g,i)=><button key={i} className={`analysis-source ${state.table===i?"is-selected":""}`} aria-pressed={state.table===i} onClick={()=>state.setTable(i)}><strong>{filename(g.path)}</strong><span>{(source.rows[i]??0).toLocaleString()} rows · {g.columns.length} columns</span><small>{g.completion}{g.coverage.invalid||g.coverage.unsupported?" · import issues":""}</small></button>)}</div>
       {group&&<><header><strong>Columns</strong><span>{visible.length}/8 shown</span></header><input className="metric-column-search" aria-label="Search metric columns" placeholder="Search columns…" value={search} onChange={e=>setSearch(e.target.value)}/><p className="analysis-muted">Units marked * are suggestions.</p><div className="metric-column-list">{group.columns.map((c,i)=>c.numeric&&c.name.toLowerCase().includes(search.toLowerCase())&&<label key={i} title={`${c.name} · ${c.unit} · ${c.meaning}${c.meaningSuggested?" (suggested)":""}`}><input type="checkbox" aria-label={`Plot ${c.name}`} checked={visible.includes(i)} disabled={!visible.includes(i)&&visible.length>=8} onChange={e=>{const next=e.target.checked?[...visible,i]:visible.filter(v=>v!==i);setVisible(next);if(e.target.checked&&!visible.length)setColumn(i);}}/><span className="metric-swatch" style={{background:palette[i%palette.length]}}/><span>{c.name}<small>{c.unit}{c.unitSuggested?" *":""} · {c.meaning}{c.meaningSuggested?" *":""}</small></span></label>)}</div></>}
      </aside>}
      <main className="metric-analysis">
       {!showSources&&<button className="metric-show-sources" onClick={()=>setShowSources(true)}>Sources & columns ›</button>}
       {!source&&<div className="metric-empty analysis-empty"><h2>Explore recorded measurements</h2><p>Open a finished CSV or a set of companion files. See the measurements, find large values and inspect the original rows.</p><button className="analysis-primary" onClick={()=>void chooseFiles(false)}>Choose CSV files…</button><p>No process connection required. Live follow comes later.</p></div>}
       {group&&<>
        {tab==="Time series"&&ready&&<>
         <div className="metric-range-toolbar"><button onClick={()=>changeView(0,rows)}>Full file</button><button onClick={()=>changeView(span[0]-(span[1]-span[0])/2,span[1]-(span[1]-span[0])/2)}>Pan left</button><button onClick={()=>changeView(span[0]+(span[1]-span[0])/2,span[1]+(span[1]-span[0])/2)}>Pan right</button><button onClick={()=>changeView(span[0]+(span[1]-span[0])/4,span[1]-(span[1]-span[0])/4)}>Zoom in</button><button onClick={()=>changeView(span[0]-(span[1]-span[0])/2,span[1]+(span[1]-span[0])/2)}>Zoom out</button><button aria-expanded={showInspector} onClick={()=>setShowInspector(!showInspector)}>Row details</button><button onClick={()=>setTab("Column meanings")}>Interpretation and joins</button></div>
         <div className="metric-axis-caption"><strong>{xLabel}</strong><span>Rows {span[0]+1}–{span[1]} · {duration?`Declared window ${duration} s`:"Window duration unknown"} · No session clock mapping</span></div>
         <div className="metric-tracks" aria-busy={!graph}>{units.map(unit=><MetricChart key={unit} graphs={plotted.filter(g=>group.columns[g.column].unit===unit)} columns={group.columns} axis={group.axis.kind} unit={unit} window={duration??null} selected={inspection?.row??null} onPick={x=>void pickPoint(x)} onRange={(a,b)=>{if(!source||!graph)return;const requestKey=key;void Promise.all([a,b].map(f=>metricAction<MetricInspection>({op:"nearest",id:source.id,table:state.table,start:span[0],end:span[1],x:graph.xStart+f*(graph.xEnd-graph.xStart)}))).then(([left,right])=>{if(currentKey.current===requestKey)changeView(left.row.index,right.row.index+1);}).catch(fail);}}/>)}{!plotted.length&&<p className="analysis-empty">Select a numeric column to plot. Different units appear in separate tracks.</p>}</div>
         <div className="metric-range-inputs"><label>First row<input aria-label="Metric range first row" type="number" min={1} max={rows} value={span[0]+1} onChange={e=>changeView(Number(e.target.value)-1,span[1])}/></label><input aria-label="Metric range overview start" type="range" min={0} max={Math.max(0,rows-1)} value={span[0]} onChange={e=>changeView(Number(e.target.value),span[1])}/><input aria-label="Metric range overview end" type="range" min={1} max={rows} value={span[1]} onChange={e=>changeView(span[0],Number(e.target.value))}/><label>Last row<input aria-label="Metric range last row" type="number" min={1} max={rows} value={span[1]} onChange={e=>changeView(span[0],Number(e.target.value))}/></label></div>
         <p className="metric-graph-note">Points / extrema bands preserve bucket minima and maxima. Click for the nearest original row; drag to select rows. No percentile aggregation. * Suggested units/meanings are editable in Column meanings.</p>
        </>}
        {tab==="Largest values"&&ready&&<div className="metric-ranking"><div className="analysis-field-row"><label>Rank by<select aria-label="Metric series" value={column} onChange={e=>{setColumn(Number(e.target.value));setWorst([]);}}>{group.columns.map((c,i)=>c.numeric&&<option key={i} value={i}>{c.name} · {c.unit}</option>)}</select></label><button onClick={()=>void rank()}>Find worst windows / largest values</button><label>Row key<select aria-label="Metric worst key" disabled={axisKey} value={axisKey?String(rowKey):keyChoice===null?"auto":String(keyChoice)} onChange={e=>setKeyChoice(e.target.value==="auto"?null:Number(e.target.value))}><option value="auto">Auto · time / elapsed column</option>{group.columns.map((c,i)=><option key={i} value={i}>{c.name}</option>)}</select></label></div><p className="analysis-muted">{duration?"Worst declared windows":"Largest retained values · window duration unknown"}. Ranking asserts no cause or performance verdict.</p><table className="analysis-table" aria-label="Worst metric windows"><thead><tr><th>Original row</th><th>{keyHeading}</th><th>{group.columns[column]?.name} · {group.columns[column]?.unit}</th></tr></thead><tbody>{worst.map(r=><tr key={r.index} className={inspection?.row.index===r.index?"is-selected":""}><td><button onClick={()=>void inspect(r.index)}>Row {r.index+1}</button></td><td>{rowKey===null?"No key selected":<MetricCell value={worstKeyValue(r,group.axis,rowKey)}/>}</td><td>{cell(r.cells[column])}</td></tr>)}</tbody></table></div>}
        {tab==="Import issues"&&<div className="metric-document"><h3>Import integrity</h3><dl className="analysis-facts" aria-label="Metric integrity">{[["Retained rows",rows],["Invalid records",coverage?.invalid??0],["Unsupported records",coverage?.unsupported??0],["Empty cells",coverage?.emptyCells??0],["Missing fields",coverage?.missingColumns??0],["Unterminated records",coverage?.unterminated??0]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{Number(v).toLocaleString()}</dd></div>)}</dl><p>Invalid rows are skipped as entire records. Empty cells count retained rows. Quoted multiline records are unsupported.</p>{coverage?.examples.map((v,i)=><p key={i}>{v}</p>)}{!issues&&<p>No rejected records reported.</p>}</div>}
        {tab==="File details"&&<div className="metric-document"><h3>Source and provenance</h3><dl className="analysis-facts">{[["Path",group.path],["Source",group.sourceId],["Generation",group.generation],["File size",`${group.size.toLocaleString()} bytes`],["Modified",new Date(group.modifiedMs).toISOString()],["SHA-256",group.sha256],["Interpretation revision",group.interpretationRevision],["Snapshot",group.snapshot?"Immutable copy · original file not required":"Finished file import"]].map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="metric-snapshot-scope">Snapshot scope: rows {span[0]+1}–{span[1]} in this file; all retained rows in companion groups. Includes original values, interpretation and provenance.</p><p>Limits: 2 source sets/window, 8 files/set, 1 GiB/file set, 512 MiB retained/set, 2,000,000 rows/file, 128 columns, 1 MiB/line.</p><button onClick={()=>void state.remove(state.selected).catch(fail)}>Remove source set</button></div>}
          {tab === "Column meanings" && <div className="metric-settings"><p>{group.snapshot ? "Snapshot interpretation and join rules are immutable." : "First nonempty value determines numeric/text storage. Units and statistic suffixes are suggestions; ambiguous names are kept literally. Edits never change existing snapshots."}</p>
            <label>Axis<select aria-label="Metric clock domain" disabled={group.snapshot} value={axis.kind} onChange={e => setAxis({ ...axis, kind: e.target.value as MetricAxis["kind"], windowSeconds: null })}>{["ordinal", "elapsed", "epoch", "iso8601"].map(k => <option key={k}>{k}</option>)}</select></label>
            {axis.kind !== "ordinal" && <><label>Time column<select aria-label="Metric time column" disabled={group.snapshot} value={axis.column ?? ""} onChange={e => setAxis({ ...axis, column: Number(e.target.value) })}><option value="" disabled>Choose column</option>{columns.map((c, i) => <option value={i} key={i}>{c.name}</option>)}</select></label>
              <label>Declared window duration (seconds; blank = unknown)<input aria-label="Metric window seconds" type="number" min="0" step="any" disabled={group.snapshot} value={axis.windowSeconds ?? ""} onChange={e => setAxis({ ...axis, windowSeconds: e.target.value === "" ? null : Number(e.target.value) })} /></label></>}
            <fieldset disabled={group.snapshot || pending}><legend>Bulk column interpretation</legend>
              <label>Apply to<select aria-label="Metric bulk scope" value={bulkScope} onChange={e => setBulkScope(e.target.value)}><option value="unitless">All unitless numeric columns in this file group</option><option value="selected">Selected numeric columns</option></select></label>
              <label>Unit<input aria-label="Metric bulk unit" disabled={group.snapshot || pending} value={bulkUnit} onChange={e => setBulkUnit(e.target.value)} /></label>
              <label>Meaning<select aria-label="Metric bulk meaning" value={bulkMeaning} onChange={e => setBulkMeaning(e.target.value)}><option value="">Keep each column's meaning</option>{["unknown", "gauge", "counter", "rate", "window statistic"].map(m => <option key={m}>{m}</option>)}</select></label>
              <button disabled={bulkScope === "selected" && !bulkSelection.length} onClick={() => void bulkApply()}>Apply bulk interpretation</button>
              <p>Applies one explicit edit to the saved interpretation, preserving its current axis and other columns. Individual unsaved draft edits are not included.</p>
            </fieldset>
            <table aria-label="Metric column interpretation"><thead><tr><th>Select</th><th>Column</th><th>Unit</th><th>Meaning</th></tr></thead><tbody>{columns.map((c, i) => <tr key={c.name}>
              <td><input type="checkbox" aria-label={`Select column ${c.name}`} disabled={group.snapshot || !c.numeric || pending} checked={bulkSelection.includes(i)} onChange={e => setBulkSelection(e.target.checked ? [...bulkSelection, i] : bulkSelection.filter(v => v !== i))} /></td>
              <td>{c.name} · {c.numeric ? "numeric" : "text"}</td><td><input aria-label={`Unit ${c.name}`} disabled={group.snapshot} value={c.unit} onChange={e => setColumns(columns.map((v, j) => j === i ? { ...v, unit: e.target.value, unitSuggested: false } : v))} />{c.unitSuggested && <small>Suggested from column name</small>}</td>
              <td><select aria-label={`Meaning ${c.name}`} disabled={group.snapshot} value={c.meaning} onChange={e => setColumns(columns.map((v, j) => j === i ? { ...v, meaning: e.target.value as MetricColumn["meaning"], meaningSuggested: false } : v))}>{["unknown", "gauge", "counter", "rate", "window statistic"].map(m => <option key={m}>{m}</option>)}</select>{c.meaningSuggested && <small>Suggested from statistic suffix</small>}</td>
            </tr>)}</tbody></table>
            <button disabled={group.snapshot || pending} onClick={async () => { setPending(true); state.setError(""); try { await metricAction({ op: "interpret", id: source.id, table: state.table, columns, axis }); await state.refresh(source.id); setNotice("Interpretation applied. Existing snapshots are unchanged."); } catch (e) { fail(e); } finally { setPending(false); } }}>Apply interpretation</button>
            {source.tables.length > 1 && <fieldset disabled={group.snapshot}><legend>Declared companion join</legend>
              <label>Companion group<select aria-label="Metric join group" value={join.right} onChange={e => setJoin({ ...join, right: Number(e.target.value), rightColumn: 0 })}>{source.tables.map((t, i) => i !== state.table && <option key={i} value={i}>{filename(t.path)}</option>)}</select></label>
              <label>Key in this group<select aria-label="Metric left key" value={join.leftColumn} onChange={e => setJoin({ ...join, leftColumn: Number(e.target.value) })}>{group.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}</select></label>
              <label>Key in companion<select aria-label="Metric right key" value={join.rightColumn} onChange={e => setJoin({ ...join, rightColumn: Number(e.target.value) })}>{source.tables[join.right]?.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}</select></label>
              <label>Numeric tolerance in key units (blank = exact)<input aria-label="Metric join tolerance" type="number" min="0" step="any" value={join.tolerance ?? ""} onChange={e => setJoin({ ...join, tolerance: e.target.value === "" ? null : Number(e.target.value) })} /></label>
              <button onClick={async () => { state.setError(""); try { await metricAction({ op: "join", id: source.id, rules: [...source.joins.filter(r => r.left !== state.table || r.right !== join.right), join] }); await state.refresh(source.id); setInspection(null); setNotice("Declared join saved. Missing or ambiguous matches remain unjoined."); } catch (e) { fail(e); } }}>Set join rule</button>
              <button onClick={async () => { state.setError(""); try { await metricAction({ op: "join", id: source.id, rules: source.joins.filter(r => r.left !== state.table) }); await state.refresh(source.id); setInspection(null); } catch (e) { fail(e); } }}>Clear this group's joins</button>
            </fieldset>}
            <p>{source.joins.length} declared join rules. Unmatched files are unjoined; grouping does not align clocks.</p>
            <ul className="metric-join-rules">{source.joins.map((r, i) => <li key={i}>{filename(source.tables[r.left].path)} [{source.tables[r.left].columns[r.leftColumn].name}] ↔ {filename(source.tables[r.right].path)} [{source.tables[r.right].columns[r.rightColumn].name}] · {r.tolerance === null ? "exact key" : `±${r.tolerance} ${source.tables[r.left].columns[r.leftColumn].unit}`}</li>)}</ul>
          </div>}

       </>}
       {(tab==="File details"||!source)&&<div className="metric-document">      <details className="metric-paths" open={tab === "File details" || !source}><summary>Import or save by path</summary>
        <label>CSV paths · one per line<textarea aria-label="Metric import paths" value={paths} onChange={e => setPaths(e.target.value)} /></label>
        <button disabled={state.busy || !paths.trim()} onClick={() => void state.start(paths.split("\n").map(s => s.trim()).filter(Boolean))}>Import paths</button>
        <button disabled={state.busy || !paths.trim()} onClick={() => void state.start([paths.trim()], true)}>Open snapshot path</button>
        <label>New snapshot path<input aria-label="Metric snapshot path" value={savePath} onChange={e => setSavePath(e.target.value)} /></label>
        <button disabled={!ready || pending || !savePath} onClick={() => void persist(savePath)}>Save snapshot path</button>
      </details>
</div>}
       {ready&&(tab==="Time series"||tab==="Rows")&&<div className={`metric-row-dock ${tab==="Rows"?"is-full":""}`}><header><strong>Rows</strong><span title="Long text is previewed; inspect a row for its complete original cells.">{span[1]-span[0]} in range</span><label>Go to row<input aria-label="Metric row number" type="number" min={1} max={rows} value={rowIndex} onChange={e=>setRowIndex(Number(e.target.value))} onKeyDown={e=>{if(e.key==="Enter")void inspect(rowIndex-1);}}/></label><button onClick={()=>void inspect(rowIndex-1)}>Inspect row</button></header><div className="metric-table-scroll"><table className="analysis-table" aria-label="Original metric rows"><thead><tr><th>Row</th>{group.columns.map((c,i)=><th key={i}>{c.name}<small>{c.unit}{c.unitSuggested?" *":""}</small></th>)}</tr></thead><tbody>{pageRows.map(r=><tr key={r.index} className={inspection?.row.index===r.index?"is-selected":""} aria-selected={inspection?.row.index===r.index}><td><button onClick={()=>void inspect(r.index)}>Row {r.index+1}</button></td>{r.cells.map((v,i)=><td key={i} title={r.truncatedColumns?.includes(i)?"Text preview · inspect this row for the full original value":undefined}>{typeof v==="string"&&v.length>80?<span title={v}>{v.slice(0,80)}…</span>:cell(v)}</td>)}</tr>)}</tbody></table></div><footer><span>{rows.toLocaleString()} retained · showing {pageRows[0]?.index!==undefined?pageRows[0].index+1:0}–{pageRows[pageRows.length-1]?.index!==undefined?pageRows[pageRows.length-1]!.index+1:0}</span><button disabled={pageStart<=span[0]} onClick={()=>setPageStart(Math.max(span[0],pageStart-50))}>Previous 50</button><button disabled={Math.max(span[0],pageStart)+50>=span[1]} onClick={()=>setPageStart(Math.min(span[1]-1,Math.max(span[0],pageStart)+50))}>Next 50</button></footer></div>}
      </main>
      {showInspector&&group&&<aside className="metric-inspector" aria-label="Inspected metric row"><header><strong>Row details</strong><button aria-label="Close metric row details" onClick={()=>setShowInspector(false)}>×</button></header>{inspection?<><h3>Row {inspection.row.index+1} · CSV line {inspection.row.line}</h3><p>{xLabel}: {format(inspection.row.x)}</p>{renderRow(inspection.row,group.columns)}{source.tables.length>1&&!inspection.companions.length&&<p>Companions unjoined: declare a named-key rule in Column meanings.</p>}{inspection.companions.map(c=><section key={c.table}><h3>{filename(source.tables[c.table].path)} · {c.state}</h3>{c.row?renderRow(c.row,source.tables[c.table].columns):<p>Unjoined; no unique match.</p>}</section>)}</>:<p>Click the chart or an original row to inspect every column and any declared companions.</p>}</aside>}
    </div>
  </section>;
}

function MetricChart({graphs,columns,axis,unit,window:windowSeconds,selected,onPick,onRange}:{graphs:MetricGraph[];columns:MetricColumn[];axis:string;unit:string;window:number|null;selected:MetricRow|null;onPick:(x:number)=>void;onRange:(a:number,b:number)=>void}) {
 const drag=useRef<number|null>(null), [selection,setSelection]=useState<[number,number]|null>(null);
 const points=graphs.flatMap(g=>g.points),low=Math.min(...points.map(p=>p.min)),high=Math.max(...points.map(p=>p.max));
 const g=graphs[0];if(!g)return null;
 const duration=graphs.some(v=>columns[v.column].meaning==="window statistic")?windowSeconds:null;
 const end=g.xEnd+(duration??0),width=end-g.xStart;
 const x=(v:number)=>60+(width?(v-g.xStart)/width:0.5)*910;
 const y=(v:number)=>high===low?105:170-(v-low)/(high-low)*150;
 const axisValue=(v:number)=>axis==="epoch"||axis==="iso8601"?new Date(v*1000).toISOString():format(v);
 const fraction=(e:React.PointerEvent<SVGSVGElement>)=>{const r=e.currentTarget.getBoundingClientRect();return Math.max(0,Math.min(1,((e.clientX-r.left)/r.width*1000-60)/910));};
 const id=`metric-chart-description-${unit.replace(/[^a-z0-9]/gi,"")}`;
 return <figure className="profiler-chart metric-chart" aria-label="Imported metric timeline"><figcaption id={id}><strong>{unit}{graphs.some(v=>columns[v.column].unitSuggested)?" *":""}</strong><span>{graphs.map(v=><span key={v.column} style={{color:palette[v.column%palette.length]}}>{columns[v.column].name} </span>)}</span></figcaption>
  <svg role="img" aria-label="Metric range graph" aria-describedby={id} data-start={g.start} data-end={g.end} data-column={g.column} viewBox="0 0 1000 210" preserveAspectRatio="none" onPointerDown={e=>{drag.current=fraction(e);e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(drag.current!==null)setSelection([drag.current,fraction(e)]);}} onPointerUp={e=>{const a=drag.current,b=fraction(e);drag.current=null;setSelection(null);if(a===null)return;if(Math.abs(b-a)>.015){onRange(Math.min(a,b),Math.max(a,b));}else onPick(g.xStart+b*(g.xEnd-g.xStart));}} onPointerCancel={()=>{drag.current=null;setSelection(null);}}>
   {[0,.25,.5,.75,1].map(t=><g key={t}><line x1={60} x2={970} y1={20+t*150} y2={20+t*150} stroke="#35414f"/><text x={50} y={24+t*150} textAnchor="end" fill="#a8b9cb" fontSize={11}>{format(high-(high-low)*t)}</text></g>)}
   {graphs.map(v=><g key={v.column}>{v.points.map((p,i)=>columns[v.column].meaning==="window statistic"&&duration?<rect key={i} x={x(p.x)} y={y(p.max)} width={Math.max(2,x(p.until+duration)-x(p.x))} height={Math.max(2,y(p.min)-y(p.max))} fill={palette[v.column%palette.length]} opacity={.75}/>:<line key={i} x1={x((p.x+p.until)/2)} x2={x((p.x+p.until)/2)} y1={y(p.max)} y2={y(p.min)+2} stroke={palette[v.column%palette.length]} strokeWidth={2.5} strokeLinecap="round" vectorEffect="non-scaling-stroke"/>)}</g>)}
   {selected&&selected.index>=g.start&&selected.index<g.end&&<line x1={x(selected.x)} x2={x(selected.x)} y1={16} y2={175} stroke="#ecf5ff" strokeDasharray="4 3" vectorEffect="non-scaling-stroke"/>}
   {selection&&<rect x={60+Math.min(...selection)*910} y={16} width={Math.abs(selection[1]-selection[0])*910} height={160} fill="#579fea" opacity={.2}/>}
   {[0,.25,.5,.75,1].map(t=><text key={t} x={60+t*910} y={198} textAnchor={t===0?"start":t===1?"end":"middle"} fill="#a8b9cb" fontSize={11}>{axisValue(g.xStart+(g.xEnd-g.xStart)*t)}</text>)}
  </svg>
 </figure>;
}

function MetricCell({ value }: { value: number | string | null }) {
  if (typeof value !== "string" || value.length <= 160) return <>{cell(value)}</>;
  return <details className="metric-long-value"><summary>{value.slice(0, 90)}… <span>Show full value</span></summary><div>{value}</div></details>;
}
