// Shared UI state for the memory features: the header button, the context meter and the badge
// open the same dialogs through this store instead of importing each other.
import { create } from "zustand";
import type { ChatState } from "./reducer";

interface MemoryUiState {
  closeOpen: boolean;
  panelOpen: boolean;
  panelFile: string | null;
  /** A close-topic call is in flight (it keeps running even if the dialog is dismissed). */
  closing: boolean;
  /** Bumped when memory may have changed, so badges refetch. */
  tick: number;
  openClose(): void;
  dismissClose(): void;
  openPanel(file?: string): void;
  closePanel(): void;
  setClosing(closing: boolean): void;
  bump(): void;
}

export const useMemoryUi = create<MemoryUiState>((set) => ({
  closeOpen: false,
  panelOpen: false,
  panelFile: null,
  closing: false,
  tick: 0,
  openClose: () => set({ closeOpen: true }),
  dismissClose: () => set({ closeOpen: false }),
  openPanel: (file) => set({ panelOpen: true, panelFile: file ?? null }),
  closePanel: () => set({ panelOpen: false }),
  setClosing: (closing) => set({ closing }),
  bump: () => set((s) => ({ tick: s.tick + 1 })),
}));

export function resetMemoryUiForTests() {
  useMemoryUi.setState({ closeOpen: false, panelOpen: false, panelFile: null, closing: false, tick: 0 });
}

/** Why «Cerrar tema» is unavailable, or null when it can be used. */
export function closeTopicBlocker(conv: Pick<ChatState, "items" | "sessionId" | "running">, closing: boolean): string | null {
  if (closing) return "Ya se está guardando el tema.";
  if (conv.running) return "Espera a que Claude termine de responder.";
  if (!conv.items.length && !conv.sessionId) return "Aún no hay una conversación que cerrar.";
  if (!conv.sessionId) return "Esta conversación todavía no tiene sesión de Claude que guardar.";
  return null;
}

export function fileTitle(file: string): string {
  return file.replace(/^cronista-/, "").replace(/\.md$/, "");
}
