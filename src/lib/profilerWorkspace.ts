import { useSolution } from "../store/solutionStore";
import { usePreferences } from "../store/preferencesStore";
import { useLinkedWindows } from "../store/linkedWindowsStore";
import { useSplit } from "../store/splitStore";
import { setActiveEditor } from "./activeEditor";

/** Explicit presentation action; never starts/stops a collector. */
export function openProfilerWorkspace(): void {
  useSplit.getState().setSideFocused(false);
  setActiveEditor(null);
  useSolution.getState().openProfiler();
  const linked = useLinkedWindows.getState();
  if (linked.viewedWindowLabel !== linked.ownWindowLabel) linked.setRemoteEditing(true);
}

/** Shell-owned routing works even when the right panel is unmounted. */
export function showProfiler(): void {
  if (useSolution.getState().tabs.some((tab) => tab.kind === "profiler")) openProfilerWorkspace();
  else {
    const prefs = usePreferences.getState();
    prefs.setRightPanelTab("profiler");
    if (!prefs.rightPanelVisible) prefs.toggleRightPanel();
  }
}
