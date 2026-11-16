import { useSolution } from "../store/solutionStore";
import type { RoutingDeps } from "./editorModelSync";

/** The store-backed routing deps. The model uri for a tab is whatever `Uri.parse(fileId)` gives, as in the bridge's `modelFor`. */
export function editorRouting(monaco: { Uri: { parse(path: string): { toString(): string } } }): RoutingDeps {
  return {
    tabs: () => useSolution.getState().tabs,
    uriOf: (fileId) => monaco.Uri.parse(fileId).toString(),
    update: (fileId, content) => useSolution.getState().updateTabContent(fileId, content),
  };
}
