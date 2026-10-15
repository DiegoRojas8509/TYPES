import { chartColor } from "./chartColors";

interface Entry {
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: { fill?: string };
}

const fmt = new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 });
export const formatValue = (v: unknown): string => (typeof v === "number" ? fmt.format(v) : "Sin dato");

/** Hover card of the chart: text in ink tokens, a swatch carries the series colour. */
export function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: readonly Entry[]; label?: unknown }) {
  if (!active || !payload || payload.length === 0) return null;
  const head = label === undefined || label === "" ? null : String(label);
  return (
    <div className="chart-tip">
      {head !== null && <div className="chart-tip-head">{head}</div>}
      {payload.map((p, i) => (
        <div className="chart-tip-row" key={i}>
          <span className="chart-swatch" style={{ background: p.color ?? p.payload?.fill ?? chartColor(i) }} aria-hidden="true" />
          <span className="chart-tip-name">{String(p.name ?? "")}</span>
          <span className="chart-tip-value">{formatValue(p.value)}</span>
        </div>
      ))}
    </div>
  );
}
