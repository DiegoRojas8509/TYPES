import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, readText: vi.fn() },
    assetUrl: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
    openWithDefaultApp: vi.fn().mockResolvedValue(undefined),
  };
});
vi.mock("../editor/Editor", () => ({ MarkdownEditor: ({ path }: { path: string }) => <div>editor:{path}</div> }));
vi.mock("../board/BoardView", () => ({ BoardView: ({ path }: { path: string }) => <div>board:{path}</div> }));

import { api } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { DocumentPane } from "./DocumentPane";

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/Users/d/TYPES-espacios", claudePath: null } });
  vi.mocked(api.readText).mockReset().mockResolvedValue("<h1>v1</h1>");
});
afterEach(() => vi.useRealTimers());

describe("DocumentPane", () => {
  it("document_pane_picks_viewer_by_kind", async () => {
    const show = async (p: string) => {
      act(() => useApp.setState({ openPath: p }));
      return render(<DocumentPane />);
    };
    let r = await show("Ropa/Notas.md");
    expect(screen.getByText("editor:Ropa/Notas.md")).toBeInTheDocument();
    r.unmount();

    r = await show("Ropa/Plan.canvas");
    expect(screen.getByText("board:Ropa/Plan.canvas")).toBeInTheDocument();
    r.unmount();

    r = await show("Ropa/dash.html");
    await settle();
    expect(r.container.querySelector("iframe")).toBeInTheDocument();
    r.unmount();

    r = await show("Ropa/adjuntos/a.png");
    expect(r.container.querySelector(".image-stage")).toBeInTheDocument();
    r.unmount();

    r = await show("Ropa/precios.csv");
    expect(screen.getByRole("button", { name: "Abrir con la app predeterminada" })).toBeInTheDocument();
    expect(r.container.querySelector("iframe")).toBeNull();
  });
});
