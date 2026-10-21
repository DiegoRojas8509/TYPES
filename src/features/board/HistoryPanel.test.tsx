import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CanvasNode } from "../../lib/canvas";
import { useChats } from "../chat/conversations";
import { initialChat } from "../chat/reducer";
import { CleanButton, cleanPrompt } from "./CleanButton";
import { HistoryPanel } from "./HistoryPanel";

const base = { x: 0, y: 0, width: 10, height: 10 };
const HOSTILE = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
const nodes: CanvasNode[] = [
  { id: "v", type: "text", ...base, text: "visible" },
  { id: "a", type: "text", ...base, text: "# Costo viejo\nlinea", archived: { at: "2026-10-01", reason: "reemplazado por el nuevo", by: "claude" } },
  { id: "b", type: "table", ...base, title: HOSTILE, archived: { at: "2026-10-03", reason: HOSTILE, by: "tu" } },
];
const restore = vi.fn();
const mount = (props: Partial<React.ComponentProps<typeof HistoryPanel>> = {}) =>
  render(<HistoryPanel path="Ropa/Plan.canvas" nodes={nodes} editable onRestore={restore} {...props} />);
const toggle = () => screen.getByRole("button", { name: /^Historial/ });

beforeEach(() => {
  restore.mockClear();
  useChats.setState({ conversations: {}, send: vi.fn().mockResolvedValue(true) });
});

describe("HistoryPanel", () => {
  it("shows «Historial (N)» with the number of valid archived nodes and opens a labelled panel", () => {
    mount();
    expect(toggle()).toHaveTextContent("Historial (2)");
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByRole("complementary", { name: "Historial" })).toBeInTheDocument();
  });

  it("lists newest first with title, snippet, date, reason and author", () => {
    mount();
    fireEvent.click(toggle());
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("archivado el 2026-10-03");
    expect(items[0]).toHaveTextContent("tú");
    expect(items[1]).toHaveTextContent("Costo viejo");
    expect(items[1]).toHaveTextContent("archivado el 2026-10-01 · reemplazado por el nuevo · Claude");
  });

  it("renders hostile content as literal text, never as markup", () => {
    const { container } = mount();
    fireEvent.click(toggle());
    expect(container.querySelector("img, script")).toBeNull();
    expect(screen.getAllByText(new RegExp(HOSTILE.slice(0, 20).replace(/[<>"=]/g, "."))).length).toBeGreaterThan(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("«Restaurar» calls onRestore with the node id", () => {
    mount();
    fireEvent.click(toggle());
    fireEvent.click(within(screen.getAllByRole("listitem")[1]).getByRole("button", { name: /Restaurar/ }));
    expect(restore).toHaveBeenCalledWith("a");
  });

  it("is hidden with no archived nodes, unless the panel is open; then shows the empty state", () => {
    const { rerender } = mount({ nodes: [nodes[0]] });
    expect(screen.queryByRole("button", { name: /^Historial/ })).toBeNull();
    rerender(<HistoryPanel path="Ropa/Plan.canvas" nodes={nodes} editable onRestore={restore} />);
    fireEvent.click(toggle());
    rerender(<HistoryPanel path="Ropa/Plan.canvas" nodes={[nodes[0]]} editable onRestore={restore} />);
    expect(toggle()).toHaveTextContent("Historial (0)");
    expect(screen.getByText("Aún no hay nada archivado.")).toBeInTheDocument();
  });

  it("read-only lists entries without restore or clean buttons", () => {
    mount({ editable: false });
    fireEvent.click(toggle());
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Restaurar/ })).toBeNull();
  });

  it("portals into the host element when given", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    mount({ host });
    fireEvent.click(toggle());
    expect(host.contains(screen.getByRole("complementary", { name: "Historial" }))).toBe(true);
    host.remove();
  });
});

describe("CleanButton", () => {
  const EXACT =
    'Revisa la pizarra "Daring Martin · cálculos" y dime qué bloques archivarías y por qué: datos reemplazados por uno más nuevo, escenarios o suposiciones descartados y bloques repetidos. Haz una lista corta. No cambies nada hasta que yo diga que sí. Cuando apruebe, archívalos agregando el campo "archived" (at, reason, by: "claude") sin borrar nada.';
  const send = vi.fn().mockResolvedValue(true);
  beforeEach(() => {
    send.mockClear();
    useChats.setState({ conversations: {}, send });
  });

  it("builds the exact sentence", () => {
    expect(cleanPrompt("Daring Martin · cálculos")).toBe(EXACT);
  });
  it("sends it through the chat store", () => {
    render(<CleanButton path="Ropa/Daring Martin · cálculos.canvas" editable />);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar con Claude" }));
    expect(send).toHaveBeenCalledWith("Ropa", EXACT, []);
  });
  it("is disabled with a reason while Claude runs, when not editable, and outside a space", () => {
    useChats.setState({ conversations: { Ropa: { ...initialChat(), running: true } } });
    const { rerender } = render(<CleanButton path="Ropa/P.canvas" editable />);
    const b = () => screen.getByRole("button", { name: "Limpiar con Claude" });
    expect(b()).toBeDisabled();
    expect(b()).toHaveAttribute("title", "Claude está trabajando; espera a que termine");
    rerender(<CleanButton path="Ropa/P.canvas" editable={false} />);
    expect(b()).toHaveAttribute("title", "La pizarra no se puede editar");
    rerender(<CleanButton path="P.canvas" editable />);
    expect(b()).toHaveAttribute("title", "La pizarra no está dentro de un espacio");
    fireEvent.click(b());
    expect(send).not.toHaveBeenCalled();
  });
});
