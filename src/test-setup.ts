import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// vitest runs with globals off, so RTL's automatic cleanup never registers.
afterEach(cleanup);

// jsdom lacks the browser APIs React Flow (the whiteboard) relies on. These
// minimal stand-ins let it mount; layout itself is never measured in tests.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
if (typeof globalThis.DOMMatrixReadOnly === "undefined") {
  globalThis.DOMMatrixReadOnly = class {
    m22 = 1;
    constructor(transform?: string) {
      const scale = /scale\(([-\d.]+)\)/.exec(transform ?? "");
      if (scale) this.m22 = Number(scale[1]);
    }
  } as unknown as typeof DOMMatrixReadOnly;
}
