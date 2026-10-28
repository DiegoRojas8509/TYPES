import { useEffect, useRef } from "react";
import { BLOCKS, type BlockKind } from "./addMenu";

/** Popup listing the block kinds. `left`/`top` are relative to the board container. */
export function BlockMenu({
  left,
  top,
  onPick,
  onClose,
}: {
  left: number;
  top: number;
  onPick(kind: BlockKind): void;
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [onClose]);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? []);
    const at = items.indexOf(document.activeElement as HTMLElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    items[(at + step + items.length) % items.length]?.focus();
  }

  return (
    <div className="board-menu" role="menu" aria-label="Agregar bloque" ref={ref} style={{ left, top }} onKeyDown={onKeyDown}>
      {BLOCKS.map((b) => (
        <button key={b.kind} type="button" role="menuitem" className="board-menu-item" onClick={() => onPick(b.kind)}>
          {b.label}
        </button>
      ))}
    </div>
  );
}
