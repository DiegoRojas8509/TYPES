// Long text wraps (textarea fields, nothing cut) and "Ajustar" fits the block. Shared by the
// table, decision and timeline blocks. jsdom has no layout: measurements are stubbed.
import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, useApp } from "../../../store/app";
import { board, make, update } from "./dataTestKit";

let errors: ReturnType<typeof vi.spyOn>[] = [];
const stubbed: [object, string][] = [];
beforeEach(() => {
  update.mockReset();
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/Users/d/TYPES-espacios", claudePath: null } });
  errors = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
});
afterEach(() => {
  for (const [proto, p] of stubbed.splice(0)) delete (proto as Record<string, unknown>)[p];
  for (const spy of errors) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

/** Block 400x300; scroll area 360x200 viewport showing a `w` x `h` content (table too). */
function measure(w: number, h: number) {
  const sizes = (el: HTMLElement, p: string): number => {
    if (el.classList.contains("block")) return p === "offsetWidth" ? 400 : p === "offsetHeight" ? 300 : 0;
    if (el.classList.contains("table-scroll")) return { clientWidth: 360, clientHeight: 200, scrollWidth: w, scrollHeight: h }[p] ?? 0;
    if (el.classList.contains("fit-content")) return { scrollWidth: w, offsetHeight: h }[p] ?? 0;
    if (el.tagName === "TABLE") return { scrollWidth: w, offsetWidth: w, scrollHeight: h, offsetHeight: h }[p] ?? 0;
    return 0;
  };
  for (const p of ["offsetWidth", "offsetHeight", "clientWidth", "clientHeight", "scrollWidth", "scrollHeight"]) {
    Object.defineProperty(HTMLElement.prototype, p, { configurable: true, get(this: HTMLElement) { return sizes(this, p); } });
    stubbed.push([HTMLElement.prototype, p]);
  }
}

const LONG = "Validar la muestra de tela con el proveedor antes de cerrar el precio por pieza y confirmar la fecha de entrega";
const field = (c: HTMLElement, label: string) => c.querySelector(`[aria-label="${label}"]`) as HTMLTextAreaElement;
const fitBtn = (c: HTMLElement) => c.querySelector("button[aria-label='Ajustar el bloque al contenido']") as HTMLButtonElement;

describe("TableNode wrapping and fit", () => {
  const table = () => make({ type: "table", columns: ["Tarea", "Nota"], rows: [[LONG, "x"], ["Hilo", "3"]] });

  it("cells and headers are textareas keeping the whole text, with no maxlength", () => {
    const { container } = render(board(table()));
    const c = field(container, "Fila 1, columna 1");
    expect(c.tagName).toBe("TEXTAREA");
    expect(c.value).toBe(LONG);
    expect(c.hasAttribute("maxlength")).toBe(false);
    expect(field(container, "Encabezado de columna 1").tagName).toBe("TEXTAREA");
    expect(update).not.toHaveBeenCalled();
  });

  it("Shift+Enter keeps the newline in the payload and does not move focus; Enter moves down", () => {
    const { container } = render(board(table()));
    const c = field(container, "Fila 1, columna 1");
    c.focus();
    fireEvent.keyDown(c, { key: "Enter", shiftKey: true });
    expect(document.activeElement).toBe(c);
    fireEvent.change(c, { target: { value: "a\nb" } });
    expect(update).toHaveBeenCalledWith("n1", { columns: ["Tarea", "Nota"], rows: [["a\nb", "x"], ["Hilo", "3"]] });
    fireEvent.keyDown(c, { key: "Enter" });
    expect(document.activeElement).toBe(field(container, "Fila 2, columna 1"));
  });

  it("locked cells stay disabled with their title", () => {
    const { container } = render(board(make({ type: "table", columns: ["A"], rows: [[{ k: 1 }], "raro"] as never })));
    expect(field(container, "Fila 1, columna 1")).toBeDisabled();
    expect(field(container, "Fila 2, columna 1")).toHaveAttribute("title");
  });

  it("auto-resize, focus and blur never write; Ajustar writes only on click, rounded", () => {
    const { container } = render(board(table()));
    measure(700.4, 900);
    const c = field(container, "Fila 1, columna 1");
    fireEvent.focus(c);
    fireEvent.blur(c);
    expect(update).not.toHaveBeenCalled();
    const btn = fitBtn(container);
    expect(btn).toHaveAttribute("title", "Ajustar el bloque al contenido de la tabla");
    fireEvent.click(btn);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("n1", { width: 740, height: 1000 });
  });

  it("Ajustar clamps at 1400 x 1600", () => {
    const { container } = render(board(table()));
    measure(5000, 9000);
    fireEvent.click(fitBtn(container));
    expect(update).toHaveBeenCalledWith("n1", { width: 1400, height: 1600 });
  });
});

describe("shrinking fit (decision and timeline)", () => {
  it.each([
    ["decision", make({ type: "decision", question: "q", options: [] }), "Ajustar el bloque al contenido de la decisión"],
    ["timeline", make({ type: "timeline", items: [] }), "Ajustar el bloque al contenido de la línea de tiempo"],
  ])("%s: shrinks the height, keeps the width when the content is narrower, block-specific title", (_n, node, title) => {
    const { container } = render(board(node));
    expect(fitBtn(container)).toHaveAttribute("title", title);
    measure(200, 100); // content far smaller than the 360x200 viewport
    fireEvent.click(fitBtn(container));
    expect(update).toHaveBeenLastCalledWith("n1", { width: 400, height: 200 }); // 300 - 200 + 100
    measure(200, 10);
    fireEvent.click(fitBtn(container));
    expect(update).toHaveBeenLastCalledWith("n1", { width: 400, height: expect.any(Number) });
    expect(update.mock.lastCall![1].height).toBeGreaterThanOrEqual(110);
  });
});

describe("DecisionNode wrapping and fit", () => {
  const decision = () =>
    make({ type: "decision", question: LONG, rationale: LONG, options: [{ name: LONG, pros: [LONG], cons: ["Caro"] }] });

  it("question, option name, points and rationale are wrapping textareas with intact text", () => {
    const { container } = render(board(decision()));
    for (const l of ["Pregunta de la decisión", "Nombre de la opción 1", "Punto a favor 1 de la opción 1", "Por qué"]) {
      const f = field(container, l);
      expect(f.tagName).toBe("TEXTAREA");
      expect(f.value).toBe(LONG);
      expect(f.hasAttribute("maxlength")).toBe(false);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("editing keeps the payloads; Shift+Enter writes a newline, plain Enter is ignored", () => {
    const { container } = render(board(decision()));
    const p = field(container, "Punto en contra 1 de la opción 1");
    expect(fireEvent.keyDown(p, { key: "Enter" })).toBe(false); // default prevented
    expect(fireEvent.keyDown(p, { key: "Enter", shiftKey: true })).toBe(true);
    fireEvent.change(p, { target: { value: "Caro\nmuy" } });
    expect(update).toHaveBeenCalledWith("n1", { options: [{ name: LONG, pros: [LONG], cons: ["Caro\nmuy"] }] });
    fireEvent.change(field(container, "Pregunta de la decisión"), { target: { value: "otra" } });
    expect(update).toHaveBeenLastCalledWith("n1", { question: "otra" });
  });

  it("Ajustar writes only on click", () => {
    const { container } = render(board(decision()));
    measure(700, 900);
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(fitBtn(container));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("n1", { width: 740, height: 1000 });
    measure(5000, 9000);
    fireEvent.click(fitBtn(container));
    expect(update).toHaveBeenLastCalledWith("n1", { width: 1400, height: 1600 });
  });
});

describe("TimelineNode wrapping and fit", () => {
  const timeline = () => make({ type: "timeline", items: [{ date: "2026-10-14", title: LONG, detail: LONG, status: "hecho" }] });

  it("date, title and detail are wrapping textareas with intact text", () => {
    const { container } = render(board(timeline()));
    expect(field(container, "Fecha del avance 1").value).toBe("2026-10-14");
    for (const l of ["Título del avance 1", "Detalle del avance 1"]) {
      const f = field(container, l);
      expect(f.tagName).toBe("TEXTAREA");
      expect(f.value).toBe(LONG);
      expect(f.hasAttribute("maxlength")).toBe(false);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it("editing keeps the payload", () => {
    const { container } = render(board(timeline()));
    fireEvent.change(field(container, "Título del avance 1"), { target: { value: "x\ny" } });
    expect(update).toHaveBeenCalledWith("n1", { items: [{ date: "2026-10-14", title: "x\ny", detail: LONG, status: "hecho" }] });
  });

  it("Ajustar writes only on click, rounded and clamped", () => {
    const { container } = render(board(timeline()));
    measure(700, 900);
    expect(update).not.toHaveBeenCalled();
    fireEvent.click(fitBtn(container));
    expect(update).toHaveBeenCalledWith("n1", { width: 740, height: 1000 });
    measure(5000, 9000);
    fireEvent.click(fitBtn(container));
    expect(update).toHaveBeenLastCalledWith("n1", { width: 1400, height: 1600 });
  });
});
