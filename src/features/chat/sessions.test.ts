import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ChatItem } from "./reducer";
import { boundItems, clearConversation, loadConversation, MAX_BYTES, MAX_ITEMS, MAX_TEXT, saveConversation, STORAGE_PREFIX } from "./sessions";

const msg = (id: number, text: string): ChatItem => ({ id, type: "assistant", text });

beforeEach(() => localStorage.clear());

describe("sessions", () => {
  it("sessions_are_per_space", () => {
    saveConversation("Ropa", { sessionId: "s-ropa", items: [msg(1, "hola ropa")] });
    saveConversation("Café", { sessionId: "s-cafe", items: [msg(1, "hola café")] });
    expect(loadConversation("Ropa")).toMatchObject({ sessionId: "s-ropa", items: [{ text: "hola ropa" }] });
    expect(loadConversation("Café")?.sessionId).toBe("s-cafe");
    expect(loadConversation("Otro")).toBeNull();
  });

  it("'Nueva conversación' clears both session id and transcript", () => {
    saveConversation("Ropa", { sessionId: "s", items: [msg(1, "x")] });
    clearConversation("Ropa");
    expect(loadConversation("Ropa")).toBeNull();
    saveConversation("Ropa", { sessionId: null, items: [] });
    expect(localStorage.getItem(`${STORAGE_PREFIX}Ropa`)).toBeNull();
  });

  it("bounds the transcript: item count, text length and total size", () => {
    const many = Array.from({ length: MAX_ITEMS + 50 }, (_, i) => msg(i + 1, "x"));
    expect(boundItems(many)).toHaveLength(MAX_ITEMS);
    expect(boundItems(many)[0].id).toBe(51);

    const long = boundItems([msg(1, "a".repeat(MAX_TEXT * 3))])[0] as { text: string };
    expect(long.text.length).toBeLessThan(MAX_TEXT + 100);

    const heavy = Array.from({ length: 100 }, (_, i) => msg(i + 1, "y".repeat(MAX_TEXT)));
    expect(JSON.stringify(boundItems(heavy)).length).toBeLessThanOrEqual(MAX_BYTES);
    expect(boundItems(heavy).slice(-1)[0]?.id).toBe(100); // newest survive
  });

  it("survives corrupt data and unavailable storage", () => {
    localStorage.setItem(`${STORAGE_PREFIX}Ropa`, "{no json");
    expect(loadConversation("Ropa")).toBeNull();
    localStorage.setItem(`${STORAGE_PREFIX}Ropa`, JSON.stringify({ sessionId: 5, items: [{ type: "x" }, msg(1, "ok")] }));
    expect(loadConversation("Ropa")).toEqual({ sessionId: null, items: [msg(1, "ok")] });

    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => saveConversation("Ropa", { sessionId: "s", items: [msg(1, "x")] })).not.toThrow();
    spy.mockRestore();
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(loadConversation("Ropa")).toBeNull();
    get.mockRestore();
  });
});
