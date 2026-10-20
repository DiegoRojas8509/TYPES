// Whether the left sidebar is collapsed. A per-viewer convenience: card navigation is the
// main way around, so the tree starts collapsed. v2 key: earlier preferences are ignored.
const KEY = "types.sidebarCollapsed.v2";

export function readSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}

export function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(KEY, collapsed ? "1" : "0");
  } catch {
    /* storage unavailable: the choice just won't persist */
  }
}
