// Page data from the Craton API. Every loader returns the same shapes the pages already render
// (Repo, Commit, Branch…), plus `live` so a page can tell which one it got. The demo data in
// lib/data.ts is used only with CRATON_DEMO=1 (a design preview with no backend); otherwise an
// unreachable API is an error, never made-up data. Server components only (see lib/api.ts).

import { cache } from "react";
import { isBBox } from "@/lib/geo";
import { notFound } from "next/navigation";
import { api, type ApiActivity, type ApiBranch, type ApiChange, type ApiCommit, type ApiIssue, type ApiPull, type ApiRelease, type ApiRepo, type ApiTreeEntry } from "@/lib/api";
import * as demo from "@/lib/data";
import type { Activity, Branch, Commit, DataType, FileNode, Issue, PullRequest, Release, Repo } from "@/lib/data";
import { formatBytes, formatDate, timeAgo } from "@/lib/format";

/** CRATON_DEMO=1: render lib/data.ts when the API isn't running (design previews only). */
export const demoMode = process.env.CRATON_DEMO === "1";

export class ApiUnavailableError extends Error {
  constructor() {
    super("The Craton API isn't reachable.");
    this.name = "ApiUnavailableError";
  }
}

/**
 * A loader's request failed. In demo mode, show the demo data. If the API is up, the thing
 * doesn't exist or isn't visible to this viewer: a 404, or `whenUp` for lists, which are simply
 * empty (an empty repository has no commits or branches yet; the repository layout already 404s
 * unknown repositories). Otherwise the API is down, and the page errors instead of pretending.
 */
async function offline<T>(demoValue: T, whenUp?: () => T): Promise<T> {
  if (demoMode) return demoValue;
  if (await apiIsUp()) {
    if (whenUp) return whenUp();
    notFound();
  }
  throw new ApiUnavailableError();
}

// ── Conversions ──────────────────────────────────────────────────────────

const DATA_TYPES = new Set<string>(Object.keys(demo.dataTypeColors));
const BY_EXT: Record<string, DataType> = {
  tif: "DEM", tiff: "DEM", vrt: "DEM", img: "DEM", asc: "DEM",
  shp: "Shapefile", gpkg: "Shapefile", geojson: "Shapefile", kml: "Shapefile",
  las: "LiDAR", laz: "LiDAR", copc: "LiDAR",
  nc: "NetCDF", grib: "NetCDF",
  zarr: "Zarr", zattrs: "Zarr", zarray: "Zarr",
  hdf: "HEC-RAS", inp: "SWMM", hms: "HEC-HMS", net: "EPANET",
};

/** Same extension rules as backend/src/core/datatypes.ts. */
export function dataTypeOf(path: string): DataType | undefined {
  const name = path.toLowerCase();
  if (/\.(p|g|u|f)\d\d$/.test(name)) return "HEC-RAS";
  return BY_EXT[name.split(".").pop() ?? ""];
}

function nodeType(path: string, dataType: DataType | undefined, dir: boolean): FileNode["type"] {
  if (dir) return "dir";
  const ext = path.toLowerCase().split(".").pop() ?? "";
  if (dataType === "DEM" || dataType === "LiDAR" || dataType === "NetCDF" || dataType === "Zarr") return "raster";
  if (dataType === "Shapefile" || ["dbf", "shx", "cpg"].includes(ext)) return "vector";
  if (ext === "csv" || ext === "tsv") return "table";
  if (dataType) return "model";
  return "text";
}

export function toRepo(r: ApiRepo): Repo {
  return {
    owner: r.owner,
    name: r.name,
    description: r.description,
    tags: r.tags.filter((t): t is DataType => DATA_TYPES.has(t)),
    size: formatBytes(r.sizeBytes),
    updated: timeAgo(r.updatedAt),
    visibility: r.visibility,
    stars: r.stars,
    forks: r.forks,
    region: r.region,
    defaultBranch: r.defaultBranch,
    license: r.license,
    topics: r.topics,
    footprint: isBBox(r.footprint) ? r.footprint : null,
    verticalDatum: r.verticalDatum,
    nodata: r.nodata,
    lockPatterns: r.lockPatterns ?? [],
  };
}

