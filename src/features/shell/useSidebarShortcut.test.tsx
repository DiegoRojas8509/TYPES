import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  api: { listTree: vi.fn().mockResolvedValue([]) },
  onFsChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => String(e),
}));

import { initialState, useApp } from "../../store/app";
import { useSidebarShortcut } from "./useSidebarShortcut";

function Host() {
  useSidebarShortcut();
  return <input aria-label="campo" />;
}

beforeEach(() => useApp.setState(initialState()));

describe("useSidebarShortcut", () => {
  it("toggles with Cmd+\\ and Ctrl+\\", () => {
    render(<Host />);
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useApp.getState().sidebarCollapsed).toBe(true);
    fireEvent.keyDown(window, { key: "\\", ctrlKey: true });
    expect(useApp.getState().sidebarCollapsed).toBe(false);
  });

  it("works while typing in an input and prevents the default", () => {
    const { getByLabelText } = render(<Host />);
    const ev = fireEvent.keyDown(getByLabelText("campo"), { key: "\\", metaKey: true });
    expect(ev).toBe(false);
    expect(useApp.getState().sidebarCollapsed).toBe(true);
  });

  it("ignores a bare backslash and other modifiers", () => {
    render(<Host />);
    fireEvent.keyDown(window, { key: "\\" });
    fireEvent.keyDown(window, { key: "\\", metaKey: true, shiftKey: true });
    fireEvent.keyDown(window, { key: "\\", metaKey: true, altKey: true });
    expect(useApp.getState().sidebarCollapsed).toBe(false);
  });
});
