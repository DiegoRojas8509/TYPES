import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * Whether the element's content overflows it. Blocks put `nowheel` on a scroll
 * area only then, so the wheel keeps zooming/panning the board over areas that
 * have nothing to scroll.
 */
export function useScrollable<T extends HTMLElement>(): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null);
  const [scrollable, setScrollable] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setScrollable(el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
    check();
    // Content can grow without a re-render of this component (the user resizes the block).
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  });
  return [ref, scrollable];
}
