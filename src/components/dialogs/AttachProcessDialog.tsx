import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useProfiling } from "../../store/profilingStore";
import { useSolution } from "../../store/solutionStore";
import { useDebug } from "../../store/debugStore";

export interface ProcessTarget { pid: number; birth: number }
export interface ProcessInfo extends ProcessTarget { name: string; executable: string; cwd: string; uid: number; adapterHint: string; unityProject?: string | null }
interface Adapter { id: string; name: string; available: boolean }

export default function AttachProcessDialog({ onClose }: { onClose: () => void }) {
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [adapters, setAdapters] = useState<Adapter[]>([]);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProcessInfo | null>(null);
  const [adapter, setAdapter] = useState("lldb");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const project = useSolution(s => s.rootPath)?.replace(/\/$/, "");
  const panel = useRef<HTMLDivElement>(null);
  const refresh = async () => {
    setLoading(true); setError(null);
    try {
      const [targets, choices] = await Promise.all([invoke<ProcessInfo[]>("list_attach_processes"), invoke<Adapter[]>("attach_adapter_choices")]);
      const currentRoot = useSolution.getState().rootPath?.replace(/\/$/, "");
      const matching = currentRoot ? targets.filter(t => t.unityProject === currentRoot) : [];
      targets.sort((a, b) => Number(matching.includes(b)) - Number(matching.includes(a)));
      setProcesses(targets); setAdapters(choices);
      setSelected((old) => targets.find((target) => target.pid === old?.pid && target.birth === old.birth) ?? (matching.length === 1 ? matching[0] : null));
    } catch (failure) { setError(String(failure)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLInputElement>("input")?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
      if (event.key === "Tab") {
        const items = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input, select') ?? [])];
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); previous?.focus(); };
  }, [onClose, busy]);
  const matches = processes.filter((target) => `${target.pid} ${target.name} ${target.executable} ${target.adapterHint} ${target.unityProject ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const attach = async (profileOnly = false) => {
    if (!selected) return;
    setBusy(true); setError(null);
    try { if (profileOnly) { await useProfiling.getState().start(selected); window.dispatchEvent(new Event("craidd:show-profiler")); } else { await useDebug.getState().attach(selected, adapter); } onClose(); }
    catch (failure) { setError(String(failure)); setBusy(false); }
  };
  return <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
    <div ref={panel} role="dialog" aria-modal="true" aria-labelledby="attach-title" className="w-[780px] max-w-full rounded-lg border border-zinc-700 bg-zinc-900 text-zinc-200 shadow-2xl text-xs">
      <header className="px-5 py-4 border-b border-zinc-800 flex justify-between items-center"><h2 id="attach-title" className="text-base font-semibold">Attach to Process</h2><button type="button" aria-label="Close attach dialog" disabled={busy} onClick={onClose} className="px-2 py-1 hover:bg-zinc-800">×</button></header>
      <div className="p-5 space-y-3">
        <p className="text-zinc-400">Connect to a running process owned by your user. Detach leaves it running.</p>
        <div className="flex gap-2"><input aria-label="Search processes" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Name, executable, PID or adapter hint" className="flex-1 min-w-0 rounded border border-zinc-600 bg-zinc-950 px-3 py-2"/><button type="button" disabled={loading || busy} onClick={() => void refresh()} className="rounded border border-zinc-600 px-3 py-1 disabled:opacity-50">Refresh</button></div>
        <div role="listbox" aria-label="Running processes" className="max-h-72 overflow-auto border border-zinc-700 rounded">
          {loading && <p role="status" className="p-3 text-zinc-400">Reading processes…</p>}
          {!loading && matches.length === 0 && <p className="p-3 text-zinc-400">No matching accessible processes.</p>}
          {!loading && matches.map((target) => <button key={`${target.pid}:${target.birth}`} type="button" role="option" aria-selected={selected?.pid === target.pid && selected.birth === target.birth}
            onClick={() => setSelected(target)} className={"w-full text-left px-3 py-2 border-b border-zinc-800 flex gap-3 items-start " + (selected?.pid === target.pid && selected.birth === target.birth ? "bg-blue-950 text-blue-100" : "hover:bg-zinc-800")}>
            <span className="w-16 shrink-0 tabular-nums text-zinc-400">{target.pid}</span><span className="min-w-0 flex-1"><span className="block">{target.name}{target.unityProject && target.unityProject === project && <span className="ml-2 text-amber-200">Unity · this project</span>}</span><span className="block text-[11px] text-zinc-400 break-all">{target.executable}</span></span><span className="max-w-44 text-[11px] text-zinc-400">{target.adapterHint}</span>
          </button>)}
        </div>
        <label className="block">Debugger adapter<select value={adapter} onChange={(e) => setAdapter(e.target.value)} className="mt-1 block w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-2">{adapters.map((choice) => <option key={choice.id} value={choice.id} disabled={!choice.available}>{choice.name}{choice.available ? "" : " · not found"}</option>)}</select></label>
        {selected?.unityProject && <p className="text-amber-200">Unity Editor selected. Profile only connects prepared Gold hooks automatically; press Play in Unity. Native debugger attach remains a separate choice.</p>}
        {selected && <p className="text-zinc-400 break-all">Working directory: {selected.cwd || "Unavailable"}</p>}
        <p className="text-zinc-500">Hints do not select an adapter. Unity C# endpoints require a separately qualified adapter; LLDB-DAP targets native code.</p>
        {error && <p role="alert" className="text-amber-300 whitespace-pre-wrap break-words">{error}</p>}
      </div>
      <footer className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-2"><button type="button" onClick={onClose} disabled={busy} className="px-3 py-1.5">Cancel</button><button type="button" onClick={() => void attach(true)} disabled={busy || !selected || !matches.includes(selected)} className={"px-3 py-1.5 rounded disabled:opacity-40 " + (selected?.unityProject ? "bg-blue-700 hover:bg-blue-600 border border-blue-600" : "border border-zinc-600")}>Profile only</button><button type="button" onClick={() => void attach()} disabled={busy || !selected || !matches.includes(selected) || !adapters.some((a) => a.id === adapter && a.available)} className={"px-3 py-1.5 rounded disabled:opacity-40 " + (selected?.unityProject ? "border border-zinc-600 hover:bg-zinc-800" : "bg-blue-700 hover:bg-blue-600")}>{busy ? "Connecting…" : "Attach debugger"}</button></footer>
    </div>
  </div>;
}
