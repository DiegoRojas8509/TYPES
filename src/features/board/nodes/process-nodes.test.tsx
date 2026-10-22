import { fireEvent, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, useApp } from "../../../store/app";
import { toFlowNode } from "../boardModel";
import { board, isKnown, make, update } from "./dataTestKit";
import { DecisionNode } from "./DecisionNode";
import { flowNodeTypes, nodeTypes } from "./index";
import { TimelineNode } from "./TimelineNode";

let errors: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  update.mockReset();
  useApp.setState({ ...initialState(), settings: { workspaceRoot: "/Users/d/TYPES-espacios", claudePath: null } });
  errors = [vi.spyOn(console, "error"), vi.spyOn(console, "warn")];
});
afterEach(() => {
  vi.useRealTimers();
  for (const spy of errors) {
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  }
});

const titleInput = (c: HTMLElement) => c.querySelector(".block-title input") as HTMLInputElement;
const rows = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("li.tl-item")];
const focusables = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("input, textarea, button")];

describe("registry", () => {
  it("registers timeline and decision, and boardModel maps those canvas types to them", () => {
    expect(nodeTypes.timeline).toBe(TimelineNode);
    expect(nodeTypes.decision).toBe(DecisionNode);
    expect(flowNodeTypes.timeline).toBe(TimelineNode);
    expect(flowNodeTypes.decision).toBe(DecisionNode);
    expect(toFlowNode(make({ type: "timeline" }), isKnown).type).toBe("timeline");
    expect(toFlowNode(make({ type: "decision" }), isKnown).type).toBe("decision");
  });
});

