"use client";

// A table (CSV) as something to read and question: each column says what it holds (number, date, text), with its range and a small histogram
// drawn from the rows loaded; click a heading to sort, type to filter, page through the rows. Numbers line up on the right.

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Props = {
  columns: string[];
  rows: string[][];
  /** All the rows in the file, when more than were loaded. */
  totalRows: number;
};

type Profile = { type: "number" | "date" | "text"; filled: number; empty: number; min?: number; max?: number; mean?: number; distinct: number; top?: string; bins: number[] };

const BINS = 14;
const PAGE = 25;

const number = (s: string) => {
  const t = s.trim().replace(/,(?=\d{3}(\D|$))/g, "");
  return t !== "" && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : NaN;
};
const date = (s: string) => (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[-+]\d{2}:?\d{2})?)?$/.test(s.trim()) ? Date.parse(s.trim().replace(" ", "T")) : NaN);

function profileOf(values: string[]): Profile {
  let filled = 0, nums = 0, dates = 0;
  const seen = new Map<string, number>();
  for (const v of values) {
    if (v.trim() === "") continue;
    filled++;
    if (!Number.isNaN(number(v))) nums++;
    else if (!Number.isNaN(date(v))) dates++;
    if (seen.size < 5000) seen.set(v, (seen.get(v) ?? 0) + 1);
  }
  const type = filled > 0 && nums / filled >= 0.9 ? "number" : filled > 0 && dates / filled >= 0.9 ? "date" : "text";
  const base = { type, filled, empty: values.length - filled, distinct: seen.size, bins: new Array<number>(BINS).fill(0) } as Profile;
  if (type === "text") {
    let top = "", n = 0;
    for (const [k, c] of seen) if (c > n) (top = k), (n = c);
    return { ...base, top: seen.size < filled ? top : undefined };
  }
  const nums2 = values.map((v) => (type === "number" ? number(v) : date(v))).filter((x) => !Number.isNaN(x));
  let min = Infinity, max = -Infinity, sum = 0;
  for (const x of nums2) (min = Math.min(min, x)), (max = Math.max(max, x)), (sum += x);
  for (const x of nums2) base.bins[max > min ? Math.min(BINS - 1, Math.floor(((x - min) / (max - min)) * BINS)) : 0]++;
  return { ...base, min, max, mean: nums2.length ? sum / nums2.length : undefined };
}

const fmt = (v: number, type: Profile["type"]) => (type === "date" ? new Date(v).toISOString().slice(0, 10) : Math.abs(v) >= 1e6 || (v !== 0 && Math.abs(v) < 1e-3) ? v.toExponential(2) : Number(v.toPrecision(6)).toLocaleString("en-US"));

function Spark({ bins }: { bins: number[] }) {
  const tallest = Math.max(1, ...bins);
  return (
    <svg viewBox={`0 0 ${BINS * 4} 14`} width={BINS * 4} height={14} aria-hidden className="text-primary">
      {bins.map((n, i) => (
        <rect key={i} x={i * 4} y={14 - (n / tallest) * 14} width={3} height={(n / tallest) * 14} fill="currentColor" opacity={0.7} />
      ))}
    </svg>
  );
}

