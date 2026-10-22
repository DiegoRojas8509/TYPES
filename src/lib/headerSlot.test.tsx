import { render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { HeaderControls, HeaderSlotContext } from "./headerSlot";

function Host() {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <HeaderSlotContext.Provider value={slot}>
      <div data-testid="bar">
        <span ref={setSlot} />
      </div>
      {slot && (
        <HeaderControls>
          <button>Guardar</button>
        </HeaderControls>
      )}
    </HeaderSlotContext.Provider>
  );
}

describe("HeaderControls", () => {
  it("portals the controls into the slot and adds no bar of its own", () => {
    const { container } = render(<Host />);
    expect(screen.getByTestId("bar")).toContainElement(screen.getByRole("button", { name: "Guardar" }));
    expect(container.querySelector(".pane-header")).toBeNull();
  });

  it("falls back to an inline bar when no slot exists", () => {
    const { container } = render(
      <HeaderControls>
        <button>Guardar</button>
      </HeaderControls>,
    );
    expect(container.querySelector(".pane-header")).toContainElement(screen.getByRole("button", { name: "Guardar" }));
  });
});
