// Cmd/Ctrl+[ goes back; Esc goes up one folder while a folder view is showing.
// Neither acts while typing, and Esc leaves open dialogs and menus alone.
import { useEffect } from "react";
import { useApp } from "../../store/app";
import { isTypingTarget } from "./typing";

/** Esc belongs to the card view only: not to controls in the sidebar or the chat. */
function inCardView(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true; // window / document
  return target === document.body || target === document.documentElement || target.closest(".doc-pane") !== null;
}

export function useBrowseShortcuts(): void {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || isTypingTarget(e.target)) return;
      const { openPath, currentDir, back } = useApp.getState();
      if (e.key === "[" && (e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        back();
      } else if (e.key === "Escape" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (openPath !== null || currentDir === null || !inCardView(e.target)) return;
        if (document.querySelector('[role="alertdialog"], [role="menu"]')) return;
        back();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
