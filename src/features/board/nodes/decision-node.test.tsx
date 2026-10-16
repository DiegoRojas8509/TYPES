import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialState, useApp } from "../../../store/app";
import { board, make, update } from "./dataTestKit";

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

const focusables = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>("input, textarea, button")];

describe("DecisionNode", () => {
  const options = () => [
    { name: "Proveedor A", pros: ["Barato", "Cerca"], cons: ["Lento"], nota: "ojo" },
    { name: "Proveedor B", pros: [], cons: ["Caro"] },
  ];
  const decision = (extra: Record<string, unknown> = {}) => make({ type: "decision", question: "¿Con quién producimos?", options: options(), ...extra });
  const field = (c: HTMLElement, label: string) => c.querySelector(`[aria-label="${label}"]`) as HTMLInputElement;
  const cards = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>(".dc-option")];

  it("renders the question, options, pros and cons, and the rationale", () => {
    const { container } = render(board(decision({ rationale: "Calidad" })));
    expect(field(container, "Pregunta de la decisión").value).toBe("¿Con quién producimos?");
    expect(field(container, "Nombre de la opción 2").value).toBe("Proveedor B");
    expect(field(container, "Punto a favor 2 de la opción 1").value).toBe("Cerca");
    expect(field(container, "Punto en contra 1 de la opción 2").value).toBe("Caro");
    expect(field(container, "Por qué").value).toBe("Calidad");
    expect(container.textContent).toContain("A favor");
    expect(container.textContent).toContain("En contra");
  });

  it("an empty question shows '¿Qué decidimos?' as placeholder; editing calls update(id, { question })", () => {
    const { container } = render(board(decision({ question: undefined })));
    expect(field(container, "Pregunta de la decisión").placeholder).toBe("¿Qué decidimos?");
    fireEvent.change(field(container, "Pregunta de la decisión"), { target: { value: "¿Qué tela?" } });
    expect(update).toHaveBeenCalledWith("n1", { question: "¿Qué tela?" });
  });

  it("'Elegir esta' sets chosen to the option's name and marks only that option", () => {
    const { container, getByRole } = render(board(decision()));
    fireEvent.click(getByRole("button", { name: "Elegir esta opción: «Proveedor B»" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("n1", { chosen: "Proveedor B" });
    expect(cards(container).map((c) => c.dataset.chosen)).toEqual(["false", "false"]);
  });

  it("marks the chosen option with the text 'Elegida' and no other", () => {
    const { container } = render(board(decision({ chosen: "Proveedor B" })));
    const [a, b] = cards(container);
    expect(a.dataset.chosen).toBe("false");
    expect(b.dataset.chosen).toBe("true");
    expect(b.textContent).toContain("Elegida");
    expect(a.textContent).not.toContain("Elegida");
  });

  it("choosing the chosen option again clears the choice (toggle)", () => {
    const { getByRole } = render(board(decision({ chosen: "Proveedor B" })));
    fireEvent.click(getByRole("button", { name: "«Proveedor B» es la opción elegida. Quitar elección" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][1]).toStrictEqual({ chosen: undefined });
  });

  it("renaming the chosen option keeps chosen on the new name, in the same update", () => {
    const { container } = render(board(decision({ chosen: "Proveedor A" })));
    fireEvent.change(field(container, "Nombre de la opción 1"), { target: { value: "Taller A" } });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith("n1", { options: [{ ...options()[0], name: "Taller A" }, options()[1]], chosen: "Taller A" });
  });

  it("emptying the chosen option's name keeps chosen as found; retyping the same name restores the mark", () => {
    const { container, getByText, queryByText, rerender } = render(board(decision({ chosen: "Proveedor A" })));
    fireEvent.change(field(container, "Nombre de la opción 1"), { target: { value: "" } });
    const patch = update.mock.calls[0][1];
    expect("chosen" in patch).toBe(false);
    expect(patch.options[0]).toEqual({ ...options()[0], name: "" });
    // the board applies the patch: chosen is now dangling and says so
    rerender(board(decision({ options: patch.options, chosen: "Proveedor A" })));
    expect(cards(container).map((c) => c.dataset.chosen)).toEqual(["false", "false"]);
    expect(getByText("«Proveedor A» ya no es una opción")).toBeInTheDocument();
    // retyping the same name matches the untouched chosen again
    fireEvent.change(field(container, "Nombre de la opción 1"), { target: { value: "Proveedor A" } });
    expect("chosen" in update.mock.calls[1][1]).toBe(false);
    rerender(board(decision({ options: update.mock.calls[1][1].options, chosen: "Proveedor A" })));
    expect(cards(container).map((c) => c.dataset.chosen)).toEqual(["true", "false"]);
    expect(queryByText("«Proveedor A» ya no es una opción")).toBeNull();
  });

  it("renaming the chosen option to a new name still moves chosen with it", () => {
    const { container } = render(board(decision({ chosen: "Proveedor A" })));
    fireEvent.change(field(container, "Nombre de la opción 1"), { target: { value: "Proveedor A2" } });
    expect(update.mock.calls[0][1].chosen).toBe("Proveedor A2");
  });

  it("duplicate names: renaming one leaves chosen on the sibling, which stays marked", () => {
    const dup = [{ name: "A", pros: [], cons: [] }, { name: "A", pros: [], cons: [] }];
    const { container, rerender } = render(board(decision({ options: dup, chosen: "A" })));
    expect(container.textContent).toContain("Hay opciones con el mismo nombre");
    fireEvent.change(field(container, "Nombre de la opción 1"), { target: { value: "A2" } });
    const patch = update.mock.calls[0][1];
    expect("chosen" in patch).toBe(false);
    rerender(board(decision({ options: patch.options, chosen: "A" })));
    const [first, second] = cards(container);
    expect(first.dataset.chosen).toBe("false");
    expect(first.textContent).not.toContain("Elegida");
    expect(second.dataset.chosen).toBe("true");
    expect(second.textContent).toContain("Elegida");
    expect(container.textContent).not.toContain("Hay opciones con el mismo nombre");
  });

  it("renaming another option does not touch chosen", () => {
    const { container } = render(board(decision({ chosen: "Proveedor A" })));
    fireEvent.change(field(container, "Nombre de la opción 2"), { target: { value: "Taller B" } });
    const patch = update.mock.calls[0][1];
    expect("chosen" in patch).toBe(false);
    expect(patch.options[1]).toEqual({ name: "Taller B", pros: [], cons: ["Caro"] });
  });

  it("a chosen that names no option renders normally, marks nothing, hints, and survives unrelated edits", () => {
    const node = decision({ chosen: "Proveedor Z" });
    const { container, getByText } = render(board(node));
    expect(cards(container).map((c) => c.dataset.chosen)).toEqual(["false", "false"]);
    expect(getByText("«Proveedor Z» ya no es una opción")).toBeInTheDocument();
    fireEvent.change(field(container, "Por qué"), { target: { value: "x" } });
    expect(update).toHaveBeenLastCalledWith("n1", { rationale: "x" });
    fireEvent.change(field(container, "Nombre de la opción 1"), { target: { value: "Q" } });
    expect("chosen" in update.mock.calls[1][1]).toBe(false);
  });

  it("duplicate names: choosing marks all of them and a hint says so", () => {
    const dup = [{ name: "A", pros: [], cons: [] }, { name: "A", pros: [], cons: [] }, { name: "B", pros: [], cons: [] }];
    const { container } = render(board(decision({ options: dup, chosen: "A" })));
    expect(cards(container).map((c) => c.dataset.chosen)).toEqual(["true", "true", "false"]);
    expect(container.textContent).toContain("Hay opciones con el mismo nombre: «A»");
  });

  it("an option without a name cannot be chosen", () => {
    const { getByRole } = render(board(decision({ options: [{ name: "", pros: [], cons: [] }] })));
    const btn = getByRole("button", { name: "Elegir esta opción 1" });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(update).not.toHaveBeenCalled();
  });

  it("the rationale edit calls update(id, { rationale })", () => {
    const { container } = render(board(decision()));
    fireEvent.change(field(container, "Por qué"), { target: { value: "Entrega en 2 semanas" } });
    expect(update).toHaveBeenCalledWith("n1", { rationale: "Entrega en 2 semanas" });
  });

  it("'+ opción' appends 'Opción N' with empty lists; deleting an option writes the rest", () => {
    const node = decision();
    const original = JSON.parse(JSON.stringify(node));
    const { getByRole } = render(board(node));
    fireEvent.click(getByRole("button", { name: "+ opción" }));
    expect(update).toHaveBeenLastCalledWith("n1", { options: [...options(), { name: "Opción 3", pros: [], cons: [] }] });
    fireEvent.click(getByRole("button", { name: "Eliminar opción «Proveedor A»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { options: [options()[1]] });
    expect(node).toEqual(original);
  });

  it("deleting the chosen option clears chosen", () => {
    const { getByRole } = render(board(decision({ chosen: "Proveedor A" })));
    fireEvent.click(getByRole("button", { name: "Eliminar opción «Proveedor A»" }));
    expect(update.mock.calls[0][1]).toStrictEqual({ options: [options()[1]], chosen: undefined });
  });

  it("adds, edits and deletes pros and cons, keeping extra fields of the option", () => {
    const { container, getByRole } = render(board(decision()));
    fireEvent.click(getByRole("button", { name: "+ a favor (opción 2)" }));
    expect(update).toHaveBeenLastCalledWith("n1", { options: [options()[0], { name: "Proveedor B", pros: [""], cons: ["Caro"] }] });
    fireEvent.click(getByRole("button", { name: "+ en contra (opción 1)" }));
    expect(update).toHaveBeenLastCalledWith("n1", { options: [{ ...options()[0], cons: ["Lento", ""] }, options()[1]] });
    fireEvent.change(field(container, "Punto a favor 1 de la opción 1"), { target: { value: "Muy barato" } });
    expect(update).toHaveBeenLastCalledWith("n1", { options: [{ ...options()[0], pros: ["Muy barato", "Cerca"] }, options()[1]] });
    fireEvent.click(getByRole("button", { name: "Eliminar punto a favor «Cerca»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { options: [{ ...options()[0], pros: ["Barato"] }, options()[1]] });
    fireEvent.click(getByRole("button", { name: "Eliminar punto en contra «Caro»" }));
    expect(update).toHaveBeenLastCalledWith("n1", { options: [options()[0], { name: "Proveedor B", pros: [], cons: [] }] });
  });

  it("every control is a tab stop with a Spanish name", () => {
    const { container, getByRole } = render(board(decision({ options: [{ name: "A", pros: [""], cons: [] }] })));
    for (const name of ["Eliminar opción «A»", "Eliminar punto a favor 1", "+ a favor (opción 1)", "+ en contra (opción 1)", "+ opción"]) {
      expect(getByRole("button", { name })).not.toHaveAttribute("tabindex");
    }
    expect(container.querySelector("[tabindex='-1']")).toBeNull();
  });

  it("keeps inputs out of React Flow's drag and pan", () => {
    const { container } = render(board(decision()));
    expect(field(container, "Nombre de la opción 1").closest(".nodrag.nopan")).not.toBeNull();
    expect(field(container, "Por qué").closest(".nodrag.nopan")).not.toBeNull();
  });

  it("renders malformed options without throwing", () => {
    const odd = ["Solo nombre", null, { name: "X", pros: "mal", cons: [1, null] }, { name: "X" }];
    const { container } = render(board(decision({ options: odd, chosen: 3 })));
    expect(cards(container)).toHaveLength(4);
    expect(field(container, "Nombre de la opción 1").value).toBe("Solo nombre");
    expect(update).not.toHaveBeenCalled();
    fireEvent.change(field(container, "Nombre de la opción 2"), { target: { value: "Nueva" } });
    expect(update.mock.calls[0][1].options).toEqual(["Solo nombre", { name: "Nueva", pros: [], cons: [] }, odd[2], odd[3]]);
  });

  it("renders a node with no options at all, and with options that is not a list", () => {
    const empty = render(board(make({ type: "decision" })));
    expect(cards(empty.container)).toHaveLength(0);
    empty.unmount();
    const bad = render(board(make({ type: "decision", options: { a: 1 } })));
    fireEvent.click(bad.getByRole("button", { name: "+ opción" }));
    expect(update).toHaveBeenCalledWith("n1", { options: [{ name: "Opción 1", pros: [], cons: [] }] });
  });

  it("never calls update on mount, select, focus or blur without a change", () => {
    const { container, rerender } = render(board(decision({ chosen: "Proveedor A" })));
    rerender(board(decision({ chosen: "Proveedor A" }), true));
    for (const el of focusables(container)) {
      fireEvent.focus(el);
      fireEvent.blur(el);
    }
    fireEvent.click(field(container, "Por qué"));
    expect(update).not.toHaveBeenCalled();
  });
});