describe("TimelineNode", () => {
  const items = () => [
    { date: "2026-10-01", title: "Muestra lista", detail: "Con botones", status: "hecho", extra: { k: 1 } },
    { date: "octubre", title: "Cortar tela", status: "en curso" },
    { date: "2026-11", title: "Enviar", status: "pendiente" },
  ];
  const timeline = (extra: Record<string, unknown> = {}) => make({ type: "timeline", title: "Avances", items: items(), ...extra });
  const input = (c: HTMLElement, label: string) => c.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;

  it("renders the title and the items in stored order with their dates as stored", () => {
    const { container } = render(board(timeline()));
    expect(titleInput(container).value).toBe("Avances");
    expect(rows(container).map((li) => (li.querySelector(".tl-title") as HTMLInputElement).value)).toEqual(["Muestra lista", "Cortar tela", "Enviar"]);
    expect(input(container, "Fecha del avance 2").value).toBe("octubre");
    expect(input(container, "Detalle del avance 1").value).toBe("Con botones");
    expect(container.textContent).toContain("1 de 3 hechos");
  });

  it("an empty title shows the 'Línea de tiempo' placeholder and a change calls update(id, { title })", () => {
    const { container } = render(board(timeline({ title: undefined })));
    expect(titleInput(container).placeholder).toBe("Línea de tiempo");
    expect(titleInput(container)).toHaveAccessibleName("Título de la línea de tiempo");
    fireEvent.change(titleInput(container), { target: { value: "Producción" } });
    expect(update).toHaveBeenCalledWith("n1", { title: "Producción" });
  });

  it("states the status of each item in more than color: the checked radio carries its name", () => {
    const { container } = render(board(timeline()));
    const [a, b, c] = rows(container);
    expect(within(a).getByRole("radio", { name: "Hecho" })).toBeChecked();
    expect(within(b).getByRole("radio", { name: "En curso" })).toBeChecked();
    expect(within(c).getByRole("radio", { name: "Pendiente" })).toBeChecked();
    expect(a.dataset.status).toBe("hecho");
    expect(b.dataset.status).toBe("en curso");
    expect(c.dataset.status).toBe("pendiente");
  });

  it("'+ avance' appends a pendiente item stamped with today's date and keeps the rest", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14, 12, 0));
    const node = timeline();
    const original = JSON.parse(JSON.stringify(node));
    const { getByRole } = render(board(node));
    fireEvent.click(getByRole("button", { name: "+ avance" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("n1", { items: [...items(), { date: "2026-10-14", title: "", status: "pendiente" }] });
    expect(update.mock.calls[0][1].items).not.toBe(node.items);
    expect(node).toEqual(original);
  });

  it("choosing another status writes exactly that status and only on that item", () => {
    const { container } = render(board(timeline()));
    fireEvent.click(within(rows(container)[2]).getByRole("radio", { name: "En curso" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("n1", { items: [items()[0], items()[1], { date: "2026-11", title: "Enviar", status: "en curso" }] });
    fireEvent.click(within(rows(container)[1]).getByRole("radio", { name: "Hecho" }));
    expect(update.mock.calls[1][1].items[1].status).toBe("hecho");
    fireEvent.click(within(rows(container)[0]).getByRole("radio", { name: "Pendiente" }));
    expect(update.mock.calls[2][1].items[0]).toEqual({ ...items()[0], status: "pendiente" });
  });

  it("clicking the status the item already has writes nothing", () => {
    const { container } = render(board(timeline()));
    fireEvent.click(within(rows(container)[0]).getByRole("radio", { name: "Hecho" }));
    expect(update).not.toHaveBeenCalled();
  });

  it("an unknown status is shown as text and survives unrelated edits; choosing one writes a valid status", () => {
    const odd = [{ date: "hoy", title: "Algo", status: "bloqueado", owner: "Diego" }, { title: "Otro", status: "hecho" }];
    const { container } = render(board(timeline({ items: odd })));
    expect(rows(container)[0].textContent).toContain("«bloqueado»");
    expect(rows(container)[0].dataset.status).toBe("desconocido");
    for (const r of within(rows(container)[0]).getAllByRole("radio")) expect(r).not.toBeChecked();
    fireEvent.change(input(container, "Título del avance 2"), { target: { value: "Otro 2" } });
    expect(update).toHaveBeenLastCalledWith("n1", { items: [odd[0], { title: "Otro 2", status: "hecho" }] });
    fireEvent.click(within(rows(container)[0]).getByRole("radio", { name: "En curso" }));
    expect(update).toHaveBeenLastCalledWith("n1", { items: [{ date: "hoy", title: "Algo", status: "en curso", owner: "Diego" }, odd[1]] });
  });

  it("editing date, title and detail patches only that item and keeps its extra fields", () => {
    const { container } = render(board(timeline()));
    fireEvent.change(input(container, "Fecha del avance 1"), { target: { value: "2026-10-02" } });
    expect(update).toHaveBeenLastCalledWith("n1", { items: [{ ...items()[0], date: "2026-10-02" }, items()[1], items()[2]] });
    fireEvent.change(input(container, "Título del avance 1"), { target: { value: "Muestra 2" } });
    expect(update).toHaveBeenLastCalledWith("n1", { items: [{ ...items()[0], title: "Muestra 2" }, items()[1], items()[2]] });
    fireEvent.change(input(container, "Detalle del avance 2"), { target: { value: "Faltan 3 m" } });
    expect(update).toHaveBeenLastCalledWith("n1", { items: [items()[0], { ...items()[1], detail: "Faltan 3 m" }, items()[2]] });
  });

  it("deletes an item and moves items up and down, writing the same items in the new order", () => {
    const { getByRole } = render(board(timeline()));
    fireEvent.click(getByRole("button", { name: "Eliminar avance «Cortar tela»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { items: [items()[0], items()[2]] });
    fireEvent.click(getByRole("button", { name: "Subir avance «Cortar tela»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { items: [items()[1], items()[0], items()[2]] });
    fireEvent.click(getByRole("button", { name: "Bajar avance «Cortar tela»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { items: [items()[0], items()[2], items()[1]] });
  });

  it("the first item cannot move up and the last cannot move down", () => {
    const { getByRole } = render(board(timeline()));
    expect(getByRole("button", { name: "Subir avance «Muestra lista»" })).toBeDisabled();
    expect(getByRole("button", { name: "Bajar avance «Enviar»" })).toBeDisabled();
    fireEvent.click(getByRole("button", { name: "Subir avance «Muestra lista»" }));
    expect(update).not.toHaveBeenCalled();
  });

  it("every control is a tab stop and the buttons say what they act on", () => {
    const { container, getByRole } = render(board(timeline({ items: [{ title: "Muestra lista" }, { title: "" }] })));
    for (const name of ["Eliminar avance «Muestra lista»", "Eliminar avance 2", "Subir avance 2", "Bajar avance «Muestra lista»", "+ avance"]) {
      expect(getByRole("button", { name })).not.toHaveAttribute("tabindex");
    }
    expect(container.querySelector("[tabindex='-1']")).toBeNull();
  });

  it("keeps inputs out of React Flow's drag and pan", () => {
    const { container } = render(board(timeline()));
    expect(input(container, "Título del avance 1").closest(".nodrag.nopan")).not.toBeNull();
    expect(titleInput(container).className).toContain("nodrag");
  });

  it("renders malformed items without throwing; an edit rebuilds only the touched one", () => {
    const odd = ["Texto suelto", null, 5, { status: "raro" }, {}];
    const { container } = render(board(make({ type: "timeline", items: odd })));
    expect(rows(container)).toHaveLength(5);
    expect(input(container, "Título del avance 1").value).toBe("Texto suelto");
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(input(container, "Fecha del avance 1"), { target: { value: "hoy" } });
    expect(update).toHaveBeenLastCalledWith("n1", { items: [{ date: "hoy", title: "Texto suelto", status: "pendiente" }, null, 5, { status: "raro" }, {}] });
  });

  it("renders a node with no items, or with items that is not a list", () => {
    const empty = render(board(make({ type: "timeline" })));
    expect(rows(empty.container)).toHaveLength(0);
    empty.unmount();
    const bad = render(board(make({ type: "timeline", items: "nada" })));
    expect(rows(bad.container)).toHaveLength(0);
    fireEvent.click(bad.getByRole("button", { name: "+ avance" }));
    expect(update.mock.calls[0][1].items).toHaveLength(1);
  });

  it("never calls update on mount, select, focus or blur without a change", () => {
    const { container, rerender } = render(board(timeline()));
    rerender(board(timeline(), true));
    for (const el of focusables(container)) {
      fireEvent.focus(el);
      fireEvent.blur(el);
    }
    fireEvent.click(input(container, "Título del avance 1"));
    expect(update).not.toHaveBeenCalled();
  });
});
