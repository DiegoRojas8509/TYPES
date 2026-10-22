import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, listImages: vi.fn(), saveImage: vi.fn(), readText: vi.fn(), writeText: vi.fn(), deleteEntry: vi.fn() },
    assetUrl: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  };
});

import { api } from "../../lib/api";
import { TREE_PATH_MIME } from "../../lib/paths";
import { initialState, useApp } from "../../store/app";
import { ImagePanel } from "./ImagePanel";
import { useSidePanel } from "./sidePanel";

const BOARD = "Ropa/Plan.canvas";
const board = (files: string[]) =>
  JSON.stringify({ nodes: files.map((f, i) => ({ id: `n${i}`, type: "file", x: 0, y: 0, width: 1, height: 1, file: f })), edges: [] });
const tree = (names: string[]) => [
  {
    name: "Ropa",
    path: "Ropa",
    kind: "dir" as const,
    children: names.map((n) => ({ name: n, path: `Ropa/${n}`, kind: "file" as const, children: [] })),
  },
];
const IMAGES = ["Ropa/Imágenes/a.png", "Ropa/Imágenes/b.png"];
const FILES = [
  { type: "file", file: "Imágenes/b.png" },
  { type: "text", file: "Imágenes/zzz.png" },
  { type: "file", file: "Imágenes/b.png" },
  { type: "file", file: "notas.md" },
];

let errors: ReturnType<typeof vi.spyOn>;
const deleteEntry = vi.fn();

async function flush() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function mount(props: Partial<React.ComponentProps<typeof ImagePanel>> = {}) {
  render(<ImagePanel path={BOARD} editable nodes={FILES} {...props} />);
  await flush();
}
async function openPanel() {
  await act(async () => {
    screen.getByRole("button", { name: "Imágenes" }).click();
  });
  await flush();
}

beforeEach(() => {
  useSidePanel.setState({ open: null });
  vi.useFakeTimers();
  errors = vi.spyOn(console, "error").mockImplementation(() => {});
  deleteEntry.mockReset().mockResolvedValue(true);
  useApp.setState({
    ...initialState(),
    settings: { workspaceRoot: "/W", claudePath: null },
    tree: tree(["Plan.canvas", "Otra.canvas", "Tercera.canvas", "nota.md"]),
    deleteEntry,
  });
  vi.mocked(api.listImages).mockReset().mockResolvedValue(IMAGES);
  vi.mocked(api.saveImage).mockReset().mockResolvedValue("Ropa/Imágenes/n.png");
  vi.mocked(api.writeText).mockReset().mockResolvedValue(undefined);
  vi.mocked(api.readText).mockReset().mockImplementation(async (p) => {
    if (p === "Ropa/Otra.canvas") return board(["Imágenes/a.png", "Imágenes/a.png"]);
    if (p === "Ropa/Tercera.canvas") return board(["Imágenes/b.png"]);
    return board([]);
  });
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
  errors.mockRestore();
  vi.useRealTimers();
});

