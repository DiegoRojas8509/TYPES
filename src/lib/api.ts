// The only module allowed to import from @tauri-apps/api. Everything else
// talks to Rust through the typed wrappers below.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";

export interface Settings {
  workspaceRoot: string;
  claudePath: string | null;
}

/** Mirrors `RemoteStatus` in remote.rs. */
export type RemoteStatus =
  | { state: "off" }
  | { state: "starting" }
  | { state: "on"; url?: string }
  | { state: "untrusted" }
  | { state: "error"; message: string };

export type NodeKind = "dir" | "file";

/** `path` is relative to the workspace root and always uses `/`. */
export interface TreeNode {
  name: string;
  path: string;
  kind: NodeKind;
  children: TreeNode[];
  /** Last modification, ms since the epoch. */
  modified?: number;
}

/** Who made a change: Diego, the chat, Claude from the phone, or something outside the app. */
export type Actor = "tu" | "claude" | "claude-cel" | "fuera";

export interface Activity {
  at: number;
  by: Actor;
}

export interface PreviewNode {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: string;
}

/** Board outline normalized to 0..1; `nodes` is empty for empty or unreadable boards. */
export interface BoardPreview {
  nodes: PreviewNode[];
}

export interface ClaudeStatus {
  found: boolean;
  path: string | null;
  version: string | null;
}

/** Mirrors `MemoryEntry` in memory.rs. `updated` is the file mtime in ms. */
export interface MemoryEntry {
  file: string;
  title: string;
  description: string;
  updated: number | null;
}

/** Mirrors `MemoryStatus` in memory.rs: Claude's native memory for one space. */
export interface MemoryStatus {
  dir: string;
  exists: boolean;
  entries: MemoryEntry[];
  facts: number;
  decisions: number;
  /** Newest mtime (ms) among the entries, or null when there are none. */
  updated: number | null;
  indexLines: number;
}

/** Mirrors `MemoryChange` in memory_close.rs: real line diff of one memory file. */
export interface MemoryChange {
  file: string;
  action: "nuevo" | "actualizado" | "sin-cambios" | "eliminado" | string;
  summary: string;
  added: string[];
  removed: string[];
  /** The diff was cut at 40 lines. */
  truncated: boolean;
}

/** Mirrors `CloseTopicResult` in memory_close.rs. */
export interface CloseTopicResult {
  ok: boolean;
  changes: MemoryChange[];
  error: string | null;
  /** The conversation has no transcript yet: there was nothing to save. */
  nothingToSave: boolean;
}

/** What every rejected command carries. `message` is Spanish, ready to show. */
export interface ApiError {
  kind: string;
  message: string;
}

export interface DeletedEntry {
  original: string;
  trashed: string;
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
  /** Creates `<name>.canvas` in `dir` and returns its relative path. */
  createBoard: (dir: string, name: string) => invoke<string>("create_board", { dir, name }),
  createFolder: (dir: string, name: string) => invoke<string>("create_folder", { dir, name }),
  renameEntry: (path: string, newName: string) => invoke<string>("rename_entry", { path, newName }),
  /** `trashed` is "" when the trash location is unknown (then the delete cannot be undone). */
  deleteEntry: (path: string) => invoke<DeletedEntry>("delete_entry", { path }),
  /** Moves a trashed item back; rejects with kind "exists" if something is already at `original`. */
  restoreEntry: (original: string, trashed: string) => invoke<string>("restore_entry", { original, trashed }),

  importFiles: (destDir: string, sources: string[]) =>
    invoke<string[]>("import_files", { destDir, sources }),
  /** Saves into `<dir>/Imágenes/` (de-duplicated) and returns the relative path. */
  saveImage: (dir: string, fileName: string, bytes: Uint8Array | number[]) =>
    invoke<string>("save_image", { dir, fileName, bytes: Array.from(bytes) }),
  /** Images directly inside `<dir>/Imágenes/`, sorted; [] when the folder does not exist. */
  listImages: (dir: string) => invoke<string[]>("list_images", { dir }),
  /** Returns the relative path of the saved file inside `<space>/Imágenes/`. */
  saveAttachment: (space: string, fileName: string, bytes: Uint8Array | number[]) =>
    invoke<string>("save_attachment", { space, fileName, bytes: Array.from(bytes) }),

  /** Last change per workspace-relative path. */
  activity: () => invoke<Record<string, Activity>>("activity"),
  boardPreview: (path: string) => invoke<BoardPreview>("board_preview", { path }),

  claudeStatus: () => invoke<ClaudeStatus>("claude_status"),
  /** Resolves with the run id used by `claude-event`. */
  /** `board` is the open `.canvas` relative to the space folder (Claude's cwd), or null. */
  claudeSend: (
    space: string,
    text: string,
    attachments: string[],
    sessionId: string | null,
    model: string | null,
    board: string | null,
  ) => invoke<number>("claude_send", { space, text, attachments, sessionId, model: model || null, board }),
  claudeStop: (runId: number) => invoke<void>("claude_stop", { runId }),

  memoryStatus: (space: string) => invoke<MemoryStatus>("memory_status", { space }),
  /** `file` is a plain name: `MEMORY.md` or `cronista-*.md`. */
  memoryRead: (space: string, file: string) => invoke<string>("memory_read", { space, file }),
  /** Runs the cronista on the conversation now (can take a minute); one at a time. */
  memoryCloseTopic: (space: string, sessionId: string) =>
    invoke<CloseTopicResult>("memory_close_topic", { space, sessionId }),

  remoteStatus: () => invoke<RemoteStatus>("remote_status"),
  remoteStart: () => invoke<RemoteStatus>("remote_start"),
  remoteStop: () => invoke<RemoteStatus>("remote_stop"),
  /** Opens Terminal with the one-time trust script for the workspace root. */
  remoteTrust: () => invoke<void>("remote_trust"),
};

/** URL the webview can load for an absolute path (needs the asset protocol enabled). */
export function assetUrl(absolutePath: string): string {
  return convertFileSrc(absolutePath);
}

/** Opens a file with the macOS default app (for .html that is normally the browser). */
export function openWithDefaultApp(absolutePath: string): Promise<void> {
  return openPath(absolutePath);
}

/** Opens an http(s) link in the default browser. */
export function openExternal(url: string): Promise<void> {
  return openUrl(url);
}

export function onFsChanged(cb: (payload: FsChangedPayload) => void): Promise<UnlistenFn> {
  return listen<FsChangedPayload>("fs-changed", (e) => cb(e.payload));
}

export function onActivityChanged(cb: () => void): Promise<UnlistenFn> {
  return listen("activity-changed", () => cb());
}

export function onClaudeEvent(cb: (event: ClaudeEvent) => void): Promise<UnlistenFn> {
  return listen<ClaudeEvent>("claude-event", (e) => cb(e.payload));
}

export function onRemoteEvent(cb: (status: RemoteStatus) => void): Promise<UnlistenFn> {
  return listen<RemoteStatus>("remote-event", (e) => cb(e.payload));
}

export type { UnlistenFn };
