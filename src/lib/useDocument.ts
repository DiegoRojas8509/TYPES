// Document state machine for one open text file (a Markdown note or a `.canvas`).
// It knows nothing about Tiptap or React Flow: the feature feeds it text through
// `onChange` and shows `content`.
//
//   loading -> clean <-> dirty -> saving -> clean
//                         \-> conflict (disk changed while there were unsaved edits)
//   loading -> error (the file could not be read)
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, errorMessage } from "./api";
import { baseName, joinRel, parentOf } from "./paths";
import { useApp, type FsChange } from "../store/app";

export const AUTOSAVE_MS = 800;

export type DocStatus = "loading" | "clean" | "dirty" | "saving" | "conflict" | "error";

export interface DocSnapshot {
  status: DocStatus;
  /** Markdown last read from disk. Changes only when the editor must be reset. */
  content: string | null;
  /** Increments each time `content` is replaced; the editor reloads on change. */
  revision: number;
  /** Spanish message when `status` is "error". */
  error: string | null;
}

/**
 * Optional three-way merge used when the disk changes under unsaved edits.
 * `base` is the text we last saw on disk, `mine` the user's text, `theirs` the
 * new disk text. The controller stays format-agnostic: the caller injects it.
 */
export type MergeFn = (base: string, mine: string, theirs: string) => { ok: true; text: string } | { ok: false };

const LOADING: DocSnapshot = { status: "loading", content: null, revision: 0, error: null };

export class DocumentController {
  private snap: DocSnapshot = LOADING;
  private listeners = new Set<() => void>();
  /** Raw text we believe is on disk (read from it, or being written to it). */
  private lastSaved: string | null = null;
  /** Newest user text not yet confirmed written; null when nothing is pending. */
  private latest: string | null = null;
  /** The user's current text, kept even when it equals what is on disk. */
  private mine: string | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private saveAgain = false;
  private conflict = false;
  private disposed = false;
  private readSeq = 0;
  private seenSeq: number;
  /** Contents written during the current save burst, to recognise their echoes. */
  private ownWrites = new Set<string>();

  constructor(
    readonly path: string,
    private readonly merge?: MergeFn,
  ) {
    this.seenSeq = useApp.getState().fsChange?.seq ?? 0;
  }

  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  getSnapshot = () => this.snap;

  private emit(patch: Partial<DocSnapshot> = {}) {
    if (this.disposed) return;
    const status = patch.status ?? this.computeStatus();
    this.snap = { ...this.snap, ...patch, status };
    this.listeners.forEach((l) => l());
  }

