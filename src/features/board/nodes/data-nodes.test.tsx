import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// recharts measures its container, which jsdom cannot do: the canvas is its own
// component (ChartCanvas.test.tsx covers it) and is stubbed out here.
vi.mock("./ChartCanvas", () => ({
  ChartCanvas: (p: { data: { kind: string } }) => <div data-testid="chart-canvas" data-kind={p.data.kind} />,
}));

import { initialState, useApp } from "../../../store/app";
import { ChartNode } from "./ChartNode";
import { board, isKnown, make, update } from "./dataTestKit";
import { flowNodeTypes, nodeTypes } from "./index";
import { TableNode } from "./TableNode";
import { toFlowNode } from "../boardModel";

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

const title = (c: HTMLElement) => c.querySelector(".block-title");

describe("registry", () => {
  it("registers table and chart, and boardModel maps those canvas types to them", () => {
    expect(nodeTypes.table).toBe(TableNode);
    expect(nodeTypes.chart).toBe(ChartNode);
    expect(flowNodeTypes.table).toBe(TableNode);
    expect(flowNodeTypes.chart).toBe(ChartNode);
    expect(toFlowNode(make({ type: "table" }), isKnown).type).toBe("table");
    expect(toFlowNode(make({ type: "chart" }), isKnown).type).toBe("chart");
  });
});

