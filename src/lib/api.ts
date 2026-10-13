// The only module allowed to import from @tauri-apps/api. Everything else
// talks to Rust through the typed wrappers below.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";

export interface Settings {
  workspaceRoot: string;
  claudePath: string | null;
}

export type NodeKind = "dir" | "file";

/** `path` is relative to the workspace root and always uses `/`. */
export interface TreeNode {
  name: string;
  path: string;
  kind: NodeKind;
  children: TreeNode[];
}

export interface ClaudeStatus {
  found: boolean;
  path: string | null;
  version: string | null;
}

/** What every rejected command carries. `message` is Spanish, ready to show. */
export interface ApiError {
  kind: string;
  message: string;
}

export interface FsChangedPayload {
  paths: string[];
}

export type ClaudeEvent =
  | { kind: "raw"; runId: number; line: unknown }
  | { kind: "stderr"; runId: number; text: string }
  | { kind: "exit"; runId: number; code: number | null };

export function isApiError(e: unknown): e is ApiError {
  return (
    typeof e === "object" &&
    e !== null &&
    typeof (e as ApiError).kind === "string" &&
    typeof (e as ApiError).message === "string"
  );
}

/** Spanish text to show for any thrown value. */
export function errorMessage(e: unknown): string {
  if (isApiError(e)) return e.message;
  if (typeof e === "string" && e) return e;
  if (e instanceof Error && e.message) return e.message;
  return "Ocurrió un error inesperado.";
}

export const api = {
  getSettings: () => invoke<Settings>("get_settings"),
  setWorkspaceRoot: (path: string) => invoke<Settings>("set_workspace_root", { path }),
  setClaudePath: (path: string | null) => invoke<Settings>("set_claude_path", { path }),

  listTree: () => invoke<TreeNode[]>("list_tree"),
  readText: (path: string) => invoke<string>("read_text", { path }),
  writeText: (path: string, content: string) => invoke<void>("write_text", { path, content }),

  /** Each create/rename returns the final relative path (names are de-duplicated). */
  createSpace: (name: string) => invoke<string>("create_space", { name }),
  createPage: (dir: string, name: string) => invoke<string>("create_page", { dir, name }),
  createFolder: (dir: string, name: string) => invoke<string>("create_folder", { dir, name }),
  renameEntry: (path: string, newName: string) => invoke<string>("rename_entry", { path, newName }),
  deleteEntry: (path: string) => invoke<void>("delete_entry", { path }),

  importFiles: (destDir: string, sources: string[]) =>
    invoke<string[]>("import_files", { destDir, sources }),
  /** Returns the relative path of the saved file inside `<space>/adjuntos/`. */
  saveAttachment: (space: string, fileName: string, bytes: Uint8Array | number[]) =>
    invoke<string>("save_attachment", { space, fileName, bytes: Array.from(bytes) }),

  claudeStatus: () => invoke<ClaudeStatus>("claude_status"),
  /** Resolves with the run id used by `claude-event`. */
  claudeSend: (space: string, text: string, attachments: string[], sessionId: string | null) =>
    invoke<number>("claude_send", { space, text, attachments, sessionId }),
  claudeStop: (runId: number) => invoke<void>("claude_stop", { runId }),
};

/** URL the webview can load for an absolute path (needs the asset protocol enabled). */
export function assetUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}

/** Opens a file with the macOS default app (for .html that is normally the browser). */
export function openWithDefaultApp(absolutePath: string): Promise<void> {
  return openPath(absolutePath);
}

export function onFsChanged(cb: (payload: FsChangedPayload) => void): Promise<UnlistenFn> {
  return listen<FsChangedPayload>("fs-changed", (e) => cb(e.payload));
}

export function onClaudeEvent(cb: (event: ClaudeEvent) => void): Promise<UnlistenFn> {
  return listen<ClaudeEvent>("claude-event", (e) => cb(e.payload));
}

export type { UnlistenFn };
