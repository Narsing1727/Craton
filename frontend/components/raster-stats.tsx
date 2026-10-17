// Numbers behind a raster change, shown under its heatmap: summary of each version, the cell-by-cell
// change, and a histogram of both versions over one shared range so a shift of the whole surface shows.
// Figures are computed on the sampled grid the heatmap is drawn from, shown in the viewer's display units.

"use client";

import type { ApiRasterStats } from "@/lib/api";
import { formatVolume, lengthUnit, toLength } from "@/lib/units";
import { useUnits } from "@/components/units";

const fmt = (n: number, digits = 2) => n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
const signed = (n: number, digits = 2) => `${n > 0 ? "+" : n < 0 ? "\u2212" : ""}${fmt(Math.abs(n), digits)}`;

export function RasterStats({ stats }: { stats: ApiRasterStats }) {
  const units = useUnits();
  const u = lengthUnit(units);
  const L = (m: number) => toLength(m, units);
  const { before, after, change, histogram: h } = stats;
  const rows: [string, number, number][] = [
    ["Lowest", before.min, after.min],
    ["5th percentile", before.p5, after.p5],
    ["Median", before.p50, after.p50],
    ["Mean", before.mean, after.mean],
    ["95th percentile", before.p95, after.p95],
    ["Highest", before.max, after.max],
  ];
  const peak = Math.max(1, ...h.before, ...h.after);
  const bins = h.before.length;
  const W = 240, H = 56;
  const bw = W / bins;

  return (
    <div className="grid gap-4 border border-border p-3 sm:grid-cols-2" aria-label="Raster statistics">
      <div className="min-w-0">
        <table className="w-full text-xs tabular-nums">
          <caption className="sr-only">Elevation statistics before and after, in {units === "imperial" ? "feet" : "metres"}</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th scope="col" className="pb-1 font-normal">Elevation ({u})</th>
              <th scope="col" className="pb-1 text-right font-normal">Before</th>
              <th scope="col" className="pb-1 text-right font-normal">After</th>
              <th scope="col" className="pb-1 text-right font-normal">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, a, b]) => (
              <tr key={label} className="border-t border-border">
                <th scope="row" className="py-1 text-left font-normal text-muted-foreground">{label}</th>
                <td className="py-1 text-right">{fmt(L(a))}</td>
                <td className="py-1 text-right">{fmt(L(b))}</td>
                <td className="py-1 text-right">{signed(L(b) - L(a))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted-foreground">
          {before.validCells.toLocaleString("en-US")} cells with data{before.nodataCells ? `, ${before.nodataCells.toLocaleString("en-US")} without` : ""}
          {stats.sampled.factor > 1.05 ? ` · sampled from a ${stats.sampled.sourceWidth} \u00d7 ${stats.sampled.sourceHeight} raster` : ""}
        </p>
      </div>

      <div className="min-w-0 space-y-3">
        {change ? (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <dt className="text-muted-foreground">Mean change</dt>
            <dd className="text-right tabular-nums">{signed(L(change.meanChange), 3)} {u}</dd>
            <dt className="text-muted-foreground">Typical size (RMSE)</dt>
            <dd className="text-right tabular-nums">{fmt(L(change.rmse), 3)} {u}</dd>
            <dt className="text-muted-foreground">Raised</dt>
            <dd className="text-right tabular-nums">{fmt(change.raisedPercent, 1)}% of cells</dd>
            <dt className="text-muted-foreground">Lowered</dt>
            <dd className="text-right tabular-nums">{fmt(change.loweredPercent, 1)}% of cells</dd>
            {change.volumeChange !== null && (
              <>
                <dt className="text-muted-foreground">Volume change</dt>
                <dd className="text-right tabular-nums">{formatVolume(change.volumeChange, units)}</dd>
              </>
            )}
          </dl>
        ) : (
          <p className="text-xs text-muted-foreground">The two versions have different dimensions, so there is no cell-by-cell change to measure.</p>
        )}
        <figure>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distribution of elevations before (outline) and after (filled)" className="h-14 w-full">
            {h.after.map((n, i) => (
              <rect key={`a${i}`} x={i * bw + 0.5} width={Math.max(0, bw - 1)} y={H - (n / peak) * H} height={(n / peak) * H} fill="var(--chart-2)" opacity={0.75} />
            ))}
            {h.before.map((n, i) => (
              <rect key={`b${i}`} x={i * bw + 0.5} width={Math.max(0, bw - 1)} y={H - (n / peak) * H} height={(n / peak) * H} fill="none" stroke="var(--muted-foreground)" strokeWidth={1} />
            ))}
          </svg>
          <figcaption className="flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{fmt(L(h.min), 1)} {u}</span>
            <span>before outlined, after filled</span>
            <span>{fmt(L(h.max), 1)} {u}</span>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}