function toFileNode(e: ApiTreeEntry, siblings: ApiTreeEntry[]): FileNode {
  let dataType = e.type === "file" ? dataTypeOf(e.path) : undefined;
  // A .prj beside a .shp is the shapefile's projection, not a HEC-RAS project file.
  const stem = e.path.replace(/\.[^.]+$/, "").toLowerCase();
  const inShapefileSet = siblings.some((s) => s.path.toLowerCase() === `${stem}.shp`);
  if (inShapefileSet) dataType = "Shapefile";
  return {
    name: e.name,
    path: e.path,
    type: inShapefileSet ? "vector" : nodeType(e.path, dataType, e.type === "dir"),
    size: formatBytes(e.size),
    lastCommit: e.lastCommit?.message ?? "",
    updated: e.lastCommit ? timeAgo(e.lastCommit.timestamp) : "",
    sha: e.lastCommit?.sha,
    dataType,
  };
}

function toFiles(changes: ApiChange[]): Commit["files"] {
  return changes.map((ch) => ({
    name: ch.path,
    dataType: dataTypeOf(ch.path),
    added: ch.chunks.added,
    changed: 0,
    removed: ch.chunks.removed,
    reused: ch.chunks.shared,
    change: ch.change,
    map: ch.chunks.map,
    sizeBefore: ch.sizeBefore,
    sizeAfter: ch.sizeAfter,
    unit: "chunks" as const,
  }));
}

function toCommit(c: ApiCommit & { changes?: ApiChange[] }, names: Record<string, string>): Commit {
  const changes = c.changes ?? [];
  const newBytes = changes.reduce((n, ch) => n + ch.chunks.addedBytes, 0);
  return {
    sha: c.sha,
    message: c.message,
    author: names[c.author] ?? c.author,
    authorHandle: c.author,
    timestamp: timeAgo(c.timestamp),
    isoTime: c.timestamp,
    parents: c.parents,
    merkleRoot: c.merkleRoot,
    sizeDelta: `+${formatBytes(newBytes)}`,
    files: toFiles(changes),
  };
}

function toBranch(b: ApiBranch): Branch {
  return {
    name: b.name,
    lastCommit: b.commit.message,
    author: b.commit.author,
    updated: timeAgo(b.commit.timestamp),
    ahead: b.ahead,
    behind: b.behind,
    isDefault: b.isDefault,
    sha: b.commit.sha,
  };
}

function toIssue(i: ApiIssue): Issue {
  return {
    id: i.number,
    title: i.title,
    author: i.author,
    status: i.state,
    label: i.label,
    comments: i.comments,
    updated: timeAgo(i.updatedAt),
    reference: i.file ?? undefined,
    body: i.body,
    opened: timeAgo(i.createdAt),
    assignee: i.assignee,
    milestone: i.milestone,
  };
}

function toPull(p: ApiPull): PullRequest {
  return {
    id: p.number,
    title: p.title,
    author: p.author,
    source: p.source,
    target: p.target,
    status: p.status,
    comments: p.comments,
    updated: timeAgo(p.updatedAt),
    description: p.body,
    checks: p.checks ?? undefined,
    head: p.head ?? undefined,
    approvals: p.approvals,
    reviewers: [...new Set(p.reviews.map((r) => r.author))],
    reviewRequests: p.reviewRequests ?? [],
  };
}

function toRelease(r: ApiRelease): Release {
  return {
    version: r.tag,
    title: r.title,
    sha: r.commit.slice(0, 7),
    date: formatDate(r.createdAt),
    author: r.author,
    notes: r.notes,
    size: formatBytes(r.sizeBytes),
    latest: r.latest,
    prerelease: r.prerelease,
    merkleRoot: r.merkleRoot,
    checksums: r.checksums,
    run: r.run ?? null,
  };
}

