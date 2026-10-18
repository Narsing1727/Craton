import type { Metadata } from "next";
import Link from "next/link";
import { BookMarked, Building2, FileCode, Search, Users } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { EmptyState, Initials } from "@/components/craton-ui";
import { DataTypeBadge } from "@/components/data-type-badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { folderTree, orgMembers, repos, type DataType } from "@/lib/data";
import { formatBytes } from "@/lib/format";
import { dataTypeOf, searchAll, noData } from "@/lib/source";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Search",
  description: "Search repositories, files, people and organizations on Craton.",
};

const files = Object.entries(folderTree).flatMap(([dir, nodes]) =>
  nodes
    .filter((n) => n.type !== "dir")
    .map((n) => ({ ...n, path: dir ? `${dir}/${n.name}` : n.name, repo: "hydrolab/chalakudy-basin" })),
);
const orgs = [
  { handle: "hydrolab", name: "Hydrolab", description: "Open river-basin models for South Asia" },
  { handle: "deltares", name: "Deltares", description: "Water and subsurface research institute" },
  { handle: "openterrain", name: "OpenTerrain", description: "Deduplicated global elevation data" },
];

const types = [
  { id: "repositories", label: "Repositories", icon: BookMarked },
  { id: "files", label: "Files", icon: FileCode },
  { id: "people", label: "People", icon: Users },
  { id: "organizations", label: "Organizations", icon: Building2 },
] as const;
type Type = (typeof types)[number]["id"];

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const i = text.toLowerCase().indexOf(query.toLowerCase());
  if (i === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark className="bg-accent/30 text-foreground">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  );
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const q = query.toLowerCase();
  const match = (...fields: (string | undefined)[]) => !q || fields.some((f) => f?.toLowerCase().includes(q));

  // Live search covers only what the viewer can see; the demo data is filtered locally.
  const live = await searchAll(query);
  if (!live) await noData();
  type FileHit = { path: string; repo: string; size: string; dataType?: DataType; lastCommit?: string };
  type PersonHit = { handle: string; name: string; detail: string };
  const results: {
    repositories: typeof repos;
    files: FileHit[];
    people: PersonHit[];
    organizations: { handle: string; name: string; description: string }[];
  } = live
    ? {
        repositories: live.repositories,
        files: live.files.map((f) => ({ path: f.path, repo: f.repo, size: formatBytes(f.size), dataType: dataTypeOf(f.path) })),
        people: live.people.map((m) => ({ handle: m.handle, name: m.name, detail: m.bio })),
        organizations: live.organizations.map((o) => ({ handle: o.handle, name: o.name, description: o.bio })),
      }
    : {
        repositories: repos.filter((r) => match(`${r.owner}/${r.name}`, r.description, r.region, ...r.tags)),
        files: files.filter((f) => match(f.path, f.dataType, f.lastCommit)),
        people: orgMembers.filter((m) => match(m.name, m.handle, m.role)).map((m) => ({ handle: m.handle, name: m.name, detail: `${m.role} · ${m.repos} repositories` })),
        organizations: orgs.filter((o) => match(o.handle, o.name, o.description)),
      };
  const requested = types.find((t) => t.id === params.type)?.id;
  // Default to the first type that has results, so a search never opens on an empty tab.
  const active: Type = requested ?? types.find((t) => results[t.id].length > 0)?.id ?? "repositories";
  const total = types.reduce((n, t) => n + results[t.id].length, 0);
  const href = (type: Type) => `/search?${new URLSearchParams({ ...(query && { q: query }), type })}`;

  return (
    <AppShell>
      <div className="flex w-full flex-col gap-6 px-4 sm:px-6 lg:px-8 xl:px-10 py-8">
        <h1 className="sr-only">Search</h1>
        <form action="/search" role="search" className="flex max-w-3xl items-center gap-2">
          <InputGroup className="h-10 flex-1">
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
            <InputGroupInput
              name="q"
              type="search"
              defaultValue={query}
              aria-label="Search Craton"
              placeholder="Search repositories, files, people…"
              enterKeyHint="search"
              autoComplete="off"
            />
            {requested && <input type="hidden" name="type" value={requested} />}
          </InputGroup>
          <Button type="submit">Search</Button>
        </form>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_1fr]">
          <nav aria-label="Result types" className="flex flex-col gap-0.5 text-sm">
            {types.map((t) => (
              <Link
                key={t.id}
                href={href(t.id)}
                aria-current={t.id === active ? "page" : undefined}
                className={cn(
                  "flex items-center justify-between px-3 py-2 transition-colors",
                  t.id === active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                <span className="flex items-center gap-2">
                  <t.icon className="size-4" aria-hidden />
                  {t.label}
                </span>
                <span className="bg-background/60 px-1.5 font-mono text-[11px] tabular-nums">{results[t.id].length}</span>
              </Link>
            ))}
            <p className="mt-3 hidden px-3 text-xs text-muted-foreground md:block">
              Tip: press <Kbd>/</Kbd> anywhere to search.
            </p>
          </nav>

          <div className="flex min-w-0 flex-col gap-3">
            <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
              {query ? (
                <>
                  {results[active].length} {types.find((t) => t.id === active)!.label.toLowerCase()} for{" "}
                  <span className="font-medium text-foreground">“{query}”</span>
                  <span> · {total} results in total</span>
                </>
              ) : (
                <>Showing everything. Type a search to narrow it down.</>
              )}
            </p>

            {results[active].length === 0 ? (
              <EmptyState
                icon={Search}
                title={`No ${types.find((t) => t.id === active)!.label.toLowerCase()} match “${query}”`}
                description="Check the spelling, or try a data type like DEM, LiDAR or HEC-RAS."
                action={
                  <Button variant="outline" size="sm" href="/search?q=DEM">
                    Search for DEM
                  </Button>
                }
              />
            ) : (
              <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                {active === "repositories" &&
                  results.repositories.map((r) => (
                    <li key={`${r.owner}/${r.name}`} className="relative flex flex-col gap-1.5 px-4 py-3 transition-colors hover:bg-muted/30">
                      <Link href={`/${r.owner}/${r.name}`} className="font-semibold text-blue-500 hover:underline after:absolute after:inset-0">
                        <Highlight text={`${r.owner}/${r.name}`} query={query} />
                      </Link>
                      <p className="text-sm text-muted-foreground text-pretty">
                        <Highlight text={r.description} query={query} />
                      </p>
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                        <span className="flex gap-1.5">
                          {r.tags.map((t) => (
                            <DataTypeBadge key={t} type={t} />
                          ))}
                        </span>
                        <span className="font-mono tabular-nums">{r.size}</span>
                        <span>{r.region}</span>
                        <span className="ml-auto">Updated {r.updated}</span>
                      </div>
                    </li>
                  ))}
                {active === "files" &&
                  results.files.map((f) => (
                    <li key={f.path} className="relative flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/30">
                      <FileCode className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link href={`/${f.repo}/blob/${f.path}`} className="truncate font-mono text-sm hover:underline after:absolute after:inset-0">
                          <Highlight text={f.path} query={query} />
                        </Link>
                        <p className="truncate text-xs text-muted-foreground">
                          {f.lastCommit ? `${f.repo} · ${f.lastCommit}` : f.repo}
                        </p>
                      </div>
                      {f.dataType && <DataTypeBadge type={f.dataType} />}
                      <span className="w-16 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{f.size}</span>
                    </li>
                  ))}
                {active === "people" &&
                  results.people.map((m) => (
                    <li key={m.handle} className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                      <Initials name={m.handle} className="size-8" />
                      <div className="min-w-0 flex-1">
                        <Link href={`/${m.handle}`} className="text-sm font-medium hover:underline after:absolute after:inset-0">
                          <Highlight text={m.name} query={query} />
                        </Link>
                        <p className="text-xs text-muted-foreground">
                          @{m.handle}{m.detail ? ` · ${m.detail}` : ""}
                        </p>
                      </div>
                    </li>
                  ))}
                {active === "organizations" &&
                  results.organizations.map((o) => (
                    <li key={o.handle} className="relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
                      <Building2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <Link href={`/orgs/${o.handle}`} className="text-sm font-medium hover:underline after:absolute after:inset-0">
                          <Highlight text={o.name} query={query} />
                        </Link>
                        <p className="text-xs text-muted-foreground">{o.description}</p>
                      </div>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
