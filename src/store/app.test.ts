import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/api";

const fsListeners: Array<(p: { paths: string[] }) => void> = [];
vi.mock("../lib/api", () => ({
  api: {
    getSettings: vi.fn(),
    listTree: vi.fn(),
    createSpace: vi.fn(),
    createPage: vi.fn(),
    createBoard: vi.fn(),
    createFolder: vi.fn(),
    renameEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
  onFsChanged: vi.fn(async (cb: (p: { paths: string[] }) => void) => {
    fsListeners.push(cb);
    return () => {};
  }),
  errorMessage: (e: unknown) => (e as { message?: string }).message ?? "error",
}));

import { api } from "../lib/api";
import { initialState, startSync, useApp } from "./app";

const tree: TreeNode[] = [
  {
    name: "Ropa",
    path: "Ropa",
    kind: "dir",
    children: [{ name: "Notas.md", path: "Ropa/Notas.md", kind: "file", children: [] }],
  },
];
const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  fsListeners.length = 0;
  useApp.setState(initialState());
  mocked.listTree.mockResolvedValue(tree);
});

describe("store", () => {
  it("open sets openPath and activeSpace", () => {
    useApp.getState().open("Ropa/a/b.md");
    expect(useApp.getState().openPath).toBe("Ropa/a/b.md");
    expect(useApp.getState().activeSpace).toBe("Ropa");
  });

  it("open of a root-level file keeps the last selected space", () => {
    useApp.getState().selectSpace("Ropa");
    useApp.getState().open("CLAUDE.md");
    expect(useApp.getState().activeSpace).toBe("Ropa");
  });

  it("fs-changed triggers refreshTree and records the paths", async () => {
    await startSync();
    fsListeners[0]({ paths: ["Ropa/Notas.md"] });
    await vi.waitFor(() => expect(mocked.listTree).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(useApp.getState().tree).toEqual(tree));
    expect(useApp.getState().fsChange?.paths).toEqual(["Ropa/Notas.md"]);
  });

  it("refreshTree keeps expanded folders", async () => {
    useApp.getState().setExpanded("Ropa", true);
    await useApp.getState().refreshTree();
    expect(useApp.getState().expanded["Ropa"]).toBe(true);
  });

  it("rename of the open file updates openPath", async () => {
    useApp.getState().open("Ropa/Notas.md");
    mocked.renameEntry.mockResolvedValue("Ropa/Ideas.md");
    await useApp.getState().renameEntry("Ropa/Notas.md", "Ideas");
    expect(useApp.getState().openPath).toBe("Ropa/Ideas.md");
  });

  it("rename of a space remaps openPath, activeSpace and expanded", async () => {
    useApp.getState().open("Ropa/Notas.md");
    useApp.getState().setExpanded("Ropa", true);
    mocked.renameEntry.mockResolvedValue("Moda");
    await useApp.getState().renameEntry("Ropa", "Moda");
    const s = useApp.getState();
    expect(s.openPath).toBe("Moda/Notas.md");
    expect(s.activeSpace).toBe("Moda");
    expect(s.expanded["Moda"]).toBe(true);
    expect(s.expanded["Ropa"]).toBeUndefined();
  });

  it("deleting the open file or its folder closes it", async () => {
    useApp.getState().open("Ropa/Notas.md");
    mocked.deleteEntry.mockResolvedValue(undefined);
    await useApp.getState().deleteEntry("Ropa");
    expect(useApp.getState().openPath).toBeNull();
    expect(useApp.getState().activeSpace).toBeNull();
  });

  it("deleting an unrelated file keeps the open one", async () => {
    useApp.getState().open("Ropa/Notas.md");
    mocked.deleteEntry.mockResolvedValue(undefined);
    await useApp.getState().deleteEntry("Ropa/Otra.md");
    expect(useApp.getState().openPath).toBe("Ropa/Notas.md");
  });

  it("a failing command shows the Spanish message and returns null", async () => {
    mocked.createSpace.mockRejectedValue({ kind: "invalid_name", message: "Nombre no válido: no puede estar vacío." });
    const r = await useApp.getState().createSpace("");
    expect(r).toBeNull();
    expect(useApp.getState().notice?.message).toBe("Nombre no válido: no puede estar vacío.");
  });

  it("createPage opens the new page and expands its folder", async () => {
    mocked.createPage.mockResolvedValue("Ropa/Nueva.md");
    await useApp.getState().createPage("Ropa", "Nueva");
    expect(useApp.getState().openPath).toBe("Ropa/Nueva.md");
    expect(useApp.getState().expanded["Ropa"]).toBe(true);
    expect(mocked.listTree).toHaveBeenCalled();
  });

  it("createBoard opens the new board and expands its folder", async () => {
    mocked.createBoard.mockResolvedValue("Ropa/Plan.canvas");
    const r = await useApp.getState().createBoard("Ropa", "Plan");
    expect(r).toBe("Ropa/Plan.canvas");
    expect(mocked.createBoard).toHaveBeenCalledWith("Ropa", "Plan");
    expect(useApp.getState().openPath).toBe("Ropa/Plan.canvas");
    expect(useApp.getState().expanded["Ropa"]).toBe(true);
    expect(mocked.listTree).toHaveBeenCalled();
  });
});
