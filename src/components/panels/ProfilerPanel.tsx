import { openProfilerWorkspace } from "../../lib/profilerWorkspace";
import { isFileTab } from "../../types/project";
import { useRef, useState, useLayoutEffect, useEffect, type PointerEvent, type ReactNode } from "react";
import { useProfiling, canTakeSnapshot, snapshotIncludesRecording, type GoldCapture, type ProfileSample } from "../../store/profilingStore";
import { goldBenchmarks, resolveGoldBenchmark, resolveProfileScope, recordingLabel, timelineEntries } from "../../lib/profilingSelection";
import { useGold } from "../../store/goldStore";
import { useSolution } from "../../store/solutionStore";

const bytes = (n: number) => n >= 1048576 ? `${(n / 1048576).toFixed(2)} MiB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KiB` : `${n} B`;
const ms = (n: number | null) => n === null ? "—" : `${n.toFixed(2)} ms`;
const seconds = (n: number) => `${(n / 1000).toFixed(2)} s`;
const sum = (captures: GoldCapture[], field: "allocatedBytes" | "freedBytes" | "liveBytes" | "allocationCount") => captures.reduce((n, c) => n + c[field], 0);
const averageCpu = (captures: GoldCapture[]) => {
  const values = captures.flatMap(c => c.cpuMs === null ? [] : [c.cpuMs]);
  return values.length ? ms(values.reduce((n, v) => n + v, 0) / values.length) : "—";
};
const countLabel = (count: number, solo = false) => `${count} ${solo ? count === 1 ? "segment" : "segments" : count === 1 ? "hit" : "hits"}`;
type Tab = "Summary" | "Gold" | "Memory" | "Events";
type Span = [number, number];

function ScopeSelect({ value, onChoose, children }: { value: string; onChoose: (value: string) => void; children: ReactNode }) {
  const select = useRef<HTMLSelectElement | null>(null);
  const nativeValue = useRef(value);
  const restoreFocus = useRef(false);
  const [revision, setRevision] = useState(0);
  useLayoutEffect(() => {
    if (nativeValue.current === value) return;
    // WebKit can remember the last user-chosen option after a controlled Live
    // reset and suppress input/change when that option is chosen again (R-01).
    // Replace only on an external value change. Native keyboard changes keep
    // the same node/focus, and incoming hits never reset the picker.
    nativeValue.current = value;
    restoreFocus.current = document.activeElement === select.current;
    setRevision(n => n + 1);
  }, [value]);
  useLayoutEffect(() => {
    if (restoreFocus.current) { select.current?.focus(); restoreFocus.current = false; }
  }, [revision]);
  return <select key={revision} ref={select} id="profiler-scope" aria-label="Profiling scope"
    title="One entry per benchmark. Focus an individual hit from Recorded hits/segments." value={value}
    onChange={e => { nativeValue.current = e.target.value; onChoose(e.target.value); }}>{children}</select>;
}

function ProfilerIcon({ kind }: { kind: "snapshot" | "again" | "stop" | "settings" }) {
  const paths = {
    snapshot: "M3 7h4l2-3h6l2 3h4v13H3Z M16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
    again: "M4 4v6h6 M4.8 9a8 8 0 1 1-.3 6",
    stop: "M5 5h14v14H5Z",
    settings: "m9 3-.5 3-2 1-3-.5-2 3 2.5 2v2L1.5 16l2 3 3-.5 2 1 .5 3h4l.5-3 2-1 3 .5 2-3-2.5-2.5v-2l2.5-2-2-3-3 .5-2-1L13 3Z M15 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z",
  };
  // Presentation attributes work under the embedded app's CSP and do not
  // depend on Monaco injecting a codicon stylesheet or loading an icon font.
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 26" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]} /></svg>;
}

function Timeline({ label, samples, values, color, format, domain, selection, onSelect }: {
  label: string; samples: ProfileSample[]; values: number[]; color: string;
  format: (n: number) => string; domain: Span; selection: Span | null; onSelect: (span: Span) => void;
}) {
  const drag = useRef<number | null>(null);
  const maximum = Math.max(...values, 0);
  const x = (time: number) => (time - domain[0]) / Math.max(1, domain[1] - domain[0]) * 1000;
  const points = values.map((v, i) => `${x(samples[i].atMs)},${55 - v / Math.max(maximum, 1) * 51}`);
  const timeAt = (e: PointerEvent<SVGSVGElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    return domain[0] + Math.max(0, Math.min(1, (e.clientX - bounds.left) / bounds.width)) * (domain[1] - domain[0]);
  };
  return <figure className="profiler-chart">
    <figcaption><strong>{label}</strong><span>{values.length ? format(values[values.length - 1]) : "—"}</span></figcaption>
    <span className="profiler-chart-maximum" aria-hidden="true">{values.length ? format(maximum) : ""}</span>
    <svg viewBox="0 0 1000 60" preserveAspectRatio="none" role="img"
      aria-label={`${label}; window ${seconds(domain[0])} to ${seconds(domain[1])}; ${values.length} samples; maximum ${format(maximum)}`}
      onPointerDown={e => { if (!samples.length || e.button !== 0) return; drag.current = timeAt(e); e.currentTarget.setPointerCapture(e.pointerId); }}
      onPointerUp={e => { if (drag.current === null) return; const end = timeAt(e); if (Math.abs(end - drag.current) > 1) onSelect([Math.min(drag.current, end), Math.max(drag.current, end)]); drag.current = null; }}
      onPointerCancel={() => { drag.current = null; }}>
      <path d="M0 4H1000M0 30H1000M0 55H1000M250 0V60M500 0V60M750 0V60" stroke="var(--profiler-grid)" fill="none" vectorEffect="non-scaling-stroke" />
      {points.length > 0 && <><polygon points={`${x(samples[0].atMs)},55 ${points.join(" ")} ${x(samples[samples.length - 1].atMs)},55`} fill={color} fillOpacity=".22" />
        <polyline points={points.join(" ")} fill="none" stroke={color} strokeWidth="1.25" vectorEffect="non-scaling-stroke" /></>}
      {selection && <rect x={x(selection[0])} y="0" width={x(selection[1]) - x(selection[0])} height="60" fill="#75b9ef" fillOpacity=".14" stroke="#75b9ef" strokeWidth="1" vectorEffect="non-scaling-stroke" />}
    </svg>
  </figure>;
}

