import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TreeNode } from "../../lib/api";

vi.mock("../../lib/api", () => ({
  api: {
    getSettings: vi.fn(),
    listTree: vi.fn().mockResolvedValue([]),
    createSpace: vi.fn(),
    createPage: vi.fn(),
    createBoard: vi.fn(),
    createFolder: vi.fn(),
    renameEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
  onFsChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => (e as { message?: string }).message ?? "error",
}));

import { api } from "../../lib/api";
import { TREE_PATH_MIME } from "../../lib/paths";
import { initialState, useApp } from "../../store/app";
import { Sidebar } from "./Sidebar";

const file = (path: string): TreeNode => ({ name: path.split("/").pop()!, path, kind: "file", children: [] });
const tree: TreeNode[] = [
  {
    name: "Ropa",
    path: "Ropa",
    kind: "dir",
    children: [
      { name: "Telas", path: "Ropa/Telas", kind: "dir", children: [file("Ropa/Telas/Algodón.md")] },
      file("Ropa/Notas.md"),
      file("Ropa/Dashboard.html"),
      file("Ropa/Plan.canvas"),
    ],
  },
];
const mocked = vi.mocked(api);

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState(initialState());
});

describe("Sidebar", () => {
  it("hides the CLAUDE.md files until the toggle asks for them", () => {
    useApp.setState({
      tree: [{ ...tree[0], children: [...tree[0].children, file("Ropa/CLAUDE.md")] }, file("CLAUDE.md")],
      treeLoaded: true,
      expanded: { Ropa: true },
    });
    render(<Sidebar />);
    expect(screen.getByText("Notas")).toBeInTheDocument();
    expect(screen.queryByText("CLAUDE")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Mostrar archivos de contexto"));
    expect(screen.getAllByText("CLAUDE")).toHaveLength(2);

    fireEvent.click(screen.getByLabelText("Ocultar archivos de contexto"));
    expect(screen.queryByText("CLAUDE")).not.toBeInTheDocument();
    localStorage.removeItem("types.showClaudeFiles");
  });

  it("offers no toggle when there is no CLAUDE.md to hide", () => {
    useApp.setState({ tree, treeLoaded: true });
    render(<Sidebar />);
    expect(screen.queryByLabelText("Mostrar archivos de contexto")).not.toBeInTheDocument();
  });

  it("invites creating the first space when the tree is empty", () => {
    useApp.setState({ tree: [], treeLoaded: true });
    render(<Sidebar />);
    expect(screen.getByText("Crea tu primer espacio")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Espacios y pizarras" })).toBeInTheDocument();
    expect(screen.getByText("Un espacio es un negocio o proyecto. Ahí viven sus pizarras y lo que Claude genere.")).toBeInTheDocument();
    expect(screen.queryByText(/páginas/)).not.toBeInTheDocument();
  });

  it("renders spaces and nested pages from the tree", () => {
    useApp.setState({ tree, treeLoaded: true, expanded: { Ropa: true, "Ropa/Telas": true } });
    render(<Sidebar />);
    expect(screen.getByText("Ropa")).toBeInTheDocument();
    expect(screen.getByText("Telas")).toBeInTheDocument();
    expect(screen.getByText("Algodón")).toBeInTheDocument();
    expect(screen.getByText("Notas")).toBeInTheDocument();
    expect(screen.getByText("Dashboard.html")).toBeInTheDocument();
    expect(screen.getByText("Plan")).toBeInTheDocument();
  });

  it("creates a board from the space's new-board button", async () => {
    mocked.createBoard.mockResolvedValue("Ropa/Ideas.canvas");
    useApp.setState({ tree, treeLoaded: true, expanded: { Ropa: true } });
    render(<Sidebar />);
    expect(screen.queryByRole("button", { name: "Nueva página en Ropa" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nueva pizarra en Ropa" }));
    const input = screen.getByRole("textbox", { name: "Nombre de la pizarra" });
    fireEvent.change(input, { target: { value: "Ideas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(mocked.createBoard).toHaveBeenCalledWith("Ropa", "Ideas"));
    expect(mocked.createPage).not.toHaveBeenCalled();
  });

  it("hides children of collapsed folders", () => {
    useApp.setState({ tree, treeLoaded: true, expanded: { Ropa: true } });
    render(<Sidebar />);
    expect(screen.queryByText("Algodón")).not.toBeInTheDocument();
  });

  it("clicking a page opens it", () => {
    useApp.setState({ tree, treeLoaded: true, expanded: { Ropa: true } });
    render(<Sidebar />);
    fireEvent.click(screen.getByText("Notas"));
    expect(useApp.getState().openPath).toBe("Ropa/Notas.md");
    expect(useApp.getState().activeSpace).toBe("Ropa");
  });

  it("marks the open page as selected", () => {
    useApp.setState({ tree, treeLoaded: true, expanded: { Ropa: true }, openPath: "Ropa/Notas.md" });
    render(<Sidebar />);
    expect(screen.getByText("Notas").closest("[role=treeitem]")).toHaveAttribute("aria-selected", "true");
  });

  it("creates a space from the inline input", async () => {
    mocked.createSpace.mockResolvedValue("Ropa");
    useApp.setState({ tree: [], treeLoaded: true });
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Nuevo espacio" }));
    const input = screen.getByRole("textbox", { name: "Nombre del espacio" });
    fireEvent.change(input, { target: { value: "Ropa" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(mocked.createSpace).toHaveBeenCalledWith("Ropa"));
  });

  it("asks for confirmation before deleting and then trashes", async () => {
    mocked.deleteEntry.mockResolvedValue(undefined);
    useApp.setState({ tree, treeLoaded: true, expanded: { Ropa: true } });
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Eliminar Notas" }));
    expect(screen.getByText(/Se moverá a la papelera/)).toBeInTheDocument();
    expect(mocked.deleteEntry).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Mover a la papelera" }));
    await vi.waitFor(() => expect(mocked.deleteEntry).toHaveBeenCalledWith("Ropa/Notas.md"));
  });

  it("renames inline and keeps the typed name", async () => {
    mocked.renameEntry.mockResolvedValue("Ropa/Ideas.md");
    useApp.setState({ tree, treeLoaded: true, expanded: { Ropa: true } });
    render(<Sidebar />);
    fireEvent.click(screen.getByRole("button", { name: "Renombrar Notas" }));
    const input = screen.getByRole("textbox", { name: "Nuevo nombre" });
    expect(input).toHaveValue("Notas");
    fireEvent.change(input, { target: { value: "Ideas" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await vi.waitFor(() => expect(mocked.renameEntry).toHaveBeenCalledWith("Ropa/Notas.md", "Ideas"));
  });
});

describe("Sidebar drag", () => {
  it("only image rows are draggable and carry their path", () => {
    useApp.setState({
      tree: [{ ...tree[0], children: [...tree[0].children, file("Ropa/adjuntos/codigo.png")] }],
      treeLoaded: true,
      expanded: { Ropa: true },
    });
    render(<Sidebar />);
    const img = screen.getByText("codigo.png").closest(".tree-row")!;
    expect(img).toHaveAttribute("draggable", "true");
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), effectAllowed: "" };
    fireEvent.dragStart(img, { dataTransfer });
    expect(data[TREE_PATH_MIME]).toBe("Ropa/adjuntos/codigo.png");
    expect(dataTransfer.effectAllowed).toBe("copyLink");
    expect(screen.getByText("Notas").closest(".tree-row")).not.toHaveAttribute("draggable");
    expect(screen.getByText("Telas").closest(".tree-row")).not.toHaveAttribute("draggable");
  });
});
