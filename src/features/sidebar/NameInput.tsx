import { useEffect, useRef, useState } from "react";

interface Props {
  label: string;
  initial?: string;
  /** Resolves true when the name was accepted; false keeps the input open. */
  onSubmit(name: string): Promise<boolean>;
  onCancel(): void;
}

/** Inline name field: Enter confirms, Escape or leaving the field cancels. */
export function NameInput({ label, initial = "", onSubmit, onCancel }: Props) {
  const [value, setValue] = useState(initial);
  const busy = useRef(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  async function submit() {
    const name = value.trim();
    if (!name || name === initial) return onCancel();
    busy.current = true;
    const ok = await onSubmit(name);
    busy.current = false;
    if (!ok) ref.current?.focus();
  }

  return (
    <input
      ref={ref}
      className="name-input"
      aria-label={label}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void submit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={() => {
        if (!busy.current) onCancel();
      }}
    />
  );
}
