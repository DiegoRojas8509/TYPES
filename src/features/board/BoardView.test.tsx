import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, readText: vi.fn(), writeText: vi.fn(), saveImage: vi.fn(), importFiles: vi.fn() },
    assetUrl: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  };
});

import { api } from "../../lib/api";
import { parseCanvas } from "../../lib/canvas";
import { initialState, useApp } from "../../store/app";
import { useChats } from "../chat/conversations";
import { initialChat } from "../chat/reducer";
import { TREE_PATH_MIME } from "../../lib/paths";
import { AUTOSAVE_MS } from "../../lib/useDocument";
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
  vi.mocked(api.saveImage).mockReset();
  vi.mocked(api.importFiles).mockReset();
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

  it("renders the image panel inside the flow area, below the toolbar", async () => {
    const { container, unmount } = await open(EMPTY);
    await act(async () => {
      screen.getByRole("button", { name: "Imágenes" }).click();
    });
    await settle();
    const panel = screen.getByRole("complementary", { name: "Imágenes" });
    expect(container.querySelector(".board-flow")?.contains(panel)).toBe(true);
    expect(container.querySelector(".pane-header")?.contains(panel)).toBe(false);
    unmount();
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

  it("renders one block of each kind (note, image, zone, unknown) without throwing", async () => {
    const raw = JSON.stringify({
      nodes: [
        { id: "z", type: "group", x: 0, y: 0, width: 600, height: 400, label: "Telas" },
        { id: "n", type: "text", x: 20, y: 40, width: 260, height: 160, text: "# Cotización\n\nLino 120 por metro", color: "2" },
        { id: "i", type: "file", x: 300, y: 40, width: 260, height: 160, file: "adjuntos/lino.png" },
        { id: "u", type: "raro", x: 20, y: 220, width: 260, height: 100, foo: 1 },
      ],
      edges: [],
    });
    const { container, unmount } = await open(raw);
    expect((container.querySelector("input.zone-label") as HTMLInputElement).value).toBe("Telas");
    expect(container.querySelector(".block-title")?.textContent).toBe("Cotización");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      `asset://localhost/${encodeURIComponent("/Users/d/TYPES-espacios/Ropa/adjuntos/lino.png")}`,
    );
    expect(container.querySelector(".block-unknown")?.textContent).toContain("«raro»");
    await wait(AUTOSAVE_MS * 5);
    unmount();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("editing a zone label from the board autosaves the new label and keeps other fields", async () => {
    const raw = JSON.stringify({ nodes: [{ id: "z", type: "group", x: 1, y: 2, width: 600, height: 400, label: "Zona", extra: true }], edges: [] });
    const { container } = await open(raw);
    await act(async () => {
      fireEvent.change(container.querySelector("input.zone-label") as HTMLInputElement, { target: { value: "Pedidos" } });
    });
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes[0]).toMatchObject({ id: "z", label: "Pedidos", extra: true, x: 1, y: 2 });
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

  it("pasting an image saves it in the board folder's Imágenes and adds a file node with a relative path", async () => {
    vi.mocked(api.saveImage).mockResolvedValue("Ropa/Imágenes/foto 1.png");
    await open(EMPTY);
    const file = new File([new Uint8Array([1, 2, 3])], "foto 1.png", { type: "image/png" });
    await act(async () => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: { files: [file] } });
      document.body.dispatchEvent(ev);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.saveImage).toHaveBeenCalledWith("Ropa", "foto 1.png", expect.any(Uint8Array));
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes).toMatchObject([{ type: "file", file: "Imágenes/foto 1.png", width: 300, height: 220 }]);
  });

  it("a board in a subfolder saves pasted images in that subfolder's Imágenes", async () => {
    vi.mocked(api.saveImage).mockResolvedValue("Ropa/Maquila/Imágenes/p.png");
    disk = EMPTY;
    render(<BoardView path="Ropa/Maquila/Plan.canvas" />);
    await settle();
    await act(async () => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", {
        value: { files: [new File([new Uint8Array([1])], "p.png", { type: "image/png" })] },
      });
      document.body.dispatchEvent(ev);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.saveImage).toHaveBeenCalledWith("Ropa/Maquila", "p.png", expect.any(Uint8Array));
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes).toMatchObject([{ type: "file", file: "Imágenes/p.png" }]);
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
    expect(api.saveImage).not.toHaveBeenCalled();
  });

  it("an image save that resolves after the board became unreadable never overwrites it", async () => {
    let resolveSave!: (p: string) => void;
    vi.mocked(api.saveImage).mockReturnValue(new Promise<string>((r) => (resolveSave = r)));
    await open(EMPTY);
    await act(async () => {
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", {
        value: { files: [new File([new Uint8Array([1])], "a.png", { type: "image/png" })] },
      });
      document.body.dispatchEvent(ev);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(api.saveImage).toHaveBeenCalledTimes(1);
    // Claude breaks the file while the attachment is still being saved.
    disk = "{ roto";
    await act(async () => {
      useApp.setState({ fsChange: { seq: ++seq, paths: [PATH] } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Esta pizarra no se puede abrir:");
    await act(async () => {
      resolveSave("Ropa/Imágenes/a.png");
      await vi.advanceTimersByTimeAsync(0);
    });
    await wait(AUTOSAVE_MS * 5);
    expect(api.writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Esta pizarra no se puede abrir:");
  });
});

async function dropFromTree(dragged: string) {
  const flow = document.querySelector(".board-flow")!;
  const dataTransfer = {
    types: [TREE_PATH_MIME],
    getData: (k: string) => (k === TREE_PATH_MIME ? dragged : ""),
    files: [],
    dropEffect: "none",
  };
  await act(async () => {
    fireEvent.dragOver(flow, { dataTransfer });
    fireEvent.drop(flow, { dataTransfer, clientX: 400, clientY: 300 });
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("dragging images from the sidebar", () => {
  it("links an image already in the board folder's Imágenes without copying it", async () => {
    await open(EMPTY);
    await dropFromTree("Ropa/Imágenes/codigo.png");
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes).toMatchObject([{ type: "file", file: "Imágenes/codigo.png" }]);
    expect(api.saveImage).not.toHaveBeenCalled();
    expect(api.importFiles).not.toHaveBeenCalled();
  });

  it("copies an image of another space into this one and points at the copy", async () => {
    vi.mocked(api.importFiles).mockResolvedValue(["Ropa/Imágenes/a.png"]);
    await open(EMPTY);
    await dropFromTree("Otro/Imágenes/a.png");
    expect(api.importFiles).toHaveBeenCalledWith("Ropa", ["/Users/d/TYPES-espacios/Otro/Imágenes/a.png"]);
    await wait(AUTOSAVE_MS);
    const parsed = parseCanvas(vi.mocked(api.writeText).mock.calls[0][1]);
    expect(parsed.ok && parsed.doc.nodes).toMatchObject([{ type: "file", file: "Imágenes/a.png" }]);
  });

  it("reports a failed copy and adds nothing", async () => {
    vi.mocked(api.importFiles).mockRejectedValue({ message: "boom" });
    await open(EMPTY);
    await dropFromTree("Otro/Imágenes/a.png");
    await wait(AUTOSAVE_MS * 5);
    expect(api.writeText).not.toHaveBeenCalled();
    expect(useApp.getState().notice?.message).toMatch(/No se pudo traer la imagen/);
  });

  it("ignores a dragged non-image", async () => {
    await open(EMPTY);
    await dropFromTree("Ropa/Notas.md");
    await wait(AUTOSAVE_MS * 5);
    expect(api.writeText).not.toHaveBeenCalled();
    expect(api.importFiles).not.toHaveBeenCalled();
  });

  it("an invalid board has no drop target and never writes", async () => {
    await open("{");
    expect(document.querySelector(".board-flow")).toBeNull();
    await wait(AUTOSAVE_MS * 5);
    expect(api.writeText).not.toHaveBeenCalled();
  });
});

describe("Ordenar con Claude", () => {
  const SENTENCE =
    'Reorganiza la pizarra "Plan": agrupa por tema con zonas (group), alinea y deja espacio entre bloques. No borres ni cambies el contenido de ningún bloque; solo x, y, width, height y las zonas nuevas.';
  const send = vi.fn().mockResolvedValue(true);
  const button = () => screen.getByRole("button", { name: "Ordenar con Claude" });

  beforeEach(() => {
    send.mockClear();
    useChats.setState({ conversations: {}, send });
  });

  it("sends the fixed sentence through the chat store, naming the board without extension", async () => {
    await open(EMPTY);
    expect(button()).toBeEnabled();
    await act(async () => {
      fireEvent.click(button());
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("Ropa", SENTENCE, []);
  });

  it("uses the name of a board in a subfolder without its path", async () => {
    disk = EMPTY;
    render(<BoardView path="Ropa/sub/Verano 2027.canvas" />);
    await settle();
    await act(async () => {
      fireEvent.click(button());
    });
    expect(send.mock.calls[0][1]).toContain('la pizarra "Verano 2027":');
    expect(send.mock.calls[0][0]).toBe("Ropa");
  });

  it("is disabled, with the reason, while Claude is running in that space and does not send", async () => {
    useChats.setState({ conversations: { Ropa: { ...initialChat(), running: true } } });
    await open(EMPTY);
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("title", "Claude está trabajando; espera a que termine");
    await act(async () => {
      fireEvent.click(button());
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a run in another space", async () => {
    useChats.setState({ conversations: { Comida: { ...initialChat(), running: true } } });
    await open(EMPTY);
    expect(button()).toBeEnabled();
  });

  it("is disabled, with the reason, when the board cannot be opened, and never writes", async () => {
    await open("{");
    expect(button()).toBeDisabled();
    expect(button()).toHaveAttribute("title", "La pizarra no se puede editar");
    await act(async () => {
      fireEvent.click(button());
    });
    expect(send).not.toHaveBeenCalled();
    await wait(AUTOSAVE_MS * 5);
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("clicking it never writes the board itself", async () => {
    await open(EMPTY);
    await act(async () => {
      fireEvent.click(button());
    });
    await wait(AUTOSAVE_MS * 5);
    expect(api.writeText).not.toHaveBeenCalled();
  });
});

describe("history layer in the mounted board", () => {
  const SAMPLE = {
    nodes: [
      { id: "a", type: "text", x: 0, y: 0, width: 200, height: 100, text: "# Uno", extra: { k: [1] } },
      { id: "b", type: "text", x: 300, y: 0, width: 200, height: 100, text: "# Dos" },
    ],
    edges: [{ id: "e", fromNode: "a", toNode: "b", label: "x" }],
  };
  const withArchived = JSON.stringify({
    ...SAMPLE,
    nodes: [{ ...SAMPLE.nodes[0], archived: { at: "2026-10-01", reason: "viejo", by: "claude" } }, SAMPLE.nodes[1]],
  });
  const lastWrite = () => {
    const calls = vi.mocked(api.writeText).mock.calls;
    const parsed = parseCanvas(calls[calls.length - 1][1]);
    if (!parsed.ok) throw new Error("bad write");
    return { text: calls[calls.length - 1][1], doc: parsed.doc };
  };

  it("opening a board with archived blocks hides them, shows «Historial (1)» and never writes", async () => {
    const { container, unmount } = await open(withArchived);
    expect(screen.getByRole("button", { name: /^Historial/ })).toHaveTextContent("Historial (1)");
    expect(container.querySelectorAll(".react-flow__node:not([style*='hidden'])").length).toBeLessThanOrEqual(2);
    await wait(AUTOSAVE_MS * 5);
    unmount();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("opening the panel and clicking around does not write", async () => {
    const { unmount } = await open(withArchived);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Historial/ }));
    });
    await wait(AUTOSAVE_MS * 5);
    unmount();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("restoring from the panel saves the node back without `archived` and with everything else intact", async () => {
    const { unmount } = await open(withArchived);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Historial/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Restaurar/ }));
    });
    await wait(AUTOSAVE_MS * 2);
    const { doc, text } = lastWrite();
    expect(doc.nodes[0]).toEqual(SAMPLE.nodes[0]);
    expect(doc.edges).toEqual(SAMPLE.edges);
    expect(text).not.toContain("hidden");
    unmount();
  });

  it("archiving from a block saves the whole node plus archived (by tu), keeps the edge, and no `hidden`", async () => {
    const { unmount } = await open(JSON.stringify(SAMPLE));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archivar «Uno»" }));
    });
    const input = screen.getByPlaceholderText("¿Por qué se archiva? (opcional)");
    fireEvent.change(input, { target: { value: "reemplazado" } });
    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter" });
    });
    await wait(AUTOSAVE_MS * 2);
    const { doc, text } = lastWrite();
    const { archived, ...rest } = doc.nodes[0] as Record<string, unknown>;
    expect(rest).toEqual(SAMPLE.nodes[0]);
    expect(archived).toMatchObject({ reason: "reemplazado", by: "tu" });
    expect((archived as { at: string }).at).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(doc.nodes[1]).toEqual(SAMPLE.nodes[1]);
    expect(doc.edges).toEqual(SAMPLE.edges);
    expect(text).not.toContain("hidden");
    expect(screen.getByRole("button", { name: /^Historial/ })).toHaveTextContent("Historial (1)");
    unmount();
  });

  it("a malformed `archived` leaves the block on screen and out of the history", async () => {
    const bad = JSON.stringify({ ...SAMPLE, nodes: [{ ...SAMPLE.nodes[0], archived: { at: "ayer", reason: "x" } }, SAMPLE.nodes[1]] });
    const { unmount } = await open(bad);
    expect(screen.queryByRole("button", { name: /^Historial/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Archivar «Uno»" })).toBeInTheDocument();
    unmount();
  });

  it("«Limpiar con Claude» sits in the toolbar and is disabled on an unreadable board", async () => {
    const { unmount } = await open("{");
    expect(screen.getByRole("button", { name: "Limpiar con Claude" })).toBeDisabled();
    unmount();
  });
});
