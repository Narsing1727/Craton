// What each column of a table means, from `.craton-dictionary.json` in the repository. Shown under the table;
// columns with no entry are listed as such, and a starter file can be downloaded with the blanks filled in.

import { Download } from "lucide-react";
import { DICTIONARY_FILE, entriesFor, starterDictionary, type Dictionary } from "@/lib/dictionary";
import { DictionaryEditor } from "@/components/dictionary-editor";

export function DataDictionary({ dict, path, columns, exists, noun = "columns", edit }: { dict: Dictionary; path: string; columns: string[]; exists: boolean; noun?: "columns" | "fields"; edit?: { owner: string; repo: string; currentText: string; branch: string; head?: string } }) {
  if (columns.length === 0) return null;
  const rows = entriesFor(dict, path, columns);
  const described = rows.filter((r) => r.entry).length;
  const starter = `data:application/json;charset=utf-8,${encodeURIComponent(starterDictionary(dict, path, columns))}`;
  return (
    <section className="flex flex-col gap-2" aria-labelledby="dictionary-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dictionary-title" className="text-sm font-semibold">Data dictionary</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{described} of {rows.length} {noun} described</span>
      </div>
      <div className="overflow-x-auto border border-border bg-card">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="px-4 py-2 font-normal">{noun === "fields" ? "Field" : "Column"}</th>
              <th scope="col" className="px-4 py-2 font-normal">Unit</th>
              <th scope="col" className="px-4 py-2 font-normal">Meaning</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map(({ column, entry }) => (
              <tr key={column}>
                <th scope="row" className="px-4 py-2 text-left font-mono text-xs font-normal">{column}</th>
                <td className="px-4 py-2 text-xs text-muted-foreground">{entry?.unit ?? "—"}</td>
                <td className={entry?.description ? "px-4 py-2" : "px-4 py-2 text-muted-foreground"}>{entry?.description ?? "Not described yet"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        {exists ? "Descriptions come from " : "Write descriptions in "}
        <code className="font-mono">{DICTIONARY_FILE}</code> at the repository root; it is versioned and reviewed like the data.{" "}
        <a href={starter} download={DICTIONARY_FILE} className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground">
          <Download className="size-3" aria-hidden /> Download a starter with these {noun}
        </a>
      </p>
      {edit && <DictionaryEditor owner={edit.owner} repo={edit.repo} path={path} columns={columns} currentText={edit.currentText} branch={edit.branch} head={edit.head} />}
    </section>
  );
}
