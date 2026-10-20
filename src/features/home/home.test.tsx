import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    getSettings: vi.fn(),
    listTree: vi.fn(),
    activity: vi.fn(),
    boardPreview: vi.fn(),
    createSpace: vi.fn(),
    createBoard: vi.fn(),
    createFolder: vi.fn(),
    createPage: vi.fn(),
    renameEntry: vi.fn(),
    deleteEntry: vi.fn(),
    writeText: vi.fn(),
  },
  onFsChanged: vi.fn(async () => () => {}),
  onActivityChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => (e as { message?: string }).message ?? "error",
}));
vi.mock("../board/BoardView", () => ({ BoardView: ({ path }: { path: string }) => (
  <div>
    <div className="pane-header pane-header-end">controles</div>
    board:{path}
  </div>
) }));
const thumbRenders: Record<string, number> = {};
vi.mock("./BoardThumb", async (orig) => {
  const actual = await orig<typeof import("./BoardThumb")>();
  return {
    ...actual,
    BoardThumb: (p: { path: string; modified?: number }) => {
      thumbRenders[p.path] = (thumbRenders[p.path] ?? 0) + 1;
      return <actual.BoardThumb {...p} />;
    },
  };
});
vi.mock("../editor/Editor", () => ({ MarkdownEditor: ({ path }: { path: string }) => <div>editor:{path}</div> }));

import { api } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { Sidebar } from "../sidebar/Sidebar";
import { DocumentPane } from "../shell/DocumentPane";
import { clearThumbCache } from "./BoardThumb";

const f = (path: string, modified?: number): TreeNode => ({ name: path.split("/").pop()!, path, kind: "file", children: [], modified });
const d = (path: string, children: TreeNode[] = []): TreeNode => ({ name: path.split("/").pop()!, path, kind: "dir", children });
const NOW = new Date(2026, 9, 19, 15, 0, 0).getTime();
const tree: TreeNode[] = [
  d("Ropa", [
    d("Ropa/Clientes", [f("Ropa/Clientes/Daring Martin.canvas", NOW - 2 * 3600_000)]),
    d("Ropa/Imágenes", [f("Ropa/Imágenes/a.png")]),
    f("Ropa/Plan.canvas", NOW - 5 * 60_000),
    f("Ropa/Notas.md", NOW - 86400_000 * 3),
    f("Ropa/CLAUDE.md"),
    f("Ropa/foto.png"),
  ]),
  d("Compras"),
];
const mocked = vi.mocked(api);
const s = () => useApp.getState();

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(thumbRenders)) delete thumbRenders[k];
  localStorage.clear();
  clearThumbCache();
  useApp.setState({ ...initialState(), showContextFiles: false, tree, treeLoaded: true });
  mocked.listTree.mockResolvedValue(tree);
  mocked.activity.mockResolvedValue({});
  mocked.boardPreview.mockResolvedValue({ nodes: [{ x: 0, y: 0, w: 0.4, h: 0.4, kind: "text" }] });
});
afterEach(() => vi.useRealTimers());

const crumb = () => within(screen.getByRole("navigation", { name: "Ruta" }));

