import { useEffect, useRef, useState } from "react";

export interface MenuItem {
  label: string;
  onSelect(): void;
  danger?: boolean;
  /** Present for on/off items (rendered as a checkbox item). */
  checked?: boolean;
}

/** The "⋯" button of a card or folder header, with a small popup menu. A separate tab stop from the card. */
export function CardMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus();
    const away = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) button.current?.focus();
  }

  function onMenuKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const all = Array.from(root.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? []);
      const i = all.indexOf(document.activeElement as HTMLElement);
      all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
    } else if (e.key === "Tab") {
      setOpen(false);
    }
  }

  return (
    <div className="card-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className="icon-btn card-menu-btn"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        ⋯
      </button>
      {open && (
        <div className="card-menu-pop" role="menu" aria-label={label} onKeyDown={onMenuKey}>
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role={item.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={item.checked}
              className={item.danger ? "is-danger" : undefined}
              onClick={() => {
                close(false);
                item.onSelect();
              }}
            >
              {item.checked !== undefined && <span aria-hidden="true">{item.checked ? "✓" : ""}</span>}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
