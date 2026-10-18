"use client";

import { useState } from "react";
import Link from "next/link";
import { MapPin, Search, Star, X } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, PageHeader, Section } from "@/components/craton-ui";
import { DataTypeBadge } from "@/components/data-type-badge";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { DataType, Repo } from "@/lib/data";
import { bboxContains, describeCentre, parseLatLon } from "@/lib/geo";

const filters: (DataType | "All")[] = ["All", "DEM", "Shapefile", "LiDAR", "NetCDF", "HEC-RAS", "SWMM"];
type Sort = "stars" | "updated" | "size";
const sortLabels: Record<Sort, string> = { stars: "Most starred", updated: "Recently updated", size: "Largest" };
const toGb = (s: string) => parseFloat(s) * (s.includes("MB") ? 0.001 : 1);
const ageMin = (u: string) => {
  const m = u.match(/(\d+)\s+(hour|day|week)/);
  return m ? Number(m[1]) * { hour: 60, day: 1440, week: 10080 }[m[2] as "hour"] : 0;
};

export function ExploreView({ repos, topic }: { repos: Repo[]; topic?: string }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string>("All");
  const [sort, setSort] = useState<Sort>("stars");
  const [place, setPlace] = useState("");

  const counts = new Map<string, number>();
  for (const r of repos) if (r.visibility === "public") for (const t of r.topics ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  const topics = [...counts.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1)).slice(0, 24);

  const q = query.trim().toLowerCase();
  // "Covers a place": a latitude and longitude typed in the usual ways. Only repositories whose located files include that point.
  const spot = parseLatLon(place);
  const placeProblem = place.trim() !== "" && !spot ? "Enter a place as latitude and longitude, like 10.3, 76.3" : null;
  const located = repos.filter((r) => r.visibility === "public" && r.footprint).length;
  const results = repos
    .filter((r) => r.visibility === "public")
    .filter((r) => filter === "All" || r.tags.includes(filter as DataType))
    .filter((r) => !topic || (r.topics ?? []).includes(topic))
    .filter((r) => !spot || (r.footprint ? bboxContains(r.footprint, spot.lon, spot.lat) : false))
    .filter((r) => !q || `${r.owner}/${r.name} ${r.description} ${r.region} ${r.tags.join(" ")} ${(r.topics ?? []).join(" ")}`.toLowerCase().includes(q))
    .toSorted((a, b) => (sort === "stars" ? b.stars - a.stars : sort === "size" ? toGb(b.size) - toGb(a.size) : ageMin(a.updated) - ageMin(b.updated)));

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-8 px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
        <PageHeader
          title="Explore public data"
          description="Open datasets, published basin models and shared elevation tiles. Anything you reference here is free: identical chunks are stored once."
        />

        {topics.length > 0 && (
          <Section title="Browse by topic" description="Topics the owners of public repositories have chosen. Pick one to see everything tagged with it.">
            <ul className="flex flex-wrap gap-2">
              {topics.map(([name, count]) => (
                <li key={name}>
                  <Link
                    href={name === topic ? "/explore" : `/explore?topic=${encodeURIComponent(name)}`}
                    aria-current={name === topic ? "true" : undefined}
                    className={`inline-flex items-center gap-2 border px-2.5 py-1.5 text-sm transition-colors ${name === topic ? "border-foreground bg-muted text-foreground" : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground"}`}
                  >
                    <span className="font-mono text-xs">{name}</span>
                    <span className="text-xs tabular-nums">{count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Section title="All public repositories">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <InputGroup className="h-8 w-full sm:w-72 sm:flex-none">
                <InputGroupAddon>
                  <Search aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  type="search"
                  aria-label="Search public repositories"
                  placeholder="Search by name, data type or region…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </InputGroup>
              <InputGroup className="h-8 w-56" data-invalid={placeProblem ? true : undefined}>
                <InputGroupAddon>
                  <MapPin aria-hidden />
                </InputGroupAddon>
                <InputGroupInput
                  type="text"
                  inputMode="decimal"
                  aria-label="Only data covering a place (latitude, longitude)"
                  aria-invalid={Boolean(placeProblem)}
                  aria-describedby={placeProblem ? "place-problem" : undefined}
                  placeholder="Covers a place: 10.3, 76.3"
                  value={place}
                  onChange={(e) => setPlace(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </InputGroup>
              <Select value={sort} onValueChange={(v) => setSort(v as Sort)}>
                <SelectTrigger size="sm" className="w-44" aria-label="Sort">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ToggleGroup value={[filter]} onValueChange={(v) => setFilter(v[0] ?? "All")} variant="outline" size="sm" spacing={0} aria-label="Data type" className="flex-wrap">
                {filters.map((f) => (
                  <ToggleGroupItem key={f} value={f}>
                    {f === "All" ? "All types" : f}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <span className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {placeProblem && (
                  <span id="place-problem" className="text-destructive">
                    {placeProblem}
                  </span>
                )}
                {spot && (
                  <button type="button" onClick={() => setPlace("")} className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-foreground hover:bg-muted" aria-label="Clear the place filter">
                    covers {spot.lat.toFixed(3)}, {spot.lon.toFixed(3)}
                    <X className="size-3" aria-hidden />
                  </button>
                )}
                {topic && (
                  <Link href="/explore" className="inline-flex items-center gap-1 border border-border px-1.5 py-0.5 font-mono text-foreground hover:bg-muted" aria-label={`Clear topic ${topic}`}>
                    topic: {topic}
                    <X className="size-3" aria-hidden />
                  </Link>
                )}
                {results.length} repositories
              </span>
            </div>
          </div>

          {results.length > 0 ? (
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {results.map((r) => (
                <li key={`${r.owner}/${r.name}`} className="relative flex flex-col gap-3 border border-border bg-card p-4 transition-colors hover:border-foreground/30">
                  <Link href={`/${r.owner}/${r.name}`} data-list-item className="truncate font-semibold text-blue-500 hover:text-blue-400 hover:underline after:absolute after:inset-0">
                    {r.owner}/{r.name}
                  </Link>
                  <p className="line-clamp-2 min-h-10 text-sm text-muted-foreground text-pretty">{r.description}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {r.tags.map((t) => (
                      <DataTypeBadge key={t} type={t} />
                    ))}
                    {(r.topics ?? []).slice(0, 3).map((t) => (
                      <span key={t} className="border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                        {t}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto flex items-center gap-4 border-t border-border pt-3 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1 tabular-nums">
                      <Star className="size-3.5" aria-hidden /> {r.stars.toLocaleString("en-US")}
                    </span>
                    <span className="font-mono tabular-nums">{r.size}</span>
                    <span className="ml-auto truncate" title={r.footprint ? `Data around ${describeCentre(r.footprint)}` : undefined}>
                      {r.region || (r.footprint ? describeCentre(r.footprint) : "")}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Search}
              title={spot ? "No public data covers that place yet" : "No public repositories match"}
              description={spot ? `${located} of ${repos.filter((r) => r.visibility === "public").length} public repositories have a known location. Data in a coordinate system Craton can’t place isn’t searchable by place.` : "Try a region like Kerala or a data type like LiDAR."}
              action={<Button variant="outline" size="sm" onClick={() => { setQuery(""); setFilter("All"); setPlace(""); }}>Clear filters</Button>}
            />
          )}
        </Section>
      </div>
    </AppShell>
  );
}
