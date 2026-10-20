import { Fragment } from "react";
import { titleOf } from "../../lib/paths";
import { useApp } from "../../store/app";

interface Crumb {
  label: string;
  /** Folder to browse to (null = Inicio); undefined for the current, non-clickable segment. */
  to?: string | null;
}

/** "Types › Ropa › Clientes › Daring Martin": every segment but the last goes there; ← goes up one level. */
export function Breadcrumb({ dir, file, slotRef }: { dir: string | null; file?: string | null; slotRef?: (el: HTMLElement | null) => void }) {
  const browse = useApp((s) => s.browse);
  const back = useApp((s) => s.back);

  const segments = dir ? dir.split("/") : [];
  const crumbs: Crumb[] = [{ label: "Types", to: null }];
  segments.forEach((label, i) => crumbs.push({ label, to: segments.slice(0, i + 1).join("/") }));
  if (file) crumbs.push({ label: titleOf(file) });
  const last = crumbs.length - 1;
  crumbs[last] = { label: crumbs[last].label }; // the current place is text, not a link

  return (
    <nav className="breadcrumb" aria-label="Ruta">
      <button
        type="button"
        className="icon-btn"
        aria-label="Atrás"
        title="Atrás (⌘[)"
        disabled={last === 0}
        onClick={back}
      >
        ←
      </button>
      <ol>
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <li className="breadcrumb-sep" aria-hidden="true">
                ›
              </li>
            )}
            <li>
              {i === last ? (
                <span className="breadcrumb-current" aria-current="page" title={file ?? dir ?? undefined}>
                  {c.label}
                </span>
              ) : (
                <button type="button" className="breadcrumb-link" onClick={() => browse(c.to ?? null)}>
                  {c.label}
                </button>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
      <span className="breadcrumb-slot" ref={slotRef} />
    </nav>
  );
}
