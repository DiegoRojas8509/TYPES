import { useState, type KeyboardEvent } from "react";
import { useBoardActions } from "../boardActions";

/**
 * «Archivar» in a block's header: shown on hover or keyboard focus, asks an optional
 * short reason inline (Enter confirms, Esc cancels) and moves the block to the history
 * layer. Nothing is deleted. Hidden when the board is read-only.
 */
export function ArchiveControl({ id, title }: { id: string; title: string }) {
  const { archive, readOnly } = useBoardActions();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  if (readOnly) return null;

  const close = () => {
    setAsking(false);
    setReason("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      archive(id, reason);
      close();
    } else if (e.key === "Escape") {
      close();
    }
  };

  if (asking) {
    return (
      <input
        className="block-archive-reason nodrag nowheel"
        autoFocus
        value={reason}
        placeholder="¿Por qué se archiva? (opcional)"
        aria-label="Motivo para archivar"
        onChange={(e) => setReason(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={close}
      />
    );
  }
  return (
    <button
      type="button"
      className="block-archive nodrag"
      aria-label={`Archivar «${title}»`}
      title="Archivar (queda en el historial)"
      onClick={() => setAsking(true)}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="2" y="3" width="12" height="3" rx="1" />
        <path d="M3 6v6.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V6M6.5 9h3" />
      </svg>
    </button>
  );
}