function toActivity(a: ApiActivity): Activity {
  return { type: a.type, actor: a.actor, text: a.text, repo: a.repo, time: timeAgo(a.at), href: a.href, detail: a.detail, at: a.at };
}

// ── Loaders ──────────────────────────────────────────────────────────────
// Wrapped in React cache() so a page and its header share one request per render.

/** Display names for handles (commit authors are stored as handles). */
const displayName = cache(async (handle: string) => (await api.owner(handle))?.name ?? handle);
async function namesFor(handles: string[]) {
  const unique = [...new Set(handles)];
  const names = await Promise.all(unique.map(displayName));
  return Object.fromEntries(unique.map((h, i) => [h, names[i]]));
}

/** True when the API answers. Lets a page tell "doesn't exist" (404) from "API not running". */
/** Who holds which file lock, as path → holder. Empty when there are none (or the API is down). */
export const loadLocks = cache(async (owner: string, name: string): Promise<Record<string, string>> => {
  const locks = await api.locks(owner, name);
  return Object.fromEntries((locks ?? []).map((l) => [l.path, l.holder]));
});

export const apiIsUp = cache(async () => Boolean(await api.health()));

export const loadUser = cache(async () => api.user());

export const loadRepos = cache(async (owner?: string) => {
  const live = await api.repos(owner);
  if (live) return { live: true, repos: live.map(toRepo) };
  return offline({ live: false, repos: owner ? demo.repos.filter((r) => r.owner === owner) : demo.repos }, () => ({ live: true, repos: [] as Repo[] }));
});

export const loadRepo = cache(async (owner: string, name: string) => {
  const r = await api.repo(owner, name);
  if (!r) {
    return offline({
      live: false,
      repo: demo.getRepo(owner, name),
      readme: demo.readmeContent,
      head: null as Commit | null,
      commitCount: 128,
      branchCount: demo.branches.length,
      openIssues: demo.issues.filter((i) => i.status === "open").length,
      openPulls: demo.pullRequests.filter((p) => p.status !== "merged").length,
      crs: "EPSG:32643",
      nodata: -9999 as number | null,
      verticalDatum: null as number | null,
      requireChecks: true,
      requireReview: false,
      requireOwnerReview: false,
      requireCog: false,
      starred: false,
      access: "admin" as "none" | "read" | "write" | "admin",
    });
  }
  return {
    live: true,
    repo: toRepo(r),
    readme: r.readme,
    head: r.head ? toCommit(r.head, await namesFor([r.head.author])) : null,
    commitCount: r.commitCount,
    branchCount: r.branchCount,
    openIssues: r.openIssues,
    openPulls: r.openPulls,
    crs: r.crs,
    nodata: r.nodata,
    verticalDatum: r.verticalDatum,
    requireChecks: r.requireChecks,
    requireReview: r.requireReview,
    requireOwnerReview: Boolean(r.requireOwnerReview),
    requireCog: Boolean(r.requireCog),
    starred: r.starred,
    access: r.access,
  };
});

/** Summary the repository header needs on every repo page. */
export type RepoSummary = Awaited<ReturnType<typeof loadRepo>>;

export const loadBranches = cache(async (owner: string, name: string) => {
  const live = await api.branches(owner, name);
  if (!live) return offline({ live: false, branches: demo.branches }, () => ({ live: true, branches: [] as Branch[] }));
  // Default branch first, then most recently updated.
  const branches = live.map(toBranch).sort((a, b) => Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)));
  return { live: true, branches };
});

