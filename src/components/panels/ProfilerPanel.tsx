import { useRef, useState, type PointerEvent } from "react";
import { useProfiling, type GoldCapture, type ProfileSample } from "../../store/profilingStore";
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
type Tab = "Summary" | "Gold" | "Memory" | "Events";
type Span = [number, number];

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
  return <figure className="profiler-capture-chart"><figcaption>{label}<span>{measured.length ? `${measured.length} hits` : "Unavailable"}</span></figcaption>
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
  const p = state.selected ? state.snapshots.find(s => s.id === state.selected)?.profile : state.profile;
  const samples = p?.samples ?? [];
  const latest = samples[samples.length - 1];
  const domain: Span = [samples[0]?.atMs ?? 0, Math.max((samples[0]?.atMs ?? 0) + 1, latest?.atMs ?? 1)];
  const selection: Span | null = range?.id === p?.id && range
    ? [Math.max(domain[0], Math.min(domain[1], range.span[0])), Math.max(domain[0], Math.min(domain[1], range.span[1]))] : null;
  const selectRange = (span: Span) => { if (p) { setRange({ id: p.id, span }); setRangeControls(true); } };
  const captures = (p?.captures ?? []).filter(c => (thread === "all" || String(c.thread) === thread)
    && (batch === "all" || String(c.batch) === batch)
    && (!selection || c.startMs <= selection[1] && (c.endMs ?? domain[1]) >= selection[0]));
  const groups = new Map<string, GoldCapture[]>();
  for (const c of captures) groups.set(c.marker, [...(groups.get(c.marker) ?? []), c]);
  const threads = [...new Set(p?.captures.map(c => c.thread) ?? [])];
  const cpuSamples = samples.slice(1);
  const cpu = cpuSamples.map((s, i) => Math.max(0, s.cpuMs - samples[i].cpuMs));
  const snapshots = state.snapshots.filter(s => s.profile.id === p?.id);
  const fail = (e: unknown) => setError(String(e));
  const takeSnapshot = () => { state.snapshot(); setTab("Memory"); };
  const filters = <div className="profiler-filters">
    <select aria-label="Capture thread" value={thread} onChange={e => setThread(e.target.value)} title="Filters Gold results; does not suspend threads or filter process graphs">
      <option value="all">All threads</option>{threads.map(t => <option key={t} value={t}>Thread {t || "all (solo)"}</option>)}
    </select>
    <select aria-label="Capture batch" value={batch} onChange={e => setBatch(e.target.value)}>
      <option value="all">All batches</option>{Array.from({ length: p?.batch ?? 0 }, (_, i) => <option key={i} value={i + 1}>Batch {i + 1}</option>)}
    </select>
  </div>;
  return <div className="profiler-panel">
    <div className="profiler-toolbar" role="toolbar" aria-label="Profiling controls">
      <button onClick={() => window.dispatchEvent(new Event("craidd:attach-process"))}>Attach…</button>
      <span className="profiler-separator" />
      <button title="Take snapshot of current session — saves RSS and recorded allocation cohorts, not a heap dump" aria-label="Take memory snapshot" disabled={!state.profile?.samples.length} onClick={takeSnapshot}><span className="codicon codicon-device-camera" aria-hidden="true" /></button>
      <button title="Snapshot and record again" aria-label="Snapshot and record again" disabled={!state.profile?.active} onClick={() => { state.snapshot(); state.select(null); void state.again(); }}><span className="codicon codicon-debug-restart" aria-hidden="true" /></button>
      <button title="Stop profiling; leave process running" aria-label="Stop profiling" disabled={!state.profile?.active} onClick={() => void state.stop().catch(fail)}><span className="codicon codicon-debug-stop" aria-hidden="true" /></button>
      <span className="profiler-toolbar-space" />
      <button title="Profiling settings and source markers" aria-label="Profiling settings" aria-expanded={setup} onClick={() => setSetup(!setup)}><span className="codicon codicon-gear" aria-hidden="true" /></button>
    </div>
    <div className="profiler-target" title={p ? `${p.name} · PID ${p.target.pid} · start ${p.target.birth}` : "Attach to a process, or start Debug"}>
      <span className={`profiler-status ${p?.active && !state.selected ? "is-live" : ""}`} />
      <strong>{p ? `${p.name} · ${p.target.pid}` : "No process selected"}</strong>
      <span>{state.selected ? "Snapshot" : p?.active ? "Live" : p ? "Stopped" : "Idle"}</span>
    </div>
    {state.snapshots.length > 0 && <select className="profiler-view" aria-label="Profiler view" value={state.selected ?? "live"} onChange={e => state.select(e.target.value === "live" ? null : e.target.value)}>
      <option value="live">Current session</option>{state.snapshots.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>}
    {(error || state.error) && <div role="alert" className="profiler-notice">{error || state.error}<button aria-label="Dismiss profiling error" onClick={() => { setError(""); useProfiling.setState({ error: null }); }}>×</button></div>}
    {setup ? <div className="profiler-results profiler-settings">
      <div className="profiler-section-title"><strong>Profiling settings</strong><button onClick={() => setSetup(false)}>Done</button></div>
      <h3>Source markers · {gold.length}</h3>
      <p>Gold markers record automatically without pausing. Pairs end at their End marker; one solo records until the session ends.</p>
      {gold.map(g => <div key={g.id} className="profiler-marker">◆ {g.solo ? "Solo" : `${g.start} → ${g.end ?? "Awaiting End"}`} · {g.file.split("/").pop()}{g.condition ? ` · if ${g.condition}` : ""}</div>)}
      <button disabled={!file || dirty} title={dirty ? "Save and review source marker lines first" : "Export a C++ source copy using explicit Gold anchors"} onClick={() => { if (file) void useGold.getState().prepare(file).then(setPrepared).catch(fail); }}>Prepare source copy…</button>
      {prepared && <p className="select-text break-all">Prepared bundle: {prepared}. Read README.txt and build the copy.</p>}
      <h3>Native source provider</h3>
      <p>Attach requires a target built with Gold instrumentation. Debug launches receive this environment variable automatically.</p>
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
        <Timeline label="CPU time (ms / interval)" samples={cpuSamples} values={cpu} color="#c9ba79" format={ms} domain={domain} selection={selection} onSelect={selectRange} />
        <div className="profiler-event-track" aria-label="Gold capture timeline">{(p?.captures ?? []).filter(c => c.startMs >= domain[0] && c.startMs <= domain[1]).map(c => <span key={c.id} title={`${c.name} · thread ${c.thread} · ${seconds(c.startMs)} → ${c.endMs === null ? "recording" : seconds(c.endMs)}`}
          style={{ left: `${Math.max(0, Math.min(100, (c.startMs - domain[0]) / (domain[1] - domain[0]) * 100))}%` }} />)}<small>Gold</small></div>
      </div>
      {rangeControls && <div className="profiler-range-controls">
        <label>From<input type="range" aria-label="Selection start" min={domain[0]} max={domain[1]} step="any" value={selection?.[0] ?? domain[0]} onChange={e => selectRange([Math.min(Number(e.target.value), selection?.[1] ?? domain[1]), selection?.[1] ?? domain[1]])} /></label>
        <label>To<input type="range" aria-label="Selection end" min={domain[0]} max={domain[1]} step="any" value={selection?.[1] ?? domain[1]} onChange={e => selectRange([selection?.[0] ?? domain[0], Math.max(Number(e.target.value), selection?.[0] ?? domain[0])])} /></label>
      </div>}
      <div className="profiler-tabs" role="tablist" aria-label="Profiling results">{(["Summary", "Gold", "Memory", "Events"] as Tab[]).map(t => <button key={t} id={`profiler-tab-${t}`} role="tab" aria-selected={tab === t} aria-controls="profiler-results" onClick={() => setTab(t)}>{t}</button>)}</div>
      <div id="profiler-results" className="profiler-results" role="tabpanel" aria-labelledby={`profiler-tab-${tab}`}>
        {tab === "Summary" && <>
          <h3>Diagnostics overview</h3>
          {!p && <p>Attach to a process, or start Debug to record diagnostics.</p>}
          <dl className="profiler-metrics"><dt>Gold captures{selection ? " in selection" : ""}</dt><dd>{captures.length}</dd>
            <dt title="Mean per measured capture; overlapping and nested captures are not summed">Mean capture CPU</dt><dd>{averageCpu(captures)}</dd>
            <dt>Resident memory</dt><dd>{latest ? bytes(latest.residentBytes) : "—"}</dd>
            <dt>Threads</dt><dd>{latest?.threadCount ?? "—"}</dd></dl>
          <h3>Memory</h3>
          <div className="profiler-section-title"><span>Capture and compare observations</span><button disabled={!state.profile?.samples.length} onClick={takeSnapshot}>Take snapshot</button></div>
          <dl className="profiler-metrics"><dt>Tracked native allocations</dt><dd>{p?.provider ? bytes(sum(captures, "allocatedBytes")) : "—"}</dd><dt>Tracked native still live</dt><dd>{p?.provider ? bytes(sum(captures, "liveBytes")) : "—"}</dd></dl>
          <button className="profiler-link" onClick={() => setTab("Gold")}>View Gold captures ({captures.length}) →</button>
          <button className="profiler-link" onClick={() => setTab("Memory")}>View memory snapshots ({snapshots.length}) →</button>
        </>}
        {tab === "Gold" && <>
          {filters}
          {Array.from(groups, ([id, hits]) => <details key={`${p?.id}:${id}`} className="profiler-capture-group">
            <summary><span className="profiler-gold">◆</span> {hits[0].name || id}<span>{hits.length} hits</span></summary>
            <dl className="profiler-metrics"><dt title="Mean per measured capture; overlapping and nested captures are not summed">Mean capture CPU</dt><dd>{averageCpu(hits)}</dd><dt>Allocated / still live</dt><dd>{bytes(sum(hits, "allocatedBytes"))} / {bytes(sum(hits, "liveBytes"))}</dd></dl>
            <CaptureGraph label="Thread CPU per hit" hits={hits} value={c => c.cpuMs} format={ms} color="#c9ba79" />
            <CaptureGraph label="Native live bytes per hit" hits={hits} value={c => c.liveBytes} format={bytes} color="#80b7d7" />
            {hits.map(c => <details key={c.id} className="profiler-hit"><summary>Thread {c.thread || "all"} · batch {c.batch}<span>{c.endMs === null ? state.selected ? "Open at snapshot" : "Recording" : ms(c.endMs - c.startMs)}</span></summary>
              <dl className="profiler-metrics"><dt>Status</dt><dd>{c.status}</dd><dt>Thread CPU</dt><dd>{ms(c.cpuMs)}</dd><dt>Allocation count</dt><dd>{c.allocationCount}</dd><dt>Allocated</dt><dd>{bytes(c.allocatedBytes)}</dd><dt>Freed as of view</dt><dd>{bytes(c.freedBytes)}</dd><dt>Live as of view</dt><dd>{bytes(c.liveBytes)}</dd></dl>
            </details>)}
          </details>)}
          {!captures.length && <p className="profiler-empty">{p?.provider ? "No Gold hits in this view." : "Waiting for an instrumented Gold source provider."}</p>}
        </>}
        {tab === "Memory" && <>
          <div className="profiler-section-title"><strong>Memory snapshots</strong><button disabled={!state.profile?.samples.length} onClick={takeSnapshot}>Take snapshot</button></div>
          <p className="profiler-caption">RSS and tracked native allocations. Heap object capture is unavailable.</p>
          {snapshots.length ? <div className="profiler-table-scroll"><table><thead><tr><th>Snapshot</th><th>RSS</th><th>Δ RSS</th><th>Live native</th></tr></thead><tbody>{snapshots.map((s, i) => {
            const sample = s.profile.samples[s.profile.samples.length - 1]; const previous = snapshots[i - 1]?.profile.samples[snapshots[i - 1].profile.samples.length - 1];
            const delta = sample && previous ? sample.residentBytes - previous.residentBytes : null;
            return <tr key={s.id} className={state.selected === s.id ? "is-selected" : ""}><td><button title={s.name} onClick={() => state.select(s.id)}>#{i + 1} · {sample ? seconds(sample.atMs) : "—"}</button></td><td>{sample ? bytes(sample.residentBytes) : "—"}</td><td>{delta === null ? "—" : `${delta >= 0 ? "+" : "−"}${bytes(Math.abs(delta))}`}</td><td>{s.profile.provider ? bytes(sum(s.profile.captures, "liveBytes")) : "—"}</td></tr>;
          })}</tbody></table></div> : <p className="profiler-empty">Take a snapshot to compare memory over time.</p>}
          <h3>Native allocation cohorts</h3>
          {filters}
          <dl className="profiler-metrics"><dt>Allocations</dt><dd>{p?.provider ? sum(captures, "allocationCount") : "—"}</dd><dt>Allocated</dt><dd>{p?.provider ? bytes(sum(captures, "allocatedBytes")) : "—"}</dd><dt>Freed as of view</dt><dd>{p?.provider ? bytes(sum(captures, "freedBytes")) : "—"}</dd><dt>Still live as of view</dt><dd>{p?.provider ? bytes(sum(captures, "liveBytes")) : "—"}</dd></dl>
          <p className="profiler-caption">Explicitly instrumented allocations only. Frees after End update the original cohort; still live does not mean leaked.</p>
          <dl className="profiler-metrics"><dt>Virtual memory</dt><dd>{latest ? bytes(latest.virtualBytes) : "—"}</dd><dt>Managed heap / GC</dt><dd>Unavailable</dd></dl>
        </>}
        {tab === "Events" && <>
          <h3>Debugger stops · {p?.pauses.length ?? 0}</h3>
          {(p?.pauses ?? []).map((pause, i) => <div className="profiler-event" key={i}><strong>{seconds(pause.startMs)} → {pause.endMs === null ? "Paused" : seconds(pause.endMs)}</strong><span>{pause.allThreads ? "All threads" : `DAP thread ${pause.thread ?? "unknown"}`} · {pause.reason}</span></div>)}
          {!p?.pauses.length && <p className="profiler-empty">No debugger stops recorded.</p>}
          <p className="profiler-caption">Range wall time includes debugger pauses. DAP thread IDs and native thread IDs are separate.</p>
          {p?.reason && <p>{p.reason}</p>}
        </>}
      </div>
      <div className="profiler-footer" title={p?.provider ? "Source events from the prepared native provider. Gutter intent requires a matching rebuilt target." : "Process metrics are available; Gold ranges require a prepared instrumented build."}>
        <span>{p?.provider ? "◆ Gold connected" : "Process metrics only"}</span><span>{p?.dropped ? `${p.dropped} dropped · incomplete` : `${samples.length} samples`}</span>
      </div>
    </>}
  </div>;
}
