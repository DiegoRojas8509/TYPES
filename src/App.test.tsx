import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./lib/api", () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({ workspaceRoot: "/w", claudePath: null }),
    listTree: vi.fn().mockResolvedValue([]),
  },
  onFsChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => String(e),
}));

import App from "./App";
import { initialState, useApp } from "./store/app";

beforeEach(() => useApp.setState(initialState()));

describe("App", () => {
  it("renders the app name and the first-run invitation", async () => {
    render(<App />);
    expect(screen.getByText("Types")).toBeInTheDocument();
    expect(await screen.findByText("Crea tu primer espacio")).toBeInTheDocument();
    expect(screen.getByText("Empieza por un espacio")).toBeInTheDocument();
  });

  it("collapses and restores the chat pane", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "Ocultar chat" }));
    expect(useApp.getState().chatCollapsed).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Mostrar chat" }));
    expect(useApp.getState().chatCollapsed).toBe(false);
  });
});
