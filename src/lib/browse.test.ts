import { describe, expect, it } from "vitest";
import type { TreeNode } from "./api";
import { changeLine, isUnseen, nearestExistingDir, summarize } from "./browse";

const f = (path: string, modified?: number): TreeNode => ({ name: path.split("/").pop()!, path, kind: "file", children: [], modified });
const d = (path: string, children: TreeNode[]): TreeNode => ({ name: path.split("/").pop()!, path, kind: "dir", children });
const tree = [d("Ropa", [d("Ropa/Clientes", [f("Ropa/Clientes/Daring.canvas", 1000)]), f("Ropa/CLAUDE.md", 9)])];

describe("browse helpers", () => {
  it("nearestExistingDir climbs to the closest folder that still exists", () => {
    expect(nearestExistingDir(tree, "Ropa/Clientes")).toBe("Ropa/Clientes");
    expect(nearestExistingDir(tree, "Ropa/Clientes/Viejo")).toBe("Ropa/Clientes");
    expect(nearestExistingDir(tree, "Otro/Cosa")).toBeNull();
    expect(nearestExistingDir(tree, null)).toBeNull();
  });

  it("looks activity up with NFC even when the path is NFD", () => {
    const nfd = "Ropa/Clientes/María.canvas";
    const act = { "Ropa/Clientes/María.canvas": { at: 50, by: "claude" as const } };
    expect(isUnseen(act, {}, nfd)).toBe(true);
    expect(isUnseen(act, { [nfd]: 50 }, nfd)).toBe(false);
  });

  it("a folder summary comes from its files and ignores CLAUDE.md", () => {
    const act = {
      "Ropa/Clientes/Daring.canvas": { at: 2000, by: "claude-cel" as const },
      "Ropa/CLAUDE.md": { at: 9999, by: "claude" as const },
    };
    const s = summarize(tree[0], act, {});
    expect(s).toMatchObject({ at: 2000, by: "claude-cel", unseen: true, boards: 1 });
    expect(summarize(tree[0], act, { "Ropa/Clientes/Daring.canvas": 2000 }).unseen).toBe(false);
  });

  it("falls back to modified when there is no activity", () => {
    expect(summarize(tree[0], {}, {})).toMatchObject({ at: 1000, by: null, unseen: false });
  });

  it("changeLine labels each actor", () => {
    const now = 10 * 3600_000;
    const at = now - 2 * 3600_000;
    expect(changeLine(at, "tu", now)).toBe("hace 2 h · tú");
    expect(changeLine(at, "claude", now)).toBe("hace 2 h · Claude");
    expect(changeLine(at, "claude-cel", now)).toBe("hace 2 h · Claude desde el cel");
    expect(changeLine(at, "fuera", now)).toBe("hace 2 h · fuera de la app");
    expect(changeLine(at, null, now)).toBe("hace 2 h");
    expect(changeLine(null, null, now)).toBe("");
  });
});
