// Spanish, one-line descriptions of Claude's tool calls, and the path helpers that
// turn the absolute paths the agent reports into workspace-relative ones.

export type ToolInput = Record<string, unknown>;

/**
 * Normalises an absolute path for comparison: collapses `.`/`..`/`//`, uses NFC
 * (macOS can hand back NFD names) and drops the `/private` prefix macOS puts on
 * `/var`, `/tmp` and `/etc` (they are symlinks into `/private`).
 */
export function canonPath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.normalize("NFC").split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return `/${parts.join("/")}`.replace(/^\/private(?=\/(?:var|tmp|etc)(?:\/|$))/, "");
}

/** `abs` relative to `dir` (both absolute), "." for the dir itself, or null when it lies outside. */
export function relativeTo(abs: string, dir: string): string | null {
  const a = canonPath(abs);
  const d = canonPath(dir);
  if (a === d) return ".";
  const prefix = d === "/" ? "/" : `${d}/`;
  return a.startsWith(prefix) ? a.slice(prefix.length) : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** The file a tool call works on, if it names one. */
export function toolFile(name: string, input: ToolInput): string | null {
  if (name === "Read" || name === "Write" || name === "Edit" || name === "MultiEdit") return str(input.file_path);
  if (name === "NotebookEdit") return str(input.notebook_path);
  return null;
}

/** Absolute path as given (relative paths are taken relative to `base`, the space folder). */
function absolute(file: string, base?: string): string {
  return file.startsWith("/") || !base ? file : `${base.replace(/\/+$/, "")}/${file}`;
}

/** Path as shown to Diego: relative to the space when inside it, otherwise exactly as reported. */
function shown(file: string, base?: string): string {
  if (!base) return file;
  return relativeTo(absolute(file, base), base) ?? file;
}

/** Workspace-relative path for a tool file, or null when it is outside the workspace (not clickable). */
export function workspacePath(file: string, root: string, base?: string): string | null {
  const rel = relativeTo(absolute(file, base), root);
  return rel && rel !== "." ? rel : null;
}

/**
 * `base` is the absolute folder of the space; when given, paths inside it are shown
 * relative to it ("Leyendo costos.md" instead of the full path).
 */
export function describeTool(name: string, input: ToolInput = {}, base?: string): string {
  const file = toolFile(name, input);
  const where = file ? shown(file, base) : null;
  switch (name) {
    case "Read":
      return where ? `Leyendo ${where}` : "Leyendo un archivo…";
    case "Write":
      return where ? `Escribiendo ${where}` : "Escribiendo un archivo…";
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return where ? `Editando ${where}` : "Editando un archivo…";
    case "Glob":
    case "Grep": {
      const pattern = str(input.pattern);
      return pattern ? `Buscando «${pattern}»…` : "Buscando…";
    }
    case "WebSearch": {
      const query = str(input.query);
      return query ? `Buscando en la web: ${query}` : "Buscando en la web…";
    }
    case "WebFetch": {
      const url = str(input.url);
      return url ? `Leyendo la web: ${url}` : "Leyendo una página web…";
    }
    case "Bash":
      return "Ejecutando un comando";
    case "TodoWrite":
      return "Actualizando su lista de tareas";
    default:
      return `Usando ${name}`;
  }
}
