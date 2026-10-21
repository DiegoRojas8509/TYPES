import "./historyPanel.css";
import { useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { CanvasNode } from "../../lib/canvas";
import { CleanButton } from "./CleanButton";
import { historyEntries } from "./historyModel";
import { GlyphChart, GlyphDecision, GlyphImage, GlyphNote, GlyphTable, GlyphTimeline, GlyphUnknown, GlyphZone } from "./nodes/glyphs";

const GLYPHS: Record<string, () => ReactNode> = {
  text: GlyphNote,
  file: GlyphImage,
  group: GlyphZone,
  table: GlyphTable,
  chart: GlyphChart,
  timeline: GlyphTimeline,
  decision: GlyphDecision,
};
const AUTHOR = { claude: "Claude", tu: "tú" } as const;

/**
 * Toolbar button «Historial (N)» + side panel with the archived blocks of the board.
 * Everything from the blocks is rendered as plain text. Restoring goes through `onRestore`
 * (the board's own persist path); this component never writes.
 */
export function HistoryPanel({
  path,
  nodes,
  editable,
  onRestore,
  host,
}: {
  path: string;
  nodes: CanvasNode[];
  editable: boolean;
  onRestore(id: string): void;
  /** Element the panel is rendered into (the board's flow area). Inline when omitted. */
  host?: HTMLElement | null;
}) {
  const [open, setOpen] = useState(false);
  const entries = useMemo(() => historyEntries(nodes), [nodes]);
  if (entries.length === 0 && !open) return null;

  const panel = open ? (
    <aside className="history-panel" aria-label="Historial">
      <div className="history-head">
        <h2>Historial</h2>
        {editable && <CleanButton path={path} editable={editable} />}
      </div>
      {entries.length === 0 ? (
        <p className="history-empty">Aún no hay nada archivado.</p>
      ) : (
        <ul className="history-list" role="list">
          {entries.map((e) => {
            const Glyph = GLYPHS[e.type] ?? GlyphUnknown;
            return (
              <li key={e.id} className="history-item">
                <div className="history-title">
                  <span className="history-glyph" aria-hidden="true">
                    <Glyph />
                  </span>
                  <span className="history-name">{e.title}</span>
                </div>
                {e.snippet && <p className="history-snippet">{e.snippet}</p>}
                <p className="history-meta">
                  {["archivado el " + e.at, e.reason, e.by ? AUTHOR[e.by] : ""].filter(Boolean).join(" · ")}
                </p>
                {editable && (
                  <button type="button" className="btn history-restore" aria-label={`Restaurar «${e.title}»`} onClick={() => onRestore(e.id)}>
                    Restaurar
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  ) : null;

  return (
    <>
      <button type="button" className="btn history-toggle" aria-pressed={open} title="Bloques archivados de esta pizarra" onClick={() => setOpen((o) => !o)}>
        Historial ({entries.length})
      </button>
      {host ? panel && createPortal(panel, host) : panel}
    </>
  );
}
