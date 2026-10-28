import { describe, expect, it } from "vitest";
import { timeAgo } from "./timeAgo";

const NOW = new Date(2026, 9, 19, 15, 0, 0).getTime();
const MIN = 60_000;
const H = 60 * MIN;
const D = 24 * H;

describe("timeAgo", () => {
  it("says ahora under a minute and for future timestamps", () => {
    expect(timeAgo(NOW - 20_000, NOW)).toBe("ahora");
    expect(timeAgo(NOW + 5 * MIN, NOW)).toBe("ahora");
  });
  it("uses minutes and hours", () => {
    expect(timeAgo(NOW - MIN, NOW)).toBe("hace 1 min");
    expect(timeAgo(NOW - 5 * MIN, NOW)).toBe("hace 5 min");
    expect(timeAgo(NOW - 59 * MIN, NOW)).toBe("hace 59 min");
    expect(timeAgo(NOW - H, NOW)).toBe("hace 1 h");
    expect(timeAgo(NOW - 2 * H, NOW)).toBe("hace 2 h");
    expect(timeAgo(NOW - 23 * H, NOW)).toBe("hace 23 h");
  });
  it("uses ayer and days up to a week", () => {
    expect(timeAgo(NOW - 25 * H, NOW)).toBe("ayer");
    expect(timeAgo(NOW - 47 * H, NOW)).toBe("ayer");
    expect(timeAgo(NOW - 3 * D, NOW)).toBe("hace 3 días");
    expect(timeAgo(NOW - 6 * D - H, NOW)).toBe("hace 6 días");
  });
  it("falls back to a short date, with the year only when it differs", () => {
    expect(timeAgo(new Date(2026, 9, 12, 9).getTime(), NOW)).toBe("12 oct");
    expect(timeAgo(new Date(2026, 0, 3, 9).getTime(), NOW)).toBe("3 ene");
    expect(timeAgo(new Date(2025, 11, 30, 9).getTime(), NOW)).toBe("30 dic 2025");
  });
});
