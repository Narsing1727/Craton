// What changed since the previous release: commits, and each file that was added, removed or rewritten,
// from the same compare the pull request page uses. Renders nothing when the two can't be compared.

import Link from "next/link";
import { api } from "@/lib/api";
import { formatBytes } from "@/lib/format";

const WORD = { added: "added", removed: "removed", modified: "changed" } as const;

export async function ReleaseChanges({ owner, repo, previous, baseSha, current, headSha }: { owner: string; repo: string; previous: string; baseSha: string; current: string; headSha: string }) {
  const cmp = await api.compare(owner, repo, baseSha, headSha).catch(() => null);
  if (!cmp) return null;
  const files = cmp.changes;
  const shown = files.slice(0, 6);
  const rewritten = files.reduce((n, f) => n + f.chunks.addedBytes, 0);
  return (
    <section aria-label={`Changes from ${previous} to ${current}`} className="flex flex-col gap-2 border border-border p-3">
      <p className="text-xs text-muted-foreground">
        Since <span className="font-mono text-foreground">{previous}</span>: {cmp.ahead} {cmp.ahead === 1 ? "commit" : "commits"}, {files.length} {files.length === 1 ? "file" : "files"} changed
        {rewritten > 0 ? `, ${formatBytes(rewritten)} of new data` : ""}
      </p>
      {files.length === 0 ? (
        <p className="text-xs text-muted-foreground">The data is identical.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-xs">
          {shown.map((f) => (
            <li key={f.path} className="flex flex-wrap items-baseline gap-x-2">
              <span className="w-14 shrink-0 text-muted-foreground">{WORD[f.change]}</span>
              <Link href={`/${owner}/${repo}/blob/${f.path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(headSha)}`} className="font-mono hover:underline">
                {f.path}
              </Link>
              {f.change === "modified" && f.chunks.added + f.chunks.shared > 0 && (
                <span className="tabular-nums text-muted-foreground">
                  {f.chunks.added} of {f.chunks.added + f.chunks.shared} chunks rewritten
                </span>
              )}
            </li>
          ))}
          {files.length > shown.length && <li className="text-muted-foreground">and {files.length - shown.length} more</li>}
        </ul>
      )}
    </section>
  );
}
