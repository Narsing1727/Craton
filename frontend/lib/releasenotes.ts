// A starting point for release notes, written from what actually changed since the previous release: the
// commit messages and the files they touched. It is a draft to edit, never published as it is.

export type NoteCommit = { sha: string; message: string; author: string };
export type NoteFile = { path: string; change: "added" | "removed" | "modified"; chunksRewritten?: number; chunksTotal?: number };

const WORD = { added: "added", removed: "removed", modified: "changed" } as const;

export function draftNotes(opts: { latestVersion: string | null; commits: NoteCommit[]; files: NoteFile[]; maxFiles?: number }): string {
  const NL = String.fromCharCode(10);
  const { latestVersion, commits, files, maxFiles = 20 } = opts;
  const out: string[] = [latestVersion ? `Changes since ${latestVersion}:` : "Changes:", ""];
  if (commits.length === 0) out.push("- (no commits since the previous release)");
  for (const c of commits) out.push(`- ${c.message.split(NL)[0]} (${c.sha.slice(0, 7)}, ${c.author})`);
  if (files.length) {
    out.push("", `Files changed (${files.length}):`);
    for (const f of files.slice(0, maxFiles)) {
      const detail = f.change === "modified" && f.chunksTotal ? `: ${f.chunksRewritten ?? 0} of ${f.chunksTotal} chunks rewritten` : "";
      out.push(`- ${WORD[f.change]} ${f.path}${detail}`);
    }
    if (files.length > maxFiles) out.push(`- and ${files.length - maxFiles} more`);
  }
  return out.join(NL);
}
