import type { ApiTableDiff } from "@/lib/api";

const num = (n: number) => n.toLocaleString("en-US");
const signed = (d: number) => `${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(d).toLocaleString("en-US", { maximumFractionDigits: 6 })}`;

function Chip({ children, tone }: { children: React.ReactNode; tone?: "added" | "removed" | "changed" }) {
  const cls = tone === "added" ? "border-chart-2/50 text-chart-2" : tone === "removed" ? "border-destructive/50 text-destructive" : "border-border text-muted-foreground";
  return <span className={`inline-flex items-center border px-2 py-0.5 text-xs tabular-nums ${cls}`}>{children}</span>;
}

/** A table's change between two versions: what was added, removed and corrected, cell by cell. */
export function TableDiffView({ diff, previous }: { diff: ApiTableDiff; previous: string }) {
  const { rows, columns, changed, added, removed } = diff;
  const nothing = rows.added === 0 && rows.removed === 0 && rows.changed === 0 && columns.added.length === 0 && columns.removed.length === 0;
  const cols = [...columns.common, ...columns.added];
  const removedCols = [...columns.common, ...columns.removed];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        {rows.added > 0 && <Chip tone="added">+{num(rows.added)} {rows.added === 1 ? "row" : "rows"}</Chip>}
        {rows.removed > 0 && <Chip tone="removed">−{num(rows.removed)} {rows.removed === 1 ? "row" : "rows"}</Chip>}
        {rows.changed > 0 && <Chip tone="changed">{num(rows.changed)} changed</Chip>}
        <Chip>{num(rows.unchanged)} unchanged</Chip>
        {columns.added.map((c) => (
          <Chip key={`a${c}`} tone="added">
            + column {c}
          </Chip>
        ))}
        {columns.removed.map((c) => (
          <Chip key={`r${c}`} tone="removed">
            − column {c}
          </Chip>
        ))}
        <span className="ml-auto text-xs text-muted-foreground">
          {diff.matchedBy.kind === "key" ? (
            <>
              Rows matched by <span className="font-mono">{diff.matchedBy.columns.join(" + ")}</span>
            </>
          ) : (
            "Rows matched by position (no column identifies a row uniquely)"
          )}
        </span>
      </div>

      {nothing && <p className="px-4 py-6 text-sm text-muted-foreground">No differences from <span className="font-mono">{previous.slice(0, 7)}</span>: every row and column is the same.</p>}

      {changed.length > 0 && (
        <section aria-label="Changed rows" className="overflow-x-auto" tabIndex={0}>
          <h3 className="border-b border-border bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground">Changed rows</h3>
          <table className="w-full text-left font-mono text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-2 font-medium">Row</th>
                <th scope="col" className="px-3 py-2 font-medium">Column</th>
                <th scope="col" className="px-3 py-2 font-medium">Before</th>
                <th scope="col" className="px-3 py-2 font-medium">After</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Change</th>
              </tr>
            </thead>
            {changed.map((r) => (
              <tbody key={r.row} className="border-b border-border last:border-0">
                {r.cells.map((c, i) => (
                  <tr key={c.column}>
                    <td className="px-4 py-1.5 align-top text-foreground">{i === 0 ? <>{r.key} <span className="text-muted-foreground">· line {r.row}</span></> : ""}</td>
                    <td className="px-3 py-1.5 text-muted-foreground">{c.column}</td>
                    <td className="px-3 py-1.5 tabular-nums text-destructive/90 line-through decoration-destructive/40">{c.before || "(empty)"}</td>
                    <td className="px-3 py-1.5 tabular-nums font-medium text-chart-2">{c.after || "(empty)"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{c.delta === null ? "" : signed(c.delta)}</td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </section>
      )}

      {added.length > 0 && <RowList title="Added rows" tone="added" columns={cols} rows={added} />}
      {removed.length > 0 && <RowList title="Removed rows" tone="removed" columns={removedCols} rows={removed} />}

      {diff.truncated && <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">Showing the first rows of each kind. The counts above are for the whole file.</p>}
    </div>
  );
}

function RowList({ title, tone, columns, rows }: { title: string; tone: "added" | "removed"; columns: string[]; rows: { key: string; row: number; values: Record<string, string> }[] }) {
  return (
    <section aria-label={title} className="overflow-x-auto border-t border-border" tabIndex={0}>
      <h3 className="border-b border-border bg-muted/20 px-4 py-2 text-xs font-medium text-muted-foreground">{title}</h3>
      <table className="w-full text-left font-mono text-xs">
        <thead className="border-b border-border text-muted-foreground">
          <tr>
            <th scope="col" className="px-4 py-2 font-medium">Line</th>
            {columns.map((c) => (
              <th key={c} scope="col" className="px-3 py-2 font-medium">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className={`divide-y divide-border ${tone === "added" ? "bg-chart-2/5" : "bg-destructive/5"}`}>
          {rows.map((r) => (
            <tr key={r.row}>
              <td className="px-4 py-1.5 text-muted-foreground">{tone === "added" ? "+" : "−"} {r.row}</td>
              {columns.map((c) => (
                <td key={c} className="px-3 py-1.5 tabular-nums">{r.values[c] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
