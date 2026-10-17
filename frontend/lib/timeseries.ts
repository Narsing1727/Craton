// Time series from a table: which column holds the time, which the value, optionally which names the series
// (a station, a gauge). Everything here is pure so it can be tested; the chart is drawn as plain SVG.


/** A plain decimal number, or NaN. */
function numericColumn(rows: string[][], index: number): number[] {
  return rows.map((r) => {
    const t = (r[index] ?? "").trim();
    return t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? NaN : Number(t);
  });
}

export type Point = { t: number; v: number };
export type Series = { name: string; points: Point[] };

/** The first column whose non-empty cells (at least 3) all parse as dates. */
export function detectTimeColumn(columns: string[], rows: string[][]): number {
  for (let c = 0; c < columns.length; c++) {
    const cells = rows.slice(0, 50).map((r) => (r[c] ?? "").trim()).filter(Boolean);
    if (cells.length >= 3 && cells.every((s) => /\d{4}-\d{2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4}/.test(s) && !Number.isNaN(Date.parse(s)))) return c;
  }
  return -1;
}

export function buildSeries(rows: string[][], timeCol: number, valueCol: number, byCol = -1, maxSeries = 6, maxPoints = 800): Series[] {
  const values = numericColumn(rows, valueCol);
  const groups = new Map<string, Point[]>();
  rows.forEach((r, i) => {
    const t = Date.parse((r[timeCol] ?? "").trim());
    const v = values[i];
    if (Number.isNaN(t) || Number.isNaN(v)) return;
    const key = byCol >= 0 ? (r[byCol] ?? "").trim() || "(blank)" : "";
    (groups.get(key) ?? groups.set(key, []).get(key)!).push({ t, v });
  });
  return [...groups.entries()]
    .slice(0, maxSeries)
    .map(([name, pts]) => {
      pts.sort((a, b) => a.t - b.t);
      const stride = Math.ceil(pts.length / maxPoints);
      return { name, points: stride > 1 ? pts.filter((_, i) => i % stride === 0) : pts };
    });
}

/** "Nice" tick values covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const raw = (max - min) / Math.max(1, count - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) out.push(Math.round(v / step) * step);
  return out;
}

export type Chart = {
  width: number;
  height: number;
  xTicks: { x: number; label: string }[];
  yTicks: { y: number; label: string }[];
  lines: { name: string; d: string; overlay: boolean }[];
  empty: boolean;
};

const pad = { l: 52, r: 12, t: 10, b: 24 };

/** Scale series (and an optional previous-version overlay) into an SVG-sized chart description. */
export function buildChart(series: Series[], overlay: Series[] = [], width = 760, height = 240): Chart {
  const all = [...series, ...overlay].flatMap((s) => s.points);
  if (all.length === 0) return { width, height, xTicks: [], yTicks: [], lines: [], empty: true };
  let t0 = Infinity, t1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of all) {
    if (p.t < t0) t0 = p.t;
    if (p.t > t1) t1 = p.t;
    if (p.v < v0) v0 = p.v;
    if (p.v > v1) v1 = p.v;
  }
  const yt = niceTicks(v0, v1);
  const lo = Math.min(v0, yt[0] ?? v0), hi = Math.max(v1, yt[yt.length - 1] ?? v1);
  const x = (t: number) => pad.l + (t1 === t0 ? 0.5 : (t - t0) / (t1 - t0)) * (width - pad.l - pad.r);
  const y = (v: number) => height - pad.b - (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const f = (n: number) => Math.round(n * 10) / 10;
  const path = (pts: Point[]) => pts.map((p, i) => `${i ? "L" : "M"}${f(x(p.t))} ${f(y(p.v))}`).join(" ");
  const span = t1 - t0;
  const fmtT = (t: number) => {
    const d = new Date(t);
    const date = d.toISOString().slice(0, 10);
    return span < 3 * 86_400_000 ? `${date.slice(5)} ${d.toISOString().slice(11, 16)}` : date;
  };
  const xTicks = Array.from({ length: 5 }, (_, i) => t0 + (span * i) / 4).map((t) => ({ x: f(x(t)), label: fmtT(t) }));
  const num = (v: number) => (Math.abs(v) >= 1000 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));
  return {
    width,
    height,
    xTicks,
    yTicks: yt.map((v) => ({ y: f(y(v)), label: num(v) })),
    lines: [
      ...overlay.map((s) => ({ name: `${s.name || "previous"} (before)`, d: path(s.points), overlay: true })),
      ...series.map((s) => ({ name: s.name, d: path(s.points), overlay: false })),
    ],
    empty: false,
  };
}
