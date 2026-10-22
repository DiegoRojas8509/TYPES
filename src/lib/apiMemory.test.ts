import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a), convertFileSrc: (p: string) => p }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: vi.fn(), openUrl: vi.fn() }));

import { api } from "./api";

describe("memory api wrappers", () => {
  beforeEach(() => invoke.mockReset());

  it("memoryStatus calls memory_status with the space", async () => {
    invoke.mockResolvedValue({ dir: "/x", exists: false, entries: [], facts: 0, decisions: 0, updated: null, indexLines: 0 });
    const r = await api.memoryStatus("Ropa");
    expect(invoke).toHaveBeenCalledWith("memory_status", { space: "Ropa" });
    expect(r.exists).toBe(false);
  });

  it("memoryRead calls memory_read with space and file", async () => {
    invoke.mockResolvedValue("texto");
    expect(await api.memoryRead("Ropa", "MEMORY.md")).toBe("texto");
    expect(invoke).toHaveBeenCalledWith("memory_read", { space: "Ropa", file: "MEMORY.md" });
  });

  it("memoryCloseTopic passes sessionId in camelCase", async () => {
    invoke.mockResolvedValue({ ok: true, changes: [], error: null, nothingToSave: true });
    const r = await api.memoryCloseTopic("Ropa", "abc-123");
    expect(invoke).toHaveBeenCalledWith("memory_close_topic", { space: "Ropa", sessionId: "abc-123" });
    expect(r.nothingToSave).toBe(true);
  });
});
