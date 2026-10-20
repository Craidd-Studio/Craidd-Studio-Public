import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { MetricSource } from "../types/profileSource";

export function metricAction<T>(request: Record<string, unknown>): Promise<T> {
  const started = performance.now();
  return invoke<T>("metric_action", { request }).finally(() => {
    if (request.op !== "graph" && request.op !== "row") return;
    // Retain one measurement per bounded query kind, not a growing trace.
    // This includes native queuing/IPC as well as the query, not UI painting.
    const name = `craidd.metrics.${request.op}`;
    performance.clearMeasures(name);
    performance.measure(name, { start: started, end: performance.now() });
  });
}
export interface MetricView {
  column: number; span: [number, number]; rowIndex: number; inspected: number | null;
  settings: boolean; scrollTop: number; showWorst: boolean;
}
interface State {
  active: boolean; sources: MetricSource[]; selected: string; table: number;
  error: string; busy: boolean;
  views: Record<string, MetricView>;
  saveView: (key: string, view: MetricView) => void;
  setActive: (active: boolean) => void; choose: (selected: string) => void;
  setTable: (table: number) => void; setError: (error: string) => void;
  start: (paths: string[], snapshot?: boolean) => Promise<void>;
  refresh: (id: string) => Promise<void>; remove: (id: string) => Promise<void>;
}
// Source identities and native storage survive switching Profiler presentations.
// Only bounded metadata lives in Zustand; CSV rows never enter the global store.
export const useMetrics = create<State>((set, get) => ({
  active: false, sources: [], selected: "", table: 0, error: "", busy: false, views: {},
  saveView: (key, view) => set(s => ({ views: Object.fromEntries([...Object.entries(s.views).filter(([id]) => id !== key), [key, view]].slice(-16)) })),
  setActive: active => set({ active }), choose: selected => set({ selected, table: 0, error: "" }),
  setTable: table => set({ table, error: "" }), setError: error => set({ error }),
  refresh: async id => {
    const source = await metricAction<MetricSource>({ op: "status", id });
    set(s => ({ sources: [...s.sources.filter(v => v.id !== id), source] }));
  },
  start: async (paths, snapshot = false) => {
    set({ error: "", busy: true });
    try {
      const { id } = await metricAction<{ id: string }>({ op: "start", paths, snapshot });
      set({ selected: id, table: 0, active: true });
      for (;;) {
        await get().refresh(id);
        if (get().sources.find(s => s.id === id)?.state !== "loading") break;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (e) { set({ error: String(e) }); }
    finally { set({ busy: false }); }
  },
  remove: async id => {
    await metricAction({ op: "dispose", id });
    set(s => ({ sources: s.sources.filter(v => v.id !== id), selected: s.selected === id ? s.sources.find(v => v.id !== id)?.id ?? "" : s.selected, table: 0,
      views: Object.fromEntries(Object.entries(s.views).filter(([key]) => !key.startsWith(id + ":"))) }));
  },
}));
