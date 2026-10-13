// Pure reducer: turns the stream-json lines of one Claude Code run (plus a few local
// actions) into the list of things the chat shows.
//
// Streamed vs whole messages: with --include-partial-messages the same text arrives
// twice, as `stream_event` deltas and then as a whole `assistant` line. The deltas
// build the visible text live; the whole `assistant` line is the source of truth and
// REPLACES the streamed text of the same message (matched by message id and text-block
// order) and freezes it, so nothing is ever shown twice. If no deltas came, the whole
// message creates the item. Tool calls are keyed by their `tool_use` id the same way.
import type { ClaudeEvent } from "../../lib/api";
import { describeTool, type ToolInput, toolFile, workspacePath } from "./describeTool";

export type StepStatus = "running" | "done" | "error" | "stopped";

export type ChatItem =
  | { id: number; type: "user"; text: string; attachments: string[] }
  | { id: number; type: "assistant"; text: string; msgId?: string; final?: boolean }
  | { id: number; type: "step"; toolId: string; name: string; label: string; path?: string; status: StepStatus }
  | { id: number; type: "error"; text: string }
  | { id: number; type: "notice"; text: string };

export const MSG_NOT_FOUND = "No encontré Claude Code. Instálalo o indica su ruta en Ajustes.";
export const MSG_AUTH = "Claude Code no tiene sesión iniciada. Ábrelo una vez en VS Code o en la terminal.";
export const MSG_RESUME =
  "No pude continuar la conversación anterior. Usa «Nueva conversación» para empezar de nuevo.";
export const MSG_STOPPED = "Detuviste a Claude.";
export const MSG_CRASHED = "Claude Code se cerró de forma inesperada.";
export const MSG_NO_RESULT = "Claude no pudo terminar la tarea.";

interface Block {
  kind: "text" | "thinking" | "tool" | "other";
  itemId?: number;
  toolId?: string;
  json: string;
}

export interface ChatState {
  items: ChatItem[];
  /** Claude Code session to `--resume` on the next message. */
  sessionId: string | null;
  nextId: number;
  /** A run is in flight (from the moment Diego sends until its `exit`). */
  running: boolean;
  /** Id of the run being followed; events of any other run are ignored. */
  runId: number | null;
  /** The model is in a thinking block right now (its text is never shown). */
  thinking: boolean;
  stopRequested: boolean;
  /** An error item was already produced for this run. */
  errored: boolean;
  /** Assistant text was shown for this run. */
  sawText: boolean;
  /** Where the agent works: used to make tool paths workspace-relative. */
  ctx: { root: string; space: string } | null;
  msgId: string | null;
  blocks: Record<number, Block>;
  /** Last stderr lines of the run (only surfaced when it exits with an error). */
  stderr: string[];
}

export type ChatAction =
  | ClaudeEvent
  /** Diego pressed send: block further sends until the run ends. */
  | { kind: "begin" }
  | { kind: "user"; text: string; attachments: string[]; root: string; space: string }
  | { kind: "started"; runId: number }
  | { kind: "failed"; message: string }
  | { kind: "stopRequested" }
  | { kind: "reset" };

export function initialChat(): ChatState {
  return {
    items: [],
    sessionId: null,
    nextId: 1,
    running: false,
    runId: null,
    thinking: false,
    stopRequested: false,
    errored: false,
    sawText: false,
    ctx: null,
    msgId: null,
    blocks: {},
    stderr: [],
  };
}

/** State for a conversation restored from storage. */
export function restoreChat(sessionId: string | null, items: ChatItem[]): ChatState {
  return {
    ...initialChat(),
    sessionId,
    nextId: items.reduce((m, i) => Math.max(m, i.id), 0) + 1,
    // A run cannot survive an app restart.
    items: items.map((i) => (i.type === "step" && i.status === "running" ? { ...i, status: "stopped" } : i)),
  };
}

const isObj = (v: unknown): v is Record<string, any> => typeof v === "object" && v !== null && !Array.isArray(v);

function push(s: ChatState, item: DistributiveOmit<ChatItem, "id">): ChatState {
  return { ...s, items: [...s.items, { ...item, id: s.nextId } as ChatItem], nextId: s.nextId + 1 };
}
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

function mapItem(s: ChatState, id: number, f: (i: ChatItem) => ChatItem): ChatState {
  return { ...s, items: s.items.map((i) => (i.id === id ? f(i) : i)) };
}

export function classifyFailure(text: string): "auth" | "resume" | "other" {
  if (/no conversation found|session id|could not resume/i.test(text)) return "resume";
  if (/not logged in|\/login|log in|authenticat|invalid api key|oauth|credentials|unauthorized|\b401\b/i.test(text)) {
    return "auth";
  }
  return "other";
}

function failureText(text: string): string {
  const kind = classifyFailure(text);
  return kind === "auth" ? MSG_AUTH : kind === "resume" ? MSG_RESUME : text.trim() || MSG_NO_RESULT;
}

