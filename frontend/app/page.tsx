import Link from "next/link";
import {
  ArrowRight,
  Box,
  GitCompare,
  GitPullRequest,
  HardDrive,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { DataTypeBadge } from "@/components/data-type-badge";
import { MapPreview, MapDiffLegend } from "@/components/map-preview";
import { InView } from "@/components/ui/in-view";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { repos as demoRepos } from "@/lib/data";
import { formatBytes } from "@/lib/format";
import { loadCommit, loadCommits, loadPulls, loadRepo, loadRepos, loadStorage } from "@/lib/source";
import { previewable, renderMeta } from "@/lib/api";
import { DataPreview, PreviewDiffLegend, previewSrc } from "@/components/data-preview";

const entryPoints = [
  {
    icon: Upload,
    title: "Push a field project",
    body: "Version a HEC-RAS, HMS, SWMM, MIKE, or EPANET project alongside its terrain and boundary data.",
    href: "/signup",
    action: "Start free",
  },
  {
    icon: GitCompare,
    title: "Review a spatial change",
    body: "Compare tiles, vector features, grids, and configuration files before a model change reaches main.",
    href: "/hydrolab/chalakudy-basin/compare",
    action: "Open map diff",
  },
  {
    icon: ShieldCheck,
    title: "Verify a submission",
    body: "Keep the commit, source data, and Merkle proof together for an audit-ready project history.",
    href: "/hydrolab/chalakudy-basin/storage",
    action: "View provenance",
  },
];

// Signed-in people go straight to the dashboard (proxy.ts), so this page is for visitors.
export default async function HomePage() {
  // The featured project: the public repository with the widest mix of data (a full model), then stars.
  const { repos } = await loadRepos();
  const project = [...repos].filter((r) => r.visibility === "public").sort((a, b) => b.tags.length - a.tags.length || b.stars - a.stars)[0] ?? demoRepos[0];
  const [summary, storage, { pulls }] = await Promise.all([
    loadRepo(project.owner, project.name),
    loadStorage(project.owner, project.name),
    loadPulls(project.owner, project.name),
  ]);
  // The latest commit that changed map data, so the preview shows a real change; else the head.
  const { live, commits } = await loadCommits(project.owner, project.name, project.defaultBranch);
  const mapPath = (name: string) => (/\.dbf$/i.test(name) ? name.replace(/\.dbf$/i, ".shp") : name);
  const mapCommit = live ? commits.find((c) => c.parents?.length && c.files.some((f) => f.change === "modified" && previewable(mapPath(f.name)))) : undefined;
  // The repo summary's head has no file list; the commit detail does.
  const head = mapCommit ?? (summary.head ? ((await loadCommit(project.owner, project.name, summary.head.sha))?.commit ?? summary.head) : null);
  const mapFile = mapCommit ? mapPath(mapCommit.files.find((f) => f.change === "modified" && previewable(mapPath(f.name)))!.name) : null;
  const mapBase = mapCommit?.parents?.[0];
  const mapDiff = mapCommit && mapFile && mapBase ? await renderMeta(project.owner, project.name, mapCommit.sha, mapFile, { base: mapBase }) : null;
  const base = `/${project.owner}/${project.name}`;
  // Live values when the API is up; the original demo copy otherwise.
  const change = head
    ? {
        ref: `${project.defaultBranch} @ ${head.sha.slice(0, 7)}`,
        message: head.message,
        unique: `${head.sizeDelta} unique`,
        summary: `${head.files.length} ${head.files.length === 1 ? "file" : "files"} changed: ${head.files.reduce((n, f) => n + f.added, 0)} new chunks, ${head.files.reduce((n, f) => n + (f.reused ?? 0), 0)} reused.`,
        proof: head.merkleRoot ? `${head.merkleRoot.slice(0, 8)}…${head.merkleRoot.slice(-5)}` : "",
        href: `${base}/commit/${head.sha}`,
      }
    : { ref: "main @ a1b2c3d", message: "Re-tile DEM to Cloud-Optimized GeoTIFF", unique: "+42 MB unique", summary: "320 terrain tiles updated. No connectivity breaks detected.", proof: "7f9ac32b…98112", href: `${base}/compare` };
  // What the featured repository stores, against keeping every version of every file.
  const plan = storage && storage.historyBytes
    ? { used: formatBytes(storage.storedBytes), limit: `vs ${formatBytes(storage.historyBytes)} for every version`, pct: Math.max(1, Math.round((storage.storedBytes / storage.historyBytes) * 100)) }
    : { used: "1.9 GB", limit: "vs 4.2 GB for every version", pct: 45 };
  const saved = storage && storage.historyBytes ? Math.round(((storage.historyBytes - storage.storedBytes) / storage.historyBytes) * 100) : null;
  const review = pulls.find((p) => p.status !== "merged" && p.status !== "closed" && p.checks !== "failed") ?? pulls.find((p) => p.status !== "merged" && p.status !== "closed");

  return (
    <AppShell>
      <section className="w-full border-b border-border/30">
        <div className="flex w-full flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8 xl:px-10 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="font-serif text-3xl font-semibold md:text-4xl">Version control for hydro and GIS data</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
              A working repository for terrain, surveys, model inputs, and results. Craton keeps the exact data history your team needs to review, reproduce, and certify.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">Free to start. No credit card. Try it on a sample flood model in under a minute.</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <Button href="/signup">
              Get started free
              <ArrowRight data-icon="inline-end" />
            </Button>
            <Button variant="outline" href="/explore">
              Browse public data
            </Button>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-1 w-full gap-6 px-4 py-6 sm:px-6 lg:px-8 xl:px-10 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="border border-border/30">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <Box className="size-4 text-accent" />
              <Link href={`/${project.owner}/${project.name}`} className="font-mono text-sm font-semibold hover:underline">
                {project.owner}/{project.name}
              </Link>
              <Badge variant="outline">{project.visibility}</Badge>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{change.ref}</span>
          </div>

          <div className="grid grid-cols-1 gap-5 p-4 md:grid-cols-[minmax(0,1fr)_280px]">
            <div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Latest verified change</p>
                  <p className="mt-1 text-xs text-muted-foreground">{change.message}</p>
                </div>
                <Badge variant="outline" className="font-mono">{change.unique}</Badge>
              </div>
              {mapCommit && mapFile && mapBase ? (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <figure className="flex flex-col gap-1.5">
                    <DataPreview src={previewSrc(project.owner, project.name, mapBase, mapFile)} alt={`${mapFile} before the change`} className="aspect-video" />
                    <figcaption className="font-mono text-xs text-muted-foreground">{mapFile} · before</figcaption>
                  </figure>
                  <figure className="flex flex-col gap-1.5">
                    <DataPreview src={previewSrc(project.owner, project.name, mapCommit.sha, mapFile, { base: mapBase })} alt={`What changed in ${mapFile}`} error={mapDiff?.error} className="aspect-video" />
                    <figcaption className="font-mono text-xs text-muted-foreground">what changed</figcaption>
                  </figure>
                </div>
              ) : (
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <MapPreview seed={12} className="aspect-video" />
                  <MapPreview
                    seed={12}
                    className="aspect-video"
                    diff={{ "2-4": "changed", "2-5": "changed", "3-4": "changed", "3-5": "added", "5-9": "added", "6-9": "changed" }}
                  />
                </div>
              )}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                {mapDiff ? <PreviewDiffLegend meta={mapDiff.meta} /> : <MapDiffLegend />}
                <Button size="sm" variant="outline" render={<Link href={change.href} />}>
                  Inspect change <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-4 border-t border-border/30 pt-4 text-xs md:border-l md:border-t-0 md:pl-4 md:pt-0">
              <div>
                <span className="text-muted-foreground">Data in this commit</span>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {project.tags.map((tag) => <DataTypeBadge key={tag} type={tag} />)}
                </div>
              </div>
              <div className="border-y border-border/20 py-3">
                <span className="block text-muted-foreground">Change summary</span>
                <span className="mt-1 block leading-relaxed">{change.summary}</span>
              </div>
              <div>
                <span className="block text-muted-foreground">Integrity proof</span>
                <span className="mt-1 block font-mono text-[11px] text-foreground">verified · {change.proof}</span>
              </div>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-4">
          <div className="border border-border/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><HardDrive className="size-4 text-accent" /> Storage, deduplicated</div>
            <div className="mt-4 flex items-end justify-between font-mono">
              <span className="text-2xl font-bold">{plan.used}</span>
              <span className="text-xs text-muted-foreground">{plan.limit}</span>
            </div>
            <div className="mt-3 h-1.5 bg-muted"><div className="h-full bg-foreground" style={{ width: `${plan.pct}%` }} /></div>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {saved !== null ? `${project.name} keeps its full history in ${saved}% less space than storing every version. ` : ""}
              Shared public terrain and rainfall layers are stored once and never count against your plan.
            </p>
          </div>
          <div className="border border-border/30 p-4">
            <div className="flex items-center gap-2 text-sm font-medium"><GitPullRequest className="size-4 text-accent" /> Review queue</div>
            {review ? (
              <Link href={`${base}/pull/${review.id}`} className="mt-4 block border-l-2 border-chart-2 pl-3 text-xs hover:text-foreground">
                <span className="font-mono text-muted-foreground">
                  #{review.id} · {review.approvals ?? 0} {(review.approvals ?? 0) === 1 ? "approval" : "approvals"}
                </span>
                <span className="mt-1 block leading-relaxed">{review.title}</span>
              </Link>
            ) : (
              <p className="mt-4 text-xs text-muted-foreground">Nothing waiting for review.</p>
            )}
          </div>
        </aside>
      </section>

      <section className="w-full border-t border-border/30">
        <div className="grid grid-cols-1 w-full gap-px px-4 py-6 sm:px-6 lg:px-8 xl:px-10 md:grid-cols-3">
          {entryPoints.map((item, i) => (
            <InView key={item.title} once transition={{ duration: 0.3, delay: i * 0.05 }}>
              <Link href={item.href} className="group block border border-border/30 p-5 transition-colors hover:bg-muted/30">
                <item.icon className="size-4 text-accent" />
                <h2 className="mt-5 text-sm font-semibold">{item.title}</h2>
                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
                <span className="mt-5 flex items-center gap-1 text-xs font-medium group-hover:underline">{item.action}<ArrowRight className="size-3" /></span>
              </Link>
            </InView>
          ))}
        </div>
      </section>

      <section className="w-full border-t border-border/30">
        <div className="flex w-full flex-col gap-4 px-4 py-10 sm:px-6 lg:px-8 xl:px-10 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold">Start with a real model, not a blank page</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground text-pretty">
              Sign up and Craton sets up a sample basin with a DEM, catchments, a HEC-RAS plan and a pull request to review, so you can see chunk-level diffs and checks before you push your own data.
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button href="/signup">Create your account</Button>
            <Button variant="ghost" href="/login">
              Sign in
            </Button>
          </div>
        </div>
      </section>
    </AppShell>
  );
}
