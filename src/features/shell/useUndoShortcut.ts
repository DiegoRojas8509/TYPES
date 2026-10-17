// Cmd+Z (macOS) / Ctrl+Z restores the last deleted item, but only when it cannot be
// a text undo: never inside inputs, textareas, selects or contenteditable (editor,
// board notes and cells, chat composer), so normal text undo keeps working there.
import { useEffect } from "react";
import { useApp } from "../../store/app";

const TEXT_TARGET = "input, textarea, select, [contenteditable]:not([contenteditable=false])";

export function useUndoShortcut(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "z") return;
      if (!useApp.getState().lastDeleted) return;
      if (e.target instanceof Element && e.target.closest(TEXT_TARGET)) return;
      e.preventDefault();
      void useApp.getState().undoDelete();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
