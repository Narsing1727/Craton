// Tools an assistant can call to answer questions about a Craton repository, read only. The transport lives
// in server.ts; this file is plain functions over an HTTP client so it can be tested against a real server.

import { dataTypeOf } from "../core/datatypes.ts";
import { parseCsv, sniffDelimiter } from "../core/csv.ts";
import { fitByGroup, fitStatistics, numericColumn, rateNse, type Fit } from "../core/fit.ts";

export type Get = (path: string) => Promise<unknown>;
/** The same endpoints, for the ones that answer with file bytes. */
export type GetText = (path: string) => Promise<string>;

type Release = { tag: string; commit: string; title: string; notes: string; prerelease: boolean; latest: boolean; createdAt: string; author: string };
type Change = { path: string; change: "added" | "removed" | "modified"; sizeBefore: number; sizeAfter: number; chunks?: { added: number; removed: number; shared: number } };
type Compare = {
  base: { ref: string; commit: string };
  head: { ref: string; commit: string };
  ahead: number;
  commits: { sha: string; message: string; author: string; timestamp: string }[];
  changes: Change[];
  conflicts: string[];
};
type RasterStats = {
  sameGrid: boolean;
  sampled: { width: number; height: number; factor: number };
  before: { min: number; max: number; mean: number; validCells: number };
  after: { min: number; max: number; mean: number; validCells: number };
  change: null | { meanChange: number; meanAbsChange: number; rmse: number; raisedPercent: number; loweredPercent: number; volumeChange: number | null };
};

