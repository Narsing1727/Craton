import type { Metadata } from "next";
import { ChecksView, type ChecksStats, type Run, type Step } from "./checks-view";
import { timeAgo } from "@/lib/format";
import { loadBranches, loadChecks, loadCommits, loadPulls, loadRepo } from "@/lib/source";
import { BadgeSnippet } from "@/components/badge-snippet";

type Params = { owner: string; repo: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo } = await params;
  return { title: `Checks · ${owner}/${repo}` };
}

// ── Demo data (API not running) ──
const demoSteps = (overrides: Partial<Record<string, Step>> = {}): Step[] =>
  [
    { name: "Coordinate reference system", status: "passed" as const, detail: "All layers use EPSG:32643 (UTM 43N)." },
    { name: "Vertical datum", status: "passed" as const, detail: "Elevations match the 2024 survey datum within 0.05 m." },
    { name: "Nodata value", status: "passed" as const, detail: "Rasters use -9999 consistently." },
    { name: "Topology", status: "passed" as const, detail: "No gaps or overlaps between sub-catchment polygons." },
    { name: "Model schema", status: "passed" as const, detail: "HEC-RAS plan references existing geometry and flow files." },
    { name: "Chunk integrity", status: "passed" as const, detail: "Every chunk hashes to the commit's Merkle root." },
  ].map((s) => overrides[s.name] ?? s);
const datumFail = (detail: string) => ({ "Vertical datum": { name: "Vertical datum", status: "failed" as const, detail } });
const demoRuns: Run[] = [
  { id: 1284, status: "failed", message: "Ingest new LiDAR tiles", sha: "e4f5g6h", branch: "lidar-2024-update", actor: "sarat", time: "5 hours ago", duration: "41 s", pr: 139, steps: demoSteps(datumFail("2024 tiles sit 0.31 m above the 2023 survey datum (tolerance 0.05 m).")) },
  { id: 1283, status: "failed", message: "Levee scenario: raise embankment crest by 0.5 m", sha: "q9r8s7t", branch: "levee-scenario", actor: "arunn", time: "2 hours ago", duration: "38 s", pr: 142, steps: demoSteps(datumFail("levees.shp crest heights reference the 2023 datum; the DEM on main uses 2024.")) },
  { id: 1282, status: "passed", message: "Re-tile DEM to Cloud-Optimized GeoTIFF", sha: "a1b2c3d", branch: "main", actor: "priyam", time: "3 hours ago", duration: "36 s", steps: demoSteps() },
  { id: 1281, status: "passed", message: "Recalibrate Manning's n for main channel", sha: "e4f5g6h", branch: "develop", actor: "arunn", time: "3 hours ago", duration: "29 s", steps: demoSteps() },
];
const demoStats: ChecksStats = { passRate: "95.8%", passHint: "46 of 48 runs", failing: "2", failingHint: "Both on vertical datum", median: "36 s", medianHint: "For 4.2 GB of data", blocked: "2", blockedHint: "#139 and #142" };
const demoConfig = `# .craton/checks.yml
crs: EPSG:32643
vertical_datum:
  reference: survey-2024
  tolerance_m: 0.05
nodata: -9999
block_merge_on: [crs, vertical_datum, integrity]`;

const duration = (ms: number) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);

export default async function ChecksPage({ params }: { params: Promise<Params> }) {
  const { owner, repo } = await params;
  const [summary, checks] = await Promise.all([loadRepo(owner, repo), loadChecks(owner, repo)]);

  if (!summary.live || !checks) {
    return <ChecksView owner={owner} repo={repo} runs={demoRuns} stats={demoStats} config={demoConfig} configTitle="checks.yml" />;
  }

  // Commit messages and authors for each run, from every branch's history.
  const [{ branches }, { pulls }] = await Promise.all([loadBranches(owner, repo), loadPulls(owner, repo)]);
  const commitInfo = new Map<string, { message: string; author: string }>();
  for (const b of branches) {
    for (const c of (await loadCommits(owner, repo, b.name)).commits) commitInfo.set(c.sha, { message: c.message, author: c.authorHandle });
  }
  const prFor = (branch: string) => pulls.filter((p) => p.source === branch && p.status !== "merged" && p.status !== "closed").at(-1)?.id;

  const runs: Run[] = checks.map((r) => ({
    id: r.id,
    status: r.status,
    message: commitInfo.get(r.commit)?.message ?? r.commit.slice(0, 7),
    sha: r.commit,
    branch: r.branch,
    actor: commitInfo.get(r.commit)?.author ?? "",
    time: timeAgo(r.createdAt),
    duration: duration(r.durationMs),
    pr: prFor(r.branch),
    steps: r.steps,
  }));

  // Stats over the last 7 days; "failing now" is the latest run of each branch.
  const weekAgo = Date.now() - 7 * 86_400_000;
  const recent = checks.filter((r) => Date.parse(r.createdAt) >= weekAgo);
  const passed = recent.filter((r) => r.status === "passed").length;
  const latestByBranch = new Map<string, (typeof checks)[number]>();
  for (const r of checks) if (!latestByBranch.has(r.branch)) latestByBranch.set(r.branch, r);
  const failingNow = [...latestByBranch.values()].filter((r) => r.status === "failed");
  const failedSteps = [...new Set(failingNow.flatMap((r) => r.steps.filter((s) => s.status === "failed").map((s) => s.name.toLowerCase())))];
  const sorted = checks.map((r) => r.durationMs).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const blocked = summary.requireChecks ? pulls.filter((p) => (p.status === "open" || p.status === "approved" || p.status === "changes-requested") && p.checks === "failed") : [];

  const stats: ChecksStats = {
    passRate: recent.length ? `${((passed / recent.length) * 100).toFixed(1)}%` : "—",
    passHint: `${passed} of ${recent.length} runs`,
    failing: String(failingNow.length),
    failingHint: failingNow.length ? `On ${failedSteps.join(", ")}` : "Every branch is green",
    median: duration(median),
    medianHint: `For ${summary.repo.size} of data`,
    blocked: String(blocked.length),
    blockedHint: blocked.length ? blocked.map((p) => `#${p.id}`).join(" and ") : summary.requireChecks ? "No open pull request is failing" : "Checks don’t block merges here",
  };

  const config = [
    `crs: ${summary.crs}`,
    `vertical_datum: ${summary.verticalDatum ? `EPSG:${summary.verticalDatum}` : "not enforced"}`,
    `nodata: ${summary.nodata ?? "not enforced"}`,
    "shapefile_sets: complete (.shp .shx .dbf)",
    "model_schema: HEC-RAS plan references",
    "integrity: sha256 + merkle root",
    `block_merge_on_failure: ${summary.requireChecks}`,
    `require_review: ${summary.requireReview}`,
  ].join("\n");

  return (
    <>
      <ChecksView owner={owner} repo={repo} runs={runs} stats={stats} config={`# ${owner}/${repo} · checks\n${config}`} configTitle="check settings" />
      {summary.live && summary.repo.visibility === "public" && <BadgeSnippet owner={owner} repo={repo} />}
    </>
  );
}
