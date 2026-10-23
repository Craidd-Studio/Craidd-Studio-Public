import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { metricAction, useMetrics, type MetricView } from "../../store/metricStore";
import type { MetricAxis, MetricColumn, MetricGraph, MetricInspection, MetricJoin, MetricRow } from "../../types/profileSource";

import { worstKeyColumn, worstKeyValue } from "../../lib/metricRowKey";

const filename = (path: string) => path.split("/").pop() ?? path;
const cell = (value: number | string | null) => value === null || value === "" ? "Empty" : String(value);
const format = (value: number) => Number.isInteger(value) ? String(value) : value.toPrecision(7);

export default function MetricImportPanel() {
  const state = useMetrics();
  const source = state.sources.find(s => s.id === state.selected);
  const group = source?.tables[state.table];
  const rows = source?.rows[state.table] ?? 0;
  const ready = !!group && rows > 0;
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
  if (loadedKey === key) lastView.current = { column, span, rowIndex, inspected: inspection?.row.index ?? restoreRow.current, settings, scrollTop: scrollTop.current, showWorst: worst.length > 0, worstKeyColumn: keyChoice };
  const fail = (e: unknown) => state.setError(String(e));
  useLayoutEffect(() => {
    const saved = useMetrics.getState().views[viewKey];
    const view: MetricView = saved ?? { column: group?.columns.findIndex(c => c.numeric) ?? 0, span: [0, rows], rowIndex: 1, inspected: null, settings: false, scrollTop: 0, showWorst: false };
    setSpan(view.span); setInspection(null); setWorst([]); setGraph(null); setRowIndex(view.rowIndex); setSettings(view.settings);
    setColumns(group?.columns ?? []); setAxis(group?.axis ?? { kind: "ordinal", column: null, windowSeconds: null });
    setKeyChoice(view.worstKeyColumn ?? null); setBulkSelection([]);
    setColumn(view.column); setLoadedKey(key); lastView.current = view;
    restoreTop.current = view.scrollTop; restoreRow.current = view.inspected; scrollTop.current = view.scrollTop;
    setJoin({ left: state.table, right: state.table === 0 ? 1 : 0, leftColumn: 0, rightColumn: 0, tolerance: null });
    rowSequence.current++;
    if (source && group && view.inspected !== null) void inspect(view.inspected);
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
    setGraph(null);
    void metricAction<MetricGraph>({ op: "graph", id: source.id, table: state.table, column, start: span[0], end: span[1] })
      .then(g => { if (sequence === graphSequence.current) setGraph(g); }).catch(e => { if (sequence === graphSequence.current) fail(e); });
    return () => { graphSequence.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, loadedKey, ready, column, span[0], span[1]]);
  const inspect = async (index: number) => {
    if (!source) return;
    state.setError("");
    const seq = ++rowSequence.current;
    try {
      const result = await metricAction<MetricInspection>({ op: "row", id: source.id, table: state.table, row: index });
      if (seq === rowSequence.current) { setInspection(result); setRowIndex(index + 1); }
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
    setSpan([a, Math.max(a + 1, Math.min(rows, Math.round(end)))]); setWorst([]);
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
  const renderRow = (r: MetricRow, cols: MetricColumn[]) => <dl className="metric-row">{cols.map((c, i) => <div key={c.name}><dt>{c.name} <small>{c.unit}{c.unitSuggested ? " (suggested)" : ""} · {c.meaning}{c.meaningSuggested ? " (suggested)" : ""}</small></dt><dd><MetricCell value={r.cells[i]} /></dd></div>)}</dl>;
  return <section className="metric-import-panel profiler-panel" aria-label="Imported metric sources">
    <div className="profiler-toolbar">
      <button disabled={state.busy} onClick={() => void chooseFiles(false)}>Import CSV files…</button>
      <button disabled={state.busy} onClick={() => void chooseFiles(true)}>Open metric snapshot…</button>
      <button disabled={!ready || pending} title="Save a new immutable snapshot. Existing files are never replaced." onClick={() => void saveDialog()}>Save metric snapshot…</button>
    </div>
    <div className="profiler-results" ref={resultRef} onScroll={e => { scrollTop.current = e.currentTarget.scrollTop; }}>
      <details className="metric-paths"><summary>Import or save by path</summary>
        <label>CSV paths · one per line<textarea aria-label="Metric import paths" value={paths} onChange={e => setPaths(e.target.value)} /></label>
        <button disabled={state.busy || !paths.trim()} onClick={() => void state.start(paths.split("\n").map(s => s.trim()).filter(Boolean))}>Import paths</button>
        <button disabled={state.busy || !paths.trim()} onClick={() => void state.start([paths.trim()], true)}>Open snapshot path</button>
        <label>New snapshot path<input aria-label="Metric snapshot path" value={savePath} onChange={e => setSavePath(e.target.value)} /></label>
        <button disabled={!ready || pending || !savePath} onClick={() => void persist(savePath)}>Save snapshot path</button>
      </details>
      {state.error && <p role="alert" ref={errorRef}>{state.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!source && <div className="metric-empty"><h3>Explore recorded metrics</h3><p>Choose a finished CSV, or select related files from the same run. Inspect values, find the largest observations and save a portable snapshot.</p><p>No process connection is required. Live follow is not available yet.</p><button disabled={state.busy} onClick={() => void chooseFiles(false)}>Choose CSV files…</button></div>}
      {!!state.sources.length && <div className="metric-controls"><label>Source set<select aria-label="Metric source set" title={source?.paths.join("\n")} value={state.selected} onChange={e => state.choose(e.target.value)}>{state.sources.map(s => <option key={s.id} value={s.id}>{filename(s.paths[0] ?? s.tables[0]?.path ?? "Metric import")} · {s.state}</option>)}</select></label>
        <button title="Unload this set. Producer files are kept. Save a snapshot to keep the current interpretation." onClick={() => void state.remove(state.selected).catch(fail)}>Remove source set</button></div>}
      {source?.state === "loading" && <div role="status" aria-label="Metric import progress"><progress max={source.totalBytes || 1} value={source.bytesRead} /> {source.bytesRead.toLocaleString()} / {source.totalBytes.toLocaleString()} bytes
        <button onClick={() => void metricAction({ op: "cancel", id: source.id }).catch(fail)}>Cancel import</button></div>}
      {source?.error && <p role="alert" ref={errorRef}>{source.state}: {source.error}</p>}
      {!!source?.tables.length && <>
        <div className="metric-controls"><label>File group<select aria-label="Metric file group" value={state.table} onChange={e => state.setTable(Number(e.target.value))}>{source.tables.map((t, i) => <option key={i} value={i}>{filename(t.path)} · {t.snapshot ? "Snapshot" : "Imported"} · generation {t.generation}</option>)}</select></label>
          <button aria-expanded={settings} onClick={() => setSettings(!settings)}>Interpretation and joins</button></div>
        {group && <>
          <div className="metric-source-heading"><h3 title={group.path}>{filename(group.path)}</h3><span>{group.snapshot ? "Saved snapshot" : "Finished import"} · {group.completion}</span></div>
          <dl className="metric-integrity" aria-label="Metric integrity">{[["Retained rows", rows], ["Invalid records", coverage?.invalid ?? 0], ["Unsupported records", coverage?.unsupported ?? 0], ["Empty cells", coverage?.emptyCells ?? 0]].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}</dl>
          <details><summary>Provenance and diagnostics</summary><p>{group.path} · source {group.sourceId} · {group.size.toLocaleString()} bytes · modified {new Date(group.modifiedMs).toISOString()} · SHA-256 {group.sha256}</p>
            <p>{coverage?.records} records read · {coverage?.missingColumns} missing fields · {coverage?.unterminated} records without a final newline. Empty cells count retained rows. Unsupported quoted multiline input is skipped as one record.</p>
            <p>Interpretation revision {group.interpretationRevision}. Limits: 2 source sets/window, 8 files/set, 1 GiB/file set, 512 MiB retained/set, 2,000,000 rows/file, 128 columns, 1 MiB/line. No retention eviction in finished imports.</p>
            {coverage?.examples.map((s, i) => <p key={i}>{s}</p>)}</details>
          {settings && <div className="metric-settings"><p>{group.snapshot ? "Snapshot interpretation and join rules are immutable." : "First nonempty value determines numeric/text storage. Units and statistic suffixes are suggestions; ambiguous names are kept literally. Edits never change existing snapshots."}</p>
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
          {ready && <>
            <div className="metric-controls"><label>Series<select aria-label="Metric series" value={column} onChange={e => { setColumn(Number(e.target.value)); setWorst([]); }}>{group.columns.map((c, i) => c.numeric && <option key={i} value={i}>{c.name} · {c.unit}{c.unitSuggested ? " (suggested)" : ""} · {c.meaning}{c.meaningSuggested ? " (suggested)" : ""}</option>)}</select></label>
              <button onClick={() => changeView(span[0] - (span[1] - span[0]) / 2, span[1] - (span[1] - span[0]) / 2)}>Pan left</button>
              <button onClick={() => changeView(span[0] + (span[1] - span[0]) / 2, span[1] + (span[1] - span[0]) / 2)}>Pan right</button>
              <button onClick={() => changeView(span[0] + (span[1] - span[0]) / 4, span[1] - (span[1] - span[0]) / 4)}>Zoom in</button>
              <button onClick={() => changeView(span[0] - (span[1] - span[0]) / 2, span[1] + (span[1] - span[0]) / 2)}>Zoom out</button>
              <button onClick={() => changeView(0, rows)}>Full file</button></div>
            <p>{xLabel}. Rows {span[0] + 1}–{span[1]}. {duration ? `Declared window: ${duration} s.` : "Window duration unknown; row spacing is not duration."} No session clock mapping.</p>
            {graph && <MetricChart graph={graph} name={group.columns[column]?.name ?? "Series"} axis={group.axis.kind} unit={group.columns[column]?.unit ?? "unitless"} window={group.columns[column]?.meaning === "window statistic" ? duration ?? null : null} />}
            <p>Graph preserves each display bucket's minimum/maximum; this is a rendering reduction, not a percentile or additive total. Inspect a row for original values.</p>
            <div className="metric-controls"><button onClick={async () => { state.setError(""); const requestKey = key; try { const values = await metricAction<MetricRow[]>({ op: "worst", id: source.id, table: state.table, column, start: span[0], end: span[1], count: 20 }); if (currentKey.current === requestKey) setWorst(values); } catch (e) { fail(e); } }}>Find worst windows / largest values</button>
              <label>Inspect retained row<input aria-label="Metric row number" type="number" min="1" max={rows} value={rowIndex} onChange={e => setRowIndex(Number(e.target.value))} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void inspect(rowIndex - 1); } }} /></label><button onClick={() => void inspect(rowIndex - 1)}>Inspect row</button></div>
            {!!worst.length && <>
              <label>Worst-window key<select aria-label="Metric worst key" disabled={axisKey} value={axisKey ? String(rowKey) : keyChoice === null ? "auto" : String(keyChoice)} onChange={e => setKeyChoice(e.target.value === "auto" ? null : Number(e.target.value))}>
                <option value="auto">Auto · first time-unit or elapsed/time column</option>{group.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
              </select></label>
              <table aria-label="Worst metric windows"><thead><tr><th>Row</th><th>{keyHeading}</th><th>{group.columns[column]?.name}</th></tr></thead><tbody>{worst.map(r => <tr key={r.index}><td><button onClick={() => void inspect(r.index)}>Row {r.index + 1}</button></td><td>{rowKey === null ? "No key selected" : <MetricCell value={worstKeyValue(r, group.axis, rowKey)} />}</td><td>{cell(r.cells[column])}</td></tr>)}</tbody></table>
            </>}
            {inspection && <aside aria-label="Inspected metric row"><h3>Row {inspection.row.index + 1} · CSV line {inspection.row.line} · {xLabel}: {format(inspection.row.x)}</h3>{renderRow(inspection.row, group.columns)}
              {source.tables.length > 1 && !inspection.companions.length && <p>Companions unjoined: declare a named-key rule.</p>}
              {inspection.companions.map(c => <section key={c.table}><h3>{filename(source.tables[c.table].path)} · {c.state}</h3>{c.row ? renderRow(c.row, source.tables[c.table].columns) : <p>Unjoined; no unique match.</p>}</section>)}
            </aside>}
            <p className="metric-snapshot-scope">Snapshot scope: rows {span[0] + 1}–{span[1]} in this file{source.tables.length > 1 ? "; all retained rows in the other file groups" : ""}. Includes original values, interpretation and provenance.</p>
          </>}
          {!rows && <p>No valid data rows retained.</p>}
        </>}
      </>}
    </div>
  </section>;
}

function MetricChart({ graph, name, axis, unit, window: windowSeconds }: { graph: MetricGraph; name: string; axis: string; unit: string; window: number | null }) {
  const low = Math.min(...graph.points.map(p => p.min)), high = Math.max(...graph.points.map(p => p.max));
  const width = graph.xEnd + (windowSeconds ?? 0) - graph.xStart;
  const x = (v: number) => width ? 4 + (v - graph.xStart) / width * 992 : 500;
  const y = (v: number) => high === low ? 52.5 : 95 - (v - low) / (high - low) * 85;
  const axisValue = (v: number) => { if (axis !== "epoch" && axis !== "iso8601") return format(v); const date = new Date(v * 1000); return Number.isFinite(date.getTime()) ? date.toISOString() : `${format(v)} epoch seconds`; };
  return <figure className="profiler-chart metric-chart" aria-label="Imported metric timeline"><figcaption id="metric-chart-description"><strong>{name}</strong><span>{graph.points.length ? `${format(low)} → ${format(high)} ${unit}` : "No numeric values in this range"}</span></figcaption>
    <svg role="img" aria-label="Metric range graph" aria-describedby="metric-chart-description" data-start={graph.start} data-end={graph.end} data-column={graph.column} viewBox="0 0 1000 110" preserveAspectRatio="none">
      {graph.points.map((p, i) => windowSeconds ? <rect key={i} x={x(p.x)} y={y(p.max)} width={Math.max(1, x(p.until + windowSeconds) - x(p.x))} height={Math.max(1, y(p.min) - y(p.max))} fill="#80b7d7" opacity=".6" /> : <line key={i} x1={x(p.x)} x2={x(p.x)} y1={y(p.max)} y2={y(p.min) + 1} stroke="#80b7d7" strokeWidth="1.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />)}
    </svg><figcaption className="metric-axis"><span>{axisValue(graph.xStart)}</span><span>{axisValue(graph.xEnd)}</span></figcaption>
  </figure>;
}

function MetricCell({ value }: { value: number | string | null }) {
  if (typeof value !== "string" || value.length <= 160) return <>{cell(value)}</>;
  return <details className="metric-long-value"><summary>{value.slice(0, 90)}… <span>Show full value</span></summary><div>{value}</div></details>;
}
