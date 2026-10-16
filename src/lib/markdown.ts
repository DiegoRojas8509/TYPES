// Pure helpers for the Markdown editor: image path mapping and a check for
// syntax the editor cannot round-trip. No Tiptap here, so they test cheaply.
import { parentOf } from "./paths";

const ABSOLUTE_URL = /^([a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Remote, data or already-resolved URLs are never rewritten. */
export function isExternalSrc(src: string): boolean {
  return ABSOLUTE_URL.test(src);
}

/** Collapses `.` and `..`; null when the path climbs above the workspace root. */
function normalize(path: string): string | null {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
    } else out.push(part);
  }
  return out.join("/");
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/** Markdown image URLs may not hold raw spaces or parentheses. */
export function encodeSrc(src: string): string {
  return src.replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29");
}

/**
 * Workspace-relative path of the file an image `src` points to, given the page
 * that contains it. `src` is relative to the page's own folder (standard
 * Markdown). Null for external URLs and for paths that leave the workspace.
 */
export function resolveWorkspacePath(pagePath: string, src: string): string | null {
  if (!src || isExternalSrc(src) || src.startsWith("/")) return null;
  return normalize(`${parentOf(pagePath)}/${safeDecode(src)}`);
}

/** Inverse: the `src` to write in `pagePath` for a workspace-relative `target`. */
export function relativeSrc(pagePath: string, target: string): string {
  const from = parentOf(pagePath).split("/").filter(Boolean);
  const to = target.split("/").filter(Boolean);
  let i = 0;
  while (i < from.length && i < to.length - 1 && from[i] === to[i]) i++;
  const up = from.slice(i).map(() => "..");
  return encodeSrc([...up, ...to.slice(i)].join("/"));
}

/**
 * Display URL for an image. On disk the Markdown keeps the relative path; this
 * only maps it to an asset URL built from the absolute workspace root.
 * Returns "" for anything that is not a file inside the workspace (http(s), `//host`,
 * data:, javascript:, absolute or escaping paths): a note must not make the webview
 * request a URL just by being opened. The caller renders no `src` for "". An asset
 * URL that points inside the workspace is ours and passes through.
 */
export function resolveImageSrc(
  pagePath: string,
  src: string,
  workspaceRoot: string | null,
  toAssetUrl: (absolutePath: string) => string,
): string {
  const rel = resolveWorkspacePath(pagePath, src);
  if (rel === null) {
    const abs = workspaceRoot ? pathFromAssetUrl(src) : null;
    return abs !== null && abs.startsWith(`${workspaceRoot!.replace(/\/+$/, "")}/`) ? src : "";
  }
  if (!workspaceRoot) return src;
  return toAssetUrl(`${workspaceRoot.replace(/\/+$/, "")}/${rel}`);
}

/**
 * Inverse of `resolveImageSrc`: turns an asset URL that points inside the
 * workspace back into the page-relative `src` written to disk. Anything else
 * is returned untouched.
 */
export function unresolveImageSrc(
  pagePath: string,
  src: string,
  workspaceRoot: string | null,
  fromAssetUrl: (url: string) => string | null,
): string {
  if (!workspaceRoot) return src;
  const abs = fromAssetUrl(src);
  if (abs === null) return src;
  const root = `${workspaceRoot.replace(/\/+$/, "")}/`;
  if (!abs.startsWith(root)) return src;
  return relativeSrc(pagePath, abs.slice(root.length));
}

/** Extracts the absolute path from a Tauri asset URL (`asset://localhost/<encoded>`). */
export function pathFromAssetUrl(url: string): string | null {
  const m = /^(?:asset:\/\/localhost|https?:\/\/asset\.localhost)\/(.+)$/.exec(url);
  return m ? safeDecode(m[1]) : null;
}

/**
 * Syntax that the editor drops or corrupts when it re-serializes a page.
 * Returns Spanish labels; empty when the page round-trips safely.
 */
export function unsupportedSyntax(markdown: string): string[] {
  const text = markdown
    .replace(/\r\n/g, "\n")
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[^\n]*$/gm, "");
  const found: string[] = [];
  if (/^---\n[\s\S]*?\n---[ \t]*(\n|$)/.test(text)) found.push("encabezado YAML");
  if (/<!--/.test(text)) found.push("comentarios HTML");
  if (/^ {0,3}<\/?(?!br\b)[a-zA-Z][^>\n]*>/m.test(text)) found.push("bloques HTML");
  if (/^ {0,3}\[\^[^\]\n]+\]:/m.test(text)) found.push("notas al pie");
  return found;
}
