import { describe, expect, it } from "vitest";
import type { TreeNode } from "./api";
import { changeLine, changeOf, isUnseen, nearestExistingDir, summarize } from "./browse";

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
    expect(isUnseen(act, { "Ropa/Clientes/María.canvas": 50 }, nfd)).toBe(false);
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

  describe("stale log entries (file edited while the app was closed)", () => {
    const mod = 100_000;
    it("changeOf: stale entry gives time only; fresh or missing entries behave", () => {
      expect(changeOf({ at: mod - 2001, by: "claude" }, mod)).toEqual({ at: mod, by: null, fresh: false });
      expect(changeOf({ at: mod - 2000, by: "claude" }, mod)).toEqual({ at: mod - 2000, by: "claude", fresh: true });
      expect(changeOf({ at: mod + 5, by: "tu" }, mod)).toMatchObject({ by: "tu", fresh: true });
      expect(changeOf(undefined, mod)).toEqual({ at: mod, by: null, fresh: false });
      expect(changeOf({ at: 7, by: "claude" }, undefined)).toMatchObject({ at: 7, by: "claude" });
      expect(changeOf(undefined, undefined)).toEqual({ at: null, by: null, fresh: false });
    });

    it("a stale entry shows no actor and no dot", () => {
      const act = { "a.md": { at: mod - 5000, by: "claude" as const } };
      expect(isUnseen(act, {}, "a.md", mod)).toBe(false);
      expect(isUnseen(act, {}, "a.md", mod - 5000)).toBe(true);
      const s = summarize(d("X", [f("X/a.md", mod)]), { "X/a.md": act["a.md"] }, {});
      expect(s).toMatchObject({ at: mod, by: null, unseen: false });
    });

    it("folder summary applies the rule per descendant", () => {
      const node = d("X", [f("X/old.md", mod), f("X/new.md", 50_000)]);
      const act = {
        "X/old.md": { at: 10, by: "claude" as const }, // stale
        "X/new.md": { at: 50_000, by: "claude-cel" as const }, // fresh but older than old.md's mtime
      };
      expect(summarize(node, act, {})).toMatchObject({ at: mod, by: null, unseen: true });
    });
  });

  it("folder entries in the log are ignored by folder summaries", () => {
    const act = { Ropa: { at: 99_999, by: "claude" as const }, "Ropa/Clientes": { at: 99_999, by: "claude" as const } };
    expect(summarize(tree[0], act, {})).toMatchObject({ at: 1000, by: null, unseen: false });
  });
});
