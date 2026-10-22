import { describe, expect, it } from "vitest";
import { addColumn, addRow, deleteColumn, deleteRow, numericColumns, setCell, setHeader, tableLocks, tableView } from "./tableData";

describe("tableView", () => {
  it("returns well-formed data untouched in shape", () => {
    expect(tableView({ columns: ["A", "B"], rows: [["1", "2"]] })).toEqual({ columns: ["A", "B"], rows: [["1", "2"]] });
  });
  it("coerces non-string cells for display", () => {
    expect(tableView({ columns: ["A", 7 as never], rows: [[1, null, undefined] as never] })).toEqual({
      columns: ["A", "7", ""],
      rows: [["1", "", ""]],
    });
  });
  it("pads short rows, and never truncates: a longer row widens the table with empty headers", () => {
    expect(tableView({ columns: ["A", "B", "C"], rows: [["1"], ["1", "2", "3", "4"]] })).toEqual({
      columns: ["A", "B", "C", ""],
      rows: [
        ["1", "", "", ""],
        ["1", "2", "3", "4"],
      ],
    });
  });
  it("copes with missing rows and columns", () => {
    expect(tableView({})).toEqual({ columns: [""], rows: [] });
    expect(tableView({ columns: ["A"] })).toEqual({ columns: ["A"], rows: [] });
    expect(tableView({ rows: [["x", "y"]] })).toEqual({ columns: ["", ""], rows: [["x", "y"]] });
  });
  it("keeps a primitive row as its first cell and shows null or an empty object as an empty row", () => {
    expect(tableView({ columns: ["A"], rows: ["oops", null, {}] as never }).rows).toEqual([["oops"], [""], [""]]);
  });
  it("ignores values that are not arrays at all", () => {
    expect(tableView({ columns: "A" as never, rows: { a: 1 } as never })).toEqual({ columns: [""], rows: [] });
  });
});

describe("tableView display of data the grid cannot edit", () => {
  it("shows an object row as read-only text of its values and a null row as empty", () => {
    expect(tableView({ columns: ["Concepto", "Valor"], rows: [{ Concepto: "Tela", Valor: 12 }, null] as never }).rows).toEqual([
      ["Tela", "12"],
      ["", ""],
    ]);
  });
  it("previews an object or array cell as JSON, never as [object Object]", () => {
    const rows = tableView({ columns: ["A", "B"], rows: [[{ a: 1 }, [1, 2]]] as never }).rows;
    expect(rows).toEqual([['{"a":1}', "[1,2]"]]);
  });
  it("truncates a long preview", () => {
    const [[cell]] = tableView({ columns: ["A"], rows: [[{ k: "x".repeat(200) }]] as never }).rows;
    expect(cell.length).toBeLessThanOrEqual(61);
    expect(cell.endsWith("…")).toBe(true);
  });
});

describe("tableLocks", () => {
  it("locks every cell of a non-array row, and object or array cells of an array row", () => {
    const locks = tableLocks({ columns: ["A", { x: 1 }], rows: [["a", { y: 1 }], "oops", null, {}, ["b", [1]]] as never });
    expect(locks.headers).toEqual([false, true]);
    expect(locks.rows).toEqual([[false, true], [true, true], [true, true], [true, true], [false, true]]);
  });
});