describe("TableNode", () => {
  const table = (extra: Record<string, unknown> = {}) =>
    make({ type: "table", title: "Costos", columns: ["Concepto", "Valor"], rows: [["Tela", "12"], ["Hilo", "3"]], ...extra });
  const cell = (c: HTMLElement, r: number, k: number) => c.querySelector(`input[aria-label="Fila ${r}, columna ${k}"]`) as HTMLInputElement;
  const head = (c: HTMLElement, k: number) => c.querySelector(`input[aria-label="Encabezado de columna ${k}"]`) as HTMLInputElement;

  it("renders the title, headers and cells", () => {
    const { container } = render(board(table()));
    expect((container.querySelector(".block-title input") as HTMLInputElement).value).toBe("Costos");
    expect(head(container, 1).value).toBe("Concepto");
    expect(cell(container, 2, 2).value).toBe("3");
  });

  it("editing a cell calls update with new rows and leaves the original arrays alone", () => {
    const node = table();
    const original = JSON.parse(JSON.stringify(node));
    const { container } = render(board(node));
    fireEvent.change(cell(container, 1, 2), { target: { value: "15" } });
    expect(update).toHaveBeenCalledTimes(1);
    const [id, patch] = update.mock.calls[0];
    expect(id).toBe("n1");
    expect(patch).toEqual({ columns: ["Concepto", "Valor"], rows: [["Tela", "15"], ["Hilo", "3"]] });
    expect(patch.rows).not.toBe(node.rows);
    expect(patch.rows[1]).not.toBe((node.rows as string[][])[1]);
    expect(node).toEqual(original);
  });

  it("editing a header calls update with the new columns", () => {
    const { container } = render(board(table()));
    fireEvent.change(head(container, 2), { target: { value: "Precio" } });
    expect(update).toHaveBeenCalledWith("n1", { columns: ["Concepto", "Precio"], rows: [["Tela", "12"], ["Hilo", "3"]] });
  });

  it("'+ fila' adds a row with one empty string per column", () => {
    const { getByRole } = render(board(table()));
    fireEvent.click(getByRole("button", { name: "+ fila" }));
    expect(update).toHaveBeenCalledWith("n1", { columns: ["Concepto", "Valor"], rows: [["Tela", "12"], ["Hilo", "3"], ["", ""]] });
  });

  it("'+ columna' adds a header and a cell to every row", () => {
    const { getByRole } = render(board(table()));
    fireEvent.click(getByRole("button", { name: "+ columna" }));
    expect(update).toHaveBeenCalledWith("n1", { columns: ["Concepto", "Valor", ""], rows: [["Tela", "12", ""], ["Hilo", "3", ""]] });
  });

  it("deletes a row (zero rows is allowed) and a column", () => {
    const { getByRole } = render(board(table({ rows: [["Tela", "12"]] })));
    fireEvent.click(getByRole("button", { name: "Borrar fila 1" }));
    expect(update).toHaveBeenLastCalledWith("n1", { columns: ["Concepto", "Valor"], rows: [] });
    fireEvent.click(getByRole("button", { name: "Borrar columna 1" }));
    expect(update).toHaveBeenLastCalledWith("n1", { columns: ["Valor"], rows: [["12"]] });
  });

  it("never deletes the last column", () => {
    const { getByRole } = render(board(table({ columns: ["Solo"], rows: [["x"]] })));
    const del = getByRole("button", { name: "Borrar columna 1" });
    expect(del).toBeDisabled();
    fireEvent.click(del);
    expect(update).not.toHaveBeenCalled();
  });

  it("title edit calls update(id, { title }); an empty title shows 'Tabla'", () => {
    const { container } = render(board(table()));
    fireEvent.change(container.querySelector(".block-title input") as HTMLInputElement, { target: { value: "Telas" } });
    expect(update).toHaveBeenCalledWith("n1", { title: "Telas" });
    const empty = render(board(table({ title: undefined })));
    const input = empty.container.querySelector(".block-title input") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.placeholder).toBe("Tabla");
    expect(input).toHaveAccessibleName("Título de la tabla");
  });

  it("Enter moves to the cell below; Tab keeps its natural order", () => {
    const { container } = render(board(table()));
    head(container, 1).focus();
    fireEvent.keyDown(head(container, 1), { key: "Enter" });
    expect(document.activeElement).toBe(cell(container, 1, 1));
    fireEvent.keyDown(cell(container, 1, 1), { key: "Enter" });
    expect(document.activeElement).toBe(cell(container, 2, 1));
    fireEvent.keyDown(cell(container, 2, 1), { key: "Enter" });
    expect(document.activeElement).toBe(cell(container, 2, 1));
    // the per-row and per-column delete buttons are mouse-only: they would break Tab-moves-right
    expect(container.querySelector("button[aria-label='Borrar fila 1']")).toHaveAttribute("tabindex", "-1");
  });

  it("keeps editable inputs out of React Flow's drag, wheel and pan", () => {
    const { container } = render(board(table()));
    expect(cell(container, 1, 1).closest(".nodrag.nopan")).not.toBeNull();
    expect(container.querySelector(".block-title input")?.className).toContain("nodrag");
  });

  it("right-aligns numeric columns for display only", () => {
    const { container } = render(board(table()));
    expect(cell(container, 1, 2).className).toContain("is-num");
    expect(cell(container, 1, 1).className).not.toContain("is-num");
    expect(update).not.toHaveBeenCalled();
  });

  it("renders malformed data without throwing, and an edit writes normalized rows", () => {
    const node = make({
      type: "table",
      columns: ["A", "B"],
      rows: [[1, 2, 3], ["solo"], "raro", [null, undefined]],
    });
    const { container } = render(board(node));
    expect(cell(container, 1, 1).value).toBe("1");
    expect(cell(container, 1, 2).value).toBe("2");
    expect(container.querySelector('input[aria-label="Fila 1, columna 3"]')).toBeNull();
    expect(cell(container, 2, 2).value).toBe("");
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(cell(container, 2, 1), { target: { value: "x" } });
    expect(update).toHaveBeenCalledWith("n1", { columns: ["A", "B"], rows: [["1", "2"], ["x", ""], ["", ""], ["", ""]] });
  });

  it("renders a node with no rows or columns at all", () => {
    const { container, getByRole } = render(board(make({ type: "table" })));
    expect(title(container)).toBeInTheDocument();
    fireEvent.click(getByRole("button", { name: "+ fila" }));
    expect(update).toHaveBeenCalledWith("n1", { columns: [""], rows: [[""]] });
  });

  it("never calls update on mount, select, focus or blur without a change", () => {
    const { container, rerender } = render(board(table()));
    rerender(board(table(), true));
    for (const input of container.querySelectorAll("input")) {
      fireEvent.focus(input);
      fireEvent.blur(input);
    }
    fireEvent.click(cell(container, 1, 1));
    expect(update).not.toHaveBeenCalled();
  });

  it("scrolls inside the block and only blocks board wheel zoom when it can scroll", () => {
    const { container } = render(board(table()));
    const area = container.querySelector(".table-scroll") as HTMLElement;
    expect(area).toBeInTheDocument();
    expect(area.className).not.toContain("nowheel"); // jsdom measures 0: nothing to scroll
  });
});

