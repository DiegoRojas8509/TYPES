import { afterEach, describe, expect, it, vi } from "vitest";
import { readSidebarCollapsed, writeSidebarCollapsed } from "./sidebarPref";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("sidebarPref", () => {
  it("defaults to expanded", () => {
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("round-trips through localStorage", () => {
    writeSidebarCollapsed(true);
    expect(readSidebarCollapsed()).toBe(true);
    writeSidebarCollapsed(false);
    expect(readSidebarCollapsed()).toBe(false);
  });

  it("does not throw when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSidebarCollapsed()).toBe(false);
    expect(() => writeSidebarCollapsed(true)).not.toThrow();
  });
});