export const loadFolder = cache(async (owner: string, name: string, ref: string, dir = "") => {
  const live = await api.tree(owner, name, ref, dir);
  if (!live) return offline({ live: false, entries: demo.getFolderContents(dir), latest: null }, () => ({ live: true, entries: [] as FileNode[], latest: null }));
  // Most recent commit that touched anything in this folder.
  const newest = live.map((e) => e.lastCommit).filter((c) => c !== undefined).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0];
  const latest = newest ? { sha: newest.sha, message: newest.message, author: newest.author, updated: timeAgo(newest.timestamp) } : null;
  return { live: true, entries: live.map((e) => toFileNode(e, live)), latest };
});

/** Every folder under the root, for the expandable tree on the code page (bounded). */
export const loadTree = cache(async (owner: string, name: string, ref: string) => {
  const root = await api.tree(owner, name, ref, "");
  if (!root) return null;
  type Node = FileNode & { children?: Node[] };
  let budget = 40; // folder requests per page render
  async function expand(entries: ApiTreeEntry[]): Promise<Node[]> {
    return Promise.all(
      entries.map(async (e) => {
        const node: Node = toFileNode(e, entries);
        if (e.type === "dir" && budget-- > 0) {
          const children = await api.tree(owner, name, ref, e.path);
          if (children) node.children = await expand(children);
        }
        return node;
      }),
    );
  }
  return expand(root);
});

export const loadCommits = cache(async (owner: string, name: string, ref?: string) => {
  const live = await api.commits(owner, name, ref, 100);
  if (!live) return offline({ live: false, commits: demo.commits }, () => ({ live: true, commits: [] as Commit[] }));
  const names = await namesFor(live.map((c) => c.author));
  return { live: true, commits: live.map((c) => toCommit(c, names)) };
});

export const loadCommit = cache(async (owner: string, name: string, sha: string) => {
  const c = await api.commit(owner, name, sha);
  if (!c) return null;
  const names = await namesFor([c.author]);
  return { commit: toCommit(c, names), checks: c.checks };
});

/** Merging head into base: commits, changed files (as a Commit's file list) and conflicts. */
export const loadCompare = cache(async (owner: string, name: string, base: string, head: string) => {
  const c = await api.compare(owner, name, base, head);
  if (!c) return null;
  const names = await namesFor(c.commits.map((x) => x.author));
  const files = toFiles(c.changes);
  const newBytes = c.changes.reduce((n, ch) => n + ch.chunks.addedBytes, 0);
  return {
    ahead: c.ahead,
    behind: c.behind,
    fastForward: c.fastForward,
    mergeBase: c.mergeBase,
    headCommit: c.head.commit,
    baseCommit: c.base.commit,
    commits: c.commits.map((x) => toCommit(x, names)),
    files,
    newBytes,
    conflicts: c.conflicts,
  };
});

export const loadChecks = cache(async (owner: string, name: string) => api.checks(owner, name));
export const loadStorage = cache(async (owner: string, name: string) => api.storage(owner, name));
export const loadFile = cache(async (owner: string, name: string, ref: string, path: string) => api.file(owner, name, ref, path));

export const loadIssues = cache(async (owner: string, name: string) => {
  const live = await api.issues(owner, name);
  if (!live) return offline({ live: false, issues: demo.issues }, () => ({ live: true, issues: [] as Issue[] }));
  return { live: true, issues: live.map(toIssue) };
});

export const loadIssue = cache(async (owner: string, name: string, n: number) => {
  const i = await api.issue(owner, name, n);
  if (!i) return null;
  return { issue: toIssue(i), thread: i.thread };
});

export const loadPulls = cache(async (owner: string, name: string) => {
  const live = await api.pulls(owner, name);
  if (!live) return offline({ live: false, pulls: demo.pullRequests }, () => ({ live: true, pulls: [] as PullRequest[] }));
  return { live: true, pulls: live.map(toPull) };
});

export const loadPull = cache(async (owner: string, name: string, n: number) => {
  const p = await api.pull(owner, name, n);
  if (!p) return null;
  return { pull: toPull(p), reviews: p.reviews, reviewRequests: p.reviewRequests ?? [], thread: p.thread, createdAt: p.createdAt };
});

