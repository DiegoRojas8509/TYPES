import "./datagrid.css";
import { useState } from "react";
import {
  addLabel,
  addSeries,
  parseNumberInput,
  removeLabel,
  removeSeries,
  renameLabel,
  renameSeries,
  setValue,
  type ChartPatch,
  type ChartRaw,
  type PreparedChart,
} from "./chartData";
import { useScrollable } from "./useScrollable";

/**
 * One number field. Typing is kept as raw text locally, and a change commits
 * only when the text is a number (empty commits 0, see parseNumberInput). Text
 * that is not a number yet ("-") stays on screen and commits nothing; leaving the
 * field shows the stored value again.
 */
function NumberCell({ value, label, onCommit }: { value: number | null; label: string; onCommit: (n: number) => void }) {
  const [raw, setRaw] = useState<string | null>(null);
  return (
    <input
      className="cell-input is-num"
      inputMode="decimal"
      aria-label={label}
      value={raw ?? (value === null ? "" : String(value))}
      onChange={(e) => {
        setRaw(e.target.value);
        const n = parseNumberInput(e.target.value);
        if (n !== null && n !== value) onCommit(n);
      }}
      onBlur={() => setRaw(null)}
    />
  );
}

/** «name» for the delete buttons' accessible names, or its 1-based position when the name is empty. */
const quoted = (name: string, position: number) => (name.trim() ? `«${name}»` : String(position));

/**
 * Compact editable table of the chart data: labels as rows, series as columns.
 * It DISPLAYS the hardened `prepared` data (a gap is an empty cell), but `edit`
 * hands the node's raw data to a patch function and writes its result, so an edit
 * never rewrites cells the user did not touch.
 */
export function ChartDataGrid({ prepared, edit }: { prepared: PreparedChart; edit: (fn: (raw: ChartRaw) => ChartPatch) => void }) {
  const [scrollRef, scrollable] = useScrollable<HTMLDivElement>();
  return (
    <div className="table-body">
      <div ref={scrollRef} className={scrollable ? "table-scroll nodrag nopan nowheel" : "table-scroll nodrag nopan"}>
        <table className="data-table">
          <thead>
            <tr>
              <th className="corner">Etiqueta</th>
              {prepared.series.map((s, j) => (
                <th key={j} className="is-num">
                  <div className="cell-wrap">
                    <input
                      className="cell-input cell-head is-num"
                      aria-label={`Nombre de la serie ${j + 1}`}
                      value={s.name}
                      onChange={(e) => edit((d) => renameSeries(d, j, e.target.value))}
                    />
                    <button type="button" className="cell-del" aria-label={`Eliminar serie ${quoted(s.name, j + 1)}`} title="Eliminar serie" onClick={() => edit((d) => removeSeries(d, j))}>
                      ×
                    </button>
                  </div>
                </th>
              ))}
              <th className="row-tools" aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {prepared.labels.map((label, i) => (
              <tr key={i}>
                <td>
                  <input
                    className="cell-input"
                    aria-label={`Etiqueta fila ${i + 1}`}
                    value={label}
                    onChange={(e) => edit((d) => renameLabel(d, i, e.target.value))}
                  />
                </td>
                {prepared.series.map((s, j) => (
                  <td key={j}>
                    <NumberCell value={s.values[i]} label={`Valor fila ${i + 1}, serie ${j + 1}`} onCommit={(n) => edit((d) => setValue(d, i, j, n))} />
                  </td>
                ))}
                <td className="row-tools">
                  <button type="button" className="cell-del" aria-label={`Eliminar etiqueta ${quoted(label, i + 1)}`} title="Eliminar etiqueta" onClick={() => edit((d) => removeLabel(d, i))}>
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="data-bar nodrag nopan">
        <button type="button" className="data-btn" onClick={() => edit(addLabel)}>
          + etiqueta
        </button>
        <button type="button" className="data-btn" onClick={() => edit(addSeries)}>
          + serie
        </button>
      </div>
    </div>
  );
}
