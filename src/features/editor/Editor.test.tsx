import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    api: { ...actual.api, readText: vi.fn(), writeText: vi.fn(), saveAttachment: vi.fn() },
    assetUrl: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
  };
});

import { api } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { MarkdownEditor } from "./Editor";

const PATH = "Ropa/Telas.md";
const PAGE = "# Telas\n\n| Tela | Precio |\n| --- | --- |\n| Lino | 120 |\n\n![Muestra](adjuntos/lino.png)\n";
let disk = PAGE;
let seq = 0;

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  disk = PAGE;
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/Users/d/TYPES-espacios", claudePath: null } });
  vi.mocked(api.readText).mockReset().mockImplementation(async () => disk);
  vi.mocked(api.writeText).mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe("MarkdownEditor (mounted under jsdom)", () => {
  it("shows the page, maps image to an asset url, and never writes on open/close", async () => {
    const { container, unmount } = render(<MarkdownEditor path={PATH} />);
    await settle();
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");
    expect(container.querySelector("h1")).toHaveTextContent("Telas");
    expect(container.querySelector("table")).not.toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      `asset://localhost/${encodeURIComponent("/Users/d/TYPES-espacios/Ropa/adjuntos/lino.png")}`,
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    unmount();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("an_external_reload_updates_the_view_and_is_not_treated_as_an_edit", async () => {
    const { container, unmount } = render(<MarkdownEditor path={PATH} />);
    await settle();
    disk = "# Telas\n\nClaude escribió esto\n";
    await act(async () => {
      useApp.setState({ fsChange: { seq: ++seq, paths: [PATH] } });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain("Claude escribió esto");
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    unmount();
    expect(api.writeText).not.toHaveBeenCalled();
  });

  it("a_real_edit_marks_dirty_and_autosaves_the_serialized_markdown", async () => {
    const { container, unmount } = render(<MarkdownEditor path={PATH} />);
    await settle();
    // Tiptap exposes the editor on its DOM node; dispatch as a keystroke would.
    const editor = (container.querySelector(".ProseMirror") as unknown as { editor: import("@tiptap/core").Editor }).editor;
    await act(async () => {
      editor.view.dispatch(editor.state.tr.insertText("Nuevo ", 1));
    });
    expect(screen.getByRole("status")).toHaveTextContent("Sin guardar");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    expect(api.writeText).toHaveBeenCalledTimes(1);
    const [path, written] = vi.mocked(api.writeText).mock.calls[0];
    expect(path).toBe(PATH);
    expect(written).toContain("# Nuevo Telas");
    expect(written).toContain("![Muestra](adjuntos/lino.png)"); // relative on disk, not the asset url
    expect(written).not.toContain("asset:");
    expect(screen.getByRole("status")).toHaveTextContent("Guardado");
    unmount();
  });

  it("a_page_with_html_blocks_opens_read_only_until_he_insists", async () => {
    disk = "<details>\n<summary>x</summary>\n</details>\n\ntexto\n";
    const { container } = render(<MarkdownEditor path={PATH} />);
    await settle();
    expect(container.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("false");
    expect(screen.getByRole("note")).toHaveTextContent("bloques HTML");
    await act(async () => {
      screen.getByRole("button", { name: "Editar de todos modos" }).click();
    });
    expect(container.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("true");
  });

  it("a_missing_file_shows_a_calm_message", async () => {
    vi.mocked(api.readText).mockRejectedValue({ kind: "NotFound", message: "x" });
    render(<MarkdownEditor path={PATH} />);
    await settle();
    expect(screen.getByText("No se puede mostrar esta página")).toBeInTheDocument();
    expect(screen.getByText(/No pude abrir esta página/)).toBeInTheDocument();
  });
});
