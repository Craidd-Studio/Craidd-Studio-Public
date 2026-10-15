import type { GoldCapture } from "../store/profilingStore";

export interface GoldBenchmark { marker: string; name: string; solo: boolean; hits: number }

// Use recorded identities, not current source intent: editing a marker must not
// relabel captures already recorded by another build or in a snapshot.
export function goldBenchmarks(captures: GoldCapture[]): GoldBenchmark[] {
  const groups = new Map<string, GoldBenchmark>();
  for (const capture of captures) {
    const group = groups.get(capture.marker);
    if (group) group.hits++;
    else groups.set(capture.marker, {
      marker: capture.marker, name: capture.name || capture.marker, solo: capture.solo, hits: 1,
    });
  }
  return [...groups.values()].sort((a, b) => Number(b.solo) - Number(a.solo));
}

// undefined means the user has not chosen yet; null is an explicit process
// overview. Preserve explicit marker IDs even when this view has no such hits.
export function resolveGoldBenchmark(benchmarks: GoldBenchmark[], chosen: string | null | undefined): string | null {
  return chosen === undefined ? benchmarks.find(b => b.solo)?.marker ?? null : chosen;
}
