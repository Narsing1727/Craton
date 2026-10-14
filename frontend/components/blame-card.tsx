// Where each part of a file came from: the commit that last rewrote each byte range. Files are stored as
// content-defined chunks, so this is exact; a re-surveyed strip of a DEM appears as its own range.

import Link from "next/link";
import type { ApiBlame } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const COLORS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function BlameCard({ blame, base }: { blame: ApiBlame; base: string }) {
  // One colour per commit, in order of first appearance along the file.
  const order: string[] = [];
  for (const r of blame.ranges) if (!order.includes(r.commit)) order.push(r.commit);
  const colour = (sha: string) => COLORS[order.indexOf(sha) % COLORS.length];
  const commits = order.map((sha) => {
    const rs = blame.ranges.filter((r) => r.commit === sha);
    return { sha, first: rs[0], bytes: rs.reduce((n, r) => n + (r.end - r.start), 0) };
  });
  if (commits.length < 2) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="blame-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="blame-title" className="text-sm font-semibold">Where each part came from</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{blame.chunks} chunks · {formatBytes(blame.size)}</span>
      </div>
      <div className="flex h-5 w-full overflow-hidden border border-border" role="img" aria-label={`The file's ${formatBytes(blame.size)} from top to bottom, coloured by the commit that last rewrote each part`}>
        {blame.ranges.map((r) => (
          <span key={`${r.start}`} style={{ width: `${((r.end - r.start) / blame.size) * 100}%`, background: colour(r.commit) }} title={`${formatBytes(r.start)} to ${formatBytes(r.end)}: ${r.message.split(String.fromCharCode(10))[0]}`} />
        ))}
      </div>
      <ul className="flex flex-col divide-y divide-border border border-border bg-card text-sm">
        {commits.map((c) => (
          <li key={c.sha} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
            <span className="size-3 shrink-0" style={{ background: colour(c.sha) }} aria-hidden />
            <Link href={`${base}/commit/${c.sha}`} className="font-mono text-xs hover:underline">{c.sha.slice(0, 7)}</Link>
            <span className="min-w-0 flex-1 truncate">{c.first.message.split(String.fromCharCode(10))[0]}</span>
            <span className="text-xs text-muted-foreground">{c.first.author} · {c.first.timestamp.slice(0, 10)}</span>
            <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">{formatBytes(c.bytes)}</span>
          </li>
        ))}
      </ul>
      {blame.truncated && <p className="text-xs text-muted-foreground">The history is longer than the walk limit; the oldest part may be older than shown.</p>}
    </section>
  );
}
