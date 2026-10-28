import { fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// recharts measures its container, which jsdom cannot do: the canvas is its own
// component (ChartCanvas.test.tsx covers it) and is stubbed out here.
vi.mock("./ChartCanvas", () => ({
  ChartCanvas: (p: { data: { kind: string } }) => <div data-testid="chart-canvas" data-kind={p.data.kind} />,
}));

import { initialState, useApp } from "../../../store/app";
import { board, make, update } from "./dataTestKit";

let errors: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  update.mockReset();
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/Users/d/TYPES-espacios", claudePath: null } });
  errors = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
});
afterEach(() => {
  // No stray console output from either block.
  for (const spy of errors) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

describe("ChartNode", () => {
  const chart = (extra: Record<string, unknown> = {}) =>
    make({ type: "chart", title: "Ventas", kind: "bar", labels: ["Ene", "Feb"], series: [{ name: "Tela", values: [3, 5] }], ...extra });
  const open = (c: HTMLElement) => fireEvent.click(within(c).getByRole("button", { name: "Datos" }));
  const num = (c: HTMLElement, r: number, s: number) => c.querySelector(`input[aria-label="Valor fila ${r}, serie ${s}"]`) as HTMLInputElement;

  it("labels the chart for assistive tech with its kind and title", () => {
    const { getByRole } = render(board(chart()));
    expect(getByRole("img", { name: "Gráfica de barras: Ventas" })).toBeInTheDocument();
    const pie = render(board(chart({ kind: "pie", title: "" })));
    expect(pie.getByRole("img", { name: "Gráfica circular: sin título" })).toBeInTheDocument();
  });

  it("hands the hardened data to the canvas", () => {
    const { getByTestId } = render(board(chart({ kind: "line" })));
    expect(getByTestId("chart-canvas")).toHaveAttribute("data-kind", "line");
  });

  it("the kind switcher emits update(id, { kind })", () => {
    const { getByRole } = render(board(chart()));
    expect(getByRole("button", { name: "Barras" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(getByRole("button", { name: "Circular" }));
    expect(update).toHaveBeenCalledWith("n1", { kind: "pie" });
    fireEvent.click(getByRole("button", { name: "Líneas" }));
    expect(update).toHaveBeenLastCalledWith("n1", { kind: "line" });
  });

  it("title edit emits { title }; empty shows the 'Gráfica' placeholder", () => {
    const { container } = render(board(chart()));
    fireEvent.change(container.querySelector(".block-title input") as HTMLInputElement, { target: { value: "Ingresos" } });
    expect(update).toHaveBeenCalledWith("n1", { title: "Ingresos" });
    const empty = render(board(chart({ title: undefined })));
    expect((empty.container.querySelector(".block-title input") as HTMLInputElement).placeholder).toBe("Gráfica");
  });

  it("shows a legend for two or more series, none for one", () => {
    const one = render(board(chart()));
    expect(one.container.querySelector(".chart-legend")).toBeNull();
    one.unmount();
    const two = render(board(chart({ series: [{ name: "Tela", values: [1, 2] }, { name: "Hilo", values: [3, 4] }] })));
    expect(within(two.container.querySelector(".chart-legend") as HTMLElement).getByText("Hilo")).toBeInTheDocument();
  });

  it("the Datos toggle shows the values as an editable grid and hides the canvas", () => {
    const { container, queryByTestId } = render(board(chart()));
    expect(queryByTestId("chart-canvas")).toBeInTheDocument();
    open(container);
    expect(queryByTestId("chart-canvas")).toBeNull();
    expect(num(container, 2, 1).value).toBe("5");
    expect(within(container).getByRole("button", { name: "Datos" })).toHaveAttribute("aria-pressed", "true");
  });

  it("editing a value emits labels and series (new arrays)", () => {
    const node = chart();
    const { container } = render(board(node));
    open(container);
    fireEvent.change(num(container, 2, 1), { target: { value: "8,5" } });
    expect(update).toHaveBeenCalledWith("n1", { labels: ["Ene", "Feb"], series: [{ name: "Tela", values: [3, 8.5] }] });
    expect((node.series as { values: number[] }[])[0].values).toEqual([3, 5]);
  });

  it("an emptied number field stores 0; text that is not a number is held back and reverts on blur", () => {
    const { container } = render(board(chart()));
    open(container);
    fireEvent.change(num(container, 1, 1), { target: { value: "" } });
    expect(update).toHaveBeenLastCalledWith("n1", { labels: ["Ene", "Feb"], series: [{ name: "Tela", values: [0, 5] }] });
    update.mockClear();
    fireEvent.change(num(container, 1, 1), { target: { value: "-" } });
    expect(update).not.toHaveBeenCalled();
    expect(num(container, 1, 1).value).toBe("-");
    fireEvent.blur(num(container, 1, 1));
    expect(num(container, 1, 1).value).toBe("3");
    expect(update).not.toHaveBeenCalled();
  });

  it("edits labels and series names", () => {
    const { container } = render(board(chart()));
    open(container);
    fireEvent.change(container.querySelector('input[aria-label="Etiqueta fila 1"]') as HTMLInputElement, { target: { value: "Enero" } });
    expect(update).toHaveBeenLastCalledWith("n1", { labels: ["Enero", "Feb"], series: [{ name: "Tela", values: [3, 5] }] });
    fireEvent.change(container.querySelector('input[aria-label="Nombre de la serie 1"]') as HTMLInputElement, { target: { value: "Telas" } });
    expect(update).toHaveBeenLastCalledWith("n1", { labels: ["Ene", "Feb"], series: [{ name: "Telas", values: [3, 5] }] });
  });

  it("adds and removes labels and series", () => {
    const { container, getByRole } = render(board(chart()));
    open(container);
    fireEvent.click(getByRole("button", { name: "+ etiqueta" }));
    expect(update).toHaveBeenLastCalledWith("n1", { labels: ["Ene", "Feb", "Etiqueta 3"], series: [{ name: "Tela", values: [3, 5, 0] }] });
    fireEvent.click(getByRole("button", { name: "+ serie" }));
    expect(update).toHaveBeenLastCalledWith("n1", {
      labels: ["Ene", "Feb"],
      series: [{ name: "Tela", values: [3, 5] }, { name: "Serie 2", values: [0, 0] }],
    });
    fireEvent.click(getByRole("button", { name: "Eliminar etiqueta «Ene»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { labels: ["Feb"], series: [{ name: "Tela", values: [5] }] });
    fireEvent.click(getByRole("button", { name: "Eliminar serie «Tela»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { labels: ["Ene", "Feb"], series: [] });
  });

  it("shows the empty state, with the grid still reachable, when there is no data", () => {
    const { container, getByText, queryByTestId } = render(board(make({ type: "chart", kind: "bar" })));
    expect(getByText("Sin datos: abre «Datos» para agregar")).toBeInTheDocument();
    expect(queryByTestId("chart-canvas")).toBeNull();
    open(container);
    fireEvent.click(within(container).getByRole("button", { name: "+ etiqueta" }));
    expect(update).toHaveBeenCalledWith("n1", { labels: ["Etiqueta 1"], series: [] });
  });

  describe("malformed data: an edit patches only the touched thing", () => {
    const messy = (extra: Record<string, unknown> = {}) =>
      chart({
        labels: ["A", "B", "C"],
        series: [{ name: "S", color: "#f00", values: [1, "n/a", NaN, 9, 9] }, { name: "Corta", values: [4] }, "raro"],
        ...extra,
      });

    it("renders without throwing and opening the grid writes nothing", () => {
      const { container } = render(board(messy()));
      open(container);
      expect(update).not.toHaveBeenCalled();
      expect(num(container, 2, 1).value).toBe("");
      expect(num(container, 3, 1).value).toBe("");
      expect(num(container, 2, 2).value).toBe("");
      expect(container.querySelector('input[aria-label="Valor fila 4, serie 1"]')).toBeNull();
    });

    it("editing cell A leaves the gaps elsewhere as gaps, text as text, extra fields, values beyond the labels and odd entries intact", () => {
      const { container } = render(board(messy()));
      open(container);
      fireEvent.change(num(container, 1, 1), { target: { value: "2" } });
      expect(update).toHaveBeenCalledTimes(1);
      expect(update).toHaveBeenCalledWith("n1", {
        labels: ["A", "B", "C"],
        series: [{ name: "S", color: "#f00", values: [2, "n/a", NaN, 9, 9] }, { name: "Corta", values: [4] }, "raro"],
      });
    });

    it("editing a cell after a gap pads only up to that cell", () => {
      const { container } = render(board(messy()));
      open(container);
      fireEvent.change(num(container, 3, 2), { target: { value: "8" } });
      expect(update).toHaveBeenCalledWith("n1", {
        labels: ["A", "B", "C"],
        series: [{ name: "S", color: "#f00", values: [1, "n/a", NaN, 9, 9] }, { name: "Corta", values: [4, 0, 8] }, "raro"],
      });
    });

    it("renaming a series keeps its extra fields", () => {
      const { container } = render(board(messy()));
      open(container);
      fireEvent.change(container.querySelector('input[aria-label="Nombre de la serie 1"]') as HTMLInputElement, { target: { value: "Ventas" } });
      expect(update.mock.calls[0][1].series[0]).toEqual({ name: "Ventas", color: "#f00", values: [1, "n/a", NaN, 9, 9] });
      expect(update.mock.calls[0][1].series[2]).toBe("raro");
    });

    it("adding a label does not turn a short series' gaps into zeros", () => {
      const { container, getByRole } = render(board(messy()));
      open(container);
      fireEvent.click(getByRole("button", { name: "+ etiqueta" }));
      const out = update.mock.calls[0][1];
      expect(out.labels).toEqual(["A", "B", "C", "Etiqueta 4"]);
      expect(out.series[1]).toEqual({ name: "Corta", values: [4] });
      expect(out.series[0].values).toEqual([1, "n/a", NaN, 9, 9]); // longer than the labels: untouched
    });
  });

  it("pie says that only the first series is plotted when there are more", () => {
    const two = chart({ kind: "pie", series: [{ name: "Tela", values: [1, 2] }, { name: "Hilo", values: [3, 4] }] });
    const { container } = render(board(two));
    const note = container.querySelector(".chart-note") as HTMLElement;
    expect(note.textContent).toBe("Solo se muestra la serie «Tela»");
    expect(note).toHaveAttribute("title");
    const one = render(board(chart({ kind: "pie" })));
    expect(one.container.querySelector(".chart-note")).toBeNull();
  });

  it("pie legend lists the slices, other kinds list the series", () => {
    const { container } = render(board(chart({ kind: "pie" })));
    expect(within(container.querySelector(".chart-legend") as HTMLElement).getByText("Feb")).toBeInTheDocument();
  });

  it("never calls update on mount, select, kind-toggle focus or grid focus/blur without a change", () => {
    const { container, rerender } = render(board(chart()));
    rerender(board(chart(), true));
    open(container);
    for (const input of container.querySelectorAll("input")) {
      fireEvent.focus(input);
      fireEvent.blur(input);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("grid delete buttons are keyboard reachable and say what they remove", () => {
    const { container, getByRole } = render(board(chart()));
    open(container);
    for (const name of ["Eliminar etiqueta «Ene»", "Eliminar etiqueta «Feb»", "Eliminar serie «Tela»"]) {
      expect(getByRole("button", { name })).not.toHaveAttribute("tabindex");
    }
    expect(container.querySelector("button[tabindex='-1']")).toBeNull();
  });

  it("keeps the grid out of React Flow's drag and pan", () => {
    const { container } = render(board(chart()));
    open(container);
    expect(num(container, 1, 1).closest(".nodrag.nopan")).not.toBeNull();
  });
});
