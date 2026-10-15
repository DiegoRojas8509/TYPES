import { act, fireEvent, render } from "@testing-library/react";
import { ReactFlow, ReactFlowProvider, type NodeProps, type NodeTypes } from "@xyflow/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api")>();
  return { ...actual, assetUrl: (p: string) => `asset://localhost/${encodeURIComponent(p)}` };
});

import type { CanvasNode } from "../../../lib/canvas";
import { initialState, useApp } from "../../../store/app";
import { BoardActionsContext, BoardContext } from "../boardActions";
import { toFlowNode, type FlowNode } from "../boardModel";
import { BlockShell, accentOf } from "./BlockShell";
import { flowNodeTypes, nodeTypes } from "./index";

const BOARD = "Ropa/Plan.canvas";
const ROOT = "/Users/d/TYPES-espacios";
const update = vi.fn();

const isKnown = (t: string) => Object.prototype.hasOwnProperty.call(nodeTypes, t);
const make = (extra: Partial<CanvasNode> & { type: string }): CanvasNode => ({
  id: "n1",
  x: 0,
  y: 0,
  width: 300,
  height: 200,
  ...extra,
});

/** Mounts one node the way BoardView does: a real React Flow with the board contexts around it. */
function board(node: CanvasNode, selected = false, types: NodeTypes = flowNodeTypes): ReactElement {
  const flowNode: FlowNode = { ...toFlowNode(node, (t) => Object.prototype.hasOwnProperty.call(types, t)), selected };
  return (
    <BoardContext.Provider value={{ boardPath: BOARD }}>
      <BoardActionsContext.Provider value={{ update }}>
        <ReactFlowProvider>
          <div style={{ width: 800, height: 600 }}>
            <ReactFlow nodes={[flowNode]} edges={[]} nodeTypes={types} />
          </div>
        </ReactFlowProvider>
      </BoardActionsContext.Provider>
    </BoardContext.Provider>
  );
}

type TiptapDom = HTMLElement & { editor: { commands: { insertContent(c: string): boolean }; getMarkdown(): string } };
const prose = (c: HTMLElement) => c.querySelector(".ProseMirror") as TiptapDom;
const title = (c: HTMLElement) => c.querySelector(".block-title")?.textContent;

beforeEach(() => {
  update.mockReset();
  useApp.setState({ ...initialState(), settings: { workspaceRoot: ROOT, claudePath: null } });
});

describe("accentOf", () => {
  it.each(["1", "2", "3", "4", "5", "6"])("maps the JSON Canvas preset %s", (c) => {
    expect(accentOf(c)).toEqual({ preset: c });
  });
  it("accepts hex colours in 3, 6 and 8 digit forms", () => {
    expect(accentOf("#f80")).toEqual({ hex: "#f80" });
    expect(accentOf("#FF8800")).toEqual({ hex: "#FF8800" });
    expect(accentOf("#ff880080")).toEqual({ hex: "#ff880080" });
  });
  it("falls back to neutral for anything else, so nothing odd reaches the CSS", () => {
    for (const c of [undefined, "", "7", "red", "#12", "#ggg", "#fff;x", "url(x)"]) expect(accentOf(c)).toEqual({});
  });
});

describe("BlockShell", () => {
  function shell(props: { selected?: boolean; color?: string }) {
    const types = {
      t: ({ id, selected }: NodeProps) => (
        <BlockShell id={id} selected={props.selected ?? selected} title="Mi título" glyph={<i data-testid="g" />} color={props.color}>
          <p>contenido</p>
        </BlockShell>
      ),
    };
    return board(make({ type: "t" }), false, types);
  }

  it("renders the glyph, the title and the children", () => {
    const { container, getByTestId, getByText } = render(shell({}));
    expect(getByTestId("g").closest(".block-glyph")).not.toBeNull();
    expect(title(container)).toBe("Mi título");
    expect(getByText("contenido")).toBeInTheDocument();
  });

  it("marks the selected state and shows the resize handles only then", () => {
    const off = render(shell({ selected: false }));
    expect(off.container.querySelector(".block")).toHaveAttribute("data-selected", "false");
    expect(off.container.querySelector(".react-flow__resize-control")).toBeNull();
    off.unmount();
    const on = render(shell({ selected: true }));
    expect(on.container.querySelector(".block")).toHaveAttribute("data-selected", "true");
    expect(on.container.querySelector(".react-flow__resize-control")).not.toBeNull();
  });

  it("maps preset colours to a data attribute and hex colours to a custom property", () => {
    const preset = render(shell({ color: "4" }));
    expect(preset.container.querySelector(".block")).toHaveAttribute("data-accent", "4");
    preset.unmount();
    const hex = render(shell({ color: "#ff8800" }));
    const el = hex.container.querySelector(".block") as HTMLElement;
    expect(el).not.toHaveAttribute("data-accent");
    expect(el.style.getPropertyValue("--block-accent")).toBe("#ff8800");
    hex.unmount();
    const none = render(shell({}));
    const neutral = none.container.querySelector(".block") as HTMLElement;
    expect(neutral).not.toHaveAttribute("data-accent");
    expect(neutral.style.getPropertyValue("--block-accent")).toBe("");
  });
});