// The writers patch the node's RAW arrays: only what is touched changes, everything
// else is carried over exactly as found (same identity, non-strings and all).
describe("edit helpers patch the raw arrays and never mutate", () => {
  const obj = { Concepto: "Tela", Valor: 12 };
  const nested = { deep: [1] };
  const raw = {
    columns: ["A", "B"],
    rows: [["1", "2"], obj, "oops", null, [12, nested, true]],
  } as never as { columns: unknown[]; rows: unknown[] };
  const frozen = JSON.stringify(raw);
  const same = (out: unknown[], src: unknown[], except: number[]) =>
    src.forEach((r, i) => {
      if (!except.includes(i)) expect(out[i]).toBe(r);
    });

  it("setCell changes only that cell: other rows are the same objects, other cells keep their type", () => {
    const out = setCell(raw, 4, 0, "x");
    expect(out.columns).toBe(raw.columns);
    expect(out.rows[4]).toEqual(["x", nested, true]);
    expect((out.rows[4] as unknown[])[1]).toBe(nested);
    same(out.rows, raw.rows, [4]);
    expect(out.rows[1]).toBe(obj);
    expect(JSON.stringify(raw)).toBe(frozen);
  });
  it("setCell leaves a number in an untouched cell of the same row as a number", () => {
    const out = setCell(raw, 4, 2, "no");
    expect(out.rows[4]).toEqual([12, nested, "no"]);
  });
  it("setCell pads only the edited row, and only up to the edited column", () => {
    const out = setCell({ columns: ["A", "B", "C"], rows: [["1"], ["2"]] }, 0, 2, "z");
    expect(out.rows).toEqual([["1", "", "z"], ["2"]]);
  });
  it("setCell is a no-op for a row that is not an array and for an object or array cell", () => {
    for (const r of [1, 2, 3]) expect(setCell(raw, r, 0, "x")).toEqual({ columns: raw.columns, rows: raw.rows });
    expect(setCell(raw, 2, 0, "x").rows).toBe(raw.rows);
    expect(setCell(raw, 4, 1, "x").rows).toBe(raw.rows);
    expect(setCell(raw, 99, 0, "x").rows).toEqual(raw.rows);
    expect(JSON.stringify(raw)).toBe(frozen);
  });
  it("setHeader changes only that header and carries every row as is", () => {
    const out = setHeader(raw, 1, "Z");
    expect(out.columns).toEqual(["A", "Z", ""]);
    same(out.rows, raw.rows, []);
    expect(JSON.stringify(raw)).toBe(frozen);
  });
  it("setHeader pads the headers up to the edited column", () => {
    expect(setHeader({ columns: ["A"], rows: [] }, 2, "Z").columns).toEqual(["A", "", "Z"]);
  });
  it("setHeader is a no-op on an object header", () => {
    const hdr = { columns: ["A", { x: 1 }], rows: [] };
    expect(setHeader(hdr, 1, "Z").columns).toBe(hdr.columns);
  });
  it("addRow appends a row of empty strings as wide as the displayed table and carries the rest", () => {
    const out = addRow(raw);
    expect(out.rows).toHaveLength(6);
    expect(out.rows[5]).toEqual(["", "", ""]);
    same(out.rows, raw.rows, [5]);
    expect(out.columns).toEqual(["A", "B", ""]);
  });
  it("addColumn appends a header and a cell only to array rows; other rows are carried untouched", () => {
    const out = addColumn(raw);
    expect(out.columns).toEqual(["A", "B", "", ""]);
    expect(out.rows[0]).toEqual(["1", "2", ""]);
    expect(out.rows[4]).toEqual([12, nested, true, ""]);
    expect((out.rows[4] as unknown[])[1]).toBe(nested);
    for (const i of [1, 2, 3]) expect(out.rows[i]).toBe(raw.rows[i]);
    expect(JSON.stringify(raw)).toBe(frozen);
  });
  it("deleteRow removes only that raw row", () => {
    const out = deleteRow(raw, 2);
    expect(out.rows).toEqual([raw.rows[0], obj, null, raw.rows[4]]);
    same(out.rows, [raw.rows[0], raw.rows[1], raw.rows[3], raw.rows[4]], [2]);
    expect(out.columns).toEqual(["A", "B", ""]);
  });
  it("deleteColumn removes that index from the headers and from array rows only; at least one column stays", () => {
    const out = deleteColumn(raw, 0);
    expect(out.columns).toEqual(["B", ""]);
    expect(out.rows[0]).toEqual(["2"]);
    expect(out.rows[4]).toEqual([nested, true]);
    for (const i of [1, 2, 3]) expect(out.rows[i]).toBe(raw.rows[i]);
    const one = { columns: ["A"], rows: [["1"]] };
    expect(deleteColumn(one, 0)).toEqual({ columns: ["A"], rows: [["1"]] });
    expect(deleteColumn(one, 0).rows).toBe(one.rows);
  });
  it("an array row too short to have the deleted column is carried by identity", () => {
    const t = { columns: ["A", "B", "C"], rows: [["1"], ["1", "2", "3"]] };
    const out = deleteColumn(t, 2);
    expect(out.rows[0]).toBe(t.rows[0]);
    expect(out.rows[1]).toEqual(["1", "2"]);
  });
  it("handles missing or malformed columns and rows as empty", () => {
    expect(addRow({})).toEqual({ columns: [""], rows: [[""]] });
    expect(setCell({ columns: "A", rows: { a: 1 } } as never, 0, 0, "x")).toEqual({ columns: [], rows: [] });
  });
  it("keeps the table wide: a row longer than the headers extends the headers on a header or structure write, never truncates", () => {
    const ragged = { columns: ["A", "B"], rows: [["1", "2", "3"], ["4"], ["5", "6"]] };
    const frozenRagged = JSON.stringify(ragged);
    expect(setHeader(ragged, 0, "Z")).toEqual({ columns: ["Z", "B", ""], rows: ragged.rows });
    expect(setCell(ragged, 1, 0, "x")).toEqual({ columns: ["A", "B"], rows: [["1", "2", "3"], ["x"], ["5", "6"]] });
    expect(addColumn(ragged)).toEqual({ columns: ["A", "B", "", ""], rows: [["1", "2", "3", ""], ["4", ""], ["5", "6", ""]] });
    expect(addRow(ragged).rows[3]).toEqual(["", "", ""]);
    expect(deleteColumn(ragged, 2)).toEqual({ columns: ["A", "B"], rows: [["1", "2"], ["4"], ["5", "6"]] });
    expect(deleteColumn(ragged, 0)).toEqual({ columns: ["B", ""], rows: [["2", "3"], [], ["6"]] });
    expect(JSON.stringify(ragged)).toBe(frozenRagged);
  });
});

describe("numericColumns", () => {
  it("flags columns whose filled cells all look like numbers", () => {
    expect(numericColumns(["Concepto", "Valor"], [["Tela", "12.5"], ["Hilo", "$1,200"], ["Botón", ""]])).toEqual([false, true]);
  });
  it("accepts percentages, signs and comma decimals", () => {
    expect(numericColumns(["a"], [["-3,5"], ["40%"], ["+2"]])).toEqual([true]);
  });
  it("is false for an empty column or mixed content", () => {
    expect(numericColumns(["a", "b"], [["", "1"], ["", "x"]])).toEqual([false, false]);
  });
});
