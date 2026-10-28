import { afterEach, describe, expect, it, vi } from "vitest";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./sidebarPref";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("sidebarPref", () => {
  it("defaults to collapsed when nothing is stored", () => {
    expect(readSidebarCollapsed()).toBe(true);
  });

  it("an explicit 0 shows the sidebar and an explicit 1 collapses it", () => {
    localStorage.setItem("types.sidebarCollapsed.v2", "0");
    expect(readSidebarCollapsed()).toBe(false);
    localStorage.setItem("types.sidebarCollapsed.v2", "1");
    expect(readSidebarCollapsed()).toBe(true);
  });

  it("ignores the old key", () => {
    localStorage.setItem("types.sidebarCollapsed", "0");
    expect(readSidebarCollapsed()).toBe(true);
  });

  it("round-trips through the v2 key only", () => {
    writeSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
    expect(localStorage.getItem("types.sidebarCollapsed")).toBeNull();
    writeSidebarCollapsed(true);
    expect(readSidebarCollapsed()).toBe(true);
  });

  it("starts collapsed and does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSidebarCollapsed()).toBe(true);
    expect(() => writeSidebarCollapsed(false)).not.toThrow();
  });
});
