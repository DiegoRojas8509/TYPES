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
  /**
   * Recharts rows: `{ label, idx, s0, s1, ... }`, one per label. The x axis uses `idx`
   * (never `label`), so two rows with the same label stay two separate points.
   */
  rows: Record<string, string | number | null>[];
  /** No labels or no series: nothing to draw. */
  empty: boolean;
  pie: { slices: PieSlice[]; seriesName: string; extraSeries: boolean };
}

import { cellText as text, isObj, type Raw } from "./raw";

export type ChartRaw = Raw;

/** Finite numbers and strings that parse as one ("12.5"); anything else is a gap. */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function readSeries(raw: unknown, labelCount: number): PreparedSeries[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((s, i) => {
    const obj: { name?: unknown; values?: unknown } = isObj(s) ? s : {};
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
    const row: Record<string, string | number | null> = { label, idx: i };
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
//
// Edits are made on the node's RAW arrays, never on the hardened display data:
// a cell edit must not rewrite what the user did not touch (a gap stays a gap,
// "n/a" stays "n/a", extra fields on a series and values beyond the labels
// survive, a non-object series entry stays as found). Each helper returns NEW
// arrays; untouched entries keep their identity and are never mutated.

export interface ChartPatch {
  labels: unknown[];
  series: unknown[];
}

const rawLabels = (raw: Raw): unknown[] => (Array.isArray(raw.labels) ? raw.labels : []);
const rawSeries = (raw: Raw): unknown[] => (Array.isArray(raw.series) ? raw.series : []);
const valuesOf = (s: unknown): unknown[] | null => (isObj(s) && Array.isArray(s.values) ? s.values : null);

/**
 * Sets one value. A series shorter than the edited row is padded with 0 only up
 * to that row (the stored array cannot hold a gap before a real value); every
 * other element is left exactly as found. A series entry that is not an object
 * (or whose `values` is not an array) is rebuilt, since the user touched it.
 */
export function setValue(raw: Raw, row: number, serie: number, value: number): ChartPatch {
  return {
    labels: [...rawLabels(raw)],
    series: rawSeries(raw).map((s, j) => {
      if (j !== serie) return s;
      const values = [...(valuesOf(s) ?? [])];
      while (values.length < row) values.push(0);
      values[row] = value;
      return { ...(isObj(s) ? s : { name: `Serie ${j + 1}` }), values };
    }),
  };
}

export const renameLabel = (raw: Raw, row: number, name: string): ChartPatch => ({
  labels: rawLabels(raw).map((l, i) => (i === row ? name : l)),
  series: [...rawSeries(raw)],
});

export const renameSeries = (raw: Raw, serie: number, name: string): ChartPatch => ({
  labels: [...rawLabels(raw)],
  series: rawSeries(raw).map((s, j) => (j !== serie ? s : isObj(s) ? { ...s, name } : { name, values: [] })),
});

/**
 * Appends a label. Only a series that was already exactly full-length gets a 0
 * for the new column: a shorter one already has implicit gaps (the new label is
 * just one more), and a longer one already holds a value for it. Non-object
 * entries and series without a `values` array are left alone.
 */
export function addLabel(raw: Raw): ChartPatch {
  const labels = rawLabels(raw);
  return {
    labels: [...labels, `Etiqueta ${labels.length + 1}`],
    series: rawSeries(raw).map((s) => {
      const values = valuesOf(s);
      return values && values.length === labels.length ? { ...(s as object), values: [...values, 0] } : s;
    }),
  };
}

/** Removes the label at `row` and that index from every series' `values` (when it has one). */
export const removeLabel = (raw: Raw, row: number): ChartPatch => ({
  labels: rawLabels(raw).filter((_, i) => i !== row),
  series: rawSeries(raw).map((s) => {
    const values = valuesOf(s);
    return values && row < values.length ? { ...(s as object), values: values.filter((_, i) => i !== row) } : s;
  }),
});

export const addSeries = (raw: Raw): ChartPatch => {
  const series = rawSeries(raw);
  return {
    labels: [...rawLabels(raw)],
    series: [...series, { name: `Serie ${series.length + 1}`, values: rawLabels(raw).map(() => 0) }],
  };
};

export const removeSeries = (raw: Raw, serie: number): ChartPatch => ({
  labels: [...rawLabels(raw)],
  series: rawSeries(raw).filter((_, j) => j !== serie),
});
