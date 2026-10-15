// The recharts drawing of a chart block. It only receives already-hardened data
// (`prepareChartData`), so it can assume well-formed rows. Marks follow the
// dataviz specs: bars 24px at most with 4px rounded data ends, 2px lines with
// 8px dots ringed in the surface colour, recessive hairline grid, no animation.
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { chartColor } from "./chartColors";
import type { PreparedChart } from "./chartData";
import { ChartTooltip } from "./ChartTooltip";

const compact = new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 });
const tick = { fill: "var(--text-muted)", fontSize: 11 };
const margin = { top: 8, right: 8, bottom: 0, left: 0 };

const tooltip = (
  <Tooltip
    isAnimationActive={false}
    cursor={{ fill: "var(--bg-hover)", stroke: "var(--border-strong)" }}
    content={(p) => <ChartTooltip active={p.active} payload={p.payload} label={p.label} />}
  />
);

function Axes() {
  return (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border-strong)" }} tick={tick} minTickGap={8} />
      <YAxis width="auto" tickLine={false} axisLine={false} tick={tick} tickFormatter={(v: number) => compact.format(v)} />
    </>
  );
}

export function ChartCanvas({ data }: { data: PreparedChart }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {data.kind === "pie" ? (
        <PieChart>
          <Pie
            data={data.pie.slices.map((s) => ({ name: s.name, value: s.value, fill: chartColor(s.index) }))}
            dataKey="value"
            nameKey="name"
            outerRadius="85%"
            stroke="var(--bg-raised)"
            strokeWidth={2}
            isAnimationActive={false}
          />
          {tooltip}
        </PieChart>
      ) : data.kind === "line" ? (
        <LineChart data={data.rows} margin={margin}>
          {Axes()}
          {tooltip}
          {data.series.map((s, j) => (
            <Line
              key={j}
              dataKey={`s${j}`}
              name={s.name}
              type="linear"
              stroke={chartColor(j)}
              strokeWidth={2}
              dot={{ r: 4, fill: chartColor(j), stroke: "var(--bg-raised)", strokeWidth: 2 }}
              activeDot={{ r: 5, fill: chartColor(j), stroke: "var(--bg-raised)", strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={data.rows} margin={margin} barGap={2}>
          {Axes()}
          {tooltip}
          {data.series.map((s, j) => (
            <Bar key={j} dataKey={`s${j}`} name={s.name} fill={chartColor(j)} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
