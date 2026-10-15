import { act, fireEvent, render, screen } from "@testing-library/react";
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

import { api, openWithDefaultApp } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { DocumentPane } from "../editor/DocumentPane";
import { HtmlViewer } from "./HtmlViewer";
import { ImageViewer } from "./ImageViewer";
import { COALESCE_MS } from "./useFileVersion";

const ROOT = "/Users/d/TYPES-espacios";
let disk = "<h1>v1</h1>";
let seq = 0;

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
async function fsChanged(...paths: string[]) {
  act(() => useApp.setState({ fsChange: { seq: ++seq, paths } }));
}
function frame(container: HTMLElement) {
  return container.querySelector("iframe") as HTMLIFrameElement;
}

beforeEach(() => {
  vi.useFakeTimers();
  disk = "<h1>v1</h1>";
  useApp.setState({ ...initialState(), settings: { workspaceRoot: ROOT, claudePath: null } });
  vi.mocked(api.readText)
    .mockReset()
    .mockImplementation(async () => disk);
  vi.mocked(openWithDefaultApp).mockClear();
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
    expect(frame(r.container)).toBeInTheDocument();
    r.unmount();

    r = await show("Ropa/adjuntos/a.png");
    expect(r.container.querySelector(".image-stage")).toBeInTheDocument();
    r.unmount();

    r = await show("Ropa/precios.csv");
    expect(screen.getByRole("button", { name: "Abrir con la app predeterminada" })).toBeInTheDocument();
    expect(r.container.querySelector("iframe")).toBeNull();
  });
});

describe("FileFallback", () => {
  it("opens_other_files_with_default_app", () => {
    act(() => useApp.setState({ openPath: "Ropa/precios.csv" }));
    render(<DocumentPane />);
    expect(screen.getByRole("heading", { name: "precios.csv" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Abrir con la app predeterminada" }));
    expect(openWithDefaultApp).toHaveBeenCalledWith(`${ROOT}/Ropa/precios.csv`);
  });
});

describe("HtmlViewer", () => {
  it("html_iframe_is_sandboxed_without_same_origin", async () => {
    const { container } = render(<HtmlViewer path="Ropa/dash.html" />);
    await settle();
    const f = frame(container);
    expect(f.getAttribute("sandbox")).toBe("allow-scripts");
    expect(f.hasAttribute("src")).toBe(false);
    expect(f.getAttribute("srcdoc")).toContain("<h1>v1</h1>");
  });

  it("html_viewer_reloads_on_fs_changed", async () => {
    const { container } = render(<HtmlViewer path="Ropa/dash.html" />);
    await settle();
    expect(vi.mocked(api.readText)).toHaveBeenCalledTimes(1);

    disk = "<h1>v2</h1>";
    await fsChanged("Ropa/dash.html");
    // Previous content stays until the new one has been read.
    expect(frame(container).getAttribute("srcdoc")).toContain("v1");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_MS + 1);
    });
    expect(frame(container).getAttribute("srcdoc")).toContain("v2");
  });

  it("ignores_other_files_and_coalesces_bursts", async () => {
    render(<HtmlViewer path="Ropa/dash.html" />);
    await settle();
    await fsChanged("Ropa/otra.md");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(vi.mocked(api.readText)).toHaveBeenCalledTimes(1);

    await fsChanged("Ropa/dash.html");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    await fsChanged("Ropa/dash.html", "Ropa/otra.md");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40);
    });
    await fsChanged("Ropa/otra.md"); // unrelated event must not cancel the pending reload
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(vi.mocked(api.readText)).toHaveBeenCalledTimes(2);
  });

  it("keeps_previous_content_and_shows_message_when_file_disappears", async () => {
    const { container } = render(<HtmlViewer path="Ropa/dash.html" />);
    await settle();
    vi.mocked(api.readText).mockRejectedValueOnce({ kind: "not_found", message: "No se encontró: el archivo." });
    await fsChanged("Ropa/dash.html");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_MS + 1);
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Este archivo ya no existe.");
    expect(frame(container).getAttribute("srcdoc")).toContain("v1");
  });

  it("shows_message_when_first_read_fails_without_crashing", async () => {
    vi.mocked(api.readText).mockRejectedValue({ kind: "invalid", message: "Operación no válida: el archivo no es de texto." });
    const { container } = render(<HtmlViewer path="Ropa/dash.html" />);
    await settle();
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo leer este archivo.");
    expect(container.querySelector("iframe")).toBeNull();
  });

  it("toolbar_reloads_and_opens_with_default_app", async () => {
    render(<HtmlViewer path="Ropa/dash.html" />);
    await settle();
    disk = "<h1>v3</h1>";
    fireEvent.click(screen.getByRole("button", { name: "Recargar" }));
    await settle();
    expect(vi.mocked(api.readText)).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Abrir en el navegador" }));
    expect(openWithDefaultApp).toHaveBeenCalledWith(`${ROOT}/Ropa/dash.html`);
  });

  it("restores_scroll_reported_by_the_frame_after_reload", async () => {
    const { container } = render(<HtmlViewer path="Ropa/dash.html" />);
    await settle();
    act(() => {
      window.dispatchEvent(
        new MessageEvent("message", { data: { typesScroll: [0, 420] }, source: frame(container).contentWindow }),
      );
    });
    disk = "<h1>v2</h1>";
    await fsChanged("Ropa/dash.html");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_MS + 1);
    });
    expect(frame(container).getAttribute("srcdoc")).toContain("var p=[0,420]");
  });
});

describe("ImageViewer", () => {
  class FakeImage {
    static instances: FakeImage[] = [];
    naturalWidth = 640;
    naturalHeight = 480;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private _src = "";
    set src(v: string) {
      this._src = v;
      FakeImage.instances.push(this);
    }
    get src() {
      return this._src;
    }
  }
  beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal("Image", FakeImage);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows_name_dimensions_and_busts_cache_on_change", async () => {
    const { container } = render(<ImageViewer path="Ropa/adjuntos/lino.png" />);
    act(() => FakeImage.instances[0].onload?.());
    expect(screen.getByText("640 × 480 px")).toBeInTheDocument();
    const first = container.querySelector("img")!.getAttribute("src")!;
    expect(first).toContain(encodeURIComponent(`${ROOT}/Ropa/adjuntos/lino.png`));
    expect(first).toMatch(/\?v=0$/);

    await fsChanged("Ropa/adjuntos/lino.png");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(COALESCE_MS + 1);
    });
    // Old image still shown until the new one has loaded.
    expect(container.querySelector("img")!.getAttribute("src")).toBe(first);
    FakeImage.instances[1].naturalWidth = 800;
    act(() => FakeImage.instances[1].onload?.());
    expect(container.querySelector("img")!.getAttribute("src")).toMatch(/\?v=1$/);
    expect(screen.getByText("800 × 480 px")).toBeInTheDocument();
  });

  it("shows_message_when_image_cannot_load", () => {
    render(<ImageViewer path="Ropa/adjuntos/lino.png" />);
    act(() => FakeImage.instances[0].onerror?.());
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudo mostrar la imagen");
  });
});
