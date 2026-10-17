// Whether the left sidebar is collapsed. A per-viewer convenience: storage may be
// unavailable, in which case the sidebar simply starts open every time.
const KEY = "types.sidebarCollapsed";

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}
