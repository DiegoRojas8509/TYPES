import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../lib/api";

vi.mock("../lib/api", () => ({
  api: {
    getSettings: vi.fn(),
    listTree: vi.fn(),
    activity: vi.fn(),
    renameEntry: vi.fn(),
    deleteEntry: vi.fn(),
    writeText: vi.fn(),
  },
  onFsChanged: vi.fn(async () => () => {}),
  onActivityChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => (e as { message?: string }).message ?? "error",
}));

import { api } from "../lib/api";
import { initialState, useApp } from "./app";

const f = (path: string): TreeNode => ({ name: path.split("/").pop()!, path, kind: "file", children: [] });
const d = (path: string, children: TreeNode[]): TreeNode => ({ name: path.split("/").pop()!, path, kind: "dir", children });
const tree = [d("Ropa", [d("Ropa/Clientes", [f("Ropa/Clientes/Daring.canvas")]), f("Ropa/Plan.canvas")])];
const mocked = vi.mocked(api);
const s = () => useApp.getState();

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  useApp.setState({ ...initialState(), tree, treeLoaded: true });
  mocked.listTree.mockResolvedValue(tree);
  mocked.activity.mockResolvedValue({});
});

describe("card navigation store", () => {
  it("navigates Inicio -> Ropa -> Clientes -> board -> back", () => {
    expect(s().currentDir).toBeNull();
    s().browse("Ropa");
    s().browse("Ropa/Clientes");
    expect(s().currentDir).toBe("Ropa/Clientes");
    s().open("Ropa/Clientes/Daring.canvas");
    expect(s().openPath).toBe("Ropa/Clientes/Daring.canvas");
    expect(s().currentDir).toBe("Ropa/Clientes");
    s().back();
    expect(s().openPath).toBeNull();
    expect(s().currentDir).toBe("Ropa/Clientes");
    s().back();
    expect(s().currentDir).toBe("Ropa");
    s().back();
    expect(s().currentDir).toBeNull();
    s().back();
    expect(s().currentDir).toBeNull();
  });

  it("browse closes the open file", () => {
    s().open("Ropa/Plan.canvas");
    s().browse("Ropa");
    expect(s().openPath).toBeNull();
  });

  it("open marks the file as seen and persists it", () => {
    s().open("Ropa/Plan.canvas");
    expect(s().seen["Ropa/Plan.canvas"]).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem("types.seen")!)["Ropa/Plan.canvas"]).toBeGreaterThan(0);
  });

  it("navigating and opening never writes to disk", async () => {
    s().browse("Ropa");
    s().open("Ropa/Plan.canvas");
    s().back();
    await s().refreshActivity();
    expect(mocked.writeText).not.toHaveBeenCalled();
  });

  it("refreshActivity stores the log and survives a failing backend", async () => {
    mocked.activity.mockResolvedValueOnce({ "Ropa/Plan.canvas": { at: 5, by: "claude" } });
    await s().refreshActivity();
    expect(s().activity["Ropa/Plan.canvas"]).toEqual({ at: 5, by: "claude" });
    mocked.activity.mockRejectedValueOnce(new Error("x"));
    await s().refreshActivity();
    expect(s().activity["Ropa/Plan.canvas"]).toEqual({ at: 5, by: "claude" });
  });

  it("claude activity on the board being viewed does not leave an unseen dot behind", async () => {
    s().open("Ropa/Plan.canvas");
    mocked.activity.mockResolvedValueOnce({ "Ropa/Plan.canvas": { at: Date.now() + 5000, by: "claude" } });
    await s().refreshActivity();
    expect(s().seen["Ropa/Plan.canvas"]).toBeGreaterThanOrEqual(Date.now() + 5000);
  });

  it("falls back to the nearest existing ancestor when currentDir disappears", async () => {
    s().browse("Ropa/Clientes");
    mocked.listTree.mockResolvedValue([d("Ropa", [f("Ropa/Plan.canvas")])]);
    await s().refreshTree();
    expect(s().currentDir).toBe("Ropa");
    mocked.listTree.mockResolvedValue([]);
    await s().refreshTree();
    expect(s().currentDir).toBeNull();
  });

  it("deleting or renaming the folder being viewed moves currentDir", async () => {
    s().browse("Ropa/Clientes");
    mocked.renameEntry.mockResolvedValue("Ropa/Cartera");
    mocked.listTree.mockResolvedValue([d("Ropa", [d("Ropa/Cartera", []), f("Ropa/Plan.canvas")])]);
    await s().renameEntry("Ropa/Clientes", "Cartera");
    expect(s().currentDir).toBe("Ropa/Cartera");
    mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Cartera", trashed: "/t/x" });
    mocked.listTree.mockResolvedValue([d("Ropa", [f("Ropa/Plan.canvas")])]);
    await s().deleteEntry("Ropa/Cartera");
    expect(s().currentDir).toBe("Ropa");
  });

  it("drops seen entries of vanished files on tree refresh", async () => {
    useApp.setState({ seen: { "Ropa/Plan.canvas": 1, "Ropa/Borrada.canvas": 2 } });
    await s().refreshTree();
    expect(Object.keys(s().seen)).toEqual(["Ropa/Plan.canvas"]);
  });
});
