// Cmd/Ctrl+[ goes back; Esc goes up one folder while a folder view is showing.
// Neither acts while typing, and Esc leaves open dialogs and menus alone.
import { useEffect } from "react";
import { useApp } from "../../store/app";
import { isTypingTarget } from "./typing";

export function useBrowseShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const { openPath, currentDir, back } = useApp.getState();
      if (e.key === "[" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        back();
      } else if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (openPath !== null || currentDir === null) return;
        if (document.querySelector('[role="alertdialog"], [role="menu"]')) return;
        back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
