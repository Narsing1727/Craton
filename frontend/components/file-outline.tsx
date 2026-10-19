// The outline of a model text file: a SWMM input's sections with how many rows each holds, or a HEC-RAS file's settings as a table.

import type { Structure } from "@/lib/structured";

export function FileOutline({ structure }: { structure: Structure }) {
  if (structure.kind === "sections") {
    return (
      <div className="max-h-[36rem] overflow-auto" tabIndex={0} role="region" aria-label="Sections of this file">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 border-b border-border bg-card text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Section</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Rows</th>
              <th scope="col" className="px-4 py-2 font-medium">First rows</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border align-top font-mono">
            {structure.sections.map((s) => (
              <tr key={`${s.name}:${s.line}`}>
                <th scope="row" className="px-4 py-2 text-left font-medium">[{s.name}]</th>
                <td className="px-4 py-2 text-right tabular-nums">{s.rows.toLocaleString("en-US")}</td>
                <td className="max-w-md px-4 py-2 text-muted-foreground">
                  {s.sample.length ? (
                    <span className="flex flex-col gap-0.5">
                      {s.sample.slice(0, 3).map((row, i) => (
                        <span key={i} className="truncate">{row}</span>
                      ))}
                    </span>
                  ) : (
                    "empty"
                  )}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-muted-foreground">{s.line.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      <div className="max-h-[36rem] overflow-auto" tabIndex={0} role="region" aria-label="Settings in this file">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 border-b border-border bg-card text-muted-foreground">
            <tr>
              <th scope="col" className="px-4 py-2 font-medium">Setting</th>
              <th scope="col" className="px-4 py-2 font-medium">Value</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Line</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border font-mono">
            {structure.pairs.map((p, i) => (
              <tr key={`${p.line}:${i}`}>
                <th scope="row" className="px-4 py-1.5 text-left font-normal text-muted-foreground">{p.key}</th>
                <td className="break-words px-4 py-1.5">{p.value || <span className="text-muted-foreground">empty</span>}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-muted-foreground">{p.line.toLocaleString("en-US")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-4 py-2 text-xs text-muted-foreground">
        {structure.total.toLocaleString("en-US")} settings{structure.total > structure.pairs.length ? ` (the first ${structure.pairs.length.toLocaleString("en-US")} shown)` : ""}
        {structure.others > 0 ? ` · ${structure.others.toLocaleString("en-US")} other ${structure.others === 1 ? "line" : "lines"} of data, in the Text tab` : ""}
      </p>
    </div>
  );
}
