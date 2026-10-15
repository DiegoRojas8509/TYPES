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