function baseDir(s: ChatState): string | undefined {
  return s.ctx ? `${s.ctx.root.replace(/\/+$/, "")}/${s.ctx.space}` : undefined;
}

function stepFor(s: ChatState, name: string, input: ToolInput) {
  const base = baseDir(s);
  const file = toolFile(name, input);
  const path = file && s.ctx && base ? workspacePath(file, s.ctx.root, base) : null;
  return { name, label: describeTool(name, input, base), ...(path ? { path } : {}) };
}

/** Creates or refreshes the step of a tool call. */
function upsertStep(s: ChatState, toolId: string, name: string, input: ToolInput): ChatState {
  const info = stepFor(s, name, input);
  const existing = s.items.find((i) => i.type === "step" && i.toolId === toolId);
  if (existing) return mapItem(s, existing.id, (i) => ({ ...(i as Extract<ChatItem, { type: "step" }>), ...info }));
  return push(s, { type: "step", toolId, status: "running", ...info });
}

function streamEvent(s: ChatState, ev: Record<string, any>): ChatState {
  switch (ev.type) {
    case "message_start":
      return { ...s, msgId: typeof ev.message?.id === "string" ? ev.message.id : null, blocks: {} };
    case "content_block_start": {
      const cb = ev.content_block;
      if (!isObj(cb) || typeof ev.index !== "number") return s;
      if (cb.type === "thinking") return { ...s, thinking: true, blocks: { ...s.blocks, [ev.index]: { kind: "thinking", json: "" } } };
      if (cb.type === "text") {
        const next = { ...s, thinking: false, blocks: { ...s.blocks, [ev.index]: { kind: "text" as const, json: "" } } };
        return typeof cb.text === "string" && cb.text ? textDelta(next, ev.index, cb.text) : next;
      }
      if (cb.type === "tool_use" && typeof cb.id === "string" && typeof cb.name === "string") {
        const withStep = upsertStep({ ...s, thinking: false }, cb.id, cb.name, {});
        return { ...withStep, blocks: { ...withStep.blocks, [ev.index]: { kind: "tool", json: "", toolId: cb.id } } };
      }
      return { ...s, blocks: { ...s.blocks, [ev.index]: { kind: "other", json: "" } } };
    }
    case "content_block_delta": {
      const d = ev.delta;
      if (!isObj(d) || typeof ev.index !== "number") return s;
      if (d.type === "text_delta" && typeof d.text === "string") return textDelta(s, ev.index, d.text);
      if (d.type === "input_json_delta" && typeof d.partial_json === "string") {
        const b = s.blocks[ev.index];
        if (!b || b.kind !== "tool") return s;
        return { ...s, blocks: { ...s.blocks, [ev.index]: { ...b, json: b.json + d.partial_json } } };
      }
      return s; // thinking_delta / signature_delta: never shown
    }
    case "content_block_stop": {
      const b = typeof ev.index === "number" ? s.blocks[ev.index] : undefined;
      if (!b) return s;
      if (b.kind === "thinking") return { ...s, thinking: false };
      if (b.kind === "tool" && b.json) {
        try {
          const input = JSON.parse(b.json);
          const step = s.items.find((i) => i.type === "step" && i.toolId === b.toolId);
          if (isObj(input) && step && step.type === "step") return upsertStep(s, step.toolId, step.name, input);
        } catch {
          /* incomplete JSON: the whole assistant message will carry the final input */
        }
      }
      return s;
    }
    case "message_stop":
      return { ...s, thinking: false };
    default:
      return s;
  }
}

function textDelta(s: ChatState, index: number, text: string): ChatState {
  if (!text) return s;
  const block = s.blocks[index] ?? { kind: "text" as const, json: "" };
  const item = block.itemId !== undefined ? s.items.find((i) => i.id === block.itemId) : undefined;
  if (item && item.type === "assistant") {
    if (item.final) return s; // the whole message already arrived: it is authoritative
    return mapItem({ ...s, thinking: false }, item.id, (i) => ({ ...(i as typeof item), text: (i as typeof item).text + text }));
  }
  const created = push({ ...s, thinking: false, sawText: true }, { type: "assistant", text, ...(s.msgId ? { msgId: s.msgId } : {}) });
  return { ...created, blocks: { ...created.blocks, [index]: { ...block, kind: "text", itemId: created.nextId - 1 } } };
}

