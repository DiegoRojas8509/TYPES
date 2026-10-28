/**
 * Marker of a timeline status. The SHAPE says the status (dashed ring = pendiente,
 * half-filled = en curso, check = hecho, "?" = a value we do not know), so it is
 * readable without colour; colour only reinforces it (see process.css).
 */
export function StatusMark({ status }: { status: string | null }) {
  return (
    <svg className="status-mark" data-status={status ?? "desconocido"} width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      {status === "hecho" ? (
        <>
          <circle cx="8" cy="8" r="6.5" fill="currentColor" stroke="currentColor" strokeWidth="1.5" />
          <path d="m5 8.2 2 2L11 6" stroke="var(--bg-raised)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : status === "en curso" ? (
        <>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 4a4 4 0 0 1 0 8z" fill="currentColor" />
        </>
      ) : status === "pendiente" ? (
        <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.6 2.4" />
      ) : (
        <>
          <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
          <path d="M6.4 6.5a1.7 1.7 0 1 1 2.5 1.5c-.6.3-.9.7-.9 1.3M8 11.4v.1" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </>
      )}
    </svg>
  );
}
