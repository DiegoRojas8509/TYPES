// Decides what dropping an image from the sidebar tree onto a board means.
import { kindOf, spaceOf } from "../../lib/paths";
import { relativeSrc } from "../../lib/markdown";

export type TreeDropPlan =
  | { kind: "link"; file: string }
  | { kind: "copy"; destDir: string }
  | { kind: "reject"; reason: "not-image" | "no-space" };

/** Path of `target` relative to the board's folder, written plainly (no %20) as the `.canvas` format expects. */
export function plainRelative(boardPath: string, target: string): string {
  return relativeSrc(boardPath, target).replace(/%20/g, " ").replace(/%28/g, "(").replace(/%29/g, ")");
}

export function planTreeDrop(boardPath: string, dragged: string): TreeDropPlan {
  if (kindOf(dragged) !== "image") return { kind: "reject", reason: "not-image" };
  const space = spaceOf(boardPath);
  if (!boardPath.includes("/") || !space) return { kind: "reject", reason: "no-space" };
  if (spaceOf(dragged) === space) return { kind: "link", file: plainRelative(boardPath, dragged) };
  return { kind: "copy", destDir: `${space}/adjuntos` };
}