function CaptureGraph({ label, hits, value, format, color }: {
  label: string; hits: GoldCapture[]; value: (hit: GoldCapture) => number | null;
  format: (n: number) => string; color: string;
}) {
  const measured = hits.flatMap((hit, i) => { const n = value(hit); return n === null ? [] : [{ i, n }]; });
  const maximum = Math.max(...measured.map(v => v.n), 0);
  return <figure className="profiler-capture-chart"><figcaption>{label}<span>{measured.length ? countLabel(measured.length) : "Unavailable"}</span></figcaption>
    {measured.length > 0 && <svg role="img" aria-label={`${label}; per capture in start order; maximum ${format(maximum)}`} viewBox="0 0 300 36" preserveAspectRatio="none">
      <path d="M0 33H300M0 17H300" stroke="var(--profiler-grid)" fill="none" />
      {measured.map(v => <line key={v.i} x1={(v.i + .5) * 300 / hits.length} x2={(v.i + .5) * 300 / hits.length} y1="33" y2={33 - v.n / Math.max(maximum, 1) * 29} stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke"><title>Hit {v.i + 1} · {format(v.n)}</title></line>)}
    </svg>}
  </figure>;
}

export default function ProfilerPanel({ expanded = false }: { expanded?: boolean }) {
  const state = useProfiling();
  const gold = useGold(s => s.points);
  const file = useSolution(s => s.activeFileId ?? s.lastSourceFileId);
  const dirty = useSolution(s => s.tabs.filter(isFileTab).find(t => t.fileId === file)?.dirty ?? false);
  const { tab, setup, thread, batch, rangeControls, range, prepared, error, snapshotNote, snapshotNoteUntil } = state.presentation;
  const setTab = (tab: Tab) => state.setPresentation({tab});
  const setSetup = (setup: boolean) => state.setPresentation({setup});
  const setThread = (thread: string) => state.setPresentation({thread});
  const setBatch = (batch: string) => state.setPresentation({batch});
  const setRangeControls = (rangeControls: boolean) => state.setPresentation({rangeControls});
  const setRange = (range: { id: string; span: Span } | null) => state.setPresentation({range});
  const setPrepared = (prepared: string) => state.setPresentation({prepared});
  const setError = (error: string) => state.setPresentation({error});
  // Expiration belongs to the saved presentation, so rehosting cannot restart
  // the confirmation or resurrect feedback from a long-hidden panel.
  useEffect(() => {
    if (!snapshotNote) return;
    const timer = window.setTimeout(() => {
      if (useProfiling.getState().presentation.snapshotNoteUntil === snapshotNoteUntil)
        useProfiling.getState().setPresentation({snapshotNote: "", snapshotNoteUntil: 0});
    }, Math.max(0, snapshotNoteUntil - Date.now()));
    return () => window.clearTimeout(timer);
  }, [snapshotNote, snapshotNoteUntil]);
  const resultRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => { if (resultRef.current) resultRef.current.scrollTop = useProfiling.getState().presentation.scrollTop; }, [expanded, setup, tab]);
  const p = state.selected ? state.snapshots.find(s => s.id === state.selected)?.profile : state.profile;
  const scopeKey = `${state.selected ?? p?.id}:${state.recording?.id ?? "session"}`;
  const subrange = range?.id === scopeKey ? range.span : null;
  const scope = resolveProfileScope(p??null, state.recording, !!state.selected, subrange);
  const samples = scope.samples, latest = scope.latest;
  const domain: Span = [scope.bounds[0],Math.max(scope.bounds[0]+.001,scope.bounds[1])];
  const selection: Span | null = subrange ? scope.window : null;
  const selectRange = (span: Span) => { if (p) { setRange({ id: scopeKey, span }); setRangeControls(true); } };
  const benchmarks = goldBenchmarks(scope.captures);
  const benchmark = scope.recording?.marker ?? resolveGoldBenchmark(benchmarks,p ? state.benchmarkBySession[p.id] ?? null : null);
  const focused = benchmarks.find(b => b.marker === benchmark);
  const threads = [...new Set(scope.captures.filter(c => !benchmark || c.marker === benchmark).map(c => c.thread))];
  const activeThread = threads.some(t => String(t) === thread) ? thread : "all";
  const activeBatch = Number(batch) <= (p?.batch ?? 0) ? batch : "all";
  const matches = (c: GoldCapture) => (activeThread === "all" || String(c.thread) === activeThread)
    && (activeBatch === "all" || String(c.batch) === activeBatch);
  const allCaptures = scope.captures.filter(matches);
  const captures = scope.recording ? [scope.recording] : benchmark ? allCaptures.filter(c => c.marker === benchmark) : [];
  const focus = (marker: string | null) => { if (p) { state.focusBenchmark(p.id, marker); setThread("all"); setBatch("all"); } };
  const focusRecording = (c: GoldCapture) => { if(p) { state.focusRecording(p.id,c); setThread("all");setBatch("all");setRange(null); } };
  const benchmarkPicker = <div className="profiler-benchmark">
    <label htmlFor="profiler-benchmark">Marker</label>
    <select id="profiler-benchmark" aria-label="Gold benchmark" title="Filters the Gold history list. Use Focus recording to scope all views." value={benchmark ?? ""} onChange={e => focus(e.target.value || null)}>
      <option value="">All markers</option>
      {benchmarks.map(b => <option key={b.marker} value={b.marker}>{b.solo ? "Solo" : "Range"} · {b.name} · {countLabel(b.hits, b.solo)}</option>)}
      {benchmark && !focused && <option value={benchmark}>Selected marker · unavailable in this view</option>}
    </select>
  </div>;
  const nativeAvailable = !!p && (p.provider || p.captures.length>0 || !!p.counters?.disconnects);
  const cohort = scope.cohort;
  const cpuSamples = scope.cpu.map(c=>c.sample), cpu=scope.cpu.map(c=>c.value);
  const relatedSnapshots = state.recording ? state.snapshots.filter(s => snapshotIncludesRecording(s,state.recording!)) : [];
  const snapshots = state.recording ? relatedSnapshots : state.snapshots.filter(s=>s.kind!=="previousSession"&&s.profile.id===p?.id);
  const manualSnapshots = state.snapshots.filter(s=>s.kind!=="previousSession"&&!relatedSnapshots.some(related=>related.id===s.id));
  const snapshotEnabled = canTakeSnapshot(state.profile);
  const duration = scope.missing&&state.recording?.endMs===null ? null : scope.bounds[1]-scope.bounds[0];
  const historyCaptures = scope.recording ? scope.captures.filter(matches) : allCaptures.filter(c=>!benchmark||c.marker===benchmark);
  const availableLive = !scope.missing&&nativeAvailable;
  const scopeMarkers = goldBenchmarks(p?.captures??[]);
  const chooseScope = (marker: string) => {
    if(marker==="session")state.clearRecording();
    else {
      const hits=p?.captures.filter(c=>c.marker===marker)??[];
      const c=hits[hits.length-1];
      if(c&&p)state.focusRecording(p.id,c);
    }
    setRange(null);setThread("all");setBatch("all");
  };
  const returnLive = () => {state.select(null);setRange(null);};
  const observedCohort = (field: "allocatedBytes"|"freedBytes"|"liveBytes"|"allocationCount") => {
    if(!availableLive || (subrange&&!state.recording))return null;
    if(state.recording)return cohort?.[field]??null;
    return field==="liveBytes"?p?.nativeLiveBytes??null:scope.activity?.[field]??null;
  };
  const metricBytes = (n: number|null|undefined) => n==null?"—":bytes(n);
  const fail = (e: unknown) => setError(String(e));
  const takeSnapshot = () => { state.snapshot(); state.setPresentation({snapshotNote:"Snapshot saved from live process · View preserved",snapshotNoteUntil:Date.now()+4000}); };
  const filters = <div className="profiler-filters">
    <select aria-label="Capture thread" value={activeThread} onChange={e => setThread(e.target.value)} title="Filters Gold results; does not suspend threads or filter process graphs">
      <option value="all">All threads</option>{threads.map(t => <option key={t} value={t}>Thread {t || "all (solo)"}</option>)}
    </select>
    <select aria-label="Capture batch" value={activeBatch} onChange={e => setBatch(e.target.value)}>
      <option value="all">All batches</option>{Array.from({ length: p?.batch ?? 0 }, (_, i) => <option key={i} value={i + 1}>Batch {i + 1}</option>)}
    </select>
  </div>;
  const hitSelection = state.presentation.hit;
  const inspectedHit = p && hitSelection?.profileId === p.id && hitSelection.snapshotId === state.selected
    ? historyCaptures.find(c => c.id === hitSelection.id) : undefined;
  const expansion = (key: string) => ({
    open: !!state.presentation.expanded[key],
    onToggle: (event: React.SyntheticEvent<HTMLDetailsElement>) => {
      const open = event.currentTarget.open;
      if (!!useProfiling.getState().presentation.expanded[key] !== open)
        state.setPresentation({expanded: Object.fromEntries(Object.entries({...state.presentation.expanded, [key]: open}).slice(-128))});
    },
  });
  const summaryFigures = <dl className={expanded ? "profiler-summary-row" : "profiler-metrics"} aria-label="Profiling summary">
    <div><dt>{state.recording ? "Recording duration" : "Gold captures"}</dt><dd>{state.recording ? ms(duration) : allCaptures.length}</dd></div>
    <div><dt>Recording thread CPU</dt><dd>{scope.recording ? ms(scope.recording.cpuMs) : "—"}</dd></div>
    <div><dt>Resident memory{state.recording ? " observed in window" : ""}</dt><dd>{latest ? bytes(latest.residentBytes) : "—"}</dd></div>
    <div><dt>Threads</dt><dd>{latest?.threadCount ?? "—"}</dd></div>
    <div><dt>{state.recording ? "Cohort live at End / as of window" : "Observed native live"}</dt><dd>{metricBytes(observedCohort("liveBytes"))}</dd></div>
  </dl>;
  return <div className={"profiler-panel" + (expanded ? " is-expanded" : "")} aria-label={expanded ? "Expanded Profiler" : "Compact Profiler"}>
    <div className="profiler-toolbar" role="toolbar" aria-label="Profiling controls">
      <button onClick={() => window.dispatchEvent(new Event("craidd:attach-process"))}>Attach…</button>
      <span className="profiler-separator" />
      <button title="Take snapshot of live process — saves RSS and recorded allocation cohorts, not a heap dump" aria-label="Take memory snapshot" disabled={!snapshotEnabled} onClick={takeSnapshot}><ProfilerIcon kind="snapshot" /></button>
      <button title="Snapshot and record again" aria-label="Snapshot and record again" disabled={!state.profile?.active || state.profile?.waitingForPlay} onClick={() => { state.snapshot(); void state.again(); }}><ProfilerIcon kind="again" /></button>
      <button title="Stop profiling; leave process running" aria-label="Stop profiling" disabled={!state.profile?.active} onClick={() => void state.stop().catch(fail)}><ProfilerIcon kind="stop" /></button>
      <span className="profiler-toolbar-space" />
      <button title="Profiling settings and source markers" aria-label="Profiling settings" aria-expanded={setup} onClick={() => setSetup(!setup)}><ProfilerIcon kind="settings" /></button>
    </div>
    {!expanded && <div className="profiler-host-actions"><button onClick={openProfilerWorkspace}>Open in Editor Panel</button></div>}
    <div className="profiler-target" title={p ? `${p.name} · PID ${p.target.pid} · start ${p.target.birth}` : "Attach to a process, or start Debug"}>
      <span className={`profiler-status ${p?.active && !state.selected ? "is-live" : ""}`} />
      <strong>{p ? `${p.name} · ${p.target.pid}` : "No process selected"}</strong>
      <span>{state.selected ? `Snapshot · ${scope.status}` : scope.status}</span>
    </div>
    {state.snapshots.length>0&&<div className="profiler-view-controls"><button aria-label="Return to live profiling" aria-pressed={!state.selected&&!state.recording} onClick={returnLive}>Live</button><select aria-label="Profiler view" title="Manual snapshot history; select a saved moment or return to the current session" value={state.selected??"live"} onChange={e=>{state.select(e.target.value==="live"?null:e.target.value);setRange(null);}}>
      <option value="live">Snapshots · Current session</option>
      {relatedSnapshots.length>0&&<optgroup label="Snapshots for this recording">{relatedSnapshots.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>}
      <optgroup label={relatedSnapshots.length?"Other manual snapshots":"Manual snapshots"}>{manualSnapshots.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
      <optgroup label="Previous sessions">{state.snapshots.filter(s=>s.kind==="previousSession").map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
    </select></div>}
    <div className="profiler-benchmark profiler-scope-picker">
      {!state.snapshots.length&&<button aria-label="Return to live profiling" aria-pressed={!state.recording} onClick={returnLive}>Live</button>}
      <label htmlFor="profiler-scope">Scope</label>
      <ScopeSelect value={state.recording?.marker??"session"} onChoose={chooseScope}>
        <option value="session">Full session{state.selected?" at snapshot":p?.active?" · Live":" · Stopped"}</option>
        {scopeMarkers.map(m=><option key={m.marker} value={m.marker}>{m.solo?"Solo":"Gold"} · {m.name} · {countLabel(m.hits,m.solo)}</option>)}
        {state.recording&&!scopeMarkers.some(m=>m.marker===state.recording!.marker)&&<option value={state.recording.marker}>{state.recording.name} · Unavailable</option>}
      </ScopeSelect>
    </div>
    {snapshotNote&&snapshotNoteUntil>Date.now()&&<p role="status" className="profiler-scope-caption">{snapshotNote}</p>}
    {state.recording&&<p className="profiler-scope-caption" role="status" data-recording-id={state.recording.id}>{state.recording.solo?"Solo":"Gold"} · {state.recording.name} · B{state.recording.batch} · T{state.recording.thread||"all"} · {scope.status} · {seconds(scope.bounds[0])} → {duration===null?"End unavailable":seconds(scope.bounds[1])}</p>}
    {scope.history&&<p role="status" className="profiler-scope-caption">{scope.history}</p>}
    {subrange&&<p className="profiler-scope-caption">Native cohort totals cover the entire recording; allocation activity for a custom subwindow is unavailable.</p>}
    {scope.coverageLost&&<p role="status" className="profiler-scope-caption">Partial source coverage · recording measurements may be incomplete.</p>}
    {(p?.reason.startsWith("Source discovery unavailable:") || p?.reason.startsWith("Capture storage full")) && <div role="status" className="profiler-notice">{p.reason}</div>}
    {p?.waitingForPlay && !state.selected && !state.recording && <p className="profiler-ready-hint">Press Play in Unity to record prepared Gold benchmarks.</p>}
    {(error || state.error) && <div role="alert" className="profiler-notice">{error || state.error}<button aria-label="Dismiss profiling error" onClick={() => { setError(""); useProfiling.setState({ error: null }); }}>×</button></div>}
    {setup ? <div ref={resultRef} onScroll={e => state.setPresentation({scrollTop: e.currentTarget.scrollTop})} className="profiler-results profiler-settings">
      <div className="profiler-section-title"><strong>Profiling settings</strong><button onClick={() => setSetup(false)}>Done</button></div>
      <h3>Source markers · {gold.length}</h3>
      <p>Gold markers record automatically without pausing. Pairs end at their End marker; one solo records until the session ends.</p>
      <p>Gutter markers require a prepared source copy and a rebuilt matching native target. Fixture benchmarks come from its compiled hooks. Unity managed C# markers are not instrumented by this exporter.</p>
      {gold.map(g => <div key={g.id} className="profiler-marker">◆ {g.solo ? "Solo" : `${g.start} → ${g.end ?? "Awaiting End"}`} · {g.file.split("/").pop()}{g.condition ? ` · if ${g.condition}` : ""}</div>)}
      <button disabled={!file || dirty} title={dirty ? "Save and review source marker lines first" : "Export a C++ source copy using explicit Gold anchors"} onClick={() => { if (file) void useGold.getState().prepare(file).then(setPrepared).catch(fail); }}>Prepare source copy…</button>
      {prepared && <p className="select-text break-all">Prepared bundle: {prepared}. Read README.txt and build the copy.</p>}
      <h3>Native source provider</h3>
      <p>Prepared targets discover Craidd after Attach or Profile only, including targets started first. Unity Editor Play sessions stay armed until Stop. This environment variable is a fallback for older instrumented builds.</p>
      <code className="select-text break-all">CRAIDD_PROFILE_SOCKET={state.bridge || "Unavailable"}</code>
      <button disabled={!state.bridge} onClick={() => void navigator.clipboard.writeText(`CRAIDD_PROFILE_SOCKET=${state.bridge}`).catch(fail)}>Copy environment</button>
      <h3>Collectors</h3>
      <dl className="profiler-metrics"><dt>Process CPU / RSS</dt><dd>250 ms polling</dd><dt>Native allocation cohorts</dt><dd>{p?.provider ? "Connected" : "Not connected"}</dd><dt>Managed heap / GC</dt><dd>Unavailable</dd><dt>Heap objects / stacks</dt><dd>Unavailable</dd><dt>GPU / hardware cycles</dt><dd>Planned</dd></dl>
    </div> : <>
      {expanded && summaryFigures}
      <div className="profiler-session">
        <span>{state.recording?"Recording window":"Session"} <strong>{duration===null?"—":seconds(duration)}</strong>{selection ? ` · ${seconds(selection[1] - selection[0])} selected` : ""}</span>
        <button disabled={!samples.length} title="Select a time range; you can also drag across a graph" aria-label="Select time range" aria-expanded={rangeControls} onClick={() => setRangeControls(!rangeControls)}>↔</button>
        {selection && <button onClick={() => setRange(null)} title="Show full session">All</button>}
      </div>
      <div className="profiler-timelines">
        <div className="profiler-ruler"><span>{seconds(domain[0])}</span><span>{seconds((domain[0] + domain[1]) / 2)}</span><span>{seconds(domain[1])}</span></div>
        <Timeline label="Process Memory (RSS)" samples={samples} values={samples.map(s => s.residentBytes)} color="#80b7d7" format={bytes} domain={domain} selection={selection} onSelect={selectRange} />
        <Timeline label="Process CPU time (ms / interval)" samples={cpuSamples} values={cpu} color="#c9ba79" format={ms} domain={domain} selection={selection} onSelect={selectRange} />
        <div className="profiler-event-track" aria-label="Gold capture timeline" title="Three non-overlapping lanes; additional retained hits remain in Gold history">{timelineEntries(scope.captures,state.recording?.id,domain).map(({capture:c,lane}) => <button key={c.id} aria-label={`Focus ${recordingLabel(c,!!state.selected)}`} aria-pressed={state.recording?.id===c.id} title={recordingLabel(c,!!state.selected)} onClick={()=>focusRecording(c)}
          style={{left:`${Math.max(0,(c.startMs-domain[0])/(domain[1]-domain[0])*100)}%`,width:`${Math.max(.7,(Math.min(c.endMs??scope.bounds[1],domain[1])-Math.max(c.startMs,domain[0]))/(domain[1]-domain[0])*100)}%`,top:`${2+lane*6}px`}}/>)}<small>Gold</small></div>
      </div>
      {rangeControls && <div className="profiler-range-controls">
        <label>From<input type="range" aria-label="Selection start" min={domain[0]} max={domain[1]} step="any" value={selection?.[0] ?? domain[0]} onChange={e => selectRange([Math.min(Number(e.target.value), selection?.[1] ?? domain[1]), selection?.[1] ?? domain[1]])} /></label>
        <label>To<input type="range" aria-label="Selection end" min={domain[0]} max={domain[1]} step="any" value={selection?.[1] ?? domain[1]} onChange={e => selectRange([selection?.[0] ?? domain[0], Math.max(Number(e.target.value), selection?.[0] ?? domain[0])])} /></label>
      </div>}
      <div className="profiler-tabs" role="tablist" aria-label="Profiling results">{(["Summary", "Gold", "Memory", "Events"] as Tab[]).map(t => <button key={t} id={`profiler-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="profiler-results" onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab === "Gold" && !state.recording && benchmarkPicker}
      <div ref={resultRef} onScroll={e => state.setPresentation({scrollTop: e.currentTarget.scrollTop})} id="profiler-results" className="profiler-results" role="tabpanel" aria-labelledby={`profiler-tab-${tab}`}>
        {tab === "Summary" && <>
          <h3>Diagnostics overview</h3>
          {!p && <p>Attach to a process, or start Debug to record diagnostics.</p>}
          {!expanded && <dl className="profiler-metrics"><dt>{state.recording?"Recording duration":"Gold captures"}</dt><dd>{state.recording?ms(duration):allCaptures.length}</dd>
            <dt title="Native thread CPU attributed to this invocation; process chart is whole-process context">Recording thread CPU</dt><dd>{scope.recording?ms(scope.recording.cpuMs):"—"}</dd>
            <dt>Resident memory{state.recording?" observed in window":""}</dt><dd>{latest ? bytes(latest.residentBytes) : "—"}</dd>
            <dt>Threads</dt><dd>{latest?.threadCount ?? "—"}</dd></dl>}
          <h3>Memory</h3>
          <div className="profiler-section-title"><span>Capture and compare observations</span><button disabled={!snapshotEnabled} onClick={takeSnapshot}>Take snapshot</button></div>
          <dl className="profiler-metrics"><dt>{state.recording?"Cohort allocated":"Observed native allocated"}</dt><dd>{metricBytes(observedCohort("allocatedBytes"))}</dd><dt>{state.recording?(scope.recording?.endMs!==null?"Cohort live at End":"Cohort live"):"Observed native live"}</dt><dd>{metricBytes(observedCohort("liveBytes"))}</dd></dl>
          <button className="profiler-link" onClick={() => setTab("Gold")}>View Gold captures ({benchmark ? captures.length : allCaptures.length}) →</button>
          <button className="profiler-link" onClick={() => setTab("Memory")}>View memory snapshots ({snapshots.length}) →</button>
        </>}
        {tab === "Gold" && expanded && <>
          <div className="profiler-section-title"><strong>Gold recordings</strong><span>{countLabel(historyCaptures.length)}</span></div>
          {filters}
          <div className="profiler-gold-workspace">
            <div className="profiler-table-scroll"><table aria-label="Gold hits"><thead><tr><th>Recording</th><th>Thread</th><th>Batch</th><th>Duration</th><th>Thread CPU</th><th>Status</th></tr></thead><tbody>
              {historyCaptures.map(c => <tr key={c.id} className={inspectedHit?.id === c.id ? "is-selected" : ""}><td><button aria-pressed={inspectedHit?.id === c.id}
                onClick={() => { if (p) state.setPresentation({hit: {profileId: p.id, snapshotId: state.selected, id: c.id}}); }}>{c.name}</button></td>
                <td>{c.thread || "all (solo)"}</td><td>{c.batch}</td><td>{c.endMs === null ? state.selected ? "Open at snapshot" : "Recording" : ms(c.endMs - c.startMs)}</td><td>{ms(c.cpuMs)}</td><td>{c.status}</td></tr>)}
            </tbody></table>{!historyCaptures.length && <p className="profiler-empty">No retained hits in this scope and filters.</p>}</div>
            <aside className="profiler-hit-inspector" aria-label="Selected Gold hit details">
              {inspectedHit ? <><h3>{inspectedHit.name}</h3><p>{recordingLabel(inspectedHit, !!state.selected)}</p>
                <dl className="profiler-metrics"><dt>Status</dt><dd>{inspectedHit.status}</dd><dt>Thread CPU</dt><dd>{ms(inspectedHit.cpuMs)}</dd>
                  <dt>Allocated</dt><dd>{bytes(inspectedHit.allocatedBytes)}</dd><dt>Allocation count</dt><dd>{inspectedHit.allocationCount}</dd>
                  <dt>Freed as of observation</dt><dd>{bytes(inspectedHit.freedBytes)}</dd><dt>Current observed survivors</dt><dd>{bytes(inspectedHit.liveBytes)}</dd></dl>
                <button className="profiler-link" onClick={() => focusRecording(inspectedHit)}>Focus recording</button>
                <p className="profiler-caption">Instrumented native cohort observations. Process CPU/RSS remain whole-process context; overlapping cohorts are inclusive.</p>
              </> : <p className="profiler-empty">{hitSelection ? "Selected hit unavailable in this view. Choose a retained hit to inspect." : "Select a hit to inspect its details. Focus recording explicitly scopes all views."}</p>}
            </aside>
          </div>
        </>}
        {tab === "Gold" && !expanded && <>
          {benchmark || state.recording ? <>
            <div className="profiler-section-title"><strong className="profiler-benchmark-name" title={focused?.name}>{focused ? `${focused.solo ? "Solo" : "Range"} · ${focused.name}` : "Selected benchmark"}</strong><span>{countLabel(captures.length, focused?.solo)}</span></div>
            {filters}
            {captures.length > 0 ? <>
              <dl className="profiler-metrics"><dt title="Mean per measured capture; overlapping and nested captures are not summed">Mean capture CPU</dt><dd>{averageCpu(captures)}</dd><dt title="Inclusive cohort observations; completed recording uses fixed End values">Allocated / live {state.recording?"at End / as of window":"(inclusive sum)"}</dt><dd>{scope.recording ? `${metricBytes(cohort?.allocatedBytes)} / ${metricBytes(cohort?.liveBytes)}` : `${bytes(sum(captures,"allocatedBytes"))} / ${bytes(sum(captures,"liveBytes"))}`}</dd></dl>
              <CaptureGraph label={focused?.solo ? "Thread CPU per segment" : "Thread CPU per hit"} hits={captures} value={c => c.cpuMs} format={ms} color="#c9ba79" />
              <CaptureGraph label="Cohort live at End / open" hits={captures} value={c => c.endMs!==null?c.cohortEnd?.liveBytes??null:c.liveBytes} format={bytes} color="#80b7d7" />
              <details {...expansion(`${scopeKey}:${benchmark}`)} key={`${scopeKey}:${benchmark}`} className="profiler-capture-group">
                <summary>Recorded {focused?.solo ? "segments" : "hits"}<span>{captures.length}</span></summary>
                {historyCaptures.map(c => <details {...expansion(`${scopeKey}:${c.id}`)} key={c.id} data-capture-id={c.id} className="profiler-hit"><summary>{state.recording?`${c.name} · `:""}Thread {c.thread || "all"} · batch {c.batch}<span>{c.endMs === null ? state.selected ? "Open at snapshot" : "Recording" : ms(c.endMs - c.startMs)}</span></summary>
                  <dl className="profiler-metrics"><dt>Status</dt><dd>{c.status}</dd><dt>Thread CPU</dt><dd>{ms(c.cpuMs)}</dd><dt>Allocation count</dt><dd>{c.allocationCount}</dd><dt>Allocated</dt><dd>{bytes(c.allocatedBytes)}</dd><dt>Freed as of observation</dt><dd>{bytes(c.freedBytes)}</dd><dt>Current observed survivors</dt><dd>{bytes(c.liveBytes)}</dd></dl>
                  <button className="profiler-link" onClick={()=>focusRecording(c)}>Focus recording</button>
                </details>)}
              </details>
            </> : <p className="profiler-empty">No captures for this benchmark in the selected view. Change the filters or choose another benchmark.</p>}
          </> : <>
            <h3>Process overview</h3>
            <p className="profiler-caption">Choose a marker to browse its hits, or choose a Gold/Solo benchmark in Scope, then focus a retained hit. All Gold markers continue recording automatically.</p>
            {!benchmarks.length && <p className="profiler-empty">{p?.provider ? "No Gold hits in this view." : "Waiting for an instrumented Gold source provider."}</p>}
          </>}
        </>}
        {tab === "Memory" && <>
          <div className="profiler-section-title"><strong>Memory snapshots{state.recording?" · Associated":""}</strong><button disabled={!snapshotEnabled} onClick={takeSnapshot}>Take snapshot</button></div>
          <p className="profiler-caption">Process RSS and instrumented native observations. Manual snapshots remain in their history dropdown. Heap object capture is unavailable.</p>
          {snapshots.length ? <div className="profiler-table-scroll"><table><thead><tr><th>Snapshot</th><th>RSS</th><th>Δ RSS</th><th title="Unique observed native live bytes for Full session; inclusive cohort live bytes for a recording">Native live</th></tr></thead><tbody>{snapshots.map((s, i) => {
            const sample = s.profile.samples[s.profile.samples.length - 1]; const previous = snapshots[i - 1]?.profile.samples[snapshots[i - 1].profile.samples.length - 1];
            const snapshotCapture = s.profile.captures.find(c=>c.id===state.recording?.id);
            const snapshotLive = state.recording ? snapshotCapture?.liveBytes : s.profile.nativeLiveBytes;
            const delta = sample && previous ? sample.residentBytes - previous.residentBytes : null;
            return <tr key={s.id} className={state.selected === s.id ? "is-selected" : ""}><td><button title={s.name} onClick={() => state.select(s.id)}>#{s.sequence ?? i + 1} · {sample ? seconds(sample.atMs) : "—"}</button></td><td>{sample ? bytes(sample.residentBytes) : "—"}</td><td>{delta === null ? "—" : `${delta >= 0 ? "+" : "−"}${bytes(Math.abs(delta))}`}</td><td>{metricBytes(snapshotLive)}</td></tr>;
          })}</tbody></table></div> : <p className="profiler-empty">{state.recording?"No manual snapshots captured while this recording was active. All saved moments remain in snapshot history.":"Take a snapshot to compare memory over time."}</p>}
          <h3>{state.recording?`Native cohort · ${state.recording.name}`:"Observed native activity"}</h3>
          <dl className="profiler-metrics"><dt>Allocation count</dt><dd>{observedCohort("allocationCount")??"—"}</dd><dt>Allocated{state.recording?" (inclusive)":" (unique observed)"}</dt><dd>{metricBytes(observedCohort("allocatedBytes"))}</dd><dt>Freed{state.recording&&scope.recording?.endMs!==null?" at End":""}</dt><dd>{metricBytes(observedCohort("freedBytes"))}</dd><dt>{state.recording&&scope.recording?.endMs!==null?"Still live at End":"Still live"}</dt><dd>{metricBytes(observedCohort("liveBytes"))}</dd></dl>
          {scope.recording?.endMs!==null&&scope.recording&&<dl className="profiler-metrics"><dt>Current observed survivors{state.selected?" at snapshot":""}</dt><dd>{bytes(scope.recording.liveBytes)}</dd><dt>Freed after End{state.selected?" as of snapshot":""}</dt><dd>{cohort?bytes(Math.max(0,scope.recording.freedBytes-cohort.freedBytes)):"—"}</dd></dl>}
          {state.recording&&<><h3>Process activity observed during window</h3><dl className="profiler-metrics"><dt>Native allocations observed</dt><dd>{metricBytes(scope.activity?.allocatedBytes)}</dd><dt>Native frees observed</dt><dd>{metricBytes(scope.activity?.freedBytes)}</dd><dt>Frees with unknown size</dt><dd>{scope.activity?.unmatchedFrees??"—"}</dd></dl></>}
          {state.recording&&<><h3>RSS observations near boundaries</h3><dl className="profiler-metrics"><dt>Before Start{scope.start?` · ${seconds(Math.max(0,scope.bounds[0]-scope.start.atMs))} earlier`:""}</dt><dd>{metricBytes(scope.start?.residentBytes)}</dd><dt>At/before End{scope.end?` · ${seconds(Math.max(0,scope.bounds[1]-scope.end.atMs))} earlier`:""}</dt><dd>{metricBytes(scope.end?.residentBytes)}</dd><dt>Observed RSS change</dt><dd>{scope.rssDelta===null?"—":`${scope.rssDelta>=0?"+":"−"}${bytes(Math.abs(scope.rssDelta))}`}</dd></dl></>}
          <p className="profiler-caption">Instrumented allocations only. Cohorts are inclusive and can overlap. Process activity includes other threads and frees of older allocations. End values are fixed; later frees update survivor observations. Still live does not mean leaked.</p>
          <dl className="profiler-metrics"><dt>Virtual memory observed</dt><dd>{latest ? bytes(latest.virtualBytes) : "—"}</dd><dt>Managed heap / GC</dt><dd>Unavailable</dd></dl>

        </>}
        {tab === "Events" && <>
          <h3>Session retention and coverage counters</h3>
          <dl className="profiler-metrics"><dt>Older process samples</dt><dd>{p?.counters?.agedSamples ?? 0}</dd><dt>Older Gold hits</dt><dd>{p?.counters?.evictedCaptures ?? 0}</dd><dt>Rejected source events</dt><dd>{p?.counters?.rejectedEvents ?? p?.dropped ?? 0}</dd><dt>Missing source events</dt><dd>{p?.counters?.sourceGaps ?? 0}</dd><dt>Provider disconnects</dt><dd>{p?.counters?.disconnects ?? 0}</dd></dl>
          <p className="profiler-caption">Rolling history removes older samples and ordinary hits. Solo segments and live allocation cohorts stay retained. Source errors and disconnects are separate coverage gaps.</p>
          <h3>Time-overlapping Gold records · {scope.captures.length}</h3>
          {scope.captures.slice(0,128).map(c=><div className="profiler-event" key={c.id}><strong>{seconds(c.startMs)} → {c.endMs===null?"Recording":seconds(c.endMs)}</strong><span>{c.name} · batch {c.batch} · {c.status}</span><button className="profiler-link" onClick={()=>focusRecording(c)}>Focus recording</button></div>)}
          <h3>Diagnostics in window · {p?.diagnostics?scope.diagnostics.length:"Unavailable"}</h3>
          {scope.diagnostics.map((event,i)=><div className="profiler-event" key={i}><strong>{seconds(Math.max(scope.window[0],event.atMs))} → {seconds(Math.min(scope.window[1],event.untilMs))}</strong><span>{event.kind} · {event.count}{event.atMs<scope.window[0]||event.untilMs>scope.window[1]?" in overlapping burst (whole burst count)":""}</span></div>)}
          {!!p?.diagnosticsEvicted&&<p className="profiler-caption">Partial diagnostic history · older bursts evicted.</p>}
          <h3>Debugger stops in window · {scope.pauses.length}</h3>
          {scope.pauses.map((pause, i) => <div className="profiler-event" key={i}><strong>{seconds(Math.max(scope.window[0],pause.startMs))} → {seconds(Math.min(scope.window[1],pause.endMs??scope.window[1]))}{pause.endMs===null?" · open":""}</strong><span>{pause.allThreads ? "All threads" : `DAP thread ${pause.thread ?? "unknown"}`} · {pause.reason}</span></div>)}
          {!scope.pauses.length && <p className="profiler-empty">No debugger stops recorded.</p>}
          <p className="profiler-caption">Range wall time includes debugger pauses. DAP thread IDs and native thread IDs are separate.</p>
          {!state.recording&&p?.reason && <p>{p.reason}</p>}
        </>}
      </div>
      <div className="profiler-footer" title={p?.provider ? "Source events from the prepared native provider. Gutter intent requires a matching rebuilt target." : "Process metrics are available; Gold ranges require a prepared instrumented build."}>
        <span>{p?.waitingForPlay ? "Unity · ready for Play" : p?.provider ? "◆ Gold connected" : "Process metrics only"}</span><span title="History and source coverage details are in Events">{p?.counters ? p.counters.disconnects || p.counters.rejectedEvents || p.counters.sourceGaps ? "Coverage interrupted" : p.counters.agedSamples || p.counters.evictedCaptures ? "Rolling history" : `${samples.length} samples` : p?.dropped ? `${p.dropped} source rejections` : `${samples.length} samples`}</span>
      </div>
    </>}
  </div>;
}