function assistantLine(s: ChatState, line: Record<string, any>): ChatState {
  const msg = line.message;
  if (!isObj(msg) || !Array.isArray(msg.content)) return s;
  const msgId = typeof msg.id === "string" ? msg.id : undefined;
  const fromSubagent = line.parent_tool_use_id != null;
  let next = s;
  let textOrdinal = 0;
  for (const block of msg.content) {
    if (!isObj(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && !fromSubagent) {
      const k = textOrdinal++;
      if (!block.text.trim()) continue;
      const streamed = msgId ? next.items.filter((i) => i.type === "assistant" && i.msgId === msgId) : [];
      const target = streamed[k];
      next =
        target && target.type === "assistant"
          ? mapItem(next, target.id, (i) => ({ ...(i as typeof target), text: block.text, final: true }))
          : push(next, { type: "assistant", text: block.text, final: true, ...(msgId ? { msgId } : {}) });
      next = { ...next, sawText: true, thinking: false };
    } else if (block.type === "tool_use" && typeof block.id === "string" && typeof block.name === "string") {
      next = upsertStep(next, block.id, block.name, isObj(block.input) ? block.input : {});
    }
  }
  return next;
}

function userLine(s: ChatState, line: Record<string, any>): ChatState {
  const content = line.message?.content;
  if (!Array.isArray(content)) return s;
  let next = s;
  for (const block of content) {
    if (!isObj(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
    const step = next.items.find((i) => i.type === "step" && i.toolId === block.tool_use_id);
    if (step) next = mapItem(next, step.id, (i) => ({ ...(i as typeof step), status: block.is_error === true ? "error" : "done" }));
  }
  return next;
}

function denialsNotice(denials: unknown[]): string | null {
  const names = [...new Set(denials.map((d) => (isObj(d) && typeof d.tool_name === "string" ? d.tool_name : null)).filter((n): n is string => !!n))];
  if (!denials.length) return null;
  const which = names.length ? names.map((n) => `«${n}»`).join(", ") : "una herramienta";
  return `Claude quiso usar ${which}, pero Types no se lo permite.`;
}

function resultLine(s: ChatState, line: Record<string, any>): ChatState {
  let next: ChatState = { ...s, thinking: false };
  if (typeof line.session_id === "string") next.sessionId = line.session_id;
  const text = typeof line.result === "string" ? line.result : "";
  if (line.is_error === true) {
    next = { ...push(next, { type: "error", text: failureText(text) }), errored: true };
  } else if (!next.sawText && text.trim()) {
    next = { ...push(next, { type: "assistant", text, final: true }), sawText: true };
  }
  const denied = Array.isArray(line.permission_denials) ? denialsNotice(line.permission_denials) : null;
  if (denied) {
    next = push(next, { type: "notice", text: denied });
    for (const d of line.permission_denials) {
      const step = isObj(d) ? next.items.find((i) => i.type === "step" && i.toolId === d.tool_use_id) : undefined;
      if (step) next = mapItem(next, step.id, (i) => ({ ...(i as typeof step), status: "error" }));
    }
  }
  return next;
}

function rawLine(s: ChatState, line: unknown): ChatState {
  if (!isObj(line)) return s;
  switch (line.type) {
    case "system":
      return line.subtype === "init" && typeof line.session_id === "string" ? { ...s, sessionId: line.session_id } : s;
    case "stream_event":
      if (line.parent_tool_use_id != null || !isObj(line.event)) return s;
      return streamEvent(s, line.event);
    case "assistant":
      return assistantLine(s, line);
    case "user":
      return userLine(s, line);
    case "result":
      return resultLine(s, line);
    default:
      return s; // rate_limit_event, hooks, status, thinking_tokens...
  }
}

function exitRun(s: ChatState, code: number | null): ChatState {
  let next: ChatState = {
    ...s,
    running: false,
    runId: null,
    thinking: false,
    blocks: {},
    items: s.items.map((i) => (i.type === "step" && i.status === "running" ? { ...i, status: "stopped" } : i)),
  };
  if (s.stopRequested) return push(next, { type: "notice", text: MSG_STOPPED });
  if (code === 0 || s.errored) return next;
  const err = s.stderr.join("\n");
  const kind = classifyFailure(err);
  const text =
    kind === "auth"
      ? MSG_AUTH
      : kind === "resume"
        ? MSG_RESUME
        : code === null
          ? MSG_CRASHED
          : `Claude Code terminó con un error (código ${code}).${s.stderr.length ? ` ${s.stderr[s.stderr.length - 1]}` : ""}`;
  next = push(next, { type: "error", text });
  return { ...next, errored: true };
}

export function reducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.kind) {
    case "begin":
      return {
        ...state,
        running: true,
        runId: null,
        thinking: false,
        stopRequested: false,
        errored: false,
        sawText: false,
        msgId: null,
        blocks: {},
        stderr: [],
      };
    case "user":
      return {
        ...push(state, { type: "user", text: action.text, attachments: action.attachments }),
        ctx: { root: action.root, space: action.space },
      };
    case "started":
      return { ...state, runId: action.runId };
    case "failed":
      return { ...push(state, { type: "error", text: action.message }), running: false, runId: null, errored: true };
    case "stopRequested":
      return state.running ? { ...state, stopRequested: true } : state;
    case "reset":
      return initialChat();
    case "raw":
    case "stderr":
    case "exit":
      if (state.runId !== null && action.runId !== state.runId) return state;
      if (action.kind === "raw") return rawLine(state, action.line);
      if (action.kind === "stderr") return { ...state, stderr: [...state.stderr, action.text.slice(0, 500)].slice(-10) };
      return exitRun(state, action.code);
  }
}
