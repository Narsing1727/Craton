// A line diff of a text file between two versions (a HEC-RAS plan, an SWMM .inp, a README): the changed lines
// with a few around them, old and new line numbers in the margin. Plain, quiet colours; the sign carries meaning.

import type { ApiTextDiff } from "@/lib/api";

export function TextDiffView({ diff }: { diff: ApiTextDiff }) {
  return (
    <div className="border border-border bg-card" role="group" aria-label={`Line changes in ${diff.path}`}>
      <p className="border-b border-border px-3 py-2 text-xs text-muted-foreground tabular-nums">
        <span className="text-chart-2">+{diff.added}</span> <span className="text-destructive">{"\u2212"}{diff.removed}</span> lines
        {diff.replaced ? " · too different to match line by line; shown as a replacement" : ""}
      </p>
      {diff.hunks.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted-foreground">Only line endings or nothing at all changed.</p>
      ) : (
        <div className="max-h-96 overflow-auto">
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {diff.hunks.map((h, hi) => {
                let o = h.oldStart, n = h.newStart;
                return (
                  <HunkRows key={hi} hunk={h} first={hi === 0} startOld={o} startNew={n} />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {diff.truncated && <p className="border-t border-border px-3 py-2 text-xs text-muted-foreground">More changes follow; open the file to see them all.</p>}
    </div>
  );
}

function HunkRows({ hunk, first, startOld, startNew }: { hunk: ApiTextDiff["hunks"][number]; first: boolean; startOld: number; startNew: number }) {
  let o = startOld, n = startNew;
  return (
    <>
      {!first && (
        <tr>
          <td colSpan={4} className="border-y border-border bg-muted/40 px-3 py-0.5 text-muted-foreground">
            @@ {hunk.oldStart}, {hunk.newStart} @@
          </td>
        </tr>
      )}
      {hunk.lines.map((l, i) => {
        const oldNo = l.t === "+" ? "" : o++;
        const newNo = l.t === "-" ? "" : n++;
        return (
          <tr key={i} className={l.t === "+" ? "bg-chart-2/10" : l.t === "-" ? "bg-destructive/10" : undefined}>
            <td className="w-10 select-none px-2 text-right text-muted-foreground tabular-nums">{oldNo}</td>
            <td className="w-10 select-none px-2 text-right text-muted-foreground tabular-nums">{newNo}</td>
            <td className="w-4 select-none px-1 text-center text-muted-foreground" aria-label={l.t === "+" ? "added" : l.t === "-" ? "removed" : "unchanged"}>{l.t === " " ? "" : l.t === "-" ? "\u2212" : "+"}</td>
            <td className="whitespace-pre px-2">{l.text === "" ? "\u00a0" : l.text}</td>
          </tr>
        );
      })}
    </>
  );
}