  private computeStatus(): DocStatus {
    const s = this.snap.status;
    if (s === "loading" || s === "error") return s;
    if (this.conflict) return "conflict";
    if (this.latest !== null) return "dirty";
    return this.inFlight ? "saving" : "clean";
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  async load() {
    try {
      const text = await api.readText(this.path);
      if (this.disposed) return;
      this.lastSaved = text;
      this.emit({ status: "clean", content: text, revision: this.snap.revision + 1, error: null });
    } catch {
      if (this.disposed) return;
      this.emit({ status: "error", error: MISSING });
    }
  }

  /** Called by the editor for real user edits only. */
  onChange = (markdown: string) => {
    if (this.disposed || this.snap.status === "loading" || this.snap.status === "error") return;
    this.mine = markdown;
    if (this.conflict) {
      this.latest = markdown;
      return;
    }
    if (markdown === this.lastSaved) {
      // Edited back to what is on disk: nothing to write.
      this.latest = null;
      this.clearTimer();
      this.emit();
      return;
    }
    this.latest = markdown;
    this.clearTimer();
    this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
    this.emit();
  };

  private async save() {
    this.clearTimer();
    if (this.conflict || this.latest === null) return;
    if (this.inFlight) {
      this.saveAgain = true;
      return;
    }
    const text = this.latest;
    const previous = this.lastSaved;
    this.latest = null;
    this.lastSaved = text;
    this.ownWrites.add(text);
    this.inFlight = true;
    this.emit();
    let ok = false;
    try {
      await api.writeText(this.path, text);
      ok = true;
    } catch (e) {
      this.lastSaved = previous;
      if (this.latest === null) this.latest = text;
      useApp.getState().notify(`No se pudo guardar: ${errorMessage(e)}`);
    }
    this.inFlight = false;
    if (!this.conflict && (this.saveAgain || this.disposed) && this.latest !== null && ok) {
      this.saveAgain = false;
      this.emit();
      await this.save();
      return;
    }
    this.saveAgain = false;
    this.ownWrites = new Set(this.lastSaved === null ? [] : [this.lastSaved]);
    this.emit();
  }

  /** Reacts to the store's `fsChange`. */
  handleFsChange(change: FsChange | null) {
    if (!change || change.seq <= this.seenSeq) return;
    this.seenSeq = change.seq;
    if (this.disposed || !change.paths.includes(this.path)) return;
    if (this.snap.status === "loading") return;
    void this.checkDisk();
  }

  private async checkDisk() {
    const mine = ++this.readSeq;
    let text: string;
    try {
      text = await api.readText(this.path);
    } catch {
      // Deleted or renamed. Unsaved text stays put; only an idle pane reports it.
      if (!this.disposed && mine === this.readSeq && this.latest === null && !this.inFlight && !this.conflict) {
        this.clearTimer();
        this.emit({ status: "error", error: MISSING });
      }
      return;
    }
    if (this.disposed || mine !== this.readSeq) return;
    if (text === this.lastSaved && this.snap.status !== "error") return; // our own write, or no real change
    if (this.inFlight && this.ownWrites.has(text)) return; // echo of an earlier write of ours
    if (this.latest === null && !this.inFlight && !this.conflict) {
      this.lastSaved = text;
      this.ownWrites = new Set([text]);
      this.mine = null;
      this.emit({ status: "clean", content: text, revision: this.snap.revision + 1, error: null });
      return;
    }
    // Disk changed under unsaved edits. Try the injected merge first, but never
    // while a write is in flight (the disk text could be our own write, and
    // merging could drop either side) or when already in conflict.
    if (this.merge && !this.inFlight && !this.conflict && this.mine !== null && this.lastSaved !== null) {
      const previousMine = this.mine;
      let merged: ReturnType<MergeFn>;
      try {
        merged = this.merge(this.lastSaved, previousMine, text);
      } catch {
        merged = { ok: false }; // a throwing merge is a failed merge: fall through to conflict
      }
      if (merged.ok) {
        this.lastSaved = text;
        this.mine = merged.text;
        this.ownWrites = new Set([text]);
        this.clearTimer();
        if (merged.text === text) {
          this.latest = null; // the merge result is exactly what is on disk
        } else {
          this.latest = merged.text;
          this.timer = setTimeout(() => void this.save(), AUTOSAVE_MS);
        }
        if (merged.text === previousMine && merged.text !== text) {
          this.emit(); // the editor already shows this text: don't reset it
        } else {
          this.emit({ content: merged.text, revision: this.snap.revision + 1, error: null });
        }
        return;
      }
    }
    this.conflict = true;
    this.clearTimer();
    this.emit();
  }

  /** Discards unsaved edits and shows what is on disk. */
  reloadFromDisk = async () => {
    try {
      const text = await api.readText(this.path);
      if (this.disposed) return;
      this.conflict = false;
      this.latest = null;
      this.mine = null;
      this.clearTimer();
      this.lastSaved = text;
      this.ownWrites = new Set([text]);
      this.emit({ status: "clean", content: text, revision: this.snap.revision + 1, error: null });
    } catch {
      if (!this.disposed) this.emit({ status: "error", error: MISSING });
    }
  };

  /** Resolves a conflict in favour of the user's text: writes it over the disk. */
  keepMine = () => {
    if (!this.conflict) return;
    this.conflict = false;
    this.latest = this.mine;
    // Force the write even if the text equals what we last saw.
    this.lastSaved = null;
    this.emit();
    void this.save();
  };

  /** Flushes pending text. Safe to call on unmount or when switching files. */
  dispose() {
    if (this.disposed) return;
    const pending = this.latest;
    const wasConflict = this.conflict;
    this.clearTimer();
    if (pending !== null && wasConflict) {
      // The disk changed under unsaved edits and he never chose: keep both.
      const copy = joinRel(parentOf(this.path), copyName(baseName(this.path)));
      this.disposed = true;
      api
        .writeText(copy, pending)
        .then(() =>
          useApp.getState().notify(`«${baseName(this.path)}» cambió mientras la editabas. Guardé tu versión en «${baseName(copy)}».`),
        )
        .catch((e) => useApp.getState().notify(`No se pudo guardar tu versión de «${baseName(this.path)}»: ${errorMessage(e)}`));
      return;
    }
    void this.save();
    this.disposed = true;
  }
}

const MISSING = "No pude abrir esta página. Puede que se haya movido o borrado fuera de la app.";

function copyName(name: string): string {
  const i = name.lastIndexOf(".");
  return i <= 0 ? `${name} (mi versión)` : `${name.slice(0, i)} (mi versión)${name.slice(i)}`;
}

export interface UseDocument extends DocSnapshot {
  onChange(markdown: string): void;
  reloadFromDisk(): void;
  keepMine(): void;
}

export function useDocument(path: string | null, merge?: MergeFn): UseDocument {
  const [ctrl, setCtrl] = useState<DocumentController | null>(null);
  // The controller is keyed on `path` only; a new function identity per render
  // must not recreate it, so it reads the latest merge through a ref.
  const mergeRef = useRef(merge);
  mergeRef.current = merge;

  useEffect(() => {
    if (!path) {
      setCtrl(null);
      return;
    }
    const c = new DocumentController(path, merge ? (b, m, t) => (mergeRef.current ?? merge)(b, m, t) : undefined);
    setCtrl(c);
    void c.load();
    return () => c.dispose();
  }, [path]);

  const current = ctrl && ctrl.path === path ? ctrl : null;
  const snap = useSyncExternalStore(
    current ? current.subscribe : noopSubscribe,
    current ? current.getSnapshot : getLoading,
  );

  const fsChange = useApp((s) => s.fsChange);
  useEffect(() => {
    current?.handleFsChange(fsChange);
  }, [current, fsChange]);

  const onChange = useCallback((md: string) => current?.onChange(md), [current]);
  const reloadFromDisk = useCallback(() => void current?.reloadFromDisk(), [current]);
  const keepMine = useCallback(() => current?.keepMine(), [current]);
  return { ...snap, onChange, reloadFromDisk, keepMine };
}

const noopSubscribe = () => () => {};
const getLoading = () => LOADING;