const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/");
const repoBase = (owner: string, repo: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
const g = (v: number) => String(Number(v.toPrecision(4)));
const sign = (v: number) => `${v > 0 ? "+" : ""}${g(v)}`;
const bytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

export async function listReleases(get: Get, owner: string, repo: string) {
  const rows = (await get(`${repoBase(owner, repo)}/releases`)) as Release[];
  if (!rows.length) return `${owner}/${repo} has no releases yet.`;
  return rows
    .map((r) => `${r.tag}${r.latest ? " (latest)" : r.prerelease ? " (pre-release)" : ""}  ${r.createdAt.slice(0, 10)}  ${r.title}${r.notes ? `\n    ${r.notes.split("\n")[0].slice(0, 200)}` : ""}`)
    .join("\n");
}

export async function rasterStats(get: Get, owner: string, repo: string, path: string, base: string, ref: string) {
  const s = (await get(`${repoBase(owner, repo)}/raster-stats/${encodeURIComponent(ref)}/${enc(path)}?base=${encodeURIComponent(base)}`)) as RasterStats;
  const lines = [
    `${path}, ${base} -> ${ref}`,
    `before: min ${g(s.before.min)}, mean ${g(s.before.mean)}, max ${g(s.before.max)} over ${s.before.validCells} sampled cells`,
    `after:  min ${g(s.after.min)}, mean ${g(s.after.mean)}, max ${g(s.after.max)} over ${s.after.validCells} sampled cells`,
  ];
  if (s.change) {
    const c = s.change;
    lines.push(
      `change: mean ${sign(c.meanChange)}, mean absolute ${g(c.meanAbsChange)}, rmse ${g(c.rmse)}; ${c.raisedPercent.toFixed(1)}% of cells raised, ${c.loweredPercent.toFixed(1)}% lowered${c.volumeChange === null ? "" : `; net volume ${sign(c.volumeChange)} m3`}`,
    );
  } else lines.push("change: the two versions are on different grids, so cells cannot be compared one to one.");
  lines.push(`Computed on a ${s.sampled.width} x ${s.sampled.height} sample of the raster${s.sampled.factor > 1.01 ? ` (about 1 cell in ${Math.round(s.sampled.factor)})` : ""}, so treat small differences with care.`);
  return lines.join("\n");
}

/**
 * Everything that changed between a release (default: the latest) and a ref (default: the default branch):
 * the commits, each changed file with how much of it was rewritten, and for GeoTIFFs the change in cell values.
 */
export async function whatChanged(get: Get, owner: string, repo: string, opts: { since?: string; until?: string; filter?: string } = {}) {
  const base = repoBase(owner, repo);
  let since = opts.since;
  let sinceNote = "";
  if (!since) {
    const releases = (await get(`${base}/releases`)) as Release[];
    const latest = releases.find((r) => r.latest) ?? releases[0];
    if (!latest) return `${owner}/${repo} has no releases, so there is nothing to compare against. Pass "since" as a branch, tag or commit.`;
    since = latest.tag;
    sinceNote = ` (the latest release, ${latest.createdAt.slice(0, 10)})`;
  }
  const info = (await get(base)) as { defaultBranch?: string; default_branch?: string };
  const until = opts.until ?? info.defaultBranch ?? info.default_branch ?? "main";
  const cmp = (await get(`${base}/compare/${encodeURIComponent(since)}...${encodeURIComponent(until)}`)) as Compare;

  const filter = opts.filter?.toLowerCase();
  const kindOf = (p: string) => dataTypeOf(p) ?? "";
  const changes = cmp.changes.filter((c) => !filter || c.path.toLowerCase().includes(filter) || kindOf(c.path).toLowerCase() === filter);
  const out: string[] = [];
  out.push(`${owner}/${repo}: ${since}${sinceNote} -> ${until}`);
  out.push(`${cmp.ahead} commit${cmp.ahead === 1 ? "" : "s"} since, ${cmp.changes.length} file${cmp.changes.length === 1 ? "" : "s"} changed${filter ? `, ${changes.length} matching "${opts.filter}"` : ""}.`);
  if (cmp.conflicts.length) out.push(`Conflicts when merging: ${cmp.conflicts.join(", ")}`);
  for (const c of cmp.commits.slice(0, 15)) out.push(`  ${c.sha.slice(0, 7)}  ${c.timestamp.slice(0, 10)}  ${c.author}: ${c.message.split("\n")[0].slice(0, 120)}`);
  if (cmp.commits.length > 15) out.push(`  and ${cmp.commits.length - 15} more commits`);
  if (changes.length === 0) {
    out.push(cmp.changes.length === 0 ? "No files differ." : "No changed file matches that filter.");
    return out.join("\n");
  }
  out.push("");
  for (const c of changes.slice(0, 40)) {
    const kind = kindOf(c.path);
    const rewritten = c.chunks ? `${c.chunks.added} chunks new, ${c.chunks.shared} unchanged` : "";
    out.push(`${c.change.padEnd(9)} ${c.path}${kind ? ` [${kind}]` : ""}  ${bytes(c.sizeBefore)} -> ${bytes(c.sizeAfter)}${c.change === "modified" && rewritten ? `  (${rewritten})` : ""}`);
    if (c.change === "modified" && /\.tiff?$/i.test(c.path)) {
      try {
        const s = await rasterStats(get, owner, repo, c.path, cmp.base.commit, cmp.head.commit);
        for (const l of s.split("\n").slice(1)) out.push(`    ${l}`);
      } catch (e) {
        out.push(`    (no statistics: ${(e as Error).message})`);
      }
    }
  }
  if (changes.length > 40) out.push(`and ${changes.length - 40} more files`);
  return out.join("\n");
}

/** Files at a ref with sizes and data types, optionally narrowed by a path fragment or data type. */
export async function listFiles(get: Get, owner: string, repo: string, opts: { ref?: string; filter?: string } = {}) {
  const base = repoBase(owner, repo);
  let ref = opts.ref;
  if (!ref) {
    const info = (await get(base)) as { defaultBranch?: string; default_branch?: string };
    ref = info.defaultBranch ?? info.default_branch ?? "main";
  }
  const r = (await get(`${base}/paths/${encodeURIComponent(ref)}`)) as { files: { path: string; size: number }[] };
  const filter = opts.filter?.toLowerCase();
  const rows = r.files.filter((f) => !filter || f.path.toLowerCase().includes(filter) || (dataTypeOf(f.path) ?? "").toLowerCase() === filter);
  if (!rows.length) return `No files${filter ? ` matching "${opts.filter}"` : ""} at ${ref}.`;
  const lines = rows.slice(0, 100).map((f) => `${f.path}${dataTypeOf(f.path) ? ` [${dataTypeOf(f.path)}]` : ""}  ${bytes(f.size)}`);
  if (rows.length > 100) lines.push(`and ${rows.length - 100} more files`);
  return [`${owner}/${repo} at ${ref}: ${rows.length} file${rows.length === 1 ? "" : "s"}`, ...lines].join("\n");
}

const fitRow = (label: string, f: Fit) => {
  const nse = f.nse === null ? "n/a" : g(f.nse);
  const rating = rateNse(f.nse);
  return `${label}: ${f.n} pairs, NSE ${nse}${rating ? ` (${rating.toLowerCase()})` : ""}, KGE ${f.kge === null ? "n/a" : g(f.kge)}, PBIAS ${f.pbias === null ? "n/a" : `${f.pbias.toFixed(1)}%`}, RMSE ${g(f.rmse)}`;
};

/** How well a simulated column agrees with an observed one in a CSV, overall and per station when `by` is given. */
export async function tableFit(getText: GetText, owner: string, repo: string, path: string, ref: string, obs: string, sim: string, by?: string) {
  const text = await getText(`${repoBase(owner, repo)}/raw/${encodeURIComponent(ref)}/${enc(path)}`);
  const rows = parseCsv(text, sniffDelimiter(text));
  const header = rows[0] ?? [];
  const col = (name: string) => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`${path} has no column "${name}". Columns: ${header.join(", ")}`);
    return i;
  };
  const oi = col(obs), si = col(sim);
  if (oi === si) throw new Error("Choose two different columns.");
  const body = rows.slice(1);
  const overall = fitStatistics(numericColumn(body, oi), numericColumn(body, si));
  if (!overall) throw new Error("Not enough numeric pairs in those two columns to compare.");
  const lines = [`${path} at ${ref}: ${sim} against ${obs}`, fitRow("all rows", overall)];
  if (by) for (const gr of fitByGroup(body, oi, si, col(by), 50)) lines.push(fitRow(gr.name, gr.fit));
  lines.push("NSE and KGE: 1 is perfect. PBIAS is positive when the model underestimates. Rows with a missing value are left out.");
  return lines.join("\n");
}

