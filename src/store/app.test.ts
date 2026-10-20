import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    restoreEntry: vi.fn(),
    activity: vi.fn().mockResolvedValue({}),
  },
  onFsChanged: vi.fn(async (cb: (p: { paths: string[] }) => void) => {
    fsListeners.push(cb);
    return () => {};
  }),
  onActivityChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => (e as { message?: string }).message ?? "error",
}));

import { api } from "../lib/api";
import { UNDO_WINDOW_MS, initialState, startSync, useApp } from "./app";

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
    mocked.deleteEntry.mockResolvedValue({ original: "", trashed: "" });
    await useApp.getState().deleteEntry("Ropa");
    expect(useApp.getState().openPath).toBeNull();
    expect(useApp.getState().activeSpace).toBeNull();
  });

  it("closes the open file BEFORE trashing it so the editor flushes into the trash", async () => {
    useApp.getState().open("Ropa/Notas.md");
    let openAtDelete: string | null | undefined;
    mocked.deleteEntry.mockImplementation(async () => {
      openAtDelete = useApp.getState().openPath;
      return { original: "Ropa/Notas.md", trashed: "/t/Notas.md" };
    });
    await useApp.getState().deleteEntry("Ropa/Notas.md");
    expect(openAtDelete).toBeNull();
  });

  it("deleting an unrelated file keeps the open one", async () => {
    useApp.getState().open("Ropa/Notas.md");
    mocked.deleteEntry.mockResolvedValue({ original: "", trashed: "" });
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

  describe("undo delete", () => {
    it("deleteEntry remembers where the item went", async () => {
      mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Notas.md", trashed: "/Users/d/.Trash/Notas.md" });
      await useApp.getState().deleteEntry("Ropa/Notas.md");
      expect(useApp.getState().lastDeleted).toEqual({ original: "Ropa/Notas.md", trashed: "/Users/d/.Trash/Notas.md" });
    });

    it("does not remember a delete whose trash location is unknown", async () => {
      mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Notas.md", trashed: "" });
      await useApp.getState().deleteEntry("Ropa/Notas.md");
      expect(useApp.getState().lastDeleted).toBeNull();
    });

    it("undoDelete restores, refreshes the tree, announces and clears", async () => {
      useApp.setState({ lastDeleted: { original: "Ropa/Notas.md", trashed: "/t/Notas.md" }, lastDeletedAt: Date.now() });
      mocked.restoreEntry.mockResolvedValue("Ropa/Notas.md");
      await useApp.getState().undoDelete();
      expect(mocked.restoreEntry).toHaveBeenCalledWith("Ropa/Notas.md", "/t/Notas.md");
      expect(mocked.listTree).toHaveBeenCalled();
      expect(useApp.getState().notice).toMatchObject({ message: "Se restauró «Notas»", tone: "info" });
      expect(useApp.getState().lastDeleted).toBeNull();
    });

    it("undoDelete shows the error and keeps lastDeleted when it fails", async () => {
      const last = { original: "Ropa/Notas.md", trashed: "/t/Notas.md" };
      useApp.setState({ lastDeleted: last, lastDeletedAt: Date.now() });
      mocked.restoreEntry.mockRejectedValue({ kind: "exists", message: "Ya existe «Notas.md»; no la sobrescribo." });
      await useApp.getState().undoDelete();
      expect(useApp.getState().notice?.message).toBe("Ya existe «Notas.md»; no la sobrescribo.");
      expect(useApp.getState().lastDeleted).toEqual(last);
    });

    it("two rapid undoDelete calls restore only once", async () => {
      useApp.setState({ lastDeleted: { original: "Ropa/Notas.md", trashed: "/t/Notas.md" }, lastDeletedAt: Date.now() });
      mocked.restoreEntry.mockResolvedValue("Ropa/Notas.md");
      await Promise.all([useApp.getState().undoDelete(), useApp.getState().undoDelete()]);
      expect(mocked.restoreEntry).toHaveBeenCalledTimes(1);
      expect(useApp.getState().notice?.tone).toBe("info");
    });

    it("a delete made while a restore is in flight keeps its own undo", async () => {
      useApp.setState({ lastDeleted: { original: "Ropa/Notas.md", trashed: "/t/Notas.md" }, lastDeletedAt: Date.now() });
      let finish!: (v: string) => void;
      mocked.restoreEntry.mockReturnValue(new Promise<string>((r) => (finish = r)));
      const undo = useApp.getState().undoDelete();
      mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Otra.md", trashed: "/t/Otra.md" });
      await useApp.getState().deleteEntry("Ropa/Otra.md");
      finish("Ropa/Notas.md");
      await undo;
      expect(useApp.getState().lastDeleted).toEqual({ original: "Ropa/Otra.md", trashed: "/t/Otra.md" });
    });

    it("a failed restore does not clobber a newer delete", async () => {
      useApp.setState({ lastDeleted: { original: "Ropa/Notas.md", trashed: "/t/Notas.md" }, lastDeletedAt: Date.now() });
      let fail!: (e: unknown) => void;
      mocked.restoreEntry.mockReturnValue(new Promise<string>((_, r) => (fail = r)));
      const undo = useApp.getState().undoDelete();
      mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Otra.md", trashed: "/t/Otra.md" });
      await useApp.getState().deleteEntry("Ropa/Otra.md");
      fail({ message: "x" });
      await undo;
      expect(useApp.getState().lastDeleted?.original).toBe("Ropa/Otra.md");
    });

    describe("expiry", () => {
      beforeEach(() => vi.useFakeTimers());
      afterEach(() => vi.useRealTimers());

      it("still restores inside the window", async () => {
        mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Notas.md", trashed: "/t/Notas.md" });
        await useApp.getState().deleteEntry("Ropa/Notas.md");
        vi.advanceTimersByTime(UNDO_WINDOW_MS - 1);
        mocked.restoreEntry.mockResolvedValue("Ropa/Notas.md");
        await useApp.getState().undoDelete();
        expect(mocked.restoreEntry).toHaveBeenCalledTimes(1);
      });

      it("after the window clears silently and restores nothing", async () => {
        mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Notas.md", trashed: "/t/Notas.md" });
        await useApp.getState().deleteEntry("Ropa/Notas.md");
        vi.advanceTimersByTime(UNDO_WINDOW_MS + 1);
        await useApp.getState().undoDelete();
        expect(mocked.restoreEntry).not.toHaveBeenCalled();
        expect(useApp.getState().lastDeleted).toBeNull();
        expect(useApp.getState().notice).toBeNull();
      });
    });

    it("undoDelete without anything to undo does nothing", async () => {
      await useApp.getState().undoDelete();
      expect(mocked.restoreEntry).not.toHaveBeenCalled();
    });
  });
});
