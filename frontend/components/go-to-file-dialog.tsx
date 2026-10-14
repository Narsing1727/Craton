"use client";

// The "Go to file" dialog itself. components/go-to-file.tsx listens for the key and loads this
// only when it is first needed, so the search UI isn't part of every repository page's JavaScript.
// The list of paths is fetched the first time it opens (it is only paths and sizes), then kept.

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FileText } from "lucide-react";
import { Command, CommandDialog, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { useRepoSummary } from "@/components/repo-context";
import { pathsAction } from "@/app/actions";
import { formatBytes } from "@/lib/format";
import { scorePath } from "@/lib/path-score";

type FileEntry = { path: string; size: number };

export default function GoToFileDialog({ owner, repo, open, onOpenChange }: { owner: string; repo: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const search = useSearchParams();
  const summary = useRepoSummary();
  const setOpen = onOpenChange;
  const [query, setQuery] = React.useState("");
  const [files, setFiles] = React.useState<FileEntry[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const defaultBranch = summary?.repo.defaultBranch ?? "main";
  const ref = search.get("ref") || defaultBranch;

  // The list belongs to a ref: forget it when the branch changes.
  React.useEffect(() => {
    setFiles(null);
    setError(null);
  }, [owner, repo, ref]);

  React.useEffect(() => {
    if (!open || files || error) return;
    let cancelled = false;
    pathsAction(owner, repo, ref).then((r) => {
      if (cancelled) return;
      if (r.ok) setFiles(r.files);
      else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [open, files, error, owner, repo, ref]);

  const results = React.useMemo(() => {
    if (!files) return [];
    return files
      .map((f) => ({ f, score: scorePath(query, f.path) }))
      .filter((r): r is { f: FileEntry; score: number } => r.score !== null)
      .sort((a, b) => b.score - a.score || (a.f.path < b.f.path ? -1 : 1))
      .slice(0, 50)
      .map((r) => r.f);
  }, [files, query]);

  function go(path: string) {
    setOpen(false);
    setQuery("");
    router.push(`/${owner}/${repo}/blob/${path.split("/").map(encodeURIComponent).join("/")}${ref === defaultBranch ? "" : `?ref=${encodeURIComponent(ref)}`}`);
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Go to file" description={`Find a file in ${owner}/${repo}`} className="sm:max-w-xl">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Go to file…" value={query} onValueChange={setQuery} />
        <CommandList>
          {error ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">{error}</div>
          ) : !files ? (
            <div className="px-4 py-6 text-center text-sm text-muted-foreground">Loading files…</div>
          ) : (
            <>
              <CommandEmpty>No file matches “{query}”.</CommandEmpty>
              {results.map((f) => (
                <CommandItem key={f.path} value={f.path} onSelect={() => go(f.path)}>
                  <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">{f.path}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{formatBytes(f.size)}</span>
                </CommandItem>
              ))}
              {files.length > 50 && !query && (
                <div className="px-4 py-2 text-center text-xs text-muted-foreground">Showing 50 of {files.length.toLocaleString("en-US")} files. Type to narrow.</div>
              )}
            </>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
