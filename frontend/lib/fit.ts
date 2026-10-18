// Goodness-of-fit between observed and simulated series, the way hydrologists report a calibration:
//   NSE   Nash and Sutcliffe (1970), 1 is perfect, 0 is no better than the mean of the observations
//   KGE   Gupta et al. (2009), 1 is perfect
//   PBIAS percent bias (Gupta et al. 1999), positive when the model underestimates
//   plus RMSE, MAE and the Pearson correlation.
// Pairs where either value is missing are dropped. Ratings follow Moriasi et al. (2007, monthly streamflow).

export type Fit = { n: number; nse: number | null; kge: number | null; pbias: number | null; rmse: number; mae: number; r: number | null };

export function fitStatistics(observed: number[], simulated: number[]): Fit | null {
  const o: number[] = [], s: number[] = [];
  const m = Math.min(observed.length, simulated.length);
  for (let i = 0; i < m; i++) {
    if (Number.isFinite(observed[i]) && Number.isFinite(simulated[i])) {
      o.push(observed[i]);
      s.push(simulated[i]);
    }
  }
  const n = o.length;
  if (n < 2) return null;
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  const mo = mean(o), ms = mean(s);
  let sse = 0, sst = 0, abs = 0, sumO = 0, diff = 0, cov = 0, vo = 0, vs = 0;
  for (let i = 0; i < n; i++) {
    const e = o[i] - s[i];
    sse += e * e;
    abs += Math.abs(e);
    sst += (o[i] - mo) ** 2;
    sumO += o[i];
    diff += e;
    cov += (o[i] - mo) * (s[i] - ms);
    vo += (o[i] - mo) ** 2;
    vs += (s[i] - ms) ** 2;
  }
  const r = vo > 0 && vs > 0 ? cov / Math.sqrt(vo * vs) : null;
  const sdo = Math.sqrt(vo / n), sds = Math.sqrt(vs / n);
  const kge = r !== null && mo !== 0 && sdo > 0 ? 1 - Math.sqrt((r - 1) ** 2 + (sds / sdo - 1) ** 2 + (ms / mo - 1) ** 2) : null;
  return {
    n,
    nse: sst > 0 ? 1 - sse / sst : null,
    kge,
    pbias: sumO !== 0 ? (100 * diff) / sumO : null,
    rmse: Math.sqrt(sse / n),
    mae: abs / n,
    r,
  };
}

/** The same statistics for each value of a grouping column (a station name), at most `limit` groups, largest first. */
export function fitByGroup(rows: string[][], obsCol: number, simCol: number, byCol: number, limit = 30) {
  const o = numericColumn(rows, obsCol), s = numericColumn(rows, simCol);
  const groups = new Map<string, { o: number[]; s: number[] }>();
  rows.forEach((r, i) => {
    const key = (r[byCol] ?? "").trim() || "(blank)";
    const g = groups.get(key) ?? groups.set(key, { o: [], s: [] }).get(key)!;
    g.o.push(o[i]);
    g.s.push(s[i]);
  });
  return [...groups.entries()]
    .map(([name, g]) => ({ name, fit: fitStatistics(g.o, g.s) }))
    .filter((x): x is { name: string; fit: Fit } => x.fit !== null)
    .sort((a, b) => b.fit.n - a.fit.n || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Moriasi et al. (2007) performance rating for NSE. */
export function rateNse(nse: number | null): "Very good" | "Good" | "Satisfactory" | "Unsatisfactory" | null {
  if (nse === null) return null;
  if (nse > 0.75) return "Very good";
  if (nse > 0.65) return "Good";
  if (nse > 0.5) return "Satisfactory";
  return "Unsatisfactory";
}

/** The numeric values of a column, with anything that isn't a plain number as NaN. */
export function numericColumn(rows: string[][], index: number): number[] {
  return rows.map((r) => {
    const t = (r[index] ?? "").trim();
    return t === "" || !/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? NaN : Number(t);
  });
}
