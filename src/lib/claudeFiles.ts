// The CLAUDE.md files are context for the agent, not pages Diego reads.
// They stay on disk and keep working; the sidebar just hides them by default.
import type { TreeNode } from "./api";

const KEY = "types.showClaudeFiles";

export function isClaudeFile(node: TreeNode): boolean {
  return node.kind === "file" && node.name.toUpperCase() === "CLAUDE.MD";
}

/** The tree without CLAUDE.md at any depth. Folders are kept even if they end up empty. */
export function withoutClaudeFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .filter((n) => !isClaudeFile(n))
    .map((n) => (n.kind === "dir" ? { ...n, children: withoutClaudeFiles(n.children) } : n));
}

export function countClaudeFiles(nodes: TreeNode[]): number {
  return nodes.reduce(
    (n, node) => n + (isClaudeFile(node) ? 1 : 0) + (node.kind === "dir" ? countClaudeFiles(node.children) : 0),
    0,
  );
}

export function getShowClaudeFiles(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setShowClaudeFiles(show: boolean): void {
  try {
    localStorage.setItem(KEY, show ? "1" : "0");
  } catch {
    /* preference only: the sidebar works without it */
  }
}
