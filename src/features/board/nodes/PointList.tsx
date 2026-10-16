import { addPoint, removePoint, setPoint, type Side } from "./decisionData";

const LABEL: Record<Side, { head: string; mark: string; one: string; add: string }> = {
  pros: { head: "A favor", mark: "+", one: "a favor", add: "+ a favor" },
  cons: { head: "En contra", mark: "−", one: "en contra", add: "+ en contra" },
};

/**
 * One side of an option (A favor or En contra): a short editable list with "+"
 * and per-point delete. The "+"/"−" mark and the heading say which side it is, so
 * colour is only a reinforcement. `onWrite` receives the node's NEW raw `options`.
 */
export function PointList({
  data,
  index,
  side,
  points,
  onWrite,
}: {
  data: Record<string, unknown>;
  index: number;
  side: Side;
  points: string[];
  onWrite: (options: unknown[]) => void;
}) {
  const t = LABEL[side];
  return (
    <div className="dc-side" data-side={side}>
      <h4 className="dc-label">{t.head}</h4>
      <ul className="dc-points">
        {points.map((p, j) => (
          <li key={j} className="dc-point">
            <span className="dc-mark" aria-hidden="true">
              {t.mark}
            </span>
            <input
              className="dc-point-input"
              aria-label={`Punto ${t.one} ${j + 1} de la opción ${index + 1}`}
              value={p}
              onChange={(e) => onWrite(setPoint(data, index, side, j, e.target.value))}
            />
            <button
              type="button"
              className="proc-btn is-danger"
              aria-label={`Eliminar punto ${t.one} ${p.trim() ? `«${p}»` : j + 1}`}
              title="Eliminar punto"
              onClick={() => onWrite(removePoint(data, index, side, j))}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="dc-add" aria-label={`${t.add} (opción ${index + 1})`} onClick={() => onWrite(addPoint(data, index, side))}>
        {t.add}
      </button>
    </div>
  );
}
