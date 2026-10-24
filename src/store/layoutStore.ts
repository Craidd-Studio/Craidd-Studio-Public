import { create } from "zustand";

interface LayoutState {
  profilerFocus: boolean;
  setProfilerFocus: (focus:boolean)=>void;
  activeView: "solution" | "search" | "docs" | "debug" | "settings";
  setActiveView: (v: "solution" | "search" | "docs" | "debug" | "settings") => void;
  discoveryReveal: { path: string; serial: number } | null;
  revealInDiscovery: (path: string) => void;
  sidebarWidth: number;
  setSidebarWidth: (n: number) => void;
  rightPanelWidth: number;
  setRightPanelWidth: (n: number) => void;
  bottomPanelHeight: number;
  setBottomPanelHeight: (n: number) => void;

  // Sidebar sections split (Solution on top, Discovery on bottom)
  solutionExplorerRatio: number;   // 0..1, fraction of sidebar height for Solution
  setSolutionExplorerRatio: (r: number) => void;
}

export const useLayout = create<LayoutState>((set) => ({
  profilerFocus:false, setProfilerFocus:profilerFocus=>set({profilerFocus}),
  activeView: "solution",
  setActiveView: (v) => set({ activeView: v }),
  discoveryReveal: null,
  revealInDiscovery: (path) => set((s) => ({ activeView: "solution", discoveryReveal: { path, serial: (s.discoveryReveal?.serial ?? 0) + 1 } })),
  sidebarWidth: 288,
  setSidebarWidth: (n) => set({ sidebarWidth: Math.max(180, Math.min(500, n)) }),
  rightPanelWidth: 288,
  setRightPanelWidth: (n) => set({ rightPanelWidth: Math.max(180, Math.min(500, n)) }),
  bottomPanelHeight: 192,
  setBottomPanelHeight: (n) => set({ bottomPanelHeight: Math.max(80, Math.min(600, n)) }),
  solutionExplorerRatio: 0.55,
  setSolutionExplorerRatio: (r) => set({ solutionExplorerRatio: Math.max(0.2, Math.min(0.8, r)) }),
}));
