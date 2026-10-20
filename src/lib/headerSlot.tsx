// A renderer's controls (save status, buttons) live in the breadcrumb bar when there is one,
// so an open file shows a single header row. Without a slot (a renderer mounted alone) they
// fall back to an inline bar. Neutral module: features import this, never each other.
import { createContext, useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

export const HeaderSlotContext = createContext<HTMLElement | null>(null);

export function useHeaderSlot(): HTMLElement | null {
  return useContext(HeaderSlotContext);
}

export function HeaderControls({ children }: { children: ReactNode }) {
  const slot = useHeaderSlot();
  return slot ? createPortal(children, slot) : <div className="pane-header pane-header-end">{children}</div>;
}
