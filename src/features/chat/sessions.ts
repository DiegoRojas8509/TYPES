// Per-space persistence of a conversation (Claude session id + transcript) in localStorage.
// One key per space: `types.chat.v1.<space>`. Everything is bounded and every storage
// access is guarded: the chat must work even when storage is full or unavailable.
import type { ChatItem } from "./reducer";

export const STORAGE_PREFIX = "types.chat.v1.";
export const MAX_ITEMS = 200;
export const MAX_TEXT = 20_000;
/** Serialized size cap per space; oldest items are dropped until it fits. */
export const MAX_BYTES = 250_000;

export interface StoredConversation {
  sessionId: string | null;
  items: ChatItem[];
}

const keyFor = (space: string) => `${STORAGE_PREFIX}${space}`;

const clip = (t: string) => (t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}\n\n[…texto recortado]` : t);

/** Copy of the transcript that is safe to store: last MAX_ITEMS items, clipped text, within MAX_BYTES. */
export function boundItems(items: ChatItem[]): ChatItem[] {
  let out = items.slice(-MAX_ITEMS).map((i): ChatItem => {
    if (i.type === "assistant" || i.type === "user" || i.type === "error" || i.type === "notice") {
      return { ...i, text: clip(i.text) };
    }
    return i;
  });
  while (out.length > 1 && JSON.stringify(out).length > MAX_BYTES) out = out.slice(Math.ceil(out.length / 10));
  return out;
}

export function saveConversation(space: string, conv: StoredConversation): void {
  try {
    if (!conv.items.length && !conv.sessionId) {
      localStorage.removeItem(keyFor(space));
      return;
    }
    const items = boundItems(conv.items);
    try {
      localStorage.setItem(keyFor(space), JSON.stringify({ sessionId: conv.sessionId, items }));
    } catch {
      // Quota exceeded: keep only the tail, then give up quietly.
      localStorage.setItem(keyFor(space), JSON.stringify({ sessionId: conv.sessionId, items: items.slice(-20) }));
    }
  } catch {
    /* storage unavailable: the conversation just won't survive a restart */
  }
}

const KINDS = new Set(["user", "assistant", "step", "error", "notice"]);

function validItem(i: unknown): i is ChatItem {
  if (typeof i !== "object" || i === null) return false;
  const o = i as Record<string, unknown>;
  if (typeof o.id !== "number" || typeof o.type !== "string" || !KINDS.has(o.type)) return false;
  if (o.type === "user") return typeof o.text === "string" && Array.isArray(o.attachments);
  if (o.type === "step") return typeof o.label === "string" && typeof o.toolId === "string" && typeof o.status === "string";
  return typeof o.text === "string";
}

/** Null when nothing usable is stored. Corrupt entries are ignored, never thrown. */
export function loadConversation(space: string): StoredConversation | null {
  try {
    const raw = localStorage.getItem(keyFor(space));
    if (!raw) return null;
    const data = JSON.parse(raw) as { sessionId?: unknown; items?: unknown };
    const items = Array.isArray(data.items) ? data.items.filter(validItem) : [];
    const sessionId = typeof data.sessionId === "string" ? data.sessionId : null;
    return items.length || sessionId ? { sessionId, items } : null;
  } catch {
    return null;
  }
}

export function clearConversation(space: string): void {
  try {
    localStorage.removeItem(keyFor(space));
  } catch {
    /* nothing to do */
  }
}
