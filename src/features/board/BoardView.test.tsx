import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, readText: vi.fn(), writeText: vi.fn(), saveAttachment: vi.fn() },
  };
});

import { api } from "../../lib/api";
import { parseCanvas } from "../../lib/canvas";
import { initialState, useApp } from "../../store/app";
import { AUTOSAVE_MS } from "../editor/useDocument";
import { BoardView } from "./BoardView";

const PATH = "Ropa/Plan.canvas";
const EMPTY = '{"nodes":[],"edges":[]}\n';
let disk = EMPTY;
let seq = 0;

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
async function open(text: string) {
  disk = text;
  const view = render(<BoardView path={PATH} />);
  await settle();
  return view;
}
async function addNote() {
  await act(async () => {
    screen.getByRole("button", { name: "Agregar bloque" }).click();
  });
  await act(async () => {
    screen.getByRole("menuitem", { name: "Nota" }).click();
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  disk = EMPTY;
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/Users/d/TYPES-espacios", claudePath: null } });
  vi.mocked(api.readText).mockReset().mockImplementation(async () => disk);
  vi.mocked(api.writeText).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.saveAttachment).mockReset();
});
afterEach(() => vi.useRealTimers());

describe("BoardView (mounted under jsdom)", () => {
  it.each([["{"], [""]])("invalid content %j opens read-only with the reason and never writes", async (text) => {
    const { unmount } = await open(text);
    expect(screen.getByRole("alert")).toHaveTextContent("Esta pizarra no se puede abrir:");
    expect(screen.queryByRole("button", { name: "Agregar bloque" })).toBeNull();
    await wait(AUTOSAVE_MS * 5);
    unmount();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("a valid empty board shows the empty state and opening it never writes", async () => {
    const { unmount } = await open(EMPTY);
    expect(screen.getByText(/Doble clic para agregar un bloque/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");
    await wait(AUTOSAVE_MS * 5);
    unmount();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("choosing Nota from the + menu autosaves a board with one default text node", async () => {
    await open(EMPTY);
    await addNote();
    expect(screen.queryByText(/Doble clic para agregar un bloque/)).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Sin guardar");
    await wait(AUTOSAVE_MS);
    expect(api.writeText).toHaveBeenCalledTimes(1);
    const [path, written] = vi.mocked(api.writeText).mock.calls[0];
    expect(path).toBe(PATH);
    const parsed = parseCanvas(written);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.nodes).toHaveLength(1);
    expect(parsed.doc.nodes[0]).toMatchObject({ type: "text", text: "# Nueva nota\n", width: 260, height: 160 });
    expect(Number.isFinite(parsed.doc.nodes[0].x)).toBe(true);
    expect(parsed.doc.edges).toEqual([]);
  });

  it("double click on the pane opens the menu there", async () => {
    const { container } = await open(EMPTY);
    const pane = container.querySelector(".react-flow__pane") as HTMLElement;
    await act(async () => {
      fireEvent.doubleClick(pane, { clientX: 40, clientY: 50 });
    });
    expect(screen.getByRole("menu")).toBeInTheDocument();
    await act(async () => {
      screen.getByRole("menuitem", { name: "Zona" }).click();
    });
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes[0]).toMatchObject({ type: "group", label: "Zona" });
  });

  it("extra node fields and dangling edges render fine and survive a user edit", async () => {
    const raw = JSON.stringify({
      nodes: [{ id: "a", type: "raro", x: 5, y: 6, width: 100, height: 50, foo: { bar: 1 } }],
      edges: [{ id: "e1", fromNode: "a", toNode: "ghost", label: "x" }],
    });
    const { container } = await open(raw);
    expect(container.textContent).toContain("raro"); // fallback card shows the type
    await addNote();
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doc.nodes).toHaveLength(2);
    expect(parsed.doc.nodes.find((n) => n.id === "a")).toMatchObject({ type: "raro", x: 5, y: 6, foo: { bar: 1 } });
    expect(parsed.doc.edges).toEqual([{ id: "e1", fromNode: "a", toNode: "ghost", label: "x" }]);
  });

  it("a disk reload re-parses the board and is not treated as an edit", async () => {
    await open(EMPTY);
    expect(screen.getByText(/Doble clic/)).toBeInTheDocument();
    disk = JSON.stringify({ nodes: [{ id: "n9", type: "mistico", x: 0, y: 0, width: 80, height: 40 }], edges: [] });
    await act(async () => {
      useApp.setState({ fsChange: { seq: ++seq, paths: [PATH] } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText("mistico")).toBeInTheDocument();
    expect(screen.queryByText(/Doble clic/)).toBeNull();
    await wait(AUTOSAVE_MS * 5);
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("a disjoint disk change merges with unsaved edits without a conflict", async () => {
    await open(EMPTY);
    await addNote();
    // Claude edits the same document while Diego has unsaved changes.
    disk = JSON.stringify({ nodes: [], edges: [{ id: "x", fromNode: "p", toNode: "q" }] });
    await act(async () => {
      useApp.setState({ fsChange: { seq: ++seq, paths: [PATH] } });
      await vi.advanceTimersByTimeAsync(0);
    });
    // Disjoint changes merge on their own: no banner, both survive.
    expect(screen.queryByRole("alert")).toBeNull();
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[vi.mocked(api.writeText).mock.calls.length - 1][1]);
    expect(parsed.ok && [parsed.doc.nodes.length, parsed.doc.edges.length]).toEqual([1, 1]);
  });

  it("pasting an image saves it as an attachment and adds a file node with a relative path", async () => {
    vi.mocked(api.saveAttachment).mockResolvedValue("Ropa/adjuntos/foto 1.png");
    await open(EMPTY);
    const file = new File([new Uint8Array([1, 2, 3])], "foto 1.png", { type: "image/png" });
    await act(async () => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: { files: [file] } });
      document.body.dispatchEvent(ev);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.saveAttachment).toHaveBeenCalledWith("Ropa", "foto 1.png", expect.any(Uint8Array));
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes).toMatchObject([{ type: "file", file: "adjuntos/foto 1.png", width: 300, height: 220 }]);
  });

  it("an invalid board ignores pasted images", async () => {
    await open("{");
    await act(async () => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", {
        value: { files: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })] },
      });
      document.body.dispatchEvent(ev);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.saveAttachment).not.toHaveBeenCalled();
  });
});
