"use client";

import { useState } from "react";
import Link from "next/link";
import { FolderCode, GitCommit, Search, ShieldCheck } from "lucide-react";
import { CopyButton } from "@/components/craton-actions";
import { EmptyState, Initials } from "@/components/craton-ui";
import { DataTypeBadge } from "@/components/data-type-badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RefSelect } from "@/components/ref-select";
import { PreviewCard, PreviewCardPopup, PreviewCardTrigger } from "@/components/ui/preview-card";
import type { Commit } from "@/lib/data";
import { cn } from "@/lib/utils";

function group(timestamp: string) {
  if (/minute|hour/.test(timestamp)) return "Today";
  if (/day/.test(timestamp)) return "Earlier this week";
  return "Last week";
}

function changeSummary(c: Commit) {
  if (!c.files.length) return "No file changes";
  const unit = c.files[0].unit;
  if (unit === "chunks") {
    const added = c.files.reduce((n, f) => n + f.added, 0);
    return `${c.files.length} ${c.files.length === 1 ? "file" : "files"} · ${added.toLocaleString("en-US")} new chunks`;
  }
  const f = c.files[0];
  return `${(f.added + f.changed + f.removed).toLocaleString("en-US")} ${f.unit}`;
}

export function CommitsView({
  owner,
  repo,
  commits,
  branches,
  branch,
  defaultBranch,
}: {
  owner: string;
  repo: string;
  commits: Commit[];
  branches: string[];
  branch: string;
  defaultBranch: string;
}) {
  const base = `/${owner}/${repo}`;
  const [author, setAuthor] = useState("all");
  const [query, setQuery] = useState("");

  const authors = [...new Set(commits.map((c) => c.authorHandle))];
  const q = query.trim().toLowerCase();
  const shown = commits.filter(
    (c) =>
      (author === "all" || c.authorHandle === author) &&
      (!q || `${c.message} ${c.sha} ${c.files.map((f) => f.name).join(" ")}`.toLowerCase().includes(q)),
  );
  const groups = shown.reduce<Record<string, Commit[]>>((acc, c) => {
    (acc[group(c.timestamp)] ??= []).push(c);
    return acc;
  }, {});

  return (
    <>
      <h1 className="sr-only">Commits · {owner}/{repo}</h1>
      <div className="flex w-full flex-col gap-5 px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <RefSelect base={base} branches={branches} value={branch} defaultBranch={defaultBranch} target="commits" size="sm" />
          <Select value={author} onValueChange={setAuthor}>
            <SelectTrigger size="sm" className="w-36" aria-label="Author">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">All authors</SelectItem>
                {authors.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <InputGroup className="h-8 w-full sm:w-72 sm:flex-none">
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              type="search"
              aria-label="Search commits"
              placeholder="Search messages, SHAs or file paths…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </InputGroup>
          {commits.length > 0 && (
            <span className="ml-auto text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {shown.length} of {commits.length} commits on <span className="font-mono text-foreground">{branch}</span>
            </span>
          )}
        </div>

        {commits.length === 0 ? (
          // Nothing to filter yet: say so, and point to where the first commit comes from, instead of "No commits match".
          <EmptyState
            icon={GitCommit}
            title="No commits yet"
            description={branch === defaultBranch ? "The first push or upload creates the first commit." : `There are no commits on ${branch} yet.`}
            action={
              <Button variant="outline" size="sm" href={base}>
                Add files
              </Button>
            }
          />
        ) : shown.length === 0 ? (
          <EmptyState
            icon={GitCommit}
            title="No commits match"
            description="Try another message, SHA or file path."
            action={
              <Button variant="outline" size="sm" onClick={() => { setQuery(""); setAuthor("all"); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          Object.entries(groups).map(([label, items]) => (
            <section key={label} className="flex flex-col gap-2">
              <h2 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <GitCommit className="size-3.5" aria-hidden />
                {label}
              </h2>
              <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                {items.map((c) => {
                  const f = c.files.find((x) => x.dataType) ?? c.files[0];
                  return (
                    <li key={c.sha} className="relative flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/20">
                      <Initials name={c.authorHandle} className="mt-0.5" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <Link href={`${base}/commit/${c.sha}`} data-list-item className="truncate text-sm font-medium hover:underline after:absolute after:inset-0">
                          {c.message}
                        </Link>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          <span>
                            <span className="font-medium text-foreground">{c.author}</span> committed {c.timestamp}
                          </span>
                          {f?.dataType && <DataTypeBadge type={f.dataType} />}
                          <span className="font-mono tabular-nums">{changeSummary(c)}</span>
                          <span
                            className={cn(
                              "font-mono tabular-nums",
                              c.sizeDelta.startsWith("-") ? "text-destructive" : c.sizeDelta === "+0 B" ? "text-muted-foreground" : "text-chart-1",
                            )}
                          >
                            {c.sizeDelta}
                          </span>
                          <span className="flex items-center gap-1" title="Merkle root verified">
                            <ShieldCheck className="size-3.5 text-chart-1" aria-hidden />
                            Verified
                          </span>
                        </div>
                      </div>
                      <div className="relative z-10 flex shrink-0 items-center gap-1">
                        <CopyButton value={c.sha} label={`Copy SHA ${c.sha}`} />
                        <PreviewCard>
                          <PreviewCardTrigger
                            render={
                              <Link
                                href={`${base}/commit/${c.sha}`}
                                className="border border-border bg-muted/40 px-2 py-1 font-mono text-xs transition-colors hover:bg-muted"
                              />
                            }
                          >
                            {c.sha.slice(0, 7)}
                          </PreviewCardTrigger>
                          <PreviewCardPopup>
                            <p className="font-medium text-foreground">{c.message}</p>
                            <p className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                              <span>{c.author} · {c.timestamp}</span>
                              <span className="font-mono">{c.sha.slice(0, 7)}</span>
                            </p>
                            {c.merkleRoot && (
                              <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                                <ShieldCheck className="size-3 text-chart-1" aria-hidden /> Merkle root verified
                              </p>
                            )}
                          </PreviewCardPopup>
                        </PreviewCard>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          href={`${base}?ref=${c.sha}`}
                          aria-label={`Browse files at ${c.sha}`}
                          title="Browse files at this commit"
                        >
                          <FolderCode />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}
