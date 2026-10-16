import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, api: { ...actual.api, readText: vi.fn(), writeText: vi.fn(), saveAttachment: vi.fn() } };
});
// recharts cannot measure its container under jsdom; its drawing is covered in ChartCanvas.test.tsx.
vi.mock("./nodes/ChartCanvas", () => ({ ChartCanvas: () => <div data-testid="chart-canvas" /> }));

import { api } from "../../lib/api";
import { parseCanvas } from "../../lib/canvas";
import { initialState, useApp } from "../../store/app";
import { AUTOSAVE_MS } from "../editor/useDocument";
import { BoardView } from "./BoardView";

const PATH = "Ropa/Plan.canvas";
const BOARD = JSON.stringify({
  nodes: [
    { id: "t1", type: "table", x: 0, y: 0, width: 360, height: 200, title: "Costos", columns: ["Concepto", "Valor"], rows: [["Tela", 12], ["Hilo"]] },
    { id: "c1", type: "chart", x: 400, y: 0, width: 360, height: 240, title: "Ventas", kind: "bar", labels: ["A", "B"], series: [{ name: "S", values: [1] }] },
  ],
  edges: [],
});
let disk = BOARD;

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  disk = BOARD;
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/Users/d/TYPES-espacios", claudePath: null } });
  vi.mocked(api.readText).mockReset().mockImplementation(async () => disk);
  vi.mocked(api.writeText).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("BoardView with data blocks", () => {
  it("renders a table and a chart (even malformed) and does not write on open", async () => {
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    render(<BoardView path={PATH} />);
    await wait(0);
    expect(screen.getByLabelText("Título de la tabla")).toHaveValue("Costos");
    expect(screen.getByLabelText("Fila 1, columna 2")).toHaveValue("12");
    expect(screen.getByRole("img", { name: "Gráfica de barras: Ventas" })).toBeInTheDocument();
    await wait(AUTOSAVE_MS * 3);
    expect(api.writeText).not.toHaveBeenCalled();
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });

  it("editing a table cell writes it to the board (normalized), keeping the chart node untouched", async () => {
    render(<BoardView path={PATH} />);
    await wait(0);
    fireEvent.change(screen.getByLabelText("Fila 2, columna 1"), { target: { value: "Botones" } });
    await wait(AUTOSAVE_MS);
    expect(api.writeText).toHaveBeenCalledTimes(1);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes[0]).toMatchObject({ id: "t1", rows: [["Tela", "12"], ["Botones", ""]] });
    expect(parsed.ok && parsed.doc.nodes[1]).toMatchObject({ id: "c1", series: [{ name: "S", values: [1] }] });
  });
});

describe("BoardView with process blocks", () => {
  it("renders a timeline and a decision (even malformed) and does not write on open", async () => {
    disk = JSON.stringify({
      nodes: [
        { id: "l1", type: "timeline", x: 0, y: 0, width: 420, height: 240, title: "Avances", items: [{ date: "2026-10-01", title: "Muestra", status: "hecho" }, "suelto", null] },
        { id: "d1", type: "decision", x: 460, y: 0, width: 420, height: 300, question: "¿Quién?", chosen: "Nadie", options: [{ name: "A", pros: ["x"] }, null, "B"] },
      ],
      edges: [],
    });
    const spies = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
    render(<BoardView path={PATH} />);
    await wait(0);
    expect(screen.getByLabelText("Título de la línea de tiempo")).toHaveValue("Avances");
    expect(screen.getByLabelText("Título del avance 2")).toHaveValue("suelto");
    expect(screen.getByLabelText("Pregunta de la decisión")).toHaveValue("¿Quién?");
    expect(screen.getByText("«Nadie» ya no es una opción")).toBeInTheDocument();
    await wait(AUTOSAVE_MS * 3);
    expect(api.writeText).not.toHaveBeenCalled();
    for (const s of spies) {
      expect(s).not.toHaveBeenCalled();
      s.mockRestore();
    }
  });

  it("choosing an option writes chosen to the board and leaves the other fields as they were", async () => {
    disk = JSON.stringify({
      nodes: [{ id: "d1", type: "decision", x: 0, y: 0, width: 420, height: 300, question: "¿Quién?", options: [{ name: "A", pros: [], cons: [], nota: 1 }] }],
      edges: [],
    });
    render(<BoardView path={PATH} />);
    await wait(0);
    fireEvent.click(screen.getByRole("button", { name: "Elegir esta opción: «A»" }));
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes[0]).toMatchObject({ id: "d1", chosen: "A", options: [{ name: "A", nota: 1 }] });
  });
});
