// Helpers for workspace-relative paths ("Ropa/Telas/Algodón.md", '/' separated).

export type FileKind = "markdown" | "html" | "image" | "other";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function parentOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

/** First path segment, or null for an empty path. */
export function spaceOf(path: string): string | null {
  const first = path.split("/")[0];
  return first ? first : null;
}

/** Lowercase extension without the dot; "" when there is none (dotfiles have none). */
export function extOf(path: string): string {
  const name = baseName(path);
  const i = name.lastIndexOf(".");
  return i <= 0 ? "" : name.slice(i + 1).toLowerCase();
}

export function kindOf(path: string): FileKind {
  const ext = extOf(path);
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "html" || ext === "htm") return "html";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "other";
}

export function joinRel(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name;
}

/** True for `path === ancestor` and for anything below it. */
export function isWithin(path: string, ancestor: string): boolean {
  return path === ancestor || path.startsWith(`${ancestor}/`);
}

/** Rewrites `path` when it is `from` or below it so it lives under `to`. */
export function replacePrefix(path: string, from: string, to: string): string {
  return path === from ? to : isWithin(path, from) ? to + path.slice(from.length) : path;
}
