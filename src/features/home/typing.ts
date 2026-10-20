/** Elements where keystrokes belong to the text, not to navigation. */
export const TYPING_TARGET = "input, textarea, select, [contenteditable]:not([contenteditable=false])";

export function isTypingTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_TARGET) !== null;
}

/** Arrow keys move focus between cards in reading order. Attach to the container that holds the cards. */
export function gridKeyDown(e: React.KeyboardEvent<HTMLElement>): void {
  const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
  if (!step || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
  const target = e.target as Element;
  if (isTypingTarget(target) || target.closest('[role="alertdialog"], [role="menu"]')) return;
  const here = target.closest('[role="listitem"]')?.querySelector<HTMLElement>("[data-card]");
  if (!here) return;
  const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-card]"));
  const next = cards[cards.indexOf(here) + step];
  e.preventDefault();
  next?.focus();
}
