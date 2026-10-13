import { describe, expect, it } from "vitest";
import type { TreeNode } from "./api";
import { countClaudeFiles, isClaudeFile, withoutClaudeFiles } from "./claudeFiles";

const file = (name: string, path: string): TreeNode => ({ name, path, kind: "file", children: [] });
const dir = (name: string, path: string, children: TreeNode[]): TreeNode => ({ name, path, kind: "dir", children });

const tree: TreeNode[] = [
  dir("Ropa", "Ropa", [
    file("CLAUDE.md", "Ropa/CLAUDE.md"),
    file("Daring Martin.md", "Ropa/Daring Martin.md"),
    dir("adjuntos", "Ropa/adjuntos", [file("CLAUDE.md", "Ropa/adjuntos/CLAUDE.md")]),
  ]),
  file("CLAUDE.md", "CLAUDE.md"),
];

describe("claudeFiles", () => {
  it("spots CLAUDE.md whatever the case, and never a folder of that name", () => {
    expect(isClaudeFile(file("CLAUDE.md", "a"))).toBe(true);
    expect(isClaudeFile(file("claude.md", "a"))).toBe(true);
    expect(isClaudeFile(file("CLAUDE.md.bak", "a"))).toBe(false);
    expect(isClaudeFile(file("notas.md", "a"))).toBe(false);
    expect(isClaudeFile(dir("CLAUDE.md", "a", []))).toBe(false);
  });

  it("strips them at every depth and keeps everything else", () => {
    const out = withoutClaudeFiles(tree);
    expect(out).toHaveLength(1);
    expect(out[0].children.map((c) => c.name)).toEqual(["Daring Martin.md", "adjuntos"]);
    expect(out[0].children[1].children).toEqual([]);
    expect(countClaudeFiles(out)).toBe(0);
    expect(countClaudeFiles(tree)).toBe(3);
  });

  it("does not mutate the tree it was given", () => {
    withoutClaudeFiles(tree);
    expect(countClaudeFiles(tree)).toBe(3);
  });
});
