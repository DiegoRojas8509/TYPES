import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { archive, board, make, restore } from "./dataTestKit";

const note = make({ type: "table", title: "Telas" });

beforeEach(() => {
  archive.mockClear();
  restore.mockClear();
});

describe("block «Archivar» control", () => {
  it("is a keyboard-reachable button named after the block, and opening nothing writes", () => {
    render(board(note));
    const b = screen.getByRole("button", { name: "Archivar «Telas»" });
    expect(b.tagName).toBe("BUTTON");
    expect(archive).not.toHaveBeenCalled();
  });

  it("asks a reason inline; Enter confirms with the typed reason", () => {
    render(board(note));
    fireEvent.click(screen.getByRole("button", { name: "Archivar «Telas»" }));
    const input = screen.getByPlaceholderText("¿Por qué se archiva? (opcional)");
    expect(input).toHaveFocus();
    expect(archive).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "ya no aplica" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(archive).toHaveBeenCalledWith("n1", "ya no aplica");
    expect(screen.queryByPlaceholderText("¿Por qué se archiva? (opcional)")).toBeNull();
  });

  it("Enter with no reason still archives (the action supplies «archivado a mano»)", () => {
    render(board(note));
    fireEvent.click(screen.getByRole("button", { name: "Archivar «Telas»" }));
    fireEvent.keyDown(screen.getByPlaceholderText("¿Por qué se archiva? (opcional)"), { key: "Enter" });
    expect(archive).toHaveBeenCalledWith("n1", "");
  });

  it("Escape cancels without archiving and brings the button back", () => {
    render(board(note));
    fireEvent.click(screen.getByRole("button", { name: "Archivar «Telas»" }));
    const input = screen.getByPlaceholderText("¿Por qué se archiva? (opcional)");
    fireEvent.change(input, { target: { value: "x" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Archivar «Telas»" })).toBeInTheDocument();
  });

  it("returns focus to the «Archivar» button after Enter and Escape", () => {
    render(board(note));
    for (const key of ["Enter", "Escape"]) {
      fireEvent.click(screen.getByRole("button", { name: "Archivar «Telas»" }));
      fireEvent.keyDown(screen.getByPlaceholderText("¿Por qué se archiva? (opcional)"), { key });
      expect(screen.getByRole("button", { name: "Archivar «Telas»" })).toHaveFocus();
    }
  });

  it("blur with text keeps the input open and nothing is archived", () => {
    render(board(note));
    fireEvent.click(screen.getByRole("button", { name: "Archivar «Telas»" }));
    const input = screen.getByPlaceholderText("¿Por qué se archiva? (opcional)");
    fireEvent.change(input, { target: { value: "algo" } });
    fireEvent.blur(input);
    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("¿Por qué se archiva? (opcional)")).toHaveValue("algo");
  });

  it("blur with empty text closes the input without archiving", () => {
    render(board(note));
    fireEvent.click(screen.getByRole("button", { name: "Archivar «Telas»" }));
    fireEvent.blur(screen.getByPlaceholderText("¿Por qué se archiva? (opcional)"));
    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Archivar «Telas»" })).toBeInTheDocument();
  });

  it("is absent in read-only mode", () => {
    render(board(note, false, undefined, true));
    expect(screen.queryByRole("button", { name: /Archivar/ })).toBeNull();
  });
});
