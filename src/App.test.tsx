import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ workspaceRoot: "/w", claudePath: null }),
    listTree: vi.fn().mockResolvedValue([]),
    activity: vi.fn().mockResolvedValue({}),
  },
  onFsChanged: vi.fn(async () => () => {}),
  onActivityChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => String(e),
}));

import App from "./App";
import { initialState, useApp } from "./store/app";

beforeEach(() => useApp.setState(initialState()));

describe("App", () => {
  it("renders the app name and the first-run invitation", async () => {
    render(<App />);
    expect(screen.getAllByText("Types").length).toBeGreaterThan(0);
    // Once in the sidebar and once in the Inicio view.
    expect(await screen.findAllByText("Crea tu primer espacio")).toHaveLength(2);
  });

  it("collapses and restores the chat pane", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar chat" }));
    expect(useApp.getState().chatCollapsed).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar chat" }));
    expect(useApp.getState().chatCollapsed).toBe(false);
  });

  it("collapses the sidebar, shows the reopen control and persists it", () => {
    render(<App />);
    expect(screen.getByRole("navigation", { name: "Espacios y pizarras" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Ocultar barra lateral" }));
    expect(useApp.getState().sidebarCollapsed).toBe(true);
    expect(screen.queryByRole("navigation", { name: "Espacios y pizarras" })).not.toBeInTheDocument();
    expect(localStorage.getItem("types.sidebarCollapsed.v2")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Mostrar barra lateral" }));
    expect(useApp.getState().sidebarCollapsed).toBe(false);
    expect(screen.getByRole("navigation", { name: "Espacios y pizarras" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Mostrar barra lateral" })).not.toBeInTheDocument();
    expect(localStorage.getItem("types.sidebarCollapsed.v2")).toBe("0");
  });

  it("toggles the sidebar with Cmd+\\", () => {
    render(<App />);
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useApp.getState().sidebarCollapsed).toBe(true);
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(useApp.getState().sidebarCollapsed).toBe(false);
  });
});
