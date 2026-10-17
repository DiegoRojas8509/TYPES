import "./datagrid.css";
import "./process.css";
import "./timeline.css";
import type { NodeProps } from "@xyflow/react";
import { useMemo, useRef } from "react";
import { useBoardActions } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { BlockShell } from "./BlockShell";
import { AutoText } from "./AutoText";
import { contentSize, fitBlockSize } from "./fitBlock";
import { GlyphTimeline } from "./glyphs";
import { StatusMark } from "./StatusMark";
import {
  STATUSES,
  addItem,
  moveItem,
  removeItem,
  setItemField,
  timelineProgress,
  timelineView,
  todayISO,
  type ItemField,
  type Status,
} from "./timelineData";
import { TitleInput } from "./TitleInput";
import { useScrollable } from "./useScrollable";

const MIN = { width: 260, height: 120 };
const FIT_TITLE = "Ajustar el bloque al contenido de la línea de tiempo";
const FIT_LABEL = "Ajustar el bloque al contenido";
const STATUS_LABEL: Record<Status, string> = { hecho: "Hecho", "en curso": "En curso", pendiente: "Pendiente" };
/** «title» for button names, or the 1-based position when the item has no title yet. */
const quoted = (title: string, position: number) => (title.trim() ? `«${title}»` : String(position));

/**
 * Timeline of progress. Items are listed in the order stored (nothing is sorted
 * on screen). Display goes through `timelineView`; every edit patches the node's
 * RAW `items` (timelineData.ts), so the items the user did not touch, their extra
 * fields and an unknown `status` survive. Opening, selecting, focusing and
 * blurring never write. Status is a radio group per item (one tab stop, arrow
 * keys) whose options carry a shape and a word, so it never relies on colour.
 */
export function TimelineNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { update } = useBoardActions();
  const title = typeof data.title === "string" ? data.title : "";
  const rows = useMemo(() => timelineView(data), [data]);
  const { done, total } = timelineProgress(rows);
  const [scrollRef, scrollable] = useScrollable<HTMLDivElement>();
  const contentRef = useRef<HTMLDivElement>(null);

  // Resize the block to show all its content. Writes only when clicked.
  const fit = () => {
    const area = scrollRef.current;
    const content = contentRef.current;
    const size = area && content && fitBlockSize(area, MIN, contentSize(area, content));
    if (size) update(id, size);
  };
  const write = (items: unknown[]) => update(id, { items });
  const edit = (i: number, field: ItemField, value: string) => write(setItemField(data, i, field, value));

  return (
    <BlockShell
      id={id}
      selected={selected}
      title={title || "Línea de tiempo"}
      titleSlot={<TitleInput value={title} placeholder="Línea de tiempo" label="Título de la línea de tiempo" onChange={(t) => update(id, { title: t })} />}
      glyph={<GlyphTimeline />}
      color={data.color}
      minWidth={MIN.width}
      minHeight={MIN.height}
      className="block-timeline"
    >
      <div className="table-body">
        <div ref={scrollRef} className={scrollable ? "table-scroll nodrag nopan nowheel" : "table-scroll nodrag nopan"}>
          <div ref={contentRef} className="fit-content">
          {total > 0 && (
            <div className="tl-progress">
              <span className="tl-progress-bar" aria-hidden="true">
                <span style={{ width: `${(done / total) * 100}%` }} />
              </span>
              <span className="tl-progress-text">
                {done} de {total} hechos
              </span>
            </div>
          )}
          <ol className="tl-list">
            {rows.map((row, i) => {
              const label = quoted(row.title, i + 1);
              return (
                <li key={i} className="tl-item" data-status={row.known ? row.status : "desconocido"}>
                  <span className="tl-rail">
                    <StatusMark status={row.known ? row.status : null} />
                  </span>
                  <div className="tl-main">
                    <div className="tl-line">
                      <AutoText
                        singleLine
                        className="tl-input tl-date"
                        aria-label={`Fecha del avance ${i + 1}`}
                        placeholder="Fecha"
                        value={row.date}
                        onChange={(v) => edit(i, "date", v)}
                      />
                      <AutoText
                        singleLine
                        className="tl-input tl-title"
                        aria-label={`Título del avance ${i + 1}`}
                        placeholder="¿Qué pasó o qué falta?"
                        value={row.title}
                        onChange={(v) => edit(i, "title", v)}
                      />
                    </div>
                    <AutoText
                      singleLine
                      className="tl-input tl-detail"
                      aria-label={`Detalle del avance ${i + 1}`}
                      placeholder="Detalle"
                      value={row.detail}
                      onChange={(v) => edit(i, "detail", v)}
                    />
                    <div className="tl-status-row">
                      <div className="tl-status" role="radiogroup" aria-label={`Estado del avance ${i + 1}`}>
                        {STATUSES.map((s) => (
                          <label key={s} className="tl-status-opt" data-value={s}>
                            <input
                              type="radio"
                              name={`${id}-status-${i}`}
                              aria-label={STATUS_LABEL[s]}
                              checked={row.status === s}
                              onChange={() => edit(i, "status", s)}
                            />
                            <span>
                              <StatusMark status={s} />
                              {STATUS_LABEL[s]}
                            </span>
                          </label>
                        ))}
                      </div>
                      {!row.known && <span className="tl-unknown">«{row.status}»</span>}
                    </div>
                  </div>
                  <div className="tl-tools">
                    <button
                      type="button"
                      className="proc-btn"
                      aria-label={`Subir avance ${label}`}
                      title="Subir"
                      disabled={i === 0}
                      onClick={() => write(moveItem(data, i, -1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="proc-btn"
                      aria-label={`Bajar avance ${label}`}
                      title="Bajar"
                      disabled={i === rows.length - 1}
                      onClick={() => write(moveItem(data, i, 1))}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="proc-btn is-danger"
                      aria-label={`Eliminar avance ${label}`}
                      title="Eliminar avance"
                      onClick={() => write(removeItem(data, i))}
                    >
                      ×
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          </div>
        </div>
        <div className="data-bar nodrag nopan">
          <button type="button" className="data-btn" onClick={() => write(addItem(data, todayISO()))}>
            + avance
          </button>
          <button type="button" className="data-btn data-btn-fit" title={FIT_TITLE} aria-label={FIT_LABEL} onClick={fit}>
            Ajustar
          </button>
        </div>
      </div>
    </BlockShell>
  );
}
