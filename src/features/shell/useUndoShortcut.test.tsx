import { fireEvent, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  api: { restoreEntry: vi.fn(), listTree: vi.fn().mockResolvedValue([]) },
  onFsChanged: vi.fn(async () => () => {}),
  errorMessage: (e: unknown) => (e as { message?: string }).message ?? "error",
}));

import { api } from "../../lib/api";
import { initialState, useApp } from "../../store/app";
import { useUndoShortcut } from "./useUndoShortcut";

function Host() {
  useUndoShortcut();
  return (
    <div>
      <input aria-label="campo" />
      <textarea aria-label="caja" />
      <div contentEditable suppressContentEditableWarning data-testid="ce">
        <p data-testid="ce-child">texto</p>
      </div>
      <div data-testid="plain" />
    </div>
  );
}

const last = { original: "Ropa/Notas.md", trashed: "/t/Notas.md" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.restoreEntry).mockResolvedValue("Ropa/Notas.md");
  useApp.setState({ ...initialState(), lastDeleted: last });
});

describe("useUndoShortcut", () => {
  it("restores on Cmd+Z outside text fields and prevents the default", () => {
    const { getByTestId } = render(<Host />);
    const notCancelled = fireEvent.keyDown(getByTestId("plain"), { key: "z", metaKey: true });
    expect(notCancelled).toBe(false);
    expect(api.restoreEntry).toHaveBeenCalledWith("Ropa/Notas.md", "/t/Notas.md");
  });

  it("restores on Ctrl+Z with an uppercase key", () => {
    render(<Host />);
    fireEvent.keyDown(document.body, { key: "Z", ctrlKey: true });
    expect(api.restoreEntry).toHaveBeenCalledTimes(1);
  });

  it.each([["campo"], ["caja"]])("leaves text undo alone inside %s", (label) => {
    const { getByLabelText } = render(<Host />);
    const notCancelled = fireEvent.keyDown(getByLabelText(label), { key: "z", metaKey: true });
    expect(notCancelled).toBe(true);
    expect(api.restoreEntry).not.toHaveBeenCalled();
  });

  it("leaves text undo alone inside a contenteditable and its children", () => {
    const { getByTestId } = render(<Host />);
    expect(fireEvent.keyDown(getByTestId("ce"), { key: "z", metaKey: true })).toBe(true);
    expect(fireEvent.keyDown(getByTestId("ce-child"), { key: "z", metaKey: true })).toBe(true);
    expect(api.restoreEntry).not.toHaveBeenCalled();
  });

  it("ignores Shift+Z (redo), plain Z and other keys", () => {
    render(<Host />);
    fireEvent.keyDown(document.body, { key: "z", metaKey: true, shiftKey: true });
    fireEvent.keyDown(document.body, { key: "z" });
    fireEvent.keyDown(document.body, { key: "y", metaKey: true });
    expect(api.restoreEntry).not.toHaveBeenCalled();
  });

  it("does nothing without a delete to undo", () => {
    useApp.setState({ lastDeleted: null });
    const { getByTestId } = render(<Host />);
    expect(fireEvent.keyDown(getByTestId("plain"), { key: "z", metaKey: true })).toBe(true);
    expect(api.restoreEntry).not.toHaveBeenCalled();
  });
});
