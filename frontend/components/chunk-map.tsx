// A file's new version as its chunks, in file order: which parts are new and which were reused
// from the previous version. Long files are bucketed to at most 96 cells.

import { formatBytes } from "@/lib/format";

export function ChunkMap({ map, before, after, change }: { map: string; before: number; after: number; change?: string }) {
  if (change === "removed") return <p className="text-xs text-muted-foreground">Removed. {formatBytes(before)} stays in history and can be restored with a revert.</p>;
  const cells = Math.min(96, map.length);
  const per = map.length / Math.max(1, cells);
  const buckets = Array.from({ length: cells }, (_, i) => map.slice(Math.floor(i * per), Math.floor((i + 1) * per)).includes("n"));
  const fresh = [...map].filter((c) => c === "n").length;
  return (
    <figure className="flex flex-col gap-2">
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${Math.max(1, cells)}, minmax(0, 1fr))` }}
        role="img"
        aria-label={`${fresh} of ${map.length} chunks are new; the rest are reused from the previous version.`}
      >
        {buckets.map((isNew, i) => (
          <span key={i} className={isNew ? "h-6 bg-chart-1" : "h-6 bg-muted"} />
        ))}
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 bg-chart-1" aria-hidden /> New
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 bg-muted" aria-hidden /> Reused
          </span>
        </span>
        <span className="font-mono tabular-nums">
          {change === "added" ? "" : `${formatBytes(before)} → `}
          {formatBytes(after)}
        </span>
      </figcaption>
    </figure>
  );
}