export function TableViewer({ columns, rows, totalRows }: Props) {
  const profiles = useMemo(() => columns.map((_, c) => profileOf(rows.map((r) => r[c] ?? ""))), [columns, rows]);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ col: number; down: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const [profile, setProfile] = useState(false);

  const order = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = rows.map((_, i) => i);
    if (q) list = list.filter((i) => rows[i].some((c) => c.toLowerCase().includes(q)));
    if (sort) {
      const p = profiles[sort.col];
      const key = (i: number) => (p.type === "number" ? number(rows[i][sort.col] ?? "") : p.type === "date" ? date(rows[i][sort.col] ?? "") : (rows[i][sort.col] ?? "").toLowerCase());
      list = [...list].sort((a, b) => {
        const x = key(a), y = key(b);
        const xe = x === "" || (typeof x === "number" && Number.isNaN(x)), ye = y === "" || (typeof y === "number" && Number.isNaN(y));
        if (xe || ye) return xe === ye ? 0 : xe ? 1 : -1; // empty cells go last, either way
        return (x < y ? -1 : x > y ? 1 : 0) * (sort.down ? -1 : 1);
      });
    }
    return list;
  }, [rows, query, sort, profiles]);

  const pages = Math.max(1, Math.ceil(order.length / PAGE));
  const at = Math.min(page, pages - 1);
  const visible = order.slice(at * PAGE, at * PAGE + PAGE);

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-xs">
        <label className="relative">
          <span className="sr-only">Filter the rows</span>
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => (setQuery(e.target.value), setPage(0))} placeholder="Filter rows" className="h-8 w-48 pl-7 text-xs" />
        </label>
        <span className="tabular-nums text-muted-foreground">
          {query ? `${order.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows match` : `${totalRows.toLocaleString("en-US")} rows · ${columns.length} columns`}
        </span>
        <Button type="button" size="sm" variant={profile ? "default" : "ghost"} aria-pressed={profile} className="ml-auto" onClick={() => setProfile(!profile)}>
          Column profile
        </Button>
      </div>

      {profile && (
        <div className="max-h-72 overflow-auto border-b border-border" tabIndex={0} role="region" aria-label="Column profile">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-border bg-card text-muted-foreground">
              <tr>
                {["Column", "Type", "Filled", "Distinct", "Min", "Mean", "Max", "Shape"].map((h) => (
                  <th key={h} scope="col" className={cn("px-3 py-2 font-medium", ["Filled", "Distinct", "Min", "Mean", "Max"].includes(h) && "text-right")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border font-mono">
              {columns.map((c, i) => {
                const p = profiles[i];
                return (
                  <tr key={`${c}:${i}`}>
                    <th scope="row" className="px-3 py-1.5 text-left font-medium">{c}</th>
                    <td className="px-3 py-1.5 text-muted-foreground">{p.type}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.filled.toLocaleString("en-US")}{p.empty > 0 && <span className="text-muted-foreground"> ({p.empty.toLocaleString("en-US")} empty)</span>}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.distinct.toLocaleString("en-US")}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.min !== undefined ? fmt(p.min, p.type) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.mean !== undefined && p.type === "number" ? fmt(p.mean, p.type) : "—"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{p.max !== undefined ? fmt(p.max, p.type) : "—"}</td>
                    <td className="px-3 py-1.5">{p.type !== "text" ? <Spark bins={p.bins} /> : p.top ? <span className="text-muted-foreground">most common: {p.top}</span> : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="max-h-[40rem] overflow-auto" tabIndex={0} role="region" aria-label="Table">
        <table className="w-full text-left font-mono text-xs">
          <thead className="sticky top-0 z-10 border-b border-border bg-card text-muted-foreground">
            <tr>
              <th scope="col" className="w-10 px-3 py-2 text-right font-medium">#</th>
              {columns.map((c, i) => {
                const p = profiles[i];
                const on = sort?.col === i;
                return (
                  <th key={`${c}:${i}`} scope="col" aria-sort={on ? (sort!.down ? "descending" : "ascending") : "none"} className={cn("px-3 py-2 align-bottom font-medium", p.type !== "text" && "text-right")}>
                    <button type="button" className={cn("flex items-center gap-1 hover:text-foreground", p.type !== "text" && "ml-auto")} onClick={() => (setSort(on && sort!.down ? null : { col: i, down: on }), setPage(0))}>
                      {c}
                      {on && (sort!.down ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                    </button>
                    <span className={cn("mt-1 flex items-center gap-1.5 text-[10px] font-normal text-muted-foreground/80", p.type !== "text" && "justify-end")}>
                      {p.type !== "text" && <Spark bins={p.bins} />}
                      <span className="tabular-nums">{p.type === "text" ? `${p.distinct.toLocaleString("en-US")} distinct` : `${fmt(p.min!, p.type)} – ${fmt(p.max!, p.type)}`}</span>
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {visible.map((i) => (
              <tr key={i} className="hover:bg-muted/40">
                <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{(i + 1).toLocaleString("en-US")}</td>
                {columns.map((_, c) => (
                  <td key={c} className={cn("px-3 py-1.5", profiles[c].type !== "text" && "text-right tabular-nums")}>
                    {rows[i][c] === "" || rows[i][c] === undefined ? <span className="text-muted-foreground/60">—</span> : rows[i][c]}
                  </td>
                ))}
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted-foreground">No rows match.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs text-muted-foreground">
        <span className="tabular-nums">
          {order.length === 0 ? "No rows" : `Rows ${(at * PAGE + 1).toLocaleString("en-US")}–${Math.min(order.length, at * PAGE + PAGE).toLocaleString("en-US")} of ${order.length.toLocaleString("en-US")}`}
          {totalRows > rows.length && !query ? ` loaded (the file has ${totalRows.toLocaleString("en-US")})` : ""}
        </span>
        <span className="flex items-center gap-1">
          <Button type="button" size="icon" variant="ghost" aria-label="Previous page" disabled={at === 0} onClick={() => setPage(at - 1)}>
            <ChevronLeft className="size-4" aria-hidden />
          </Button>
          <span className="tabular-nums">{at + 1} / {pages}</span>
          <Button type="button" size="icon" variant="ghost" aria-label="Next page" disabled={at >= pages - 1} onClick={() => setPage(at + 1)}>
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </span>
      </div>
    </div>
  );
}
