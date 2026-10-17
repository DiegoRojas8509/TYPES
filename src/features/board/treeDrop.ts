// Decides what dropping an image from the sidebar tree onto a board means.
import { IMAGES_DIR, kindOf, parentOf, spaceOf } from "../../lib/paths";
import { relativeSrc } from "../../lib/markdown";

export type TreeDropPlan =
  | { kind: "link"; file: string }
  | { kind: "copy"; destDir: string }
  | { kind: "reject"; reason: "not-image" | "no-space" };

/** Path of `target` relative to the board's folder, written plainly (no %20) as the `.canvas` format expects. */
export function plainRelative(boardPath: string, target: string): string {
  return relativeSrc(boardPath, target).replace(/%20/g, " ").replace(/%28/g, "(").replace(/%29/g, ")");
}

/**
 * Images live in `<folder>/Imágenes/`. Dropping one that is already in the board folder's own
 * `Imágenes/` links it; anything else is copied into the board's folder (Rust adds `Imágenes/`).
 */
export function planTreeDrop(boardPath: string, dragged: string): TreeDropPlan {
  if (kindOf(dragged) !== "image") return { kind: "reject", reason: "not-image" };
  const folder = parentOf(boardPath);
  if (!folder || !spaceOf(boardPath)) return { kind: "reject", reason: "no-space" };
  const own = `${folder}/${IMAGES_DIR}`.normalize("NFC");
  if (parentOf(dragged).normalize("NFC") === own) return { kind: "link", file: plainRelative(boardPath, dragged) };
  return { kind: "copy", destDir: folder };
}