type BlameDoc = { path: string; commit: string; size: number; chunks: number; truncated: boolean; ranges: { start: number; end: number; commit: string; author: string; message: string; timestamp: string }[] };

/** Which commit rewrote each part of a file (byte ranges), so "who changed this strip of the DEM" has an answer. */
export async function blame(get: Get, owner: string, repo: string, path: string, ref?: string) {
  let at = ref;
  if (!at) {
    const info = (await get(repoBase(owner, repo))) as { defaultBranch?: string; default_branch?: string };
    at = info.defaultBranch ?? info.default_branch ?? "main";
  }
  const b = (await get(`${repoBase(owner, repo)}/blame/${encodeURIComponent(at)}/${enc(path)}`)) as BlameDoc;
  const lines = [`${b.path} at ${at} (${b.commit.slice(0, 7)}): ${b.chunks} chunk${b.chunks === 1 ? "" : "s"}, ${bytes(b.size)}`];
  for (const r of b.ranges) lines.push(`  ${bytes(r.start)} to ${bytes(r.end)}: ${r.commit.slice(0, 7)} ${r.timestamp.slice(0, 10)} ${r.author}: ${r.message.split("\n")[0].slice(0, 100)}`);
  if (b.ranges.length === 1) lines.push("The whole file comes from one commit.");
  if (b.truncated) lines.push("The history was longer than the walk limit, so the oldest range may be older than shown.");
  return lines.join("\n");
}

/** Who must review a pull request (CODEOWNERS on its target branch) and where each of them stands. */
export async function pullOwners(get: Get, owner: string, repo: string, number: number) {
  const rows = (await get(`${repoBase(owner, repo)}/pulls/${number}/owners`)) as { handle: string; files: string[]; requested: boolean; state: string | null; current: boolean }[];
  if (!rows.length) return `No code owners are named for the files pull request #${number} changes.`;
  return [
    `Code owners for ${owner}/${repo}#${number}:`,
    ...rows.map((o) => {
      const status = o.state === "approved" ? (o.current ? "approved" : "approved an earlier version") : o.state === "changes_requested" ? "asked for changes" : o.state === "commented" ? "commented" : o.requested ? "waiting" : "not asked";
      return `  @${o.handle}: ${status}; owns ${o.files.length} changed file${o.files.length === 1 ? "" : "s"} (${o.files.slice(0, 3).join(", ")}${o.files.length > 3 ? ", ..." : ""})`;
    }),
  ].join("\n");
}

type TextDiffDoc = { path: string; added: number; removed: number; replaced: boolean; truncated: boolean; hunks: { oldStart: number; newStart: number; oldLines: number; newLines: number; lines: { t: string; text: string }[] }[] };

/** The changed lines of a text file (a HEC-RAS plan or geometry file, an .inp, a config) between two versions. */
export async function textDiff(get: Get, owner: string, repo: string, path: string, since?: string, until?: string) {
  const base = repoBase(owner, repo);
  let from = since;
  if (!from) {
    const releases = (await get(`${base}/releases`)) as Release[];
    const latest = releases.find((r) => r.latest) ?? releases[0];
    if (!latest) return `${owner}/${repo} has no releases to compare with. Pass "since" as a branch, tag or commit.`;
    from = latest.tag;
  }
  let to = until;
  if (!to) {
    const info = (await get(base)) as { defaultBranch?: string; default_branch?: string };
    to = info.defaultBranch ?? info.default_branch ?? "main";
  }
  const d = (await get(`${base}/text-diff/${encodeURIComponent(to)}/${enc(path)}?base=${encodeURIComponent(from)}`)) as TextDiffDoc;
  if (!d.hunks.length) return `${path}: no lines changed between ${from} and ${to}.`;
  const out = [`${path}, ${from} -> ${to}: +${d.added} -${d.removed} lines${d.replaced ? " (too different to match line by line)" : ""}`];
  for (const h of d.hunks.slice(0, 20)) {
    out.push(`@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@`);
    for (const l of h.lines) out.push(`${l.t}${l.text}`);
  }
  if (d.hunks.length > 20 || d.truncated) out.push("... more changes follow.");
  return out.join("\n");
}
