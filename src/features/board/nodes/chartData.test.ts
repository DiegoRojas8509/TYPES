import { describe, expect, it } from "vitest";
import {
  addLabel,
  addSeries,
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
      { label: "A", idx: 0, s0: 1 },
      { label: "B", idx: 1, s0: 2 },
    ]);
    expect(d.empty).toBe(false);
  });

  it("treats values shorter than labels as gaps (null), never 0", () => {
    const d = prepareChartData(node({ kind: "bar", labels: ["A", "B", "C"], series: [{ name: "S", values: [1] }] }));
    expect(d.series[0].values).toEqual([1, null, null]);
    expect(d.rows[2]).toEqual({ label: "C", idx: 2, s0: null });
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

describe("editing helpers: they patch only what was touched, from the RAW data", () => {
  const raw = () =>
    node({
      kind: "bar",
      labels: ["A", "B", "C"],
      series: [
        { name: "S1", color: "#f00", values: [1, "n/a", 3, 99] },
        { name: "S2", values: [5] },
        "raro",
      ],
    });
  const frozen = JSON.stringify(raw());

  it("setValue changes only that cell; gaps, text and values beyond the labels stay as found", () => {
    const out = setValue(raw(), 0, 0, 7);
    expect(out.labels).toEqual(["A", "B", "C"]);
    expect(out.series[0]).toEqual({ name: "S1", color: "#f00", values: [7, "n/a", 3, 99] });
    expect(out.series[1]).toEqual({ name: "S2", values: [5] }); // the other series is untouched
    expect(out.series[2]).toBe("raro"); // a non-object entry stays intact
  });
  it("setValue pads with 0 only up to the edited index, so a gap before it becomes 0 but later ones stay gaps", () => {
    expect(setValue(raw(), 2, 1, 9).series[1]).toEqual({ name: "S2", values: [5, 0, 9] });
    expect(setValue(raw(), 0, 1, 6).series[1]).toEqual({ name: "S2", values: [6] });
  });
  it("setValue on a non-object series creates it (the user touched it); other fields stay", () => {
    expect(setValue(raw(), 1, 2, 4).series[2]).toEqual({ name: "Serie 3", values: [0, 4] });
    const odd = node({ labels: ["A"], series: [{ name: "S", values: "no", color: "1" }] });
    expect(setValue(odd, 0, 0, 2).series[0]).toEqual({ name: "S", values: [2], color: "1" });
  });
  it("renameLabel changes only that label", () => {
    const out = renameLabel(raw(), 1, "Z");
    expect(out.labels).toEqual(["A", "Z", "C"]);
    expect(out.series).toEqual(raw().series);
  });
  it("renameSeries spreads the original object, so extra fields survive", () => {
    expect(renameSeries(raw(), 0, "Nuevo").series[0]).toEqual({ name: "Nuevo", color: "#f00", values: [1, "n/a", 3, 99] });
    expect(renameSeries(raw(), 2, "Ahora").series[2]).toEqual({ name: "Ahora", values: [] });
  });
  it("addLabel appends the label and a 0 only to series that were already full-length", () => {
    const full = node({ labels: ["A", "B"], series: [{ name: "Full", values: [1, 2] }, { name: "Short", values: [1] }, { name: "Long", values: [1, 2, 3] }, "raro"] });
    const out = addLabel(full);
    expect(out.labels).toEqual(["A", "B", "Etiqueta 3"]);
    expect(out.series).toEqual([{ name: "Full", values: [1, 2, 0] }, { name: "Short", values: [1] }, { name: "Long", values: [1, 2, 3] }, "raro"]);
  });
  it("removeLabel removes that index from labels and from each series' values, if present", () => {
    const out = removeLabel(raw(), 1);
    expect(out.labels).toEqual(["A", "C"]);
    expect(out.series[0]).toEqual({ name: "S1", color: "#f00", values: [1, 3, 99] });
    expect(out.series[1]).toEqual({ name: "S2", values: [5] });
    expect(out.series[2]).toBe("raro");
    expect(removeLabel(raw(), 2).series[1]).toEqual({ name: "S2", values: [5] });
  });
  it("addSeries appends a zero-filled series without touching the others; removeSeries removes one entry", () => {
    const added = addSeries(raw());
    expect(added.series).toHaveLength(4);
    expect(added.series[3]).toEqual({ name: "Serie 4", values: [0, 0, 0] });
    expect(added.series.slice(0, 3)).toEqual(raw().series);
    expect(removeSeries(raw(), 2).series).toHaveLength(2);
    expect(removeSeries(raw(), 0).series[0]).toEqual({ name: "S2", values: [5] });
  });
  it("copes with missing arrays and never mutates its input", () => {
    expect(addLabel(node({}))).toEqual({ labels: ["Etiqueta 1"], series: [] });
    expect(addSeries(node({}))).toEqual({ labels: [], series: [{ name: "Serie 1", values: [] }] });
    const input = raw();
    setValue(input, 0, 0, 5);
    addLabel(input);
    removeLabel(input, 0);
    renameSeries(input, 0, "x");
    expect(JSON.stringify(input)).toBe(frozen);
  });
});
