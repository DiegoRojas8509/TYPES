// Pure data helpers of the table block. A `.canvas` can be hand-written or edited
// by Claude, so `columns` and `rows` may be missing, ragged or hold non-strings:
// everything shown goes through `tableView`, and every edit writes back normalized
// data (each row exactly `columns.length` strings) as NEW arrays.

export interface TableData {
  columns: string[];
  rows: string[][];
}

type Raw = Record<string, unknown>;

const cellText = (v: unknown): string => String(v ?? "");

/** The table as it is displayed: strings only, rows padded or truncated to the column count. */
export function tableView(raw: Raw): TableData {
  const cols = Array.isArray(raw.columns) ? raw.columns.map(cellText) : [];
  const rawRows: unknown[][] = Array.isArray(raw.rows) ? raw.rows.map((r) => (Array.isArray(r) ? r : [])) : [];
  // No headers at all: keep as many (empty) columns as the widest row has, and at least one.
  const width = cols.length > 0 ? cols.length : Math.max(1, ...rawRows.map((r) => r.length));
  const columns = cols.length > 0 ? cols : Array.from({ length: width }, () => "");
  const rows = rawRows.map((r) => Array.from({ length: width }, (_, i) => cellText(r[i])));
  return { columns, rows };
}

export const setCell = (raw: Raw, r: number, c: number, value: string): TableData => {
  const t = tableView(raw);
  return { columns: t.columns, rows: t.rows.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)) };
};

export const setHeader = (raw: Raw, c: number, value: string): TableData => {
  const t = tableView(raw);
  return { columns: t.columns.map((h, j) => (j === c ? value : h)), rows: t.rows };
};

export const addRow = (raw: Raw): TableData => {
  const t = tableView(raw);
  return { columns: t.columns, rows: [...t.rows, t.columns.map(() => "")] };
};

export const addColumn = (raw: Raw): TableData => {
  const t = tableView(raw);
  return { columns: [...t.columns, ""], rows: t.rows.map((row) => [...row, ""]) };
};

export const deleteRow = (raw: Raw, r: number): TableData => {
  const t = tableView(raw);
  return { columns: t.columns, rows: t.rows.filter((_, i) => i !== r) };
};

/** Removes a column; the last remaining one is kept (a table needs at least one). */
export const deleteColumn = (raw: Raw, c: number): TableData => {
  const t = tableView(raw);
  if (t.columns.length <= 1) return t;
  return { columns: t.columns.filter((_, j) => j !== c), rows: t.rows.map((row) => row.filter((_, j) => j !== c)) };
};

// "12", "-3,5", "$1,200.50", "40%", "+2"
const NUMERIC = /^[-+]?\$?\s*\d[\d,.\s]*%?$/;

/** Which columns hold only numbers (ignoring empty cells): they are right-aligned. Display only. */
export function numericColumns(columns: string[], rows: string[][]): boolean[] {
  return columns.map((_, c) => {
    const filled = rows.map((r) => (r[c] ?? "").trim()).filter((v) => v !== "");
    return filled.length > 0 && filled.every((v) => NUMERIC.test(v));
  });
}
