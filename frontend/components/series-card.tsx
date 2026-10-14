// A time-series chart of a table column, drawn as SVG on the server (no script): one line per station, and
// optionally the same data from the previous version in dashed grey so a change in the record shows up.

import { buildChart, type Series } from "@/lib/timeseries";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--primary)"];

export function SeriesCard({ columns, timeCol, valueCol, byCol, series, overlay, canOverlay, overlayOn, action, note }: {
  columns: string[];
  timeCol: string;
  valueCol: string;
  byCol: string;
  series: Series[];
  overlay: Series[];
  canOverlay: boolean;
  overlayOn: boolean;
  action: string;
  note?: string | null;
}) {
  const chart = buildChart(series, overlay);
  const select = (name: string, value: string, label: string, optional = false) => (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select name={name} defaultValue={value} className="h-8 min-w-32 border border-border bg-background px-2 text-sm">
        <option value="">{optional ? "None" : "Choose…"}</option>
        {columns.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
  return (
    <section className="flex flex-col gap-3" aria-labelledby="series-title">
      <h2 id="series-title" className="text-sm font-semibold">Plot over time</h2>
      <form method="get" action={action} className="flex flex-wrap items-end gap-3 border border-border bg-card p-4 text-sm">
        {select("ts_t", timeCol, "Time")}
        {select("ts_v", valueCol, "Value")}
        {select("ts_by", byCol, "One line per", true)}
        {canOverlay && (
          <label className="flex items-center gap-1.5 pb-1.5 text-xs">
            <input type="checkbox" name="ts_over" value="1" defaultChecked={overlayOn} /> Show the previous version
          </label>
        )}
        <button type="submit" className="h-8 border border-border px-3 text-sm hover:bg-muted">Plot</button>
      </form>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {!chart.empty && (
        <figure className="border border-border bg-card p-3">
          <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label={`${valueCol} over time`} className="h-auto w-full">
            {chart.yTicks.map((t) => (
              <g key={`y${t.y}`}>
                <line x1={52} x2={chart.width - 12} y1={t.y} y2={t.y} stroke="var(--border)" strokeWidth={1} />
                <text x={48} y={t.y + 3} textAnchor="end" fontSize={10} fill="var(--muted-foreground)">{t.label}</text>
              </g>
            ))}
            {chart.xTicks.map((t, i) => (
              <text key={`x${t.x}`} x={t.x} y={chart.height - 8} textAnchor={i === 0 ? "start" : i === chart.xTicks.length - 1 ? "end" : "middle"} fontSize={10} fill="var(--muted-foreground)">{t.label}</text>
            ))}
            {chart.lines.map((l, i) => (
              <path
                key={`${l.name}-${i}`}
                d={l.d}
                fill="none"
                stroke={l.overlay ? "var(--muted-foreground)" : COLORS[(i - chart.lines.filter((x) => x.overlay).length) % COLORS.length]}
                strokeWidth={l.overlay ? 1 : 1.5}
                strokeDasharray={l.overlay ? "4 3" : undefined}
                opacity={l.overlay ? 0.8 : 1}
              />
            ))}
          </svg>
          <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {chart.lines.filter((l) => !l.overlay).map((l, i) => (
              <span key={l.name} className="flex items-center gap-1.5">
                <span className="inline-block h-0.5 w-4" style={{ background: COLORS[i % COLORS.length] }} aria-hidden /> {l.name || valueCol}
              </span>
            ))}
            {chart.lines.some((l) => l.overlay) && <span className="flex items-center gap-1.5"><span className="inline-block w-4 border-t border-dashed border-muted-foreground" aria-hidden /> previous version</span>}
          </figcaption>
        </figure>
      )}
    </section>
  );
}
