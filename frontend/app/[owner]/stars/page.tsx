import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, FolderGit2, Search, Star } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { RepoCard } from "@/components/repo-card";
import { loadStarred } from "@/lib/source";

type Params = { owner: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner } = await params;
  return { title: `Stars · ${owner}` };
}

export default async function UserStarsPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ q?: string }> }) {
  const { owner } = await params;
  const q = ((await searchParams).q ?? "").trim().toLowerCase();
  const { repos } = await loadStarred(owner);
  const shown = q ? repos.filter((r) => `${r.owner}/${r.name} ${r.description}`.toLowerCase().includes(q)) : repos;

  const tab = "flex items-center gap-2 border-b-2 px-3 py-3 text-sm transition-colors";
  return (
    <AppShell>
      <h1 className="sr-only">Repositories {owner} starred</h1>
      <div className="w-full border-b border-border bg-card/30">
        <nav aria-label="Profile" className="flex w-full gap-2 overflow-x-auto px-4 sm:px-6 lg:px-8 xl:px-10">
          <Link href={`/${owner}`} className={`${tab} border-transparent font-medium text-muted-foreground hover:text-foreground`}>
            <BookOpen className="size-4" aria-hidden /> Overview
          </Link>
          <Link href={`/${owner}?tab=repositories`} className={`${tab} border-transparent font-medium text-muted-foreground hover:text-foreground`}>
            <FolderGit2 className="size-4" aria-hidden /> Repositories
          </Link>
          <Link href={`/${owner}/stars`} aria-current="page" className={`${tab} border-accent font-semibold text-foreground`}>
            <Star className="size-4" aria-hidden /> Stars
            <Badge variant="secondary" className="ml-1 text-xs tabular-nums">{repos.length}</Badge>
          </Link>
        </nav>
      </div>

      <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8 xl:px-10">
        <form className="flex flex-wrap items-center justify-between gap-4 pb-6" role="search">
          <label className="relative w-full max-w-sm">
            <span className="sr-only">Search starred repositories</span>
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
            <Input name="q" defaultValue={q} placeholder="Search starred repositories…" className="h-9 pl-8 text-xs" />
          </label>
          <span className="font-mono text-xs text-muted-foreground tabular-nums" aria-live="polite">
            {shown.length} {shown.length === 1 ? "repository" : "repositories"}
          </span>
        </form>

        {shown.length === 0 ? (
          <p className="border border-border/40 p-8 text-center text-sm text-muted-foreground">
            {q ? "No starred repositories match." : `${owner} hasn’t starred any repositories you can see.`}
          </p>
        ) : (
          <div className="grid gap-0 divide-y divide-border/20 border border-border/20">
            {shown.map((r) => (
              <RepoCard key={`${r.owner}/${r.name}`} repo={r} />
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