export const loadReleases = cache(async (owner: string, name: string) => {
  const live = await api.releases(owner, name);
  if (!live) return offline({ live: false, releases: demo.releases }, () => ({ live: true, releases: [] as Release[] }));
  return { live: true, releases: live.map(toRelease) };
});

export const loadActivity = cache(async (limit = 30, actor?: string) => {
  const live = await api.activity({ limit, actor });
  if (!live) return offline({ live: false, activity: demo.activityFeed }, () => ({ live: true, activity: [] as Activity[] }));
  return { live: true, activity: live.map(toActivity) };
});

/** The signed-in person's inbox, with read / done kept on the server. Demo mode has no server state. */
export type InboxEntry = Activity & { key: string; reason: "mention" | "reply" | "activity" | "lock" | "review" };
export const loadInbox = cache(async (view: "inbox" | "done" = "inbox") => {
  const live = await api.inbox(view);
  if (!live) return offline({ live: false, unread: 0, items: [] as InboxEntry[], demo: demo.activityFeed }, () => ({ live: true, unread: 0, items: [] as InboxEntry[], demo: [] as Activity[] }));
  const items = live.items.map((i): InboxEntry => ({ ...toActivity(i), type: i.reason === "mention" ? "mention" : i.type, read: i.read, key: i.key, reason: i.reason }));
  return { live: true, unread: live.unread, items, demo: [] as Activity[] };
});

export const loadTemplates = cache(async (owner: string, name: string) => (await api.templates(owner, name)) ?? { issues: [], pull: null });

export const loadMilestones = cache(async (owner: string, name: string) => (await api.milestones(owner, name)) ?? []);

export const loadModelReviews = cache(async (owner: string, name: string) => (await api.modelReviews(owner, name)) ?? []);
export const loadModelReview = cache(async (owner: string, name: string, n: number) => api.modelReview(owner, name, n));

export const loadRepoActivity = cache(async (owner: string, name: string, limit = 30) => {
  const live = await api.repoActivity(owner, name, limit);
  return live ? live.map(toActivity) : null;
});

export const loadAllIssues = cache(async () => {
  const live = await api.allIssues();
  return live ? live.map((i) => ({ ...toIssue(i), repo: i.repo })) : null;
});

export const loadAllPulls = cache(async () => {
  const live = await api.allPulls();
  return live ? live.map((p) => ({ ...toPull(p), repo: p.repo, checks: p.checks ?? undefined })) : null;
});

export const loadUsage = cache(async () => api.usage());

export const loadOwner = cache(async (handle: string) => {
  const o = await api.owner(handle);
  if (!o) return null;
  return { ...o, repositories: o.repositories.map(toRepo) };
});

export async function searchAll(q: string) {
  const live = await api.search(q);
  if (!live) return null;
  return { ...live, repositories: live.repositories.map(toRepo) };
}

/** Repositories a person starred (the signed-in user when no handle is given), newest first. */
export const loadStarred = cache(async (handle?: string) => {
  const live = handle ? await api.ownerStarred(handle) : await api.starred();
  if (!live) return offline({ live: false, repos: demo.repos.filter((r) => r.visibility === "public").slice(0, 4) });
  return { live: true, repos: live.map(toRepo) };
});

/** For pages that build demo content themselves: go on only in demo mode (see offline). */
export async function noData(): Promise<void> {
  await offline(undefined);
}

/** Public repositories by stars received in the period, with whether the viewer starred each. */
export const loadTrending = cache(async (period: "day" | "week" | "month") => {
  const live = await api.trending(period);
  if (!live) return offline({ live: false, repos: demo.repos.filter((r) => r.visibility === "public").map((r) => ({ ...r, gained: 0, starred: false })) });
  return { live: true, repos: live.map((r) => ({ ...toRepo(r), gained: r.gained, starred: r.starred })) };
});
