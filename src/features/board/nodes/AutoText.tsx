import { useLayoutEffect, useRef, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value" | "rows"> & {
  value: string;
  onChange: (value: string) => void;
  /** Plain Enter does nothing (as in the single-line input it replaces); Shift+Enter inserts a newline. */
  singleLine?: boolean;
};

/**
 * Text field that wraps and grows with its text, so long values are never cut. Sizing only
 * touches the element's style, never the board data: mounting, focusing, blurring and resizing
 * never write. Shift+Enter inserts a "\n" (stored as such).
 */
export function AutoText({ value, onChange, singleLine, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // A narrower or wider column re-wraps the text without a new value.
    if (typeof ResizeObserver === "undefined") return;
    let width = el.clientWidth;
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return;
      width = el.clientWidth;
      fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  const keyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (singleLine && e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) e.preventDefault();
    onKeyDown?.(e);
  };

  return <textarea ref={ref} rows={1} spellCheck={false} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={keyDown} {...rest} />;
}
