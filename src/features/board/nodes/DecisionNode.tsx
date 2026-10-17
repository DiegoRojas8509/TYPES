import "./datagrid.css";
import "./process.css";
import "./decision.css";
import type { NodeProps } from "@xyflow/react";
import { useMemo } from "react";
import { useBoardActions } from "../boardActions";
import type { FlowNode } from "../boardModel";
import { addOption, decisionView, removeOption, setOptionName, toggleChosen } from "./decisionData";
import { BlockShell } from "./BlockShell";
import { GlyphDecision } from "./glyphs";
import { AutoText } from "./AutoText";
import { fitBlockSize } from "./fitBlock";
import { PointList } from "./PointList";
import { useScrollable } from "./useScrollable";

const MIN = { width: 280, height: 160 };
const FIT_TITLE = "Ajustar el bloque al contenido de la tabla";
const FIT_LABEL = "Ajustar el bloque al contenido";
const quoted = (name: string, position: number) => (name.trim() ? `«${name}»` : String(position));

/**
 * Decision block: a question, options laid out so the tradeoff reads at a glance
 * (A favor / En contra side by side, stacked when the option card is narrow), the
 * chosen option and the reason. Display goes through `decisionView`; every edit
 * patches the node's RAW `options` (decisionData.ts) so nothing the user did not
 * touch is rewritten. `chosen` is keyed by option NAME (that is the file format):
 *  - "Elegir esta" on the chosen option clears the choice again (a toggle);
 *  - renaming the chosen option keeps `chosen` on the new name;
 *  - a `chosen` that names nothing is left as found and only hinted.
 * Opening, selecting, focusing and blurring never write.
 */
export function DecisionNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { update } = useBoardActions();
  const view = useMemo(() => decisionView(data), [data]);
  const [scrollRef, scrollable] = useScrollable<HTMLDivElement>();
  const stop = "nodrag nopan";
  // Resize the block to show all its content. Writes only when clicked.
  const fit = () => {
    const size = fitBlockSize(scrollRef.current, MIN);
    if (size) update(id, size);
  };

  return (
    <BlockShell
      id={id}
      selected={selected}
      title="Decisión"
      glyph={<GlyphDecision />}
      color={data.color}
      minWidth={MIN.width}
      minHeight={MIN.height}
      className="block-decision"
    >
      <div className="table-body">
        <div ref={scrollRef} className={scrollable ? `table-scroll dc-scroll ${stop} nowheel` : `table-scroll dc-scroll ${stop}`}>
          <AutoText
            className="dc-question"
            aria-label="Pregunta de la decisión"
            placeholder="¿Qué decidimos?"
            value={view.question}
            onChange={(v) => update(id, { question: v })}
          />
          {view.options.length === 0 && <p className="dc-empty">Sin opciones todavía. Agrega una con «+ opción».</p>}
          <div className="dc-options">
            {view.options.map((opt, i) => {
              const isChosen = view.chosen !== "" && opt.name === view.chosen;
              return (
                <section key={i} className="dc-option" data-chosen={isChosen ? "true" : "false"} aria-label={`Opción ${i + 1}`}>
                  <div className="dc-opt-head">
                    <AutoText
                      singleLine
                      className="dc-name"
                      aria-label={`Nombre de la opción ${i + 1}`}
                      placeholder="Nombre"
                      value={opt.name}
                      onChange={(v) => update(id, setOptionName(data, i, v))}
                    />
                    <button
                      type="button"
                      className="proc-btn is-danger"
                      aria-label={`Eliminar opción ${quoted(opt.name, i + 1)}`}
                      title="Eliminar opción"
                      onClick={() => update(id, removeOption(data, i))}
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    className="dc-choose"
                    disabled={opt.name === ""}
                    aria-label={isChosen ? `«${opt.name}» es la opción elegida. Quitar elección` : `Elegir esta opción${opt.name ? `: «${opt.name}»` : ` ${i + 1}`}`}
                    title={isChosen ? "Quitar elección" : opt.name === "" ? "Ponle nombre para poder elegirla" : undefined}
                    onClick={() => {
                      const patch = toggleChosen(data, i);
                      if (patch) update(id, patch);
                    }}
                  >
                    {isChosen ? "✓ Elegida" : "Elegir esta"}
                  </button>
                  <div className="dc-pc">
                    <PointList data={data} index={i} side="pros" points={opt.pros} onWrite={(options) => update(id, { options })} />
                    <PointList data={data} index={i} side="cons" points={opt.cons} onWrite={(options) => update(id, { options })} />
                  </div>
                </section>
              );
            })}
          </div>
          {!view.chosenFound && <p className="dc-hint">«{view.chosen}» ya no es una opción</p>}
          {view.duplicates.length > 0 && (
            <p className="dc-hint">
              Hay opciones con el mismo nombre: {view.duplicates.map((n) => `«${n}»`).join(", ")}. Elegir una marca a todas.
            </p>
          )}
          <label className="dc-why">
            <span className="dc-label">Por qué</span>
            <AutoText
              className="dc-rationale"
              aria-label="Por qué"
              placeholder="La razón de la decisión"
              value={view.rationale}
              onChange={(v) => update(id, { rationale: v })}
            />
          </label>
        </div>
        <div className="data-bar nodrag nopan">
          <button type="button" className="data-btn" onClick={() => update(id, addOption(data))}>
            + opción
          </button>
          <button type="button" className="data-btn data-btn-fit" title={FIT_TITLE} aria-label={FIT_LABEL} onClick={fit}>
            Ajustar
          </button>
        </div>
      </div>
    </BlockShell>
  );
}
