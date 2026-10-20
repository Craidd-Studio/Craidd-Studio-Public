import { useSolution } from "../store/solutionStore";
import { findFileTab } from "../types/project";
import { dispatchLinkedWindowCommand, useLinkedWindows } from "../store/linkedWindowsStore";

/** Share the owning-window guard across filesystem trees and document links. */
export async function openWorkspaceFile(path: string): Promise<void> {
  const linked = useLinkedWindows.getState();
  const hidden = linked.windows.find((item) => item.windowLabel === linked.viewedWindowLabel
    && item.windowLabel !== linked.ownWindowLabel && !item.visible && !item.restoring);
  if (hidden && (hidden.tabs.some((tab) => tab.path === path && tab.dirty)
    || (hidden.activeFile?.path === path && hidden.activeFile.dirty))) {
    throw new Error("Save this file in its owning window before editing it here.");
  }
  await useSolution.getState().openFile(path, path.split("/").pop() || path);
  if (!findFileTab(useSolution.getState().tabs, path)) throw new Error(`Could not open ${path}`);
  if (hidden) {
    linked.setRemoteEditing(true);
    await dispatchLinkedWindowCommand(hidden.windowLabel, "reveal_file", JSON.stringify({ file: path, line: 1 }));
  }
}
