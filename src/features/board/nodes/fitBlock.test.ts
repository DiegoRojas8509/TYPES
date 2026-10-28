import { describe, expect, it } from "vitest";
import { FIT_MAX_HEIGHT, FIT_MAX_WIDTH, fitBlockSize } from "./fitBlock";

function dom(block: [number, number], area: { client: [number, number]; scroll: [number, number] }) {
  const b = document.createElement("div");
  b.className = "block";
  const a = document.createElement("div");
  b.appendChild(a);
  const def = (el: HTMLElement, p: string, v: number) => Object.defineProperty(el, p, { value: v, configurable: true });
  def(b, "offsetWidth", block[0]);
  def(b, "offsetHeight", block[1]);
  def(a, "clientWidth", area.client[0]);
  def(a, "clientHeight", area.client[1]);
  def(a, "scrollWidth", area.scroll[0]);
  def(a, "scrollHeight", area.scroll[1]);
  return a;
}
const min = { width: 200, height: 110 };

describe("fitBlockSize", () => {
  it("adds the block chrome to the content size and rounds", () => {
    const a = dom([400, 300], { client: [360, 200], scroll: [500.4, 640.6] });
    expect(fitBlockSize(a, min)).toEqual({ width: 540, height: 741 });
  });

  it("uses the natural size when given", () => {
    const a = dom([400, 300], { client: [360, 200], scroll: [360, 200] });
    expect(fitBlockSize(a, min, { width: 600, height: 500 })).toEqual({ width: 640, height: 600 });
  });

  it("clamps to the maximums and the minimums", () => {
    const big = dom([400, 300], { client: [360, 200], scroll: [5000, 9000] });
    expect(fitBlockSize(big, min)).toEqual({ width: FIT_MAX_WIDTH, height: FIT_MAX_HEIGHT });
    const tiny = dom([400, 300], { client: [360, 200], scroll: [0, 0] });
    expect(fitBlockSize(tiny, min)).toEqual(min);
  });

  it("returns null outside a block", () => {
    expect(fitBlockSize(document.createElement("div"), min)).toBeNull();
    expect(fitBlockSize(null, min)).toBeNull();
  });
});
