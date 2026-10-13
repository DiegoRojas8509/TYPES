// Owns every conversation (one per space) and the Claude runs that feed them.
// Events are routed by RUN ID, never by the space on screen, so a run in space A keeps
// updating A while Diego looks at B.
import { create } from "zustand";
import { api, errorMessage, isApiError, onClaudeEvent, type ClaudeEvent, type UnlistenFn } from "../../lib/api";
import { getModel } from "../../lib/model";
import { useApp } from "../../store/app";
import {
  type ChatAction,
  type ChatState,
  initialChat,
  MSG_NOT_FOUND,
  reducer,
  restoreChat,
} from "./reducer";
import { clearConversation, loadConversation, saveConversation } from "./sessions";

export interface PendingImage {
  name: string;
  bytes: Uint8Array;
}

interface ChatsState {
  conversations: Record<string, ChatState>;
  /** Claude Code could not be found the last time we checked or tried to run it. */
  claudeMissing: boolean;

  ensure(space: string): void;
  checkClaude(): Promise<void>;
  /** Resolves false only when nothing was sent and the draft should be given back to Diego. */
  send(space: string, text: string, images: PendingImage[]): Promise<boolean>;
  stop(space: string): void;
  reset(space: string): void;
}

// run id -> space it belongs to
const runSpace = new Map<number, string>();
// Events can arrive before `claudeSend` resolves with the run id: hold them until it does.
const early = new Map<number, ClaudeEvent[]>();
let sending = 0;

let listening: Promise<UnlistenFn> | null = null;
function ensureListening(): Promise<UnlistenFn> {
  listening ??= onClaudeEvent(handleEvent).catch((e) => {
    listening = null; // let the next send try again
    throw e;
  });
  return listening;
}

const PERSIST_DELAY = 500;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function persistNow(space: string) {
  const t = timers.get(space);
  if (t) clearTimeout(t);
  timers.delete(space);
  const c = useChats.getState().conversations[space];
  if (c) saveConversation(space, { sessionId: c.sessionId, items: c.items });
}

function persistSoon(space: string) {
  if (timers.has(space)) return;
  timers.set(space, setTimeout(() => persistNow(space), PERSIST_DELAY));
}

function flushAll() {
  for (const space of [...timers.keys()]) persistNow(space);
}
if (typeof window !== "undefined") window.addEventListener("pagehide", flushAll);

function load(space: string): ChatState {
  const stored = loadConversation(space);
  return stored ? restoreChat(stored.sessionId, stored.items) : initialChat();
}

function dispatch(space: string, action: ChatAction) {
  useChats.setState((s) => ({
    conversations: { ...s.conversations, [space]: reducer(s.conversations[space] ?? load(space), action) },
  }));
  if (action.kind === "exit" || action.kind === "failed" || action.kind === "reset") persistNow(space);
  else persistSoon(space);
}

function handleEvent(ev: ClaudeEvent) {
  const space = runSpace.get(ev.runId);
  if (space !== undefined) {
    dispatch(space, ev);
    if (ev.kind === "exit") runSpace.delete(ev.runId);
    return;
  }
  if (sending > 0) early.set(ev.runId, [...(early.get(ev.runId) ?? []), ev]);
}

function bindRun(runId: number, space: string) {
  runSpace.set(runId, space);
  dispatch(space, { kind: "started", runId });
  for (const ev of early.get(runId) ?? []) handleEvent(ev);
  early.delete(runId);
}

function isNotFound(e: unknown) {
  return isApiError(e) && e.kind === "claude_not_found";
}

export const useChats = create<ChatsState>()((set, get) => ({
  conversations: {},
  claudeMissing: false,

  ensure(space) {
    if (get().conversations[space]) return;
    set((s) => (s.conversations[space] ? s : { conversations: { ...s.conversations, [space]: load(space) } }));
  },

  async checkClaude() {
    try {
      const status = await api.claudeStatus();
      set({ claudeMissing: !status.found });
    } catch {
      /* the check itself failing says nothing about Claude: leave the banner alone */
    }
  },

  async send(space, text, images) {
    get().ensure(space);
    if (get().conversations[space]?.running) return false;
    dispatch(space, { kind: "begin" });

    const root = useApp.getState().settings?.workspaceRoot ?? "";
    const attachments: string[] = [];
    try {
      for (const img of images) attachments.push(await api.saveAttachment(space, img.name, img.bytes));
    } catch (e) {
      dispatch(space, { kind: "failed", message: `No pude guardar la imagen. ${errorMessage(e)}` });
      return false;
    }
    if (get().conversations[space]?.stopRequested) {
      dispatch(space, { kind: "exit", runId: -1, code: 0 }); // nothing started: just close the run
      return true;
    }
    dispatch(space, { kind: "user", text, attachments, root, space });

    // The agent runs inside the space folder, so it gets paths relative to it.
    const forAgent = attachments.map((p) => (p.startsWith(`${space}/`) ? p.slice(space.length + 1) : p));
    sending++;
    try {
      await ensureListening();
      const sessionId = get().conversations[space]?.sessionId ?? null;
      const runId = await api.claudeSend(space, text, forAgent, sessionId, getModel());
      bindRun(runId, space);
      set({ claudeMissing: false });
      if (get().conversations[space]?.stopRequested) void api.claudeStop(runId).catch(() => {});
    } catch (e) {
      if (isNotFound(e)) set({ claudeMissing: true });
      dispatch(space, { kind: "failed", message: isNotFound(e) ? MSG_NOT_FOUND : errorMessage(e) });
    } finally {
      sending--;
      if (sending === 0) early.clear();
    }
    return true;
  },

  stop(space) {
    const c = get().conversations[space];
    if (!c?.running) return;
    dispatch(space, { kind: "stopRequested" });
    if (c.runId !== null) void api.claudeStop(c.runId).catch(() => {});
  },

  reset(space) {
    const c = get().conversations[space];
    if (c?.running) return;
    clearConversation(space);
    dispatch(space, { kind: "reset" });
  },
}));

/** Subscribes to run events once (idempotent). Resolves when listening. */
export function startChatEvents(): Promise<UnlistenFn> {
  return ensureListening();
}

/** Test helper: forget every run, timer and listener. */
export function resetChatsForTests() {
  for (const t of timers.values()) clearTimeout(t);
  timers.clear();
  runSpace.clear();
  early.clear();
  sending = 0;
  listening = null;
  useChats.setState({ conversations: {}, claudeMissing: false });
}
