// "Compare two columns": pick an observed and a simulated column of a table and see how well they agree. The form
// is a plain GET, so the result is a link that can be shared; the numbers are computed on the server from the
// whole file, not the 20-row preview.

import type { Fit } from "@/lib/fit";
import { rateNse } from "@/lib/fit";

const num = (v: number | null, d = 3) => (v === null ? "n/a" : v.toFixed(d));

export function FitCard({ columns, observed, simulated, by = "", groups = [], fit, action, note }: { columns: string[]; observed: string; simulated: string; by?: string; groups?: { name: string; fit: Fit }[]; fit: Fit | null; action: string; note?: string | null }) {
  const rating = fit ? rateNse(fit.nse) : null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="fit-title">
      <h2 id="fit-title" className="text-sm font-semibold">Compare two columns</h2>
      <form method="get" action={action} className="flex flex-wrap items-end gap-3 border border-border bg-card p-4 text-sm">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Observed</span>
          <select name="obs" defaultValue={observed} className="h-8 min-w-36 border border-border bg-background px-2 text-sm">
            <option value="">Choose…</option>
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Simulated</span>
          <select name="sim" defaultValue={simulated} className="h-8 min-w-36 border border-border bg-background px-2 text-sm">
            <option value="">Choose…</option>
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Also by</span>
          <select name="fit_by" defaultValue={by} className="h-8 min-w-36 border border-border bg-background px-2 text-sm">
            <option value="">None</option>
            {columns.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <button type="submit" className="h-8 border border-border px-3 text-sm hover:bg-muted">Compare</button>
      </form>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
      {fit && (
        <div className="border border-border bg-card">
          <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
            {[
              ["NSE", num(fit.nse), rating ?? ""],
              ["KGE", num(fit.kge), ""],
              ["PBIAS", fit.pbias === null ? "n/a" : `${fit.pbias.toFixed(1)}%`, fit.pbias === null ? "" : fit.pbias > 0 ? "model low" : fit.pbias < 0 ? "model high" : ""],
              ["RMSE", num(fit.rmse), ""],
              ["MAE", num(fit.mae), ""],
              ["r", num(fit.r), `${fit.n} pairs`],
            ].map(([k, v, hint]) => (
              <div key={k} className="flex flex-col gap-0.5 bg-card p-3">
                <dt className="text-xs text-muted-foreground">{k}</dt>
                <dd className="text-lg font-semibold tabular-nums">{v}</dd>
                <dd className="text-xs text-muted-foreground">{hint || "\u00a0"}</dd>
              </div>
            ))}
          </dl>
          {groups.length > 0 && (
            <div className="overflow-x-auto border-t border-border">
              <table className="w-full text-sm">
                <caption className="sr-only">Fit statistics for each {by}</caption>
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    {[by, "Pairs", "NSE", "KGE", "PBIAS", "RMSE", "Rating"].map((h) => <th key={h} scope="col" className="px-3 py-2 font-normal">{h}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border tabular-nums">
                  {groups.map((g) => (
                    <tr key={g.name}>
                      <th scope="row" className="px-3 py-2 text-left font-mono text-xs font-normal">{g.name}</th>
                      <td className="px-3 py-2">{g.fit.n}</td>
                      <td className="px-3 py-2">{num(g.fit.nse)}</td>
                      <td className="px-3 py-2">{num(g.fit.kge)}</td>
                      <td className="px-3 py-2">{g.fit.pbias === null ? "n/a" : `${g.fit.pbias.toFixed(1)}%`}</td>
                      <td className="px-3 py-2">{num(g.fit.rmse)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{rateNse(g.fit.nse) ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
            NSE: Nash and Sutcliffe (1970); KGE: Gupta et al. (2009); PBIAS positive means the model underestimates; ratings follow Moriasi et al. (2007) for monthly streamflow. Rows where either value is missing are left out.
          </p>
        </div>
      )}
    </section>
  );
}
