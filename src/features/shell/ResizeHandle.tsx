import { useRef, useState } from "react";

interface Props {
  label: string;
  /** +1 when dragging right grows the pane (left pane), -1 when it shrinks it (right pane). */
  direction: 1 | -1;
  width: number;
  onResize(width: number): void;
}

export function ResizeHandle({ label, direction, width, onResize }: Props) {
  const start = useRef<{ x: number; w: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  return (
    <div
      className="resize-handle"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      tabIndex={0}
      data-dragging={dragging}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, w: width };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (start.current) onResize(start.current.w + direction * (e.clientX - start.current.x));
      }}
      onPointerUp={() => {
        start.current = null;
        setDragging(false);
      }}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 40 : 10;
        if (e.key === "ArrowLeft") onResize(width - direction * step);
        else if (e.key === "ArrowRight") onResize(width + direction * step);
      }}
    />
  );
}
