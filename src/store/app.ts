import { create } from "zustand";
import {
  api,
  errorMessage,
  onActivityChanged,
  onFsChanged,
  type Activity,
  type DeletedEntry,
  type Settings,
  type TreeNode,
} from "../lib/api";
import { nearestExistingDir } from "../lib/browse";
import { readSeen, writeSeen } from "../lib/seenPref";
import { readSidebarCollapsed, writeSidebarCollapsed } from "../lib/sidebarPref";
import { isWithin, parentOf, replacePrefix, spaceOf, titleOf } from "../lib/paths";

export interface Notice {
  id: number;
  message: string;
  tone: "error" | "info";
}

export interface FsChange {
  /** Increments on every `fs-changed` event so subscribers can react to repeats. */
  seq: number;
  paths: string[];
}

export interface AppState {
  settings: Settings | null;
  tree: TreeNode[];
  treeLoaded: boolean;
  /** Workspace-relative path of the file shown in the middle pane. */
  openPath: string | null;
  /** Folder shown when nothing is open; null = Inicio (the list of spaces). */
  currentDir: string | null;
  /** Last change per workspace-relative path (NFC keys), from the backend log. */
  activity: Record<string, Activity>;
  /** When Diego last opened each file (ms); an orange dot shows when Claude changed it after that. */
  seen: Record<string, number>;
  /** First segment of `openPath`, or the last space selected in the sidebar. */
  activeSpace: string | null;
  /** Folder paths that are expanded in the sidebar. */
  expanded: Record<string, boolean>;
  chatCollapsed: boolean;
  sidebarCollapsed: boolean;
  /** Last `fs-changed` event; editor and viewers watch this to reload. */
  fsChange: FsChange | null;
  notice: Notice | null;
  /** The last delete that can be undone (null when none, or when its trash location is unknown). */
  lastDeleted: DeletedEntry | null;
  /** When `lastDeleted` happened (ms since epoch); the undo expires after `UNDO_WINDOW_MS`. */
  lastDeletedAt: number;

  init(): Promise<void>;
  refreshTree(): Promise<void>;
  open(path: string | null): void;
  /** Shows a folder's cards (null = Inicio) and closes the open file. */
  browse(dir: string | null): void;
  /** Closes the open file (landing in its folder) or goes up one folder. */
  back(): void;
  refreshActivity(): Promise<void>;
  selectSpace(space: string | null): void;
  setExpanded(path: string, value: boolean): void;
  toggleExpanded(path: string): void;
  toggleChat(): void;
  toggleSidebar(): void;
  notify(message: string, tone?: Notice["tone"]): void;
  dismissNotice(): void;

  /** Each mutation returns the resulting path (or null if it failed; the error is shown). */
  createSpace(name: string): Promise<string | null>;
  createPage(dir: string, name: string): Promise<string | null>;
  createBoard(dir: string, name: string): Promise<string | null>;
  createFolder(dir: string, name: string): Promise<string | null>;
  renameEntry(path: string, newName: string): Promise<string | null>;
  deleteEntry(path: string): Promise<boolean>;
  /** Restores `lastDeleted`. Cleared on success; kept on failure so Diego can retry (e.g. after freeing the name). */
  undoDelete(): Promise<void>;
}

export function initialState() {
  return {
    settings: null,
    tree: [],
    treeLoaded: false,
    openPath: null,
    currentDir: null,
    activity: {},
    seen: {},
    activeSpace: null,
    expanded: {},
    chatCollapsed: false,
    sidebarCollapsed: false,
    fsChange: null,
    notice: null,
    lastDeleted: null,
    lastDeletedAt: 0,
  } satisfies Partial<AppState>;
}

function collectFiles(nodes: TreeNode[], into: Set<string>) {
  for (const n of nodes) {
    if (n.kind === "dir") collectFiles(n.children, into);
    else into.add(n.path);
  }
}

