// Pure data helpers of the chart block. The chart data of a `.canvas` can be
// hand-written or edited by Claude, so nothing is trusted: `prepareChartData` is
// the ONE place that hardens it for display. Edits go through the `editableData`
// helpers, which write back normalized NEW arrays.

export type ChartKind = "bar" | "line" | "pie";
export const KINDS: ChartKind[] = ["bar", "line", "pie"];

export interface PreparedSeries {
  name: string;
  /** One entry per label; `null` is a gap (missing or not a finite number), never 0. */
  values: (number | null)[];
}
export interface PieSlice {
  name: string;
  value: number;
  /** Position of the label, so a slice keeps its colour when its neighbours are skipped. */
  index: number;
}
export interface PreparedChart {
  kind: ChartKind;
  title: string;
  labels: string[];
  series: PreparedSeries[];
  /** Recharts rows: `{ label, s0, s1, ... }`, one per label. */
  rows: Record<string, string | number | null>[];
  /** No labels or no series: nothing to draw. */
  empty: boolean;
  pie: { slices: PieSlice[]; seriesName: string; extraSeries: boolean };
}

type Raw = Record<string, unknown>;

/** Finite numbers and strings that parse as one ("12.5"); anything else is a gap. */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const text = (v: unknown): string => String(v ?? "");

function readSeries(raw: unknown, labelCount: number): PreparedSeries[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => {
    const obj = s !== null && typeof s === "object" ? (s as { name?: unknown; values?: unknown }) : {};
    const values = Array.isArray(obj.values) ? obj.values : [];
    return {
      name: obj.name === undefined || obj.name === null || obj.name === "" ? `Serie ${i + 1}` : text(obj.name),
      // Exactly one entry per label: short lists leave gaps, long ones are cut.
      values: Array.from({ length: labelCount }, (_, k) => toNumber(values[k])),
    };
  });
}

export function prepareChartData(raw: Raw): PreparedChart {
  const kind = KINDS.includes(raw.kind as ChartKind) ? (raw.kind as ChartKind) : "bar";
  const labels = Array.isArray(raw.labels) ? raw.labels.map(text) : [];
  const series = readSeries(raw.series, labels.length);
  const rows = labels.map((label, i) => {
    const row: Record<string, string | number | null> = { label };
    series.forEach((s, j) => {
      row[`s${j}`] = s.values[i];
    });
    return row;
  });
  const first = series[0];
  const slices: PieSlice[] = first
    ? labels.flatMap((name, index) => {
        const value = first.values[index];
        return value !== null && value > 0 ? [{ name, value, index }] : [];
      })
    : [];
  return {
    kind,
    title: typeof raw.title === "string" ? raw.title : "",
    labels,
    series,
    rows,
    empty: labels.length === 0 || series.length === 0,
    pie: { slices, seriesName: first?.name ?? "", extraSeries: series.length > 1 },
  };
}

/**
 * What a number field commits. Empty means 0: the stored `values` are plain
 * numbers (no null in the file), so clearing a cell stores 0 rather than keeping
 * the previous value. Text that is not a number (yet), like "-", returns null:
 * the field keeps it locally and commits nothing. Comma decimals are accepted.
 */
export function parseNumberInput(raw: string): number | null {
  const s = raw.trim().replace(",", ".");
  if (s === "") return 0;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// ---- editing ---------------------------------------------------------------

export interface EditableData {
  labels: string[];
  series: { name: string; values: number[] }[];
}

/**
 * The data as the grid edits it: labels and series normalized to what the file
 * should hold. Gaps (missing or invalid values) become 0 here, so editing one
 * cell also writes the repairs for the others. Opening the grid writes nothing.
 */
export function editableData(raw: Raw): EditableData {
  const p = prepareChartData(raw);
  return { labels: p.labels, series: p.series.map((s) => ({ name: s.name, values: s.values.map((v) => v ?? 0) })) };
}

export const setValue = (d: EditableData, row: number, serie: number, value: number): EditableData => ({
  labels: d.labels,
  series: d.series.map((s, j) => (j === serie ? { ...s, values: s.values.map((v, i) => (i === row ? value : v)) } : s)),
});
export const renameLabel = (d: EditableData, row: number, name: string): EditableData => ({
  labels: d.labels.map((l, i) => (i === row ? name : l)),
  series: d.series,
});
export const renameSeries = (d: EditableData, serie: number, name: string): EditableData => ({
  labels: d.labels,
  series: d.series.map((s, j) => (j === serie ? { ...s, name } : s)),
});
export const addLabel = (d: EditableData): EditableData => ({
  labels: [...d.labels, `Etiqueta ${d.labels.length + 1}`],
  series: d.series.map((s) => ({ ...s, values: [...s.values, 0] })),
});
export const removeLabel = (d: EditableData, row: number): EditableData => ({
  labels: d.labels.filter((_, i) => i !== row),
  series: d.series.map((s) => ({ ...s, values: s.values.filter((_, i) => i !== row) })),
});
export const addSeries = (d: EditableData): EditableData => ({
  labels: d.labels,
  series: [...d.series, { name: `Serie ${d.series.length + 1}`, values: d.labels.map(() => 0) }],
});
export const removeSeries = (d: EditableData, serie: number): EditableData => ({
  labels: d.labels,
  series: d.series.filter((_, j) => j !== serie),
});