describe("NoteNode", () => {
  const note = (text: string, extra: Partial<CanvasNode> = {}) => make({ type: "text", text, ...extra });

  it("shows the first # heading as the title and the rest as the body", () => {
    const { container } = render(board(note("# Telas\n\nPrecios por metro\n\n# Otro\n")));
    expect(title(container)).toBe("Telas");
    expect(container.textContent).toContain("Precios por metro");
    expect(update).not.toHaveBeenCalled();
  });

  it("falls back to a generic title when there is no # heading", () => {
    const { container } = render(board(note("Solo texto\n\n## Subtítulo\n")));
    expect(title(container)).toBe("Nota");
  });

  it("ignores a # inside a code fence when deriving the title", () => {
    const { container } = render(board(note("```\n# no soy título\n```\n\n# Real\n")));
    expect(title(container)).toBe("Real");
  });

  it("does not edit on a plain click of an unselected note, and double click starts editing", () => {
    const { container } = render(board(note("# A\n\nhola")));
    const body = container.querySelector(".note-body") as HTMLElement;
    expect(prose(container)).toHaveAttribute("contenteditable", "false");
    fireEvent.pointerDown(body);
    fireEvent.click(body);
    expect(prose(container)).toHaveAttribute("contenteditable", "false");
    fireEvent.doubleClick(body);
    expect(prose(container)).toHaveAttribute("contenteditable", "true");
    expect(body.className).toContain("nodrag");
    expect(body.className).toContain("nowheel");
  });

  it("a click on a note that was already selected starts editing", () => {
    const { container } = render(board(note("# A\n\nhola"), true));
    const body = container.querySelector(".note-body") as HTMLElement;
    fireEvent.pointerDown(body);
    fireEvent.click(body);
    expect(prose(container)).toHaveAttribute("contenteditable", "true");
  });

  it("editing calls update(id, { text }) with the new Markdown", () => {
    const { container } = render(board(note("# A\n\nhola")));
    fireEvent.doubleClick(container.querySelector(".note-body") as HTMLElement);
    act(() => {
      prose(container).editor.commands.insertContent(" mundo");
    });
    expect(update).toHaveBeenCalled();
    const [id, patch] = update.mock.calls[update.mock.calls.length - 1];
    expect(id).toBe("n1");
    expect(Object.keys(patch)).toEqual(["text"]);
    expect(patch.text).toContain("mundo");
    expect(patch.text).toMatch(/^# A/);
  });

  it("an external text change while NOT editing updates the display and writes nothing", () => {
    const { container, rerender } = render(board(note("# A\n\nversión uno")));
    expect(container.textContent).toContain("versión uno");
    rerender(board(note("# B\n\nversión de Claude")));
    expect(title(container)).toBe("B");
    expect(container.textContent).toContain("versión de Claude");
    expect(container.textContent).not.toContain("versión uno");
    expect(update).not.toHaveBeenCalled();
  });

  it("an external change WHILE editing keeps the user's live text", () => {
    const { container, rerender } = render(board(note("# A\n\nhola")));
    fireEvent.doubleClick(container.querySelector(".note-body") as HTMLElement);
    act(() => {
      prose(container).editor.commands.insertContent(" escribiendo");
    });
    rerender(board(note("# A\n\nClaude cambió esto")));
    expect(prose(container).textContent).toContain("escribiendo");
    expect(prose(container).textContent).not.toContain("Claude cambió esto");
  });

  it("applies the accent colour of the node", () => {
    const { container } = render(board(note("# A", { color: "5" })));
    expect(container.querySelector(".block")).toHaveAttribute("data-accent", "5");
  });
});

describe("ImageNode", () => {
  const image = (file: string) => make({ type: "file", file });
  const assetFor = (rel: string) => `asset://localhost/${encodeURIComponent(`${ROOT}/${rel}`)}`;

  it("builds the asset URL from the workspace root and the board folder", () => {
    const { container } = render(board(image("adjuntos/a.png")));
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(assetFor("Ropa/adjuntos/a.png"));
    expect(img.draggable).toBe(false);
    expect(title(container)).toBe("a.png");
  });

  it("resolves ../ paths against the board folder", () => {
    const { container } = render(board(image("../adjuntos/b.png")));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(assetFor("adjuntos/b.png"));
  });

  it("shows 'No encuentro la imagen' with the file name when the image fails to load", () => {
    const { container, getByText } = render(board(image("adjuntos/a.png")));
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    expect(getByText("No encuentro la imagen")).toBeInTheDocument();
    expect(container.querySelector(".image-missing")?.textContent).toContain("a.png");
    expect(container.querySelector("img")).toBeNull();
  });

  it("tries again when the file path changes after a failure", () => {
    const { container, rerender } = render(board(image("adjuntos/a.png")));
    fireEvent.error(container.querySelector("img") as HTMLImageElement);
    rerender(board(image("adjuntos/c.png")));
    expect(container.querySelector("img")?.getAttribute("src")).toBe(assetFor("Ropa/adjuntos/c.png"));
  });

  it("shows the empty-state card when there is no file yet", () => {
    const { container, getByText } = render(board(image("")));
    expect(getByText("Suelta una imagen aquí o pégala")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(title(container)).toBe("Imagen");
  });

  it("never edits the board on its own", () => {
    render(board(image("adjuntos/a.png")));
    expect(update).not.toHaveBeenCalled();
  });
});

describe("GroupNode", () => {
  const group = (label: string) => make({ type: "group", label, width: 520, height: 360 });

  it("shows the label in an input and editing it calls update(id, { label })", () => {
    const { container } = render(board(group("Zona")));
    const input = container.querySelector("input.zone-label") as HTMLInputElement;
    expect(input.value).toBe("Zona");
    fireEvent.change(input, { target: { value: "Telas y avíos" } });
    expect(update).toHaveBeenCalledWith("n1", { label: "Telas y avíos" });
  });

  it("keeps the label input out of React Flow's drag and pan", () => {
    const { container } = render(board(group("Zona")));
    expect(container.querySelector("input.zone-label")?.className).toContain("nodrag");
  });

  it("copes with a missing label", () => {
    const { container } = render(board(make({ type: "group" })));
    expect((container.querySelector("input.zone-label") as HTMLInputElement).value).toBe("");
  });
});

describe("UnknownNode", () => {
  it("shows the type and the preserved-as-is note, and offers no edit controls", () => {
    const node = make({ type: "raro", foo: 1 });
    expect(isKnown("raro")).toBe(false);
    const { container, getByText } = render(board(node));
    expect(getByText("raro")).toBeInTheDocument();
    expect(container.textContent).toContain("Bloque de tipo «raro» no soportado: se conserva sin cambios");
    expect(container.querySelector("input, textarea, button, [contenteditable=true]")).toBeNull();
  });

  it("never calls update, whatever the user does to it", () => {
    const { container } = render(board(make({ type: "raro" }), true));
    const block = container.querySelector(".block") as HTMLElement;
    fireEvent.pointerDown(block);
    fireEvent.click(block);
    fireEvent.doubleClick(block);
    fireEvent.keyDown(block, { key: "Enter" });
    expect(update).not.toHaveBeenCalled();
  });
});

describe("nodeTypes", () => {
  it("registers the four content blocks of this task", () => {
    expect(Object.keys(nodeTypes)).toEqual(expect.arrayContaining(["text", "file", "group", "default"]));
  });
});
