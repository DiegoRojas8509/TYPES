import { create } from "zustand";
import { api, errorMessage, onFsChanged, type DeletedEntry, type Settings, type TreeNode } from "../lib/api";
import { readSidebarCollapsed, writeSidebarCollapsed } from "../lib/sidebarPref";
import { isWithin, replacePrefix, spaceOf, titleOf } from "../lib/paths";

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

  init(): Promise<void>;
  refreshTree(): Promise<void>;
  open(path: string | null): void;
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
    activeSpace: null,
    expanded: {},
    chatCollapsed: false,
    sidebarCollapsed: false,
    fsChange: null,
    notice: null,
    lastDeleted: null,
  } satisfies Partial<AppState>;
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

    async init() {
      const settings = await attempt(() => api.getSettings());
      if (settings) set({ settings });
      await get().refreshTree();
    },

    async refreshTree() {
      const mine = ++refreshSeq;
      try {
        const tree = await api.listTree();
        if (mine === refreshSeq) set({ tree, treeLoaded: true });
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
      set((s) => ({ openPath: path, activeSpace: space ?? s.activeSpace }));
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
          openPath: s.openPath === null ? null : replacePrefix(s.openPath, path, next),
          activeSpace: s.activeSpace === null ? null : replacePrefix(s.activeSpace, path, next),
        };
      });
      await get().refreshTree();
      return next;
    },

    async deleteEntry(path) {
      const deleted = await attempt(() => api.deleteEntry(path));
      if (!deleted) return false;
      set((s) => {
        const expanded = Object.fromEntries(Object.entries(s.expanded).filter(([k]) => !isWithin(k, path)));
        return {
          lastDeleted: deleted.trashed ? deleted : null,
          expanded,
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
      const restored = await attempt(() => api.restoreEntry(last.original, last.trashed));
      if (restored === undefined) return;
      set({ lastDeleted: null });
      await get().refreshTree();
      get().notify(`Se restauró «${titleOf(restored)}»`, "info");
    },
  };
});

/** Subscribes the tree to `fs-changed`. Resolves with the unlisten function. */
export async function startSync(): Promise<() => void> {
  return onFsChanged(({ paths }) => {
    useApp.setState({ fsChange: { seq: ++fsSeq, paths } });
    void useApp.getState().refreshTree();
  });
}
