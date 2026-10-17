// The CLAUDE.md files and the Imágenes folders are support material, not pages Diego reads.
// They stay on disk and keep working; the sidebar just hides them by default.
import type { TreeNode } from "./api";
import { isImagesSegment } from "./paths";

const KEY = "types.showClaudeFiles";

export function isClaudeFile(node: TreeNode): boolean {
  return node.kind === "file" && node.name.toUpperCase() === "CLAUDE.MD";
}

export function isImagesDir(node: TreeNode): boolean {
  return node.kind === "dir" && isImagesSegment(node.name);
}

const isHidden = (n: TreeNode) => isClaudeFile(n) || isImagesDir(n);

/** The tree without CLAUDE.md files and Imágenes folders at any depth. Other folders are kept even if empty. */
export function withoutClaudeFiles(nodes: TreeNode[]): TreeNode[] {
  return nodes
    .filter((n) => !isHidden(n))
    .map((n) => (n.kind === "dir" ? { ...n, children: withoutClaudeFiles(n.children) } : n));
}

/** How many nodes `withoutClaudeFiles` hides (CLAUDE.md files and Imágenes folders; not their contents). */
export function countClaudeFiles(nodes: TreeNode[]): number {
  return nodes.reduce(
    (n, node) => n + (isHidden(node) ? 1 : 0) + (node.kind === "dir" && !isImagesDir(node) ? countClaudeFiles(node.children) : 0),
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