/** Drops `seen` entries of files that no longer exist (persisting only when something changed). */
function pruneSeen(seen: Record<string, number>, tree: TreeNode[]): Record<string, number> {
  const keys = Object.keys(seen);
  if (keys.length === 0) return seen;
  const files = new Set<string>();
  collectFiles(tree, files);
  if (keys.every((k) => files.has(k))) return seen;
  const next = Object.fromEntries(keys.filter((k) => files.has(k)).map((k) => [k, seen[k]]));
  writeSeen(next);
  return next;
}

function renameKeys(seen: Record<string, number>, from: string, to: string): Record<string, number> {
  const next = Object.fromEntries(Object.entries(seen).map(([k, v]) => [replacePrefix(k, from, to), v]));
  writeSeen(next);
  return next;
}

let noticeSeq = 0;
let refreshSeq = 0;
let fsSeq = 0;

export const useApp = create<AppState>()((set, get) => {
  /** Runs a command; on failure shows its Spanish message and returns undefined. */
  async function attempt<T>(run: () => Promise<T>): Promise<T | undefined> {
    try {
      return await run();
    } catch (e) {
      get().notify(errorMessage(e));
      return undefined;
    }
  }

  return {
    ...initialState(),
    sidebarCollapsed: readSidebarCollapsed(),
    seen: readSeen(),

    async init() {
      const settings = await attempt(() => api.getSettings());
      if (settings) set({ settings });
      await Promise.all([get().refreshTree(), get().refreshActivity()]);
    },

    async refreshTree() {
      const mine = ++refreshSeq;
      try {
        const tree = await api.listTree();
        if (mine === refreshSeq) {
          set((s) => {
            const currentDir = nearestExistingDir(tree, s.currentDir);
            const seen = pruneSeen(s.seen, tree);
            return { tree, treeLoaded: true, currentDir, seen };
          });
        }
      } catch (e) {
        if (mine === refreshSeq) {
          set({ treeLoaded: true });
          get().notify(errorMessage(e));
        }
      }
    },

    open(path) {
      if (path === null) {
        set({ openPath: null });
        return;
      }
      // A root-level file (e.g. the workspace CLAUDE.md) belongs to no space: keep the last one.
      const space = path.includes("/") ? spaceOf(path) : null;
      const seen = { ...get().seen, [path]: Date.now() };
      writeSeen(seen);
      set((s) => ({ openPath: path, currentDir: parentOf(path) || null, seen, activeSpace: space ?? s.activeSpace }));
    },

    browse(dir) {
      set((s) => ({ openPath: null, currentDir: dir || null, activeSpace: dir ? spaceOf(dir) : s.activeSpace }));
    },

    back() {
      const { openPath, currentDir } = get();
      const from = openPath !== null ? parentOf(openPath) : currentDir !== null ? parentOf(currentDir) : null;
      if (openPath === null && currentDir === null) return;
      set({ openPath: null, currentDir: from || null });
    },

    async refreshActivity() {
      let activity: Record<string, Activity>;
      try {
        activity = await api.activity();
      } catch {
        return; // the log is a nicety: cards just show less
      }
      set((s) => {
        // What Diego is looking at right now counts as seen, so no dot appears behind his back.
        const open = s.openPath;
        const at = open ? activity[open.normalize("NFC")]?.at : undefined;
        if (open && at !== undefined && at > (s.seen[open] ?? 0)) {
          const seen = { ...s.seen, [open]: at };
          writeSeen(seen);
          return { activity, seen };
        }
        return { activity };
      });
    },

    selectSpace(space) {
      set({ activeSpace: space });
    },

    setExpanded(path, value) {
      set((s) => ({ expanded: { ...s.expanded, [path]: value } }));
    },

    toggleExpanded(path) {
      set((s) => ({ expanded: { ...s.expanded, [path]: !s.expanded[path] } }));
    },

    toggleChat() {
      set((s) => ({ chatCollapsed: !s.chatCollapsed }));
    },

    toggleSidebar() {
      const next = !get().sidebarCollapsed;
      set({ sidebarCollapsed: next });
      writeSidebarCollapsed(next);
    },

    notify(message, tone = "error") {
      set({ notice: { id: ++noticeSeq, message, tone } });
    },

    dismissNotice() {
      set({ notice: null });
    },

    async createSpace(name) {
      const path = await attempt(() => api.createSpace(name));
      if (path === undefined) return null;
      set((s) => ({ activeSpace: path, expanded: { ...s.expanded, [path]: true } }));
      await get().refreshTree();
      return path;
    },

    async createPage(dir, name) {
      const path = await attempt(() => api.createPage(dir, name));
      if (path === undefined) return null;
      if (dir) get().setExpanded(dir, true);
      get().open(path);
      await get().refreshTree();
      return path;
    },

    async createBoard(dir, name) {
      const path = await attempt(() => api.createBoard(dir, name));
      if (path === undefined) return null;
      if (dir) get().setExpanded(dir, true);
      get().open(path);
      await get().refreshTree();
      return path;
    },

    async createFolder(dir, name) {
      const path = await attempt(() => api.createFolder(dir, name));
      if (path === undefined) return null;
      if (dir) get().setExpanded(dir, true);
      get().setExpanded(path, true);
      await get().refreshTree();
      return path;
    },

    async renameEntry(path, newName) {
      const next = await attempt(() => api.renameEntry(path, newName));
      if (next === undefined) return null;
      set((s) => {
        const expanded: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(s.expanded)) expanded[replacePrefix(k, path, next)] = v;
        return {
          expanded,
          seen: renameKeys(s.seen, path, next),
          currentDir: s.currentDir === null ? null : replacePrefix(s.currentDir, path, next),
          openPath: s.openPath === null ? null : replacePrefix(s.openPath, path, next),
          activeSpace: s.activeSpace === null ? null : replacePrefix(s.activeSpace, path, next),
        };
      });
      await get().refreshTree();
      return next;
    },

    async deleteEntry(path) {
      // Close the open document first and let it flush: otherwise its pending
      // text would be written after the trashing and resurrect the file.
      if (get().openPath !== null && isWithin(get().openPath!, path)) {
        set({ openPath: null });
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      const deleted = await attempt(() => api.deleteEntry(path));
      if (!deleted) return false;
      set((s) => {
        const expanded = Object.fromEntries(Object.entries(s.expanded).filter(([k]) => !isWithin(k, path)));
        return {
          lastDeleted: deleted.trashed ? deleted : null,
          lastDeletedAt: Date.now(),
          expanded,
          currentDir: s.currentDir !== null && isWithin(s.currentDir, path) ? parentOf(path) || null : s.currentDir,
          openPath: s.openPath !== null && isWithin(s.openPath, path) ? null : s.openPath,
          activeSpace: s.activeSpace !== null && isWithin(s.activeSpace, path) ? null : s.activeSpace,
        };
      });
      await get().refreshTree();
      return true;
    },

    async undoDelete() {
      const last = get().lastDeleted;
      if (!last) return;
      if (Date.now() - get().lastDeletedAt > UNDO_WINDOW_MS) {
        set({ lastDeleted: null });
        return;
      }
      // Claim it before awaiting so a second trigger cannot restore it again.
      set({ lastDeleted: null });
      const restored = await attempt(() => api.restoreEntry(last.original, last.trashed));
      if (restored === undefined) {
        // Keep it for a retry, unless a newer delete took its place meanwhile.
        if (get().lastDeleted === null) set({ lastDeleted: last });
        return;
      }
      await get().refreshTree();
      get().notify(`Se restauró «${titleOf(restored)}»`, "info");
    },
  };
});

/** How long after a delete Cmd+Z still brings it back. */
export const UNDO_WINDOW_MS = 120_000;

/** Subscribes the tree and the activity log to the backend events. Resolves with the unlisten function. */
export async function startSync(): Promise<() => void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const refreshActivitySoon = () => {
    clearTimeout(timer);
    timer = setTimeout(() => void useApp.getState().refreshActivity(), 150);
  };
  const [offFs, offActivity] = await Promise.all([
    onFsChanged(({ paths }) => {
      useApp.setState({ fsChange: { seq: ++fsSeq, paths } });
      void useApp.getState().refreshTree();
      refreshActivitySoon();
    }),
    onActivityChanged(refreshActivitySoon),
  ]);
  return () => {
    clearTimeout(timer);
    offFs();
    offActivity();
  };
}
