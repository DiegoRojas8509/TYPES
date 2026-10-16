import { render } from "@testing-library/react";
import { cloneElement, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ResponsiveContainer measures its parent, which is 0x0 in jsdom (and warns about it):
// give it a fixed size so the real recharts charts render.
vi.mock("recharts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("recharts")>();
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 400, height: 240 }),
  };
});

import { ChartCanvas } from "./ChartCanvas";
import { prepareChartData } from "./chartData";

const spies: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  spies.push(vi.spyOn(console, "error"), vi.spyOn(console, "warn"));
});
afterEach(() => {
  for (const s of spies.splice(0)) {
    expect(s).not.toHaveBeenCalled();
    s.mockRestore();
  }
});

const draw = (extra: Record<string, unknown>) =>
  render(<ChartCanvas data={prepareChartData({ labels: ["A", "B", "C"], series: [{ name: "S1", values: [1, 2] }, { name: "S2", values: [3, "x", 5] }], ...extra })} />);

describe("ChartCanvas (real recharts at a fixed size)", () => {
  it("draws bars with series colour tokens, leaving gaps for missing values", () => {
    const { container } = draw({ kind: "bar" });
    const fills = [...container.querySelectorAll(".recharts-bar-rectangle path, .recharts-bar-rectangle rect")].map((e) => e.getAttribute("fill"));
    expect(fills.length).toBeGreaterThan(0);
    expect(new Set(fills)).toEqual(new Set(["var(--chart-1)", "var(--chart-2)"]));
  });

  it("draws one line per series", () => {
    const { container } = draw({ kind: "line" });
    expect(container.querySelectorAll(".recharts-line-curve")).toHaveLength(2);
    expect(container.querySelector(".recharts-line-curve")).toHaveAttribute("stroke-width", "2");
  });

  it("draws a pie from the first series only", () => {
    const { container } = draw({ kind: "pie" });
    expect(container.querySelectorAll(".recharts-pie-sector")).toHaveLength(2); // C has no value in S1
  });

  it("copes with more than six series (the palette cycles)", () => {
    const series = Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, values: [i + 1, i + 2] }));
    const { container } = draw({ kind: "bar", labels: ["A", "B"], series });
    expect(container.querySelector(".recharts-wrapper")).not.toBeNull();
  });

  it("duplicate labels stay separate data points: two bars and two dots, even with the same label", () => {
    const dup = { labels: ["Ene", "Ene"], series: [{ name: "S1", values: [3, 7] }] };
    const bars = draw({ kind: "bar", ...dup });
    const xs = [...bars.container.querySelectorAll(".recharts-bar-rectangle path")].map((e) => e.getAttribute("x") ?? e.getAttribute("d"));
    expect(xs).toHaveLength(2);
    expect(new Set(xs).size).toBe(2);
    bars.unmount();
    const line = draw({ kind: "line", ...dup });
    const cx = [...line.container.querySelectorAll(".recharts-line-dots circle")].map((c) => c.getAttribute("cx"));
    expect(cx).toHaveLength(2);
    expect(new Set(cx).size).toBe(2);
  });
});
