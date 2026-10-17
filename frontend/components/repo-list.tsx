"use client";

import * as React from "react";
import Link from "next/link";
import { FolderGit2, Lock, Search, Star } from "lucide-react";
import { DataTypeBadge } from "@/components/data-type-badge";
import { BadgeOverflow } from "@/components/ui/badge-overflow";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { Repo } from "@/lib/data";

type Visibility = "all" | "public" | "private";
type Sort = "updated" | "name" | "stars";

const sortLabels: Record<Sort, string> = { updated: "Last updated", name: "Name", stars: "Stars" };

// "3 hours ago" style strings -> minutes, for sorting mock data.
function ageInMinutes(updated: string) {
  const m = updated.match(/(\d+)\s+(minute|hour|day|week|month)/);
  if (!m) return 0;
  const unit = { minute: 1, hour: 60, day: 1440, week: 10080, month: 43200 }[m[2] as "minute"];
  return Number(m[1]) * unit;
}

/** Repositories with filter, visibility toggle and sort (DESIGN.md §5 lists over cards). */
export function RepoList({
  repos,
  emptyHref = "/new",
  empty,
}: {
  repos: Repo[];
  emptyHref?: string;
  empty?: { title: string; description: string; label: string };
}) {
  const [query, setQuery] = React.useState("");
  const [visibility, setVisibility] = React.useState<Visibility>("all");
  const [sort, setSort] = React.useState<Sort>("updated");

  const q = query.trim().toLowerCase();
  const shown = repos
    .filter((r) => visibility === "all" || r.visibility === visibility)
    .filter((r) => !q || `${r.owner}/${r.name} ${r.description} ${r.tags.join(" ")}`.toLowerCase().includes(q))
    .toSorted((a, b) =>
      sort === "name" ? a.name.localeCompare(b.name) : sort === "stars" ? b.stars - a.stars : ageInMinutes(a.updated) - ageInMinutes(b.updated),
    );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <InputGroup className="h-8 w-full sm:w-72 sm:flex-none">
          <InputGroupAddon>
            <Search aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Filter repositories"
            placeholder="Filter by name, data type or description…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </InputGroup>
        <ToggleGroup
          variant="outline"
          size="sm"
          spacing={0}
          value={[visibility]}
          onValueChange={(v) => v[0] && setVisibility(v[0] as Visibility)}
          aria-label="Visibility"
        >
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="public">Public</ToggleGroupItem>
          <ToggleGroupItem value="private">Private</ToggleGroupItem>
        </ToggleGroup>
        <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
          <SelectTrigger size="sm" className="w-36" aria-label="Sort repositories">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              {(Object.keys(sortLabels) as Sort[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {sortLabels[s]}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </div>

      {shown.length === 0 ? (
        q || visibility !== "all" ? (
          <EmptyState
            icon={Search}
            title="No repositories match"
            description="Try a different name or data type, or show all repositories."
            action={
              <Button variant="outline" size="sm" onClick={() => { setQuery(""); setVisibility("all"); }}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={FolderGit2}
            title={empty?.title ?? "No repositories yet"}
            description={empty?.description ?? "Create one and push your first DEM, shapefile or model with the CLI."}
            action={<Button size="sm" href={emptyHref}>{empty?.label ?? "New repository"}</Button>}
          />
        )
      ) : (
        <ul className="flex flex-col divide-y divide-border border border-border bg-card" aria-label="Repositories">
          {shown.map((repo) => (
            <li key={`${repo.owner}/${repo.name}`} className="group relative flex flex-col gap-2 px-4 py-3.5 transition-colors hover:bg-muted/20">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/${repo.owner}/${repo.name}`}
                  data-list-item
                  className="min-w-0 truncate font-semibold text-blue-500 hover:text-blue-400 hover:underline after:absolute after:inset-0"
                >
                  {repo.owner}/{repo.name}
                </Link>
                <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                  {repo.visibility === "private" && <Lock className="size-3" aria-hidden />}
                  <span className="capitalize">{repo.visibility}</span>
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground text-pretty">{repo.description}</p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                <BadgeOverflow
                  items={repo.tags}
                  lineCount={1}
                  className="flex min-w-0 flex-wrap gap-1.5"
                  renderBadge={(t) => <DataTypeBadge type={t} />}
                  renderOverflow={(n) => <Badge variant="outline">+{n}</Badge>}
                />
                <span className="font-mono tabular-nums">{repo.size}</span>
                <span className="flex items-center gap-1 tabular-nums">
                  <Star className="size-3.5" aria-hidden />
                  {repo.stars}
                  <span className="sr-only">stars</span>
                </span>
                <span className="ml-auto">Updated {repo.updated}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        Showing {shown.length} of {repos.length} repositories
      </p>
    </div>
  );
}
