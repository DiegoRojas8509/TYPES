import { create } from "zustand";

export type SidePanelId = "history" | "images";

/** Which right-hand board panel is open. One at a time: opening one closes the other. */
export const useSidePanel = create<{ open: SidePanelId | null; toggle(id: SidePanelId): void }>((set) => ({
  open: null,
  toggle: (id) => set((s) => ({ open: s.open === id ? null : id })),
}));
