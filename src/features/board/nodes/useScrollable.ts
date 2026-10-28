import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether the element's content overflows it. Blocks put `nowheel` on a scroll
 * area only then, so the wheel keeps zooming/panning the board over areas that
 * have nothing to scroll.
 */
export function useScrollable<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [scrollable, setScrollable] = useState(false);
  const check = useCallback(() => {
    const el = ref.current;
    if (el) setScrollable(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  }, []);
  // Content can grow without the element resizing (a row is added to a scrolling
  // table), so measure after every render; setState bails out when nothing changed.
  useLayoutEffect(check);
  // Block resizes do not re-render this component: one observer per element, for the element's lifetime.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, [check]);
  return [ref, scrollable];
}
