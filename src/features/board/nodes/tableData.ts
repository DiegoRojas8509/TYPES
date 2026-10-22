// Pure data helpers of the table block. A `.canvas` can be hand-written or edited
// by Claude, so `columns` and `rows` may be missing, ragged or hold non-strings,
// objects or nested arrays.
//
// Two separate paths, as in chartData.ts:
//  - DISPLAY goes through `tableView` (coerces to strings, pads, previews objects as
//    JSON) and `tableLocks` (which of those cells the grid must not edit).
//  - WRITES patch the node's RAW `columns` and `rows`: only the touched header, row
//    or cell changes, and every other entry is carried over exactly as found (same
//    identity, numbers stay numbers, null stays null). Each helper returns NEW
//    outer arrays and never mutates. A `columns` or `rows` that is not an array
//    counts as empty.
//
// What the grid will not edit: a row that is not an array (a string, null or an
// OBJECT) and any header or cell that is an object or array. They are shown as
// read-only text, and the writers are no-ops on them: Claude can edit them from
// the chat, but a keystroke in the grid can never rewrite them. Whole rows can
// still be deleted.
//
// The user's data wins over tidiness: a table is never truncated. When an ARRAY row
// has more cells than there are headers, the display shows extra empty headers, and
// the writers that change the structure (`setHeader`, `addRow`, `deleteRow`,
// `addColumn`, `deleteColumn`) extend `columns` with "" up to the widest array row.
// `setCell` leaves `columns` alone. Short rows are padded only when a cell past
// their end is edited.

import { isObj, list, type Raw } from "./raw";

export interface TableData {
  columns: string[];
  rows: string[][];
}

/** What a writer returns: the node's `columns` and `rows`, as written back. */
export interface TablePatch {
  columns: unknown[];
  rows: unknown[];
}

export interface TableLocks {
  headers: boolean[];
  /** One list per row, same width as the displayed table. */
  rows: boolean[][];
}

const PREVIEW_MAX = 60;

/** Readable text of one value: primitives as text, an object or array as truncated JSON (never "[object Object]"). */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v !== "object") return String(v);
  const json = JSON.stringify(v);
  return json.length > PREVIEW_MAX ? `${json.slice(0, PREVIEW_MAX)}…` : json;
}

/** A row's cells as shown: an array as is; an object its values; a lone primitive its first cell; null nothing. */
function rowCells(r: unknown): unknown[] {
  if (Array.isArray(r)) return r;
  if (isObj(r)) return Object.values(r);
  return r !== null && r !== undefined ? [r] : [];
}

const widthOf = (raw: Raw): number =>
  Math.max(1, list(raw.columns).length, ...list(raw.rows).map((r) => rowCells(r).length));

/** The table as displayed: strings only, as wide as its widest row or header list, never truncated. */
export function tableView(raw: Raw): TableData {
  const cols = list(raw.columns).map(cellText);
  const rawRows = list(raw.rows).map((r) => rowCells(r).map(cellText));
  const width = widthOf(raw);
  return {
    columns: Array.from({ length: width }, (_, i) => cols[i] ?? ""),
    rows: rawRows.map((r) => Array.from({ length: width }, (_, i) => r[i] ?? "")),
  };
}

const nested = (v: unknown): boolean => v !== null && typeof v === "object";

/** Cells the grid shows read-only: every cell of a non-array row, and object or array headers and cells. */
export function tableLocks(raw: Raw): TableLocks {
  const width = widthOf(raw);
  const cols = list(raw.columns);
  return {
    headers: Array.from({ length: width }, (_, i) => nested(cols[i])),
    rows: list(raw.rows).map((r) =>
      Array.from({ length: width }, (_, i) => !Array.isArray(r) || nested(r[i])),
    ),
  };
}

const rawColumns = (raw: Raw): unknown[] => list(raw.columns);
const rawRows = (raw: Raw): unknown[] => list(raw.rows);

/** The widest ARRAY row: the width the headers are extended to on a column-position write. */
const arrayWidth = (raw: Raw): number =>
  Math.max(1, rawColumns(raw).length, ...rawRows(raw).map((r) => (Array.isArray(r) ? r.length : 0)));

/** The headers padded with "" to `width`, as a NEW array. */
const paddedColumns = (raw: Raw, width: number): unknown[] => {
  const cols = [...rawColumns(raw)];
  while (cols.length < width) cols.push("");
  return cols;
};

export function setCell(raw: Raw, r: number, c: number, value: string): TablePatch {
  const rows = rawRows(raw);
  const row = rows[r];
  if (!Array.isArray(row) || nested(row[c])) return { columns: rawColumns(raw), rows };
  const cells = [...row];
  while (cells.length < c) cells.push("");
  cells[c] = value;
  return { columns: rawColumns(raw), rows: rows.map((x, i) => (i === r ? cells : x)) };
}

export function setHeader(raw: Raw, c: number, value: string): TablePatch {
  const cols = paddedColumns(raw, Math.max(arrayWidth(raw), c + 1));
  if (nested(cols[c])) return { columns: rawColumns(raw), rows: rawRows(raw) };
  cols[c] = value;
  return { columns: cols, rows: rawRows(raw) };
}

export function addRow(raw: Raw): TablePatch {
  const columns = paddedColumns(raw, arrayWidth(raw));
  return { columns, rows: [...rawRows(raw), columns.map(() => "")] };
}

export const addColumn = (raw: Raw): TablePatch => ({
  columns: [...paddedColumns(raw, arrayWidth(raw)), ""],
  rows: rawRows(raw).map((row) => (Array.isArray(row) ? [...row, ""] : row)),
});

export const deleteRow = (raw: Raw, r: number): TablePatch => ({
  columns: paddedColumns(raw, arrayWidth(raw)),
  rows: rawRows(raw).filter((_, i) => i !== r),
});

/** Removes a column; the last remaining one is kept (a table needs at least one). */
export function deleteColumn(raw: Raw, c: number): TablePatch {
  if (widthOf(raw) <= 1) return { columns: rawColumns(raw), rows: rawRows(raw) };
  return {
    columns: paddedColumns(raw, arrayWidth(raw)).filter((_, j) => j !== c),
    rows: rawRows(raw).map((row) => (Array.isArray(row) && c < row.length ? row.filter((_, j) => j !== c) : row)),
  };
}

// "12", "-3,5", "$1,200.50", "40%", "+2"
const NUMERIC = /^[-+]?\$?\s*\d[\d,.\s]*%?$/;

/** Which columns hold only numbers (ignoring empty cells): they are right-aligned. Display only. */
export function numericColumns(columns: string[], rows: string[][]): boolean[] {
  return columns.map((_, c) => {
    const filled = rows.map((r) => (r[c] ?? "").trim()).filter((v) => v !== "");
    return filled.length > 0 && filled.every((v) => NUMERIC.test(v));
  });
}
