/** Shared envelope only. Payloads keep their own measurement semantics. */
export type ColumnMeaning = "gauge" | "counter" | "rate" | "window statistic" | "unknown";
export interface MetricColumn { name: string; numeric: boolean; unit: string; meaning: ColumnMeaning; unitSuggested: boolean; meaningSuggested: boolean }
export interface MetricAxis { kind: "ordinal" | "elapsed" | "epoch" | "iso8601"; column: number | null; windowSeconds: number | null }
export interface MetricMetadata {
  sourceId: string;
  path: string; size: number; modifiedMs: number; sha256: string;
  columns: MetricColumn[]; coverage: { records: number; retained: number; invalid: number; emptyCells: number; unsupported: number; unterminated: number; missingColumns: number; examples: string[] };
  axis: MetricAxis; generation: number; interpretationRevision: number;
  completion: string; schemaSidecar: string | null; snapshot: boolean; originalRange: [number, number] | null;
}
export interface MetricJoin { left: number; right: number; leftColumn: number; rightColumn: number; tolerance: number | null }
export interface MetricSource {
  paths: string[];
  id: string; kind: "importedMetrics"; state: string; error: string | null;
  bytesRead: number; totalBytes: number; tables: MetricMetadata[]; rows: number[]; joins: MetricJoin[];
  memoryBytes: number; maxMemoryBytes: number; maxRows: number; maxFileBytes: number; maxSets: number;
}
export interface MetricRow { truncatedColumns?: number[]; index: number; line: number; x: number; cells: (number | string | null)[] }
export interface MetricInspection { row: MetricRow; companions: { table: number; state: string; row: MetricRow | null }[] }
export interface MetricGraph { column: number; points: { x: number; until: number; min: number; max: number }[]; start: number; end: number; xStart: number; xEnd: number }
