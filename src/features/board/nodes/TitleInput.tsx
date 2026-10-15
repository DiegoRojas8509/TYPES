import type { ChangeEvent } from "react";

/**
 * Inline title of a data block, shown in the header strip through BlockShell's
 * `titleSlot`. Only an actual change calls `onChange`; an empty value shows the
 * placeholder (the block's default name).
 */
export function TitleInput({
  value,
  placeholder,
  label,
  onChange,
}: {
  value: string;
  placeholder: string;
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      className="block-title-input nodrag nopan"
      aria-label={label}
      placeholder={placeholder}
      size={Math.max(value.length, placeholder.length, 4)}
      value={value}
      onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
    />
  );
}