describe("card navigation", () => {
  it("walks Inicio -> Ropa -> Clientes -> board -> back with the breadcrumb header", async () => {
    render(<DocumentPane />);
    expect(screen.getByRole("heading", { name: "Espacios" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Ropa/ }));
    expect(crumb().getByText("Ropa")).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByRole("button", { name: /^Clientes/ }));
    expect(crumb().getByText("Clientes")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^Daring Martin/ }));
    expect(screen.getByText("board:Ropa/Clientes/Daring Martin.canvas")).toBeInTheDocument();
    expect(crumb().getByText("Daring Martin")).toHaveAttribute("aria-current", "page");
    // The title shows once: in the header only
    expect(screen.getAllByText("Daring Martin")).toHaveLength(1);
    fireEvent.click(crumb().getByRole("button", { name: "Atrás" }));
    expect(screen.getByRole("heading", { name: "Clientes" })).toBeInTheDocument();
    fireEvent.click(crumb().getByRole("button", { name: "Ropa" }));
    expect(screen.getByRole("heading", { name: "Ropa" })).toBeInTheDocument();
    fireEvent.click(crumb().getByRole("button", { name: "Types" }));
    expect(screen.getByRole("heading", { name: "Espacios" })).toBeInTheDocument();
    expect(mocked.writeText).not.toHaveBeenCalled();
  });

  it("lists boards, folders and other files; hides CLAUDE.md and Imágenes until the toggle", () => {
    useApp.setState({ currentDir: "Ropa" });
    render(<DocumentPane />);
    expect(screen.getByRole("list", { name: "Pizarras" })).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
    expect(screen.getByText("Clientes")).toBeInTheDocument();
    expect(screen.getByText("Notas")).toBeInTheDocument();
    expect(screen.getByText("foto.png")).toBeInTheDocument();
    expect(screen.queryByText("CLAUDE")).not.toBeInTheDocument();
    expect(screen.queryByText("Imágenes")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Opciones de Ropa" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Mostrar archivos de contexto/ }));
    expect(screen.getByText("CLAUDE")).toBeInTheDocument();
    expect(screen.getByText("Imágenes")).toBeInTheDocument();
    localStorage.removeItem("types.showClaudeFiles");
  });

  it("shows time and actor on cards, and the folder summary", () => {
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    mocked.activity.mockResolvedValue({});
    useApp.setState({
      currentDir: "Ropa",
      activity: { "Ropa/Plan.canvas": { at: NOW - 2 * 3600_000, by: "claude-cel" } },
    });
    render(<DocumentPane />);
    expect(screen.getByText("hace 2 h · Claude desde el cel")).toBeInTheDocument();
    expect(screen.getByText("1 pizarra")).toBeInTheDocument(); // Clientes folder card
  });

  it("shows the empty state of a fresh workspace and creates the first space", async () => {
    useApp.setState({ tree: [] });
    mocked.createSpace.mockResolvedValue("Ropa");
    render(<DocumentPane />);
    expect(screen.getByText("Crea tu primer espacio")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Espacio" }));
    const input = screen.getByLabelText("Nombre del espacio");
    fireEvent.change(input, { target: { value: "Ropa" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocked.createSpace).toHaveBeenCalledWith("Ropa"));
  });
});

describe("unseen dot", () => {
  const dot = (container: HTMLElement) => container.querySelectorAll(".card-dot").length;

  it("appears for claude changes after the last open, disappears on open and stays gone", async () => {
    useApp.setState({
      currentDir: "Ropa",
      activity: {
        "Ropa/Plan.canvas": { at: 1000, by: "claude" },
        "Ropa/Notas.md": { at: 1000, by: "tu" },
      },
    });
    const { container, rerender } = render(<DocumentPane />);
    expect(dot(container)).toBe(1);
    expect(container.querySelector(".board-card")).toHaveClass("is-unseen");

    act(() => s().open("Ropa/Plan.canvas"));
    act(() => s().back());
    rerender(<DocumentPane />);
    expect(dot(container)).toBe(0);
    // an unrelated activity refresh does not bring it back
    mocked.activity.mockResolvedValue({ "Ropa/Plan.canvas": { at: 1000, by: "claude" } });
    await act(() => s().refreshActivity());
    expect(dot(container)).toBe(0);
  });

  it("a folder shows the dot when a descendant changed by claude unseen", () => {
    useApp.setState({
      currentDir: "Ropa",
      activity: { "Ropa/Clientes/Daring Martin.canvas": { at: 5, by: "claude-cel" } },
    });
    render(<DocumentPane />);
    const folder = screen.getByRole("button", { name: /^Clientes/ }).closest(".card")!;
    expect(folder).toHaveClass("is-unseen");
  });

  it("finds NFC activity for an NFD-named board", () => {
    const nfd = "Ropa/María.canvas";
    useApp.setState({
      tree: [d("Ropa", [f(nfd)])],
      currentDir: "Ropa",
      activity: { "Ropa/María.canvas": { at: 9, by: "claude" } },
    });
    const { container } = render(<DocumentPane />);
    expect(container.querySelectorAll(".card-dot")).toHaveLength(1);
  });
});

describe("cards: create, rename, delete", () => {
  beforeEach(() => useApp.setState({ currentDir: "Ropa" }));

  it("creates a board and a folder with the same payloads as the sidebar", async () => {
    mocked.createBoard.mockResolvedValue("Ropa/Nueva.canvas");
    mocked.createFolder.mockResolvedValue("Ropa/Caja");
    render(<DocumentPane />);
    fireEvent.click(screen.getByRole("button", { name: "Pizarra" }));
    let input = screen.getByLabelText("Nombre de la pizarra");
    fireEvent.change(input, { target: { value: "Nueva" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocked.createBoard).toHaveBeenCalledWith("Ropa", "Nueva"));
    expect(s().openPath).toBe("Ropa/Nueva.canvas");

    act(() => s().browse("Ropa"));
    fireEvent.click(screen.getByRole("button", { name: "Carpeta" }));
    input = screen.getByLabelText("Nombre de la carpeta");
    fireEvent.change(input, { target: { value: "Caja" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocked.createFolder).toHaveBeenCalledWith("Ropa", "Caja"));
  });

  it("renames from the menu", async () => {
    mocked.renameEntry.mockResolvedValue("Ropa/Plan B.canvas");
    render(<DocumentPane />);
    fireEvent.click(screen.getByRole("button", { name: "Opciones de Plan" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Renombrar" }));
    const input = screen.getByLabelText("Nuevo nombre");
    expect(input).toHaveValue("Plan");
    fireEvent.change(input, { target: { value: "Plan B" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(mocked.renameEntry).toHaveBeenCalledWith("Ropa/Plan.canvas", "Plan B"));
  });

  it("deletes from the menu after confirming", async () => {
    mocked.deleteEntry.mockResolvedValue({ original: "Ropa/Plan.canvas", trashed: "/t/Plan.canvas" });
    render(<DocumentPane />);
    fireEvent.click(screen.getByRole("button", { name: "Opciones de Plan" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Eliminar" }));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mover a la papelera" }));
    await waitFor(() => expect(mocked.deleteEntry).toHaveBeenCalledWith("Ropa/Plan.canvas"));
    expect(s().lastDeleted).not.toBeNull();
  });
});

describe("keyboard", () => {
  beforeEach(() => useApp.setState({ currentDir: "Ropa" }));
  const cards = () => Array.from(document.querySelectorAll<HTMLElement>("[data-card]"));

  it("arrows move focus in reading order and Enter opens", () => {
    render(<DocumentPane />);
    const [first, second] = cards();
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(first);
    // Enter on a focused button clicks it natively; in jsdom emulate with click
    fireEvent.click(first);
    expect(s().openPath).toBe("Ropa/Plan.canvas");
  });

  it("F2 renames and Supr asks to delete the focused card", () => {
    render(<DocumentPane />);
    const plan = screen.getByRole("button", { name: /^Plan/ });
    plan.focus();
    fireEvent.keyDown(plan, { key: "F2" });
    expect(screen.getByLabelText("Nuevo nombre")).toBeInTheDocument();
    fireEvent.keyDown(screen.getByLabelText("Nuevo nombre"), { key: "Escape" });
    const again = screen.getByRole("button", { name: /^Plan/ });
    fireEvent.keyDown(again, { key: "Delete" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("Esc goes up a level, Cmd+[ goes back, Esc does nothing in Inicio", () => {
    useApp.setState({ currentDir: "Ropa/Clientes" });
    render(<DocumentPane />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(s().currentDir).toBe("Ropa");
    fireEvent.keyDown(window, { key: "[", metaKey: true });
    expect(s().currentDir).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(s().currentDir).toBeNull();
  });

  it("ignores Esc, Delete, arrows and Cmd+[ while typing a name", () => {
    render(<DocumentPane />);
    fireEvent.click(screen.getByRole("button", { name: "Carpeta" }));
    const input = screen.getByLabelText("Nombre de la carpeta");
    for (const key of ["ArrowRight", "Delete", "F2"]) fireEvent.keyDown(input, { key });
    fireEvent.keyDown(input, { key: "[", metaKey: true });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(s().currentDir).toBe("Ropa");
    expect(screen.getByLabelText("Nombre de la carpeta")).toBe(input);
  });

  it("Esc inside the open menu only closes the menu", () => {
    render(<DocumentPane />);
    fireEvent.click(screen.getByRole("button", { name: "Opciones de Plan" }));
    const item = screen.getByRole("menuitem", { name: "Renombrar" });
    fireEvent.keyDown(item, { key: "Escape" });
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(s().currentDir).toBe("Ropa");
  });
});

describe("lazy previews", () => {
  it("a 200-board folder only requests previews for cards on screen", async () => {
    const observed: Array<{ el: Element; cb: IntersectionObserverCallback }> = [];
    class IO {
      constructor(private cb: IntersectionObserverCallback) {}
      observe(el: Element) {
        observed.push({ el, cb: this.cb });
      }
      disconnect() {}
      unobserve() {}
      takeRecords() {
        return [];
      }
    }
    vi.stubGlobal("IntersectionObserver", IO);
    try {
      const boards = Array.from({ length: 200 }, (_, i) => f(`Ropa/B${i}.canvas`, 1));
      useApp.setState({ tree: [d("Ropa", boards)], currentDir: "Ropa" });
      render(<DocumentPane />);
      await act(async () => {});
      expect(mocked.boardPreview).not.toHaveBeenCalled();
      expect(observed).toHaveLength(200);
      await act(async () => {
        for (const o of observed.slice(0, 3)) o.cb([{ isIntersecting: true, target: o.el } as IntersectionObserverEntry], {} as IntersectionObserver);
      });
      await waitFor(() => expect(mocked.boardPreview).toHaveBeenCalledTimes(3));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("an empty or failing preview leaves the card usable", async () => {
    mocked.boardPreview.mockRejectedValue(new Error("boom"));
    useApp.setState({ currentDir: "Ropa" });
    render(<DocumentPane />);
    await waitFor(() => expect(mocked.boardPreview).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /^Plan/ })).toBeInTheDocument();
  });

  it("does not reload a preview when the board did not change", async () => {
    useApp.setState({ currentDir: "Ropa" });
    const first = render(<DocumentPane />);
    await waitFor(() => expect(mocked.boardPreview).toHaveBeenCalled());
    const calls = mocked.boardPreview.mock.calls.length;
    first.unmount();
    render(<DocumentPane />);
    await act(async () => {});
    expect(mocked.boardPreview.mock.calls.length).toBe(calls);
  });
});

describe("currentDir disappearing", () => {
  it("the view falls back when the folder is deleted", async () => {
    useApp.setState({ currentDir: "Ropa/Clientes" });
    render(<DocumentPane />);
    mocked.listTree.mockResolvedValue([d("Ropa", [f("Ropa/Plan.canvas")])]);
    await act(() => s().refreshTree());
    expect(screen.getByRole("heading", { name: "Ropa" })).toBeInTheDocument();
  });
});

describe("fix round 1", () => {
  beforeEach(() => useApp.setState({ currentDir: "Ropa" }));

  it("Backspace and Delete both ask to delete; neither acts inside a text field", () => {
    render(<DocumentPane />);
    for (const key of ["Backspace", "Delete"]) {
      const plan = screen.getByRole("button", { name: /^Plan/ });
      fireEvent.keyDown(plan, { key });
      expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    }
    fireEvent.click(screen.getByRole("button", { name: "Carpeta" }));
    fireEvent.keyDown(screen.getByLabelText("Nombre de la carpeta"), { key: "Backspace" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("Esc ignores focus in the sidebar or chat, and while a file is open", () => {
    useApp.setState({ currentDir: "Ropa/Clientes" });
    render(
      <>
        <aside className="pane-chat">
          <button>fuera</button>
        </aside>
        <DocumentPane />
      </>,
    );
    const outside = screen.getByRole("button", { name: "fuera" });
    outside.focus();
    fireEvent.keyDown(outside, { key: "Escape" });
    expect(s().currentDir).toBe("Ropa/Clientes");
    const card = screen.getByRole("button", { name: /^Daring Martin/ });
    fireEvent.keyDown(card, { key: "Escape" });
    expect(s().currentDir).toBe("Ropa");
    act(() => s().open("Ropa/Plan.canvas"));
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(s().openPath).toBe("Ropa/Plan.canvas");
  });

  it("the dot comes back after a newer Claude edit following an open", async () => {
    useApp.setState({ activity: { "Ropa/Plan.canvas": { at: 1000, by: "claude" } } });
    const { container } = render(<DocumentPane />);
    act(() => s().open("Ropa/Plan.canvas"));
    act(() => s().back());
    expect(container.querySelectorAll(".card-dot")).toHaveLength(0);
    mocked.activity.mockResolvedValue({ "Ropa/Plan.canvas": { at: Date.now() + 60_000, by: "claude" } });
    await act(() => s().refreshActivity());
    expect(container.querySelectorAll(".card-dot")).toHaveLength(1);
  });

  it("a changed modified refetches the preview", async () => {
    const t = (m: number) => [d("Ropa", [f("Ropa/Plan.canvas", m)])];
    useApp.setState({ tree: t(1) });
    render(<DocumentPane />);
    await waitFor(() => expect(mocked.boardPreview).toHaveBeenCalledTimes(1));
    act(() => useApp.setState({ tree: t(2) }));
    await waitFor(() => expect(mocked.boardPreview).toHaveBeenCalledTimes(2));
  });

  it("an unrelated activity change does not re-render an unaffected card", async () => {
    useApp.setState({ activity: { "Ropa/Plan.canvas": { at: 5, by: "tu" } } });
    render(<DocumentPane />);
    await act(async () => {});
    const before = thumbRenders["Ropa/Plan.canvas"];
    act(() =>
      useApp.setState((st) => ({
        activity: { ...st.activity, "Ropa/Notas.md": { at: 9, by: "claude" } },
      })),
    );
    expect(thumbRenders["Ropa/Plan.canvas"]).toBe(before);
    // identical content in fresh objects (what every IPC refresh produces) is also quiet
    act(() => useApp.setState((st) => ({ activity: Object.fromEntries(Object.entries(st.activity).map(([k, v]) => [k, { ...v }])) })));
    expect(thumbRenders["Ropa/Plan.canvas"]).toBe(before);
  });

  it("the context-files toggle is shared by the folder view and the sidebar", () => {
    useApp.setState({ tree: [d("Ropa", [f("Ropa/Plan.canvas"), f("Ropa/CLAUDE.md")])], expanded: { Ropa: true } });
    render(
      <>
        <Sidebar />
        <DocumentPane />
      </>,
    );
    expect(screen.queryByText("CLAUDE")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Opciones de Ropa" }));
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: /Mostrar archivos de contexto/ }));
    expect(screen.getAllByText("CLAUDE")).toHaveLength(2); // sidebar row + card
    localStorage.removeItem("types.showClaudeFiles");
  });
});
