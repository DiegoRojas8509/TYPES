// Card navigation state: which folder is shown, what Claude changed, and what Diego has already opened.
import type { StateCreator } from "zustand";
import { api, type Activity, type TreeNode } from "../lib/api";
import { nfc } from "../lib/browse";
import { getShowClaudeFiles, setShowClaudeFiles } from "../lib/claudeFiles";
import { parentOf, replacePrefix, spaceOf } from "../lib/paths";
import { readSeen, writeSeen } from "../lib/seenPref";
import type { AppState } from "./app";

export interface BrowseSlice {
  /** Folder shown when nothing is open; null = Inicio (the list of spaces). */
  currentDir: string | null;
  /** Last change per workspace-relative path (NFC keys), from the backend log. */
  activity: Record<string, Activity>;
  /** When Diego last opened each file (ms, NFC keys); an orange dot shows when Claude changed it after that. */
  seen: Record<string, number>;
  /** Show CLAUDE.md files and Imágenes folders (sidebar, Inicio and folder views share this). */
  showContextFiles: boolean;
  /** Shows a folder's cards (null = Inicio) and closes the open file. */
  browse(dir: string | null): void;
  /** Closes the open file (landing in its folder) or goes up one folder. */
  back(): void;
  refreshActivity(): Promise<void>;
  setShowContextFiles(show: boolean): void;
  /** Records that Diego has just opened `path`. */
  markSeen(path: string): void;
}

export function initialBrowseState() {
  return { currentDir: null, activity: {}, seen: {}, showContextFiles: false } satisfies Partial<BrowseSlice>;
}

function collectFiles(nodes: TreeNode[], into: Set<string>) {
  for (const n of nodes) {
    if (n.kind === "dir") collectFiles(n.children, into);
    else into.add(nfc(n.path));
  }
}

/**
 * Drops `seen` entries of files that no longer exist. An empty tree means "not loaded yet or
 * transiently unreadable", so it prunes nothing.
 */
export function pruneSeen(seen: Record<string, number>, tree: TreeNode[]): Record<string, number> {
  const keys = Object.keys(seen);
  if (keys.length === 0 || tree.length === 0) return seen;
  const files = new Set<string>();
  collectFiles(tree, files);
  if (keys.every((k) => files.has(k))) return seen;
  const next = Object.fromEntries(keys.filter((k) => files.has(k)).map((k) => [k, seen[k]]));
  writeSeen(next);
  return next;
}

export function renameSeenKeys(seen: Record<string, number>, from: string, to: string): Record<string, number> {
  const next = Object.fromEntries(Object.entries(seen).map(([k, v]) => [replacePrefix(k, nfc(from), nfc(to)), v]));
  writeSeen(next);
  return next;
}

let activitySeq = 0;

export const createBrowseSlice: StateCreator<AppState, [], [], BrowseSlice> = (set, get) => ({
  ...initialBrowseState(),
  seen: readSeen(),
  showContextFiles: getShowClaudeFiles(),

  browse(dir) {
    set((s) => ({ openPath: null, currentDir: dir || null, activeSpace: dir ? spaceOf(dir) : s.activeSpace }));
  },

  back() {
    const { openPath, currentDir } = get();
    if (openPath === null && currentDir === null) return;
    const from = openPath !== null ? parentOf(openPath) : parentOf(currentDir!);
    set({ openPath: null, currentDir: from || null });
  },

  markSeen(path) {
    const seen = { ...get().seen, [nfc(path)]: Date.now() };
    writeSeen(seen);
    set({ seen });
  },

  async refreshActivity() {
    const mine = ++activitySeq;
    let activity: Record<string, Activity>;
    try {
      activity = await api.activity();
    } catch {
      return; // the log is a nicety: cards just show less
    }
    if (mine !== activitySeq) return;
    set((s) => {
      // What Diego is looking at right now counts as seen, so no dot appears behind his back.
      const open = s.openPath === null ? null : nfc(s.openPath);
      const at = open ? activity[open]?.at : undefined;
      if (open && at !== undefined && at > (s.seen[open] ?? 0)) {
        const seen = { ...s.seen, [open]: at };
        writeSeen(seen);
        return { activity, seen };
      }
      return { activity };
    });
  },

  setShowContextFiles(show) {
    setShowClaudeFiles(show);
    set({ showContextFiles: show });
  },
});
