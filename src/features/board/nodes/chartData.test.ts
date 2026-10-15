import { describe, expect, it } from "vitest";
import {
  addLabel,
  addSeries,
  editableData,
  parseNumberInput,
  prepareChartData,
  removeLabel,
  removeSeries,
  renameLabel,
  renameSeries,
  setValue,
} from "./chartData";

const node = (extra: Record<string, unknown>) => extra as Parameters<typeof prepareChartData>[0];

describe("prepareChartData", () => {
  it("passes clean data through", () => {
    const d = prepareChartData(node({ kind: "line", title: "Ventas", labels: ["A", "B"], series: [{ name: "S", values: [1, 2] }] }));
    expect(d.kind).toBe("line");
    expect(d.title).toBe("Ventas");
    expect(d.labels).toEqual(["A", "B"]);
    expect(d.series).toEqual([{ name: "S", values: [1, 2] }]);
    expect(d.rows).toEqual([
      { label: "A", s0: 1 },
      { label: "B", s0: 2 },
    ]);
    expect(d.empty).toBe(false);
  });

  it("treats values shorter than labels as gaps (null), never 0", () => {
    const d = prepareChartData(node({ kind: "bar", labels: ["A", "B", "C"], series: [{ name: "S", values: [1] }] }));
    expect(d.series[0].values).toEqual([1, null, null]);
    expect(d.rows[2]).toEqual({ label: "C", s0: null });
  });

  it("truncates values longer than labels for display", () => {
    const d = prepareChartData(node({ kind: "bar", labels: ["A"], series: [{ name: "S", values: [1, 2, 3] }] }));
    expect(d.series[0].values).toEqual([1]);
  });

  it("turns non-numeric, NaN and Infinity into null", () => {
    const d = prepareChartData(
      node({ kind: "bar", labels: ["a", "b", "c", "d", "e", "f"], series: [{ name: "S", values: ["x", NaN, Infinity, -Infinity, {}, true] }] }),
    );
    expect(d.series[0].values).toEqual([null, null, null, null, null, null]);
  });

  it("accepts strings that parse as finite numbers", () => {
    const d = prepareChartData(node({ kind: "bar", labels: ["a", "b", "c", "d"], series: [{ name: "S", values: ["12.5", " 7 ", "", "1e3"] }] }));
    expect(d.series[0].values).toEqual([12.5, 7, null, 1000]);
  });

  it("is an empty chart when series or labels are missing or malformed", () => {
    for (const bad of [{}, { labels: ["A"] }, { series: [{ name: "S", values: [1] }] }, { labels: "A", series: "S" }, { labels: [], series: [] }]) {
      const d = prepareChartData(node({ kind: "bar", ...bad }));
      expect(d.empty).toBe(true);
      expect(d.rows).toEqual(d.labels.map((label) => expect.objectContaining({ label })));
    }
  });

  it("falls back to bar for an unknown kind and coerces labels and names", () => {
    const d = prepareChartData(node({ kind: "radar", labels: [1, null, "x"], series: [{ values: [1, 2, 3] }, "raro", { name: 5, values: "no" }] }));
    expect(d.kind).toBe("bar");
    expect(d.labels).toEqual(["1", "", "x"]);
    expect(d.series.map((s) => s.name)).toEqual(["Serie 1", "Serie 2", "5"]);
    expect(d.series[1].values).toEqual([null, null, null]);
    expect(d.series[2].values).toEqual([null, null, null]);
  });

  it("pie uses the first series only, keeps real values above zero and flags extra series", () => {
    const d = prepareChartData(
      node({
        kind: "pie",
        labels: ["A", "B", "C", "D"],
        series: [
          { name: "S1", values: [3, 0, null, -2] },
          { name: "S2", values: [9, 9, 9, 9] },
        ],
      }),
    );
    expect(d.pie.slices).toEqual([{ name: "A", value: 3, index: 0 }]);
    expect(d.pie.extraSeries).toBe(true);
    expect(d.pie.seriesName).toBe("S1");
    const single = prepareChartData(node({ kind: "pie", labels: ["A"], series: [{ name: "S1", values: [1] }] }));
    expect(single.pie.extraSeries).toBe(false);
  });

  it("keeps more than six series (the palette cycles at render time)", () => {
    const series = Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, values: [i] }));
    const d = prepareChartData(node({ kind: "bar", labels: ["A"], series }));
    expect(d.series).toHaveLength(8);
    expect(d.rows[0].s7).toBe(7);
  });

  it("never mutates its input", () => {
    const input = node({ kind: "bar", labels: ["A", "B"], series: [{ name: "S", values: [1] }] });
    const copy = JSON.stringify(input);
    prepareChartData(input);
    expect(JSON.stringify(input)).toBe(copy);
  });
});

describe("parseNumberInput", () => {
  it("parses plain, signed, decimal and comma-decimal numbers", () => {
    expect(parseNumberInput("12")).toBe(12);
    expect(parseNumberInput("-3.5")).toBe(-3.5);
    expect(parseNumberInput("12,5")).toBe(12.5);
    expect(parseNumberInput(" 7 ")).toBe(7);
    expect(parseNumberInput("1.")).toBe(1);
  });
  it("maps an empty input to 0 (stored arrays hold numbers only)", () => {
    expect(parseNumberInput("")).toBe(0);
    expect(parseNumberInput("  ")).toBe(0);
  });
  it("returns null for text that is not (yet) a number", () => {
    for (const s of ["-", "abc", "1.2.3", "Infinity", "0x10", "1e"]) expect(parseNumberInput(s)).toBeNull();
  });
});

describe("editing helpers (new arrays, normalized, gaps stored as 0)", () => {
  const n = node({ kind: "bar", labels: ["A", "B"], series: [{ name: "S1", values: [1, 2] }, { name: "S2", values: [3] }] });
  const frozen = JSON.stringify(n);

  it("editableData normalizes to labels.length numbers, null becomes 0", () => {
    expect(editableData(n)).toEqual({
      labels: ["A", "B"],
      series: [
        { name: "S1", values: [1, 2] },
        { name: "S2", values: [3, 0] },
      ],
    });
  });
  it("setValue changes one cell", () => {
    expect(setValue(editableData(n), 1, 0, 9).series[0].values).toEqual([1, 9]);
  });
  it("renameLabel / renameSeries", () => {
    expect(renameLabel(editableData(n), 0, "Z").labels).toEqual(["Z", "B"]);
    expect(renameSeries(editableData(n), 1, "Y").series[1].name).toBe("Y");
  });
  it("addLabel appends a label and a 0 to every series", () => {
    const d = addLabel(editableData(n));
    expect(d.labels).toEqual(["A", "B", "Etiqueta 3"]);
    expect(d.series.map((s) => s.values)).toEqual([[1, 2, 0], [3, 0, 0]]);
  });
  it("removeLabel drops the label and its value in every series", () => {
    const d = removeLabel(editableData(n), 0);
    expect(d.labels).toEqual(["B"]);
    expect(d.series.map((s) => s.values)).toEqual([[2], [0]]);
  });
  it("addSeries appends a zero-filled series; removeSeries drops one", () => {
    const d = addSeries(editableData(n));
    expect(d.series[2]).toEqual({ name: "Serie 3", values: [0, 0] });
    expect(removeSeries(d, 0).series.map((s) => s.name)).toEqual(["S2", "Serie 3"]);
  });
  it("never mutates the node", () => {
    setValue(editableData(n), 0, 0, 5);
    addLabel(editableData(n));
    expect(JSON.stringify(n)).toBe(frozen);
  });
});
