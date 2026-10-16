import { useRef, useState, type PointerEvent } from "react";
import { useProfiling, type GoldCapture, type ProfileSample } from "../../store/profilingStore";
import { goldBenchmarks, resolveGoldBenchmark } from "../../lib/profilingSelection";
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
      aria-label={`${label}; ${values.length} samples; maximum ${format(maximum)}`}
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

export default function ProfilerPanel() {
  const state = useProfiling();
  const gold = useGold(s => s.points);
  const file = useSolution(s => s.activeFileId);
  const dirty = useSolution(s => s.tabs.find(t => t.fileId === s.activeFileId)?.dirty ?? false);
  const [tab, setTab] = useState<Tab>("Summary");
  const [setup, setSetup] = useState(false);
  const [thread, setThread] = useState("all");
  const [batch, setBatch] = useState("all");
  const [rangeControls, setRangeControls] = useState(false);
  const [range, setRange] = useState<{ id: string; span: Span } | null>(null);
  const [prepared, setPrepared] = useState("");
  const [error, setError] = useState("");
  const [snapshotNote, setSnapshotNote] = useState("");
  const p = state.selected ? state.snapshots.find(s => s.id === state.selected)?.profile : state.profile;
  const samples = p?.samples ?? [];
  const latest = samples[samples.length - 1];
  const domain: Span = [samples[0]?.atMs ?? 0, Math.max((samples[0]?.atMs ?? 0) + 1, latest?.atMs ?? 1)];
  const selection: Span | null = range?.id === p?.id && range
    ? [Math.max(domain[0], Math.min(domain[1], range.span[0])), Math.max(domain[0], Math.min(domain[1], range.span[1]))] : null;
  const selectRange = (span: Span) => { if (p) { setRange({ id: p.id, span }); setRangeControls(true); } };
  const benchmarks = goldBenchmarks(p?.captures ?? []);
  const benchmark = resolveGoldBenchmark(benchmarks, p ? state.benchmarkBySession[p.id] : undefined);
  const focused = benchmarks.find(b => b.marker === benchmark);
  const solo = benchmarks.find(b => b.solo);
  const threads = [...new Set((p?.captures ?? []).filter(c => !benchmark || c.marker === benchmark).map(c => c.thread))];
  const activeThread = threads.some(t => String(t) === thread) ? thread : "all";
  const activeBatch = Number(batch) <= (p?.batch ?? 0) ? batch : "all";
  const matches = (c: GoldCapture, until = domain[1]) => (activeThread === "all" || String(c.thread) === activeThread)
    && (activeBatch === "all" || String(c.batch) === activeBatch)
    && (!selection || c.startMs <= selection[1] && (c.endMs ?? until) >= selection[0]);
  const allCaptures = (p?.captures ?? []).filter(c => matches(c));
  const captures = benchmark ? allCaptures.filter(c => c.marker === benchmark) : [];
  const focus = (marker: string | null) => { if (p) { state.focusBenchmark(p.id, marker); setThread("all"); setBatch("all"); } };
  const benchmarkPicker = <div className="profiler-benchmark">
    <label htmlFor="profiler-benchmark">Benchmark</label>
    <select id="profiler-benchmark" aria-label="Gold benchmark" title={focused?.name ?? (benchmark ? "Selected benchmark unavailable in this view" : "Process overview")} value={benchmark ?? ""} onChange={e => focus(e.target.value || null)}>
      <option value="">Process overview</option>
      {benchmarks.map(b => <option key={b.marker} value={b.marker}>{b.solo ? "Solo" : "Range"} · {b.name} · {countLabel(b.hits, b.solo)}</option>)}
      {benchmark && !focused && <option value={benchmark}>Selected benchmark · unavailable in this view</option>}
    </select>
    {solo && <button title="Return to Solo overview" disabled={benchmark === solo.marker} onClick={() => focus(solo.marker)}>Solo</button>}
  </div>;
  const cpuSamples = samples.slice(1);
  const cpu = cpuSamples.map((s, i) => Math.max(0, s.cpuMs - samples[i].cpuMs));
  const snapshots = state.snapshots.filter(s => s.profile.id === p?.id);
  const fail = (e: unknown) => setError(String(e));
  const takeSnapshot = () => { state.snapshot(); setTab("Memory"); setSnapshotNote(state.selected ? "Snapshot saved from current session" : state.profile?.active ? "Snapshot saved · Live continues" : "Snapshot saved"); };
  const filters = <div className="profiler-filters">
    <select aria-label="Capture thread" value={activeThread} onChange={e => setThread(e.target.value)} title="Filters Gold results; does not suspend threads or filter process graphs">
      <option value="all">All threads</option>{threads.map(t => <option key={t} value={t}>Thread {t || "all (solo)"}</option>)}
    </select>
    <select aria-label="Capture batch" value={activeBatch} onChange={e => setBatch(e.target.value)}>
      <option value="all">All batches</option>{Array.from({ length: p?.batch ?? 0 }, (_, i) => <option key={i} value={i + 1}>Batch {i + 1}</option>)}
    </select>
  </div>;
  return <div className="profiler-panel">
    <div className="profiler-toolbar" role="toolbar" aria-label="Profiling controls">
      <button onClick={() => window.dispatchEvent(new Event("craidd:attach-process"))}>Attach…</button>
      <span className="profiler-separator" />
      <button title="Take snapshot of current session — saves RSS and recorded allocation cohorts, not a heap dump" aria-label="Take memory snapshot" disabled={!state.profile?.samples.length} onClick={takeSnapshot}><ProfilerIcon kind="snapshot" /></button>
      <button title="Snapshot and record again" aria-label="Snapshot and record again" disabled={!state.profile?.active || state.profile?.waitingForPlay} onClick={() => { state.snapshot(); state.select(null); void state.again(); }}><ProfilerIcon kind="again" /></button>
      <button title="Stop profiling; leave process running" aria-label="Stop profiling" disabled={!state.profile?.active} onClick={() => void state.stop().catch(fail)}><ProfilerIcon kind="stop" /></button>
      <span className="profiler-toolbar-space" />
      <button title="Profiling settings and source markers" aria-label="Profiling settings" aria-expanded={setup} onClick={() => setSetup(!setup)}><ProfilerIcon kind="settings" /></button>
    </div>
    <div className="profiler-target" title={p ? `${p.name} · PID ${p.target.pid} · start ${p.target.birth}` : "Attach to a process, or start Debug"}>
      <span className={`profiler-status ${p?.active && !state.selected ? "is-live" : ""}`} />
      <strong>{p ? `${p.name} · ${p.target.pid}` : "No process selected"}</strong>
      <span>{state.selected ? "Snapshot" : p?.waitingForPlay ? "Ready for Play" : p?.active ? "Live" : p ? "Stopped" : "Idle"}</span>
    </div>
    {state.snapshots.length > 0 && <div className="profiler-view-controls"><button aria-label="Return to live profiling" aria-pressed={!state.selected} onClick={() => state.select(null)}>Live</button><select aria-label="Profiler view" value={state.selected ?? "live"} onChange={e => state.select(e.target.value === "live" ? null : e.target.value)}>
      <option value="live">Current session{state.profile?.active ? " · Live" : " · Stopped"}</option>{state.snapshots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select></div>}
    {p?.reason.startsWith("Source discovery unavailable:") && <div role="status" className="profiler-notice">{p.reason}</div>}
    {p?.waitingForPlay && !state.selected && <p className="profiler-ready-hint">Press Play in Unity to record prepared Gold benchmarks.</p>}
    {(error || state.error) && <div role="alert" className="profiler-notice">{error || state.error}<button aria-label="Dismiss profiling error" onClick={() => { setError(""); useProfiling.setState({ error: null }); }}>×</button></div>}
    {setup ? <div className="profiler-results profiler-settings">
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
      <div className="profiler-session">
        <span>Session <strong>{latest ? seconds(latest.atMs) : "0.00 s"}</strong>{selection ? ` · ${seconds(selection[1] - selection[0])} selected` : ""}</span>
        <button disabled={!samples.length} title="Select a time range; you can also drag across a graph" aria-label="Select time range" aria-expanded={rangeControls} onClick={() => setRangeControls(!rangeControls)}>↔</button>
        {selection && <button onClick={() => setRange(null)} title="Show full session">All</button>}
      </div>
      <div className="profiler-timelines">
        <div className="profiler-ruler"><span>{seconds(domain[0])}</span><span>{seconds((domain[0] + domain[1]) / 2)}</span><span>{seconds(domain[1])}</span></div>
        <Timeline label="Process Memory (RSS)" samples={samples} values={samples.map(s => s.residentBytes)} color="#80b7d7" format={bytes} domain={domain} selection={selection} onSelect={selectRange} />
        <Timeline label="Process CPU time (ms / interval)" samples={cpuSamples} values={cpu} color="#c9ba79" format={ms} domain={domain} selection={selection} onSelect={selectRange} />
        <div className="profiler-event-track" aria-label="Gold capture timeline">{(p?.captures ?? []).filter(c => c.startMs >= domain[0] && c.startMs <= domain[1]).map(c => <span key={c.id} title={`${c.name} · thread ${c.thread} · ${seconds(c.startMs)} → ${c.endMs === null ? "recording" : seconds(c.endMs)}`}
          style={{ left: `${Math.max(0, Math.min(100, (c.startMs - domain[0]) / (domain[1] - domain[0]) * 100))}%` }} />)}<small>Gold</small></div>
      </div>
      {rangeControls && <div className="profiler-range-controls">
        <label>From<input type="range" aria-label="Selection start" min={domain[0]} max={domain[1]} step="any" value={selection?.[0] ?? domain[0]} onChange={e => selectRange([Math.min(Number(e.target.value), selection?.[1] ?? domain[1]), selection?.[1] ?? domain[1]])} /></label>
        <label>To<input type="range" aria-label="Selection end" min={domain[0]} max={domain[1]} step="any" value={selection?.[1] ?? domain[1]} onChange={e => selectRange([selection?.[0] ?? domain[0], Math.max(Number(e.target.value), selection?.[0] ?? domain[0])])} /></label>
      </div>}
      <div className="profiler-tabs" role="tablist" aria-label="Profiling results">{(["Summary", "Gold", "Memory", "Events"] as Tab[]).map(t => <button key={t} id={`profiler-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="profiler-results" onClick={() => setTab(t)}>{t}</button>)}</div>
      {tab !== "Events" && benchmarkPicker}
      <div id="profiler-results" className="profiler-results" role="tabpanel" aria-labelledby={`profiler-tab-${tab}`}>
        {tab === "Summary" && <>
          <h3>Diagnostics overview</h3>
          {!p && <p>Attach to a process, or start Debug to record diagnostics.</p>}
          <dl className="profiler-metrics"><dt>{benchmark ? focused?.solo ? "Solo segments" : "Selected benchmark hits" : "Gold captures"}{selection ? " in selection" : ""}</dt><dd>{benchmark ? captures.length : allCaptures.length}</dd>
            <dt title="Mean per measured capture; overlapping and nested captures are not summed">Mean capture CPU</dt><dd>{averageCpu(captures)}</dd>
            <dt>Resident memory</dt><dd>{latest ? bytes(latest.residentBytes) : "—"}</dd>
            <dt>Threads</dt><dd>{latest?.threadCount ?? "—"}</dd></dl>
          <h3>Memory</h3>
          <div className="profiler-section-title"><span>Capture and compare observations</span><button disabled={!state.profile?.samples.length} onClick={takeSnapshot}>Take snapshot</button></div>
          <dl className="profiler-metrics"><dt title="Sum of selected capture cohorts; nested hits can include the same allocation">Cohort allocated (sum)</dt><dd>{p?.provider && captures.length ? bytes(sum(captures, "allocatedBytes")) : "—"}</dd><dt title="Sum of selected capture cohorts as of this view">Cohort live (sum)</dt><dd>{p?.provider && captures.length ? bytes(sum(captures, "liveBytes")) : "—"}</dd></dl>
          <button className="profiler-link" onClick={() => setTab("Gold")}>View Gold captures ({benchmark ? captures.length : allCaptures.length}) →</button>
          <button className="profiler-link" onClick={() => setTab("Memory")}>View memory snapshots ({snapshots.length}) →</button>
        </>}
        {tab === "Gold" && <>
          {benchmark ? <>
            <div className="profiler-section-title"><strong className="profiler-benchmark-name" title={focused?.name}>{focused ? `${focused.solo ? "Solo" : "Range"} · ${focused.name}` : "Selected benchmark"}</strong><span>{countLabel(captures.length, focused?.solo)}</span></div>
            {filters}
            {captures.length > 0 ? <>
              <dl className="profiler-metrics"><dt title="Mean per measured capture; overlapping and nested captures are not summed">Mean capture CPU</dt><dd>{averageCpu(captures)}</dd><dt title="Inclusive cohort sums; nested hits may track the same allocation">Allocated / live (sum)</dt><dd>{bytes(sum(captures, "allocatedBytes"))} / {bytes(sum(captures, "liveBytes"))}</dd></dl>
              <CaptureGraph label={focused?.solo ? "Thread CPU per segment" : "Thread CPU per hit"} hits={captures} value={c => c.cpuMs} format={ms} color="#c9ba79" />
              <CaptureGraph label={focused?.solo ? "Native live bytes per segment" : "Native live bytes per hit"} hits={captures} value={c => c.liveBytes} format={bytes} color="#80b7d7" />
              <details key={`${p?.id}:${benchmark}`} className="profiler-capture-group">
                <summary>Recorded {focused?.solo ? "segments" : "hits"}<span>{captures.length}</span></summary>
                {captures.map(c => <details key={c.id} className="profiler-hit"><summary>Thread {c.thread || "all"} · batch {c.batch}<span>{c.endMs === null ? state.selected ? "Open at snapshot" : "Recording" : ms(c.endMs - c.startMs)}</span></summary>
                  <dl className="profiler-metrics"><dt>Status</dt><dd>{c.status}</dd><dt>Thread CPU</dt><dd>{ms(c.cpuMs)}</dd><dt>Allocation count</dt><dd>{c.allocationCount}</dd><dt>Allocated</dt><dd>{bytes(c.allocatedBytes)}</dd><dt>Freed as of view</dt><dd>{bytes(c.freedBytes)}</dd><dt>Live as of view</dt><dd>{bytes(c.liveBytes)}</dd></dl>
                </details>)}
              </details>
            </> : <p className="profiler-empty">No captures for this benchmark in the selected view. Change the filters or choose another benchmark.</p>}
          </> : <>
            <h3>Process overview</h3>
            <p className="profiler-caption">Choose a Gold benchmark above to inspect its CPU and memory graphs. All Gold markers continue recording automatically.</p>
            {!benchmarks.length && <p className="profiler-empty">{p?.provider ? "No Gold hits in this view." : "Waiting for an instrumented Gold source provider."}</p>}
          </>}
        </>}
        {tab === "Memory" && <>
          <div className="profiler-section-title"><strong>Memory snapshots</strong><button disabled={!state.profile?.samples.length} onClick={takeSnapshot}>Take snapshot</button></div>
          {snapshotNote && <p role="status" className="profiler-caption">{snapshotNote}</p>}
          <p className="profiler-caption">Process RSS and the selected benchmark’s native allocations. Heap object capture is unavailable.</p>
          {snapshots.length ? <div className="profiler-table-scroll"><table><thead><tr><th>Snapshot</th><th>RSS</th><th>Δ RSS</th><th title="Sum of the selected benchmark’s capture cohorts">Live cohorts</th></tr></thead><tbody>{snapshots.map((s, i) => {
            const sample = s.profile.samples[s.profile.samples.length - 1]; const previous = snapshots[i - 1]?.profile.samples[snapshots[i - 1].profile.samples.length - 1];
            const snapshotHits = s.profile.captures.filter(c => c.marker === benchmark && matches(c, sample?.atMs));
            const delta = sample && previous ? sample.residentBytes - previous.residentBytes : null;
            return <tr key={s.id} className={state.selected === s.id ? "is-selected" : ""}><td><button title={s.name} onClick={() => state.select(s.id)}>#{i + 1} · {sample ? seconds(sample.atMs) : "—"}</button></td><td>{sample ? bytes(sample.residentBytes) : "—"}</td><td>{delta === null ? "—" : `${delta >= 0 ? "+" : "−"}${bytes(Math.abs(delta))}`}</td><td>{s.profile.provider && snapshotHits.length ? bytes(sum(snapshotHits, "liveBytes")) : "—"}</td></tr>;
          })}</tbody></table></div> : <p className="profiler-empty">Take a snapshot to compare memory over time.</p>}
          <h3>Native allocation cohorts{focused ? ` · ${focused.name}` : ""}</h3>
          {!benchmark && <p className="profiler-caption">Choose a Gold benchmark to inspect its allocation cohort.</p>}
          {filters}
          <dl className="profiler-metrics"><dt title="Inclusive sum across selected capture cohorts">Allocation count (sum)</dt><dd>{p?.provider && captures.length ? sum(captures, "allocationCount") : "—"}</dd><dt>Allocated (inclusive)</dt><dd>{p?.provider && captures.length ? bytes(sum(captures, "allocatedBytes")) : "—"}</dd><dt>Freed (inclusive)</dt><dd>{p?.provider && captures.length ? bytes(sum(captures, "freedBytes")) : "—"}</dd><dt>Still live (inclusive)</dt><dd>{p?.provider && captures.length ? bytes(sum(captures, "liveBytes")) : "—"}</dd></dl>
          <p className="profiler-caption">Instrumented allocations only. Nested capture cohorts can overlap. Frees after End update the original cohort; still live does not mean leaked.</p>
          <dl className="profiler-metrics"><dt>Virtual memory</dt><dd>{latest ? bytes(latest.virtualBytes) : "—"}</dd><dt>Managed heap / GC</dt><dd>Unavailable</dd></dl>
        </>}
        {tab === "Events" && <>
          <h3>Capture history and coverage</h3>
          <dl className="profiler-metrics"><dt>Older process samples</dt><dd>{p?.counters?.agedSamples ?? 0}</dd><dt>Older Gold hits</dt><dd>{p?.counters?.evictedCaptures ?? 0}</dd><dt>Rejected source events</dt><dd>{p?.counters?.rejectedEvents ?? p?.dropped ?? 0}</dd><dt>Missing source events</dt><dd>{p?.counters?.sourceGaps ?? 0}</dd><dt>Provider disconnects</dt><dd>{p?.counters?.disconnects ?? 0}</dd></dl>
          <p className="profiler-caption">Rolling history removes older samples and ordinary hits. Solo segments and live allocation cohorts stay retained. Source errors and disconnects are separate coverage gaps.</p>
          <h3>Debugger stops · {p?.pauses.length ?? 0}</h3>
          {(p?.pauses ?? []).map((pause, i) => <div className="profiler-event" key={i}><strong>{seconds(pause.startMs)} → {pause.endMs === null ? "Paused" : seconds(pause.endMs)}</strong><span>{pause.allThreads ? "All threads" : `DAP thread ${pause.thread ?? "unknown"}`} · {pause.reason}</span></div>)}
          {!p?.pauses.length && <p className="profiler-empty">No debugger stops recorded.</p>}
          <p className="profiler-caption">Range wall time includes debugger pauses. DAP thread IDs and native thread IDs are separate.</p>
          {p?.reason && <p>{p.reason}</p>}
        </>}
      </div>
      <div className="profiler-footer" title={p?.provider ? "Source events from the prepared native provider. Gutter intent requires a matching rebuilt target." : "Process metrics are available; Gold ranges require a prepared instrumented build."}>
        <span>{p?.waitingForPlay ? "Unity · ready for Play" : p?.provider ? "◆ Gold connected" : "Process metrics only"}</span><span title="History and source coverage details are in Events">{p?.counters ? p.counters.disconnects || p.counters.rejectedEvents || p.counters.sourceGaps ? "Coverage interrupted" : p.counters.agedSamples || p.counters.evictedCaptures ? "Rolling history" : `${samples.length} samples` : p?.dropped ? `${p.dropped} source rejections` : `${samples.length} samples`}</span>
      </div>
    </>}
  </div>;
}
