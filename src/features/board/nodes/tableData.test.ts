import { describe, expect, it } from "vitest";
import { addColumn, addRow, deleteColumn, deleteRow, numericColumns, setCell, setHeader, tableView } from "./tableData";

describe("tableView", () => {
  it("returns well-formed data untouched in shape", () => {
    expect(tableView({ columns: ["A", "B"], rows: [["1", "2"]] })).toEqual({ columns: ["A", "B"], rows: [["1", "2"]] });
  });
  it("coerces non-string cells for display", () => {
    expect(tableView({ columns: ["A", 7 as never], rows: [[1, null, undefined] as never] })).toEqual({
      columns: ["A", "7"],
      rows: [["1", ""]],
    });
  });
  it("pads short rows and truncates long ones to the column count", () => {
    expect(tableView({ columns: ["A", "B", "C"], rows: [["1"], ["1", "2", "3", "4"]] }).rows).toEqual([
      ["1", "", ""],
      ["1", "2", "3"],
    ]);
  });
  it("copes with missing rows and columns", () => {
    expect(tableView({})).toEqual({ columns: [""], rows: [] });
    expect(tableView({ columns: ["A"] })).toEqual({ columns: ["A"], rows: [] });
    expect(tableView({ rows: [["x", "y"]] })).toEqual({ columns: ["", ""], rows: [["x", "y"]] });
  });
  it("treats a row that is not an array as an empty row", () => {
    expect(tableView({ columns: ["A"], rows: ["oops", null] as never }).rows).toEqual([[""], [""]]);
  });
  it("ignores values that are not arrays at all", () => {
    expect(tableView({ columns: "A" as never, rows: { a: 1 } as never })).toEqual({ columns: [""], rows: [] });
  });
});

describe("edit helpers return new normalized data and never mutate", () => {
  const t = { columns: ["A", "B"], rows: [["1", "2"]] };
  const frozen = JSON.stringify(t);
  it("setCell", () => {
    expect(setCell(t, 0, 1, "9")).toEqual({ columns: ["A", "B"], rows: [["1", "9"]] });
    expect(JSON.stringify(t)).toBe(frozen);
  });
  it("setHeader", () => {
    expect(setHeader(t, 0, "Z").columns).toEqual(["Z", "B"]);
  });
  it("addRow adds columns.length empty strings", () => {
    expect(addRow(t).rows).toEqual([["1", "2"], ["", ""]]);
  });
  it("addColumn adds a header and a cell to every row", () => {
    expect(addColumn(t)).toEqual({ columns: ["A", "B", ""], rows: [["1", "2", ""]] });
  });
  it("deleteRow removes that row, and zero rows is fine", () => {
    expect(deleteRow(t, 0).rows).toEqual([]);
  });
  it("deleteColumn removes the header and that cell, but keeps at least one column", () => {
    expect(deleteColumn(t, 0)).toEqual({ columns: ["B"], rows: [["2"]] });
    expect(deleteColumn({ columns: ["A"], rows: [["1"]] }, 0)).toEqual({ columns: ["A"], rows: [["1"]] });
  });
  it("normalizes malformed input when writing back", () => {
    expect(setCell({ columns: ["A", "B"], rows: [[5, "x", "extra"] as never] }, 0, 0, "7").rows).toEqual([["7", "x"]]);
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
