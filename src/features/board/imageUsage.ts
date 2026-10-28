// Pure helpers for the image panel: which images a board shows and which boards use an image.
import { parseCanvas } from "../../lib/canvas";
import { resolveWorkspacePath } from "../../lib/markdown";
import { kindOf } from "../../lib/paths";

const nfc = (s: string) => s.normalize("NFC");

/** Workspace paths of the image `file` nodes, in board order, without duplicates. */
export function boardImageFiles(boardPath: string, nodes: { type?: string; file?: unknown }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    if (n.type !== "file" || typeof n.file !== "string" || n.file === "") continue;
    const rel = resolveWorkspacePath(boardPath, n.file);
    if (rel === null || kindOf(rel) !== "image" || seen.has(nfc(rel))) continue;
    seen.add(nfc(rel));
    out.push(rel);
  }
  return out;
}

/** True when the `.canvas` text has a `file` node resolving to `image` (workspace path). */
export function usesImage(boardPath: string, text: string, image: string): boolean {
  const parsed = parseCanvas(text);
  if (!parsed.ok) return false;
  const target = nfc(image);
  return parsed.doc.nodes.some((n) => {
    if (n.type !== "file" || typeof n.file !== "string") return false;
    const rel = resolveWorkspacePath(boardPath, n.file);
    return rel !== null && nfc(rel) === target;
  });
}

/** Number of boards (not blocks) among `[path, text]` that use `image`. */
export function countBoardsUsing(boards: [string, string][], image: string): number {
  return boards.filter(([p, t]) => usesImage(p, t, image)).length;
}
