import "./datagrid.css";
import type { NodeProps } from "@xyflow/react";
import { useMemo, useRef, type KeyboardEvent } from "react";
import { useBoardActions } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { BlockShell } from "./BlockShell";
import { GlyphTable } from "./glyphs";
import { addColumn, addRow, deleteColumn, deleteRow, numericColumns, setCell, setHeader, tableLocks, tableView, type TablePatch } from "./tableData";
import { TitleInput } from "./TitleInput";
import { useScrollable } from "./useScrollable";

const LOCKED_ROW = "Fila en otro formato; edítala desde el chat";
const LOCKED_CELL = "Celda en otro formato; edítala desde el chat";

/**
 * Editable table. `columns` and `rows` can arrive ragged or with non-strings
 * (hand-written or edited by Claude): the view pads and coerces for display only,
 * and an edit patches the raw arrays so everything it did not touch is written back
 * as found (see tableData.ts). Rows that are not arrays and object or array cells are
 * shown read-only: a keystroke here can never rewrite them. Opening, selecting,
 * focusing and blurring never write. The delete buttons are ordinary tab stops: Tab
 * walks a row's cells and then reaches its delete button.
 */
export function TableNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { update } = useBoardActions();
  const title = typeof data.title === "string" ? data.title : "";
  const view = useMemo(() => tableView(data), [data]);
  const numeric = useMemo(() => numericColumns(view.columns, view.rows), [view]);
  const locks = useMemo(() => tableLocks(data), [data]);
  const rawRows: unknown[] = Array.isArray(data.rows) ? data.rows : [];
  const [scrollRef, scrollable] = useScrollable<HTMLDivElement>();
  const gridRef = useRef<HTMLTableElement>(null);

  const write = (t: TablePatch) => update(id, { columns: t.columns, rows: t.rows });

  // Enter moves to the cell below in the same column (the header counts as row 0).
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>, row: number, col: number) => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    const next = gridRef.current?.querySelector<HTMLInputElement>(`input[data-r="${row + 1}"][data-c="${col}"]`);
    next?.focus();
  };

  const canDeleteColumn = view.columns.length > 1;
  return (
    <BlockShell
      id={id}
      selected={selected}
      title={title || "Tabla"}
      titleSlot={<TitleInput value={title} placeholder="Tabla" label="Título de la tabla" onChange={(t) => update(id, { title: t })} />}
      glyph={<GlyphTable />}
      color={data.color}
      minWidth={200}
      minHeight={110}
      className="block-table"
    >
      <div className="table-body">
        <div ref={scrollRef} className={scrollable ? "table-scroll nodrag nopan nowheel" : "table-scroll nodrag nopan"}>
          <table ref={gridRef} className="data-table">
            <thead>
              <tr>
                {view.columns.map((h, c) => (
                  <th key={c} className={numeric[c] ? "is-num" : undefined}>
                    <div className="cell-wrap">
                      <input
                        className="cell-input cell-head"
                        aria-label={`Encabezado de columna ${c + 1}`}
                        data-r={0}
                        data-c={c}
                        value={h}
                        placeholder="Columna"
                        disabled={locks.headers[c]}
                        title={locks.headers[c] ? LOCKED_CELL : undefined}
                        onChange={(e) => write(setHeader(data, c, e.target.value))}
                        onKeyDown={(e) => onKeyDown(e, 0, c)}
                      />
                      <button
                        type="button"
                        className="cell-del"
                        aria-label={`Eliminar columna ${h.trim() ? `«${h}»` : c + 1}`}
                        title="Eliminar columna"
                        disabled={!canDeleteColumn}
                        onClick={() => write(deleteColumn(data, c))}
                      >
                        ×
                      </button>
                    </div>
                  </th>
                ))}
                <th className="row-tools" aria-hidden="true" />
              </tr>
            </thead>
            <tbody>
              {view.rows.map((row, r) => (
                <tr key={r}>
                  {row.map((v, c) => (
                    <td key={c}>
                      <input
                        className={numeric[c] ? "cell-input is-num" : "cell-input"}
                        aria-label={`Fila ${r + 1}, columna ${c + 1}`}
                        data-r={r + 1}
                        data-c={c}
                        value={v}
                        disabled={locks.rows[r][c]}
                        title={locks.rows[r][c] ? (Array.isArray(rawRows[r]) ? LOCKED_CELL : LOCKED_ROW) : undefined}
                        onChange={(e) => write(setCell(data, r, c, e.target.value))}
                        onKeyDown={(e) => onKeyDown(e, r + 1, c)}
                      />
                    </td>
                  ))}
                  <td className="row-tools">
                    <button
                      type="button"
                      className="cell-del"
                      aria-label={`Eliminar fila ${r + 1}`}
                      title="Eliminar fila"
                      onClick={() => write(deleteRow(data, r))}
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="data-bar nodrag nopan">
          <button type="button" className="data-btn" onClick={() => write(addRow(data))}>
            + fila
          </button>
          <button type="button" className="data-btn" onClick={() => write(addColumn(data))}>
            + columna
          </button>
        </div>
      </div>
    </BlockShell>
  );
}
