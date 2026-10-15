import type { NodeProps } from "@xyflow/react";
import { useMemo, useState } from "react";
import { useBoardActions } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { BlockShell } from "./BlockShell";
import { chartColor } from "./chartColors";
import { ChartCanvas } from "./ChartCanvas";
import { ChartDataGrid } from "./ChartDataGrid";
import { editableData, KINDS, prepareChartData, type ChartKind, type EditableData } from "./chartData";
import { GlyphChart } from "./glyphs";
import { TitleInput } from "./TitleInput";

const KIND_NAME: Record<ChartKind, { button: string; aria: string }> = {
  bar: { button: "Barras", aria: "Gráfica de barras" },
  line: { button: "Líneas", aria: "Gráfica de líneas" },
  pie: { button: "Circular", aria: "Gráfica circular" },
};

/**
 * Chart block (bar, line or pie). The data is hardened once by
 * `prepareChartData`; the "Datos" toggle swaps the chart for an editable grid
 * of the same data. Opening, selecting or toggling never writes: only an edit
 * does, and then `labels` and `series` are written back normalized.
 */
export function ChartNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { update } = useBoardActions();
  const [showData, setShowData] = useState(false);
  const prepared = useMemo(() => prepareChartData(data), [data]);
  const title = prepared.title;
  const { kind } = prepared;

  const edit = (fn: (d: EditableData) => EditableData) => {
    const next = fn(editableData(data));
    update(id, { labels: next.labels, series: next.series });
  };

  const switcher = (
    <div className="chart-tools nodrag nopan">
      <div className="chart-kinds" role="group" aria-label="Tipo de gráfica">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className="chart-kind"
            aria-pressed={k === kind}
            aria-label={KIND_NAME[k].button}
            title={KIND_NAME[k].button}
            onClick={() => k !== kind && update(id, { kind: k })}
          >
            <KindIcon kind={k} />
          </button>
        ))}
      </div>
      <button type="button" className="chart-data-toggle" aria-pressed={showData} onClick={() => setShowData((v) => !v)}>
        Datos
      </button>
    </div>
  );

  // One series needs no legend (the title says what it is); a pie is identified by its slices.
  const legend =
    kind === "pie"
      ? prepared.pie.slices.map((s) => ({ name: s.name, color: chartColor(s.index) }))
      : prepared.series.length > 1
        ? prepared.series.map((s, j) => ({ name: s.name, color: chartColor(j) }))
        : [];
  const showNote = kind === "pie" && prepared.pie.extraSeries;

  return (
    <BlockShell
      id={id}
      selected={selected}
      title={title || "Gráfica"}
      titleSlot={<TitleInput value={title} placeholder="Gráfica" label="Título de la gráfica" onChange={(t) => update(id, { title: t })} />}
      glyph={<GlyphChart />}
      color={data.color}
      actions={switcher}
      minWidth={240}
      minHeight={150}
      className="block-chart"
    >
      {showData ? (
        <ChartDataGrid prepared={prepared} edit={edit} />
      ) : prepared.empty ? (
        <p className="chart-empty">Sin datos: abre «Datos» para agregar</p>
      ) : (
        <div className="chart-body">
          {(legend.length > 0 || showNote) && (
            <div className="chart-meta">
              {legend.length > 0 && (
                <ul className="chart-legend">
                  {legend.map((l, i) => (
                    <li key={i}>
                      <span className={kind === "line" ? "chart-swatch is-line" : "chart-swatch"} style={{ background: l.color }} aria-hidden="true" />
                      {l.name}
                    </li>
                  ))}
                </ul>
              )}
              {showNote && (
                <span className="chart-note" title="Una gráfica circular solo dibuja la primera serie; las demás se conservan en los datos.">
                  Solo se muestra la serie «{prepared.pie.seriesName}»
                </span>
              )}
            </div>
          )}
          <div className="chart-frame" role="img" aria-label={`${KIND_NAME[kind].aria}: ${title || "sin título"}`}>
            <ChartCanvas data={prepared} />
          </div>
        </div>
      )}
    </BlockShell>
  );
}

function KindIcon({ kind }: { kind: ChartKind }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {kind === "bar" && <path d="M4 13V8M8 13V3.5M12 13V6" />}
      {kind === "line" && <path d="m2.5 11.5 3.5-4 3 2.5 4.5-6" />}
      {kind === "pie" && (
        <>
          <path d="M8 2.5v5.5h5.5" />
          <circle cx="8" cy="8" r="5.5" />
        </>
      )}
    </svg>
  );
}