describe("ImagePanel", () => {
  it("closes when another right-hand panel opens", async () => {
    await mount();
    await openPanel();
    expect(screen.getByRole("complementary", { name: "Imágenes" })).toBeTruthy();
    await act(async () => useSidePanel.getState().toggle("history"));
    expect(screen.queryByRole("complementary", { name: "Imágenes" })).toBeNull();
  });

  it("toggles open and closed without touching disk", async () => {
    await mount();
    expect(screen.queryByRole("complementary", { name: "Imágenes" })).toBeNull();
    await openPanel();
    expect(screen.getByRole("complementary", { name: "Imágenes" })).toBeTruthy();
    await openPanel();
    expect(screen.queryByRole("complementary", { name: "Imágenes" })).toBeNull();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("«En esta pizarra» shows only image file nodes, deduped", async () => {
    await mount();
    await openPanel();
    const panel = screen.getByRole("complementary", { name: "Imágenes" });
    expect(within(panel).getAllByRole("listitem")).toHaveLength(1);
    expect(within(panel).getByText("b.png")).toBeTruthy();
  });

  it("«Todas» lists from listImages with the board folder", async () => {
    await mount();
    await openPanel();
    await act(async () => {
      screen.getByRole("tab", { name: "Todas" }).click();
    });
    await flush();
    expect(api.listImages).toHaveBeenCalledWith("Ropa");
    expect(within(screen.getByRole("complementary", { name: "Imágenes" })).getAllByRole("listitem")).toHaveLength(2);
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("dragstart sets the tree MIME with the workspace path", async () => {
    await mount();
    await openPanel();
    const item = screen.getAllByRole("listitem")[0];
    const setData = vi.fn();
    const dt = { setData, effectAllowed: "" };
    fireEvent.dragStart(item, { dataTransfer: dt });
    expect(setData).toHaveBeenCalledWith(TREE_PATH_MIME, "Ropa/Imágenes/b.png");
    expect(dt.effectAllowed).toBe("copyLink");
  });

  it("uploads to the board folder and writes nothing else", async () => {
    await mount();
    await openPanel();
    const input = screen.getByLabelText("Subir imágenes") as HTMLInputElement;
    const file = new File([new Uint8Array([1, 2])], "foto.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await flush();
    expect(api.saveImage).toHaveBeenCalledWith("Ropa", "foto.png", expect.any(Uint8Array));
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("notifies when an upload fails", async () => {
    vi.mocked(api.saveImage).mockRejectedValue(new Error("disco lleno"));
    await mount();
    await openPanel();
    const file = new File([new Uint8Array([1])], "foto.png", { type: "image/png" });
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Subir imágenes"), { target: { files: [file] } });
    });
    await flush();
    expect(useApp.getState().notice?.message).toContain("No se pudo subir la imagen:");
  });

  async function askDelete(name: string) {
    await act(async () => {
      screen.getByRole("tab", { name: "Todas" }).click();
    });
    await flush();
    await act(async () => {
      screen.getByRole("button", { name: `Mandar «${name}» a la papelera` }).click();
    });
    await flush();
  }

  it("warns with the number of boards using the image, then trashes via the store", async () => {
    await mount();
    await openPanel();
    await askDelete("a.png");
    expect(screen.getByRole("alertdialog").textContent).toContain("Esta imagen se usa en 1 pizarra.");
    expect(deleteEntry).not.toHaveBeenCalled();
    await act(async () => {
      screen.getByRole("button", { name: "Mover a la papelera" }).click();
    });
    expect(deleteEntry).toHaveBeenCalledWith("Ropa/Imágenes/a.png");
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("cancel does nothing", async () => {
    await mount();
    await openPanel();
    await askDelete("a.png");
    await act(async () => {
      screen.getByRole("button", { name: "Cancelar" }).click();
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(deleteEntry).not.toHaveBeenCalled();
  });

  it("still confirms when no board uses the image", async () => {
    vi.mocked(api.listImages).mockResolvedValue(["Ropa/Imágenes/libre.png"]);
    await mount();
    await openPanel();
    await askDelete("libre.png");
    expect(screen.getByRole("alertdialog").textContent).not.toContain("se usa en");
    await act(async () => {
      screen.getByRole("button", { name: "Mover a la papelera" }).click();
    });
    expect(deleteEntry).toHaveBeenCalledWith("Ropa/Imágenes/libre.png");
  });

  it("read-only board: browsable, no upload, delete or drag", async () => {
    await mount({ editable: false });
    await openPanel();
    expect(screen.queryByLabelText("Subir imágenes")).toBeNull();
    expect(screen.getAllByRole("listitem")[0].getAttribute("draggable")).not.toBe("true");
    await act(async () => {
      screen.getByRole("tab", { name: "Todas" }).click();
    });
    await flush();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /papelera/ })).toBeNull();
  });

  it("disables the button for a board at the workspace root", async () => {
    await mount({ path: "Plan.canvas" });
    const btn = screen.getByRole("button", { name: "Imágenes" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain("espacio");
  });

  it("shows empty states", async () => {
    vi.mocked(api.listImages).mockResolvedValue([]);
    await mount({ nodes: [] });
    await openPanel();
    expect(screen.getByText("Esta pizarra aún no tiene imágenes.")).toBeTruthy();
    await act(async () => {
      screen.getByRole("tab", { name: "Todas" }).click();
    });
    await flush();
    expect(screen.getByText("Suelta o sube imágenes para empezar.")).toBeTruthy();
  });

  it("shows a placeholder when a thumbnail fails to load", async () => {
    await mount();
    await openPanel();
    const img = document.querySelector(".image-panel img") as HTMLImageElement;
    fireEvent.error(img);
    expect(document.querySelector(".image-panel img")).toBeNull();
    expect(document.querySelector(".image-thumb-missing")).not.toBeNull();
  });

  it("refreshes «Todas» after a file change in the folder", async () => {
    await mount();
    await openPanel();
    await act(async () => {
      screen.getByRole("tab", { name: "Todas" }).click();
    });
    await flush();
    const before = vi.mocked(api.listImages).mock.calls.length;
    vi.mocked(api.listImages).mockResolvedValue([...IMAGES, "Ropa/Imágenes/c.png"]);
    await act(async () => {
      useApp.setState({ fsChange: { seq: 1, paths: ["Ropa/Imágenes/c.png"] } });
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(vi.mocked(api.listImages).mock.calls.length).toBeGreaterThan(before);
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });

  it("a failed thumbnail recovers when an fs change touches its path, other changes leave the src alone", async () => {
    await mount();
    await openPanel();
    const img = () => document.querySelector(".image-thumb img") as HTMLImageElement | null;
    const first = img()!.getAttribute("src");
    await act(async () => {
      useApp.setState({ fsChange: { seq: 5, paths: ["Ropa/otra.md"] } });
    });
    expect(img()!.getAttribute("src")).toBe(first);
    fireEvent.error(img()!);
    expect(img()).toBeNull();
    await act(async () => {
      useApp.setState({ fsChange: { seq: 6, paths: ["Ropa/Imágenes/b.png"] } });
    });
    expect(img()!.getAttribute("src")).toBe(`${first}?v=6`);
  });

  it("renders the panel inside the host element instead of the toolbar", async () => {
    const host = document.createElement("div");
    host.className = "board-flow";
    document.body.appendChild(host);
    await mount({ host });
    await openPanel();
    const panel = screen.getByRole("complementary", { name: "Imágenes" });
    expect(host.contains(panel)).toBe(true);
    host.remove();
  });

  it("clears the «Todas» list when the board moves to another folder", async () => {
    const { rerender } = render(<ImagePanel path={BOARD} editable nodes={FILES} />);
    await flush();
    await openPanel();
    await act(async () => {
      screen.getByRole("tab", { name: "Todas" }).click();
    });
    await flush();
    const panel = () => screen.getByRole("complementary", { name: "Imágenes" });
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(2);

    let release: (v: string[]) => void = () => {};
    vi.mocked(api.listImages).mockReturnValue(new Promise<string[]>((r) => (release = r)));
    rerender(<ImagePanel path="Otra/Plan.canvas" editable nodes={FILES} />);
    await flush();
    expect(within(panel()).queryAllByRole("listitem")).toHaveLength(0);

    await act(async () => release(["Otra/Imágenes/z.png"]));
    expect(within(panel()).getAllByRole("listitem")).toHaveLength(1);
  });
});
