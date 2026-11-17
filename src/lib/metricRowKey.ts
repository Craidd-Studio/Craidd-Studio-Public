import type { MetricAxis, MetricColumn, MetricRow } from "../types/profileSource";

/** A row locator is display context. It never declares a clock or changes ranking. */
export function worstKeyColumn(columns: readonly MetricColumn[], axis: MetricAxis, chosen: number | null): number | null {
  if (axis.kind !== "ordinal" && axis.column !== null && columns[axis.column]) return axis.column;
  if (chosen !== null && Number.isInteger(chosen) && columns[chosen]) return chosen;
  const index = columns.findIndex(c => (c.numeric && ["s", "ms", "us"].includes(c.unit)) || /(^|_)(elapsed|time|timestamp)(_|$)/i.test(c.name));
  return index < 0 ? null : index;
}
export function worstKeyValue(row: MetricRow, axis: MetricAxis, key: number | null): number | string | null {
  if (key === null) return null;
  if (axis.kind !== "ordinal" && key === axis.column) {
    if (axis.kind === "epoch" || axis.kind === "iso8601") {
      const date = new Date(row.x * 1000);
      return Number.isFinite(date.getTime()) ? date.toISOString() : row.x;
    }
    return row.x; // Axis already normalizes elapsed ms/us to seconds; cells stay original.
  }
  return row.cells[key] ?? null;
}
