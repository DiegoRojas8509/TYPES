// Cmd+\ (macOS) / Ctrl+\ toggles the left sidebar. The chat has no shortcut and
// Cmd+\ inserts no text, so it works everywhere, including inside inputs and editors.
import { useEffect } from "react";
import { useApp } from "../../store/app";

export function useSidebarShortcut(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key !== "\\") return;
      e.preventDefault();
      useApp.getState().toggleSidebar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
