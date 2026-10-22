import { useApp } from "../../store/app";
import type { MenuItem } from "./CardMenu";

/** The shared "show CLAUDE.md files and Imágenes folders" menu entry (state lives in the store). */
export function useContextFilesItem(): MenuItem {
  const show = useApp((s) => s.showContextFiles);
  const set = useApp((s) => s.setShowContextFiles);
  return { label: "Mostrar archivos de contexto e imágenes", checked: show, onSelect: () => set(!show) };
}
