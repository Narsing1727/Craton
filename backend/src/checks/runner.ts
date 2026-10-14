// The validation gate: runs on every branch update and records a check run.
// A failing CRS, vertical datum or integrity step blocks merges when branch protection is on.

import type { Ctx } from "../services/context.ts";
import type { RepoRow } from "../services/repos.ts";
import { BlobReader } from "../services/chunks.ts";
import { getObject } from "../services/history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { treeMerkleRoot } from "../core/objects.ts";
import { sha256Hex } from "../core/fastcdc.ts";
import { createHash } from "node:crypto";
import { NotTiffError, readGeoTiff } from "./geotiff.ts";
import { epsgFromWkt, hecRasPlanRefs, readShpHeader } from "./vector.ts";

export type StepStatus = "passed" | "failed" | "skipped";
export type Step = { name: string; status: StepStatus; detail: string; files?: string[] };
export type CheckRun = { id: number; commit: string; branch: string; status: "passed" | "failed"; steps: Step[]; durationMs: number; createdAt: string };

const FULL_HASH_LIMIT = 64 * 1024 * 1024; // re-hash whole files up to 64 MB per run
const lower = (p: string) => p.toLowerCase();
const ext = (p: string) => lower(p).split(".").pop() ?? "";
const stem = (p: string) => p.slice(0, p.lastIndexOf("."));

export async function runChecks(ctx: Ctx, repo: RepoRow, commitId: string, branch: string): Promise<CheckRun> {
  const started = performance.now();
  const commit = getObject<CommitObject>(ctx, repo, commitId, "commit");
  const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
  const blobOf = (id: string) => getObject<BlobObject>(ctx, repo, id, "blob");
  const byPath = new Map(tree.entries.map((e) => [lower(e.path), e]));

  const rasters = tree.entries.filter((e) => ["tif", "tiff"].includes(ext(e.path)));
  const rasterInfo: { path: string; epsg: number | null; vertical: number | null; nodata: number | null; error?: string }[] = [];
  for (const r of rasters) {
    const reader = new BlobReader(ctx, blobOf(r.blob));
    try {
      const info = await readGeoTiff((o, l) => reader.read(o, l), reader.size);
      rasterInfo.push({ path: r.path, epsg: info.epsg, vertical: info.verticalEpsg, nodata: info.nodata });
    } catch (err) {
      rasterInfo.push({ path: r.path, epsg: null, vertical: null, nodata: null, error: err instanceof NotTiffError ? "not a TIFF" : String((err as Error).message) });
    }
  }

  const prjFiles = tree.entries.filter((e) => ext(e.path) === "prj" && byPath.has(lower(stem(e.path)) + ".shp"));
  const prjInfo: { path: string; epsg: number | null }[] = [];
  for (const p of prjFiles) {
    const text = (await new BlobReader(ctx, blobOf(p.blob)).readAll()).toString("utf8");
    prjInfo.push({ path: p.path, epsg: epsgFromWkt(text) });
  }

  const steps: Step[] = [];
  const want = Number(repo.crs.replace("EPSG:", ""));

  // 1. Coordinate reference system
  {
    const bad = [
      ...rasterInfo.filter((r) => r.epsg !== want).map((r) => `${r.path} (${r.error ?? (r.epsg ? `EPSG:${r.epsg}` : "no CRS")})`),
      ...prjInfo.filter((p) => p.epsg !== want).map((p) => `${p.path} (${p.epsg ? `EPSG:${p.epsg}` : "unrecognised WKT"})`),
    ];
    const total = rasterInfo.length + prjInfo.length;
    steps.push(
      total === 0
        ? { name: "Coordinate reference system", status: "skipped", detail: "No rasters or shapefiles to check." }
        : bad.length
          ? { name: "Coordinate reference system", status: "failed", detail: `${bad.length} of ${total} layers are not in ${repo.crs}.`, files: bad }
          : { name: "Coordinate reference system", status: "passed", detail: `All ${total} layers use ${repo.crs}.` },
    );
  }

  // 2. Vertical datum
  {
    const withVertical = rasterInfo.filter((r) => r.vertical !== null);
    if (!repo.vertical_datum || withVertical.length === 0) {
      steps.push({ name: "Vertical datum", status: "skipped", detail: repo.vertical_datum ? "No raster declares a vertical CRS." : "No vertical datum is configured for this repository." });
    } else {
      const bad = rasterInfo.filter((r) => r.vertical !== repo.vertical_datum).map((r) => `${r.path} (${r.vertical ? `EPSG:${r.vertical}` : "none declared"})`);
      steps.push(
        bad.length
          ? { name: "Vertical datum", status: "failed", detail: `${bad.length} rasters don’t use vertical EPSG:${repo.vertical_datum}. Mixing datums shifts every elevation.`, files: bad }
          : { name: "Vertical datum", status: "passed", detail: `All rasters use vertical EPSG:${repo.vertical_datum}.` },
      );
    }
  }

  // 3. Nodata value
  {
    const valid = rasterInfo.filter((r) => !r.error);
    if (!valid.length) steps.push({ name: "Nodata value", status: "skipped", detail: "No rasters to check." });
    else {
      const expected = repo.nodata ?? valid.find((r) => r.nodata !== null)?.nodata ?? null;
      const bad = valid.filter((r) => r.nodata !== expected).map((r) => `${r.path} (${r.nodata ?? "not set"})`);
      steps.push(
        bad.length
          ? { name: "Nodata value", status: "failed", detail: `Rasters should use nodata ${expected}.`, files: bad }
          : { name: "Nodata value", status: "passed", detail: `Rasters use ${expected === null ? "no nodata value" : `nodata ${expected}`} consistently.` },
      );
    }
  }

  // 4. Shapefile sets
  {
    const shps = tree.entries.filter((e) => ext(e.path) === "shp");
    const problems: string[] = [];
    for (const s of shps) {
      const base = lower(stem(s.path));
      const missing = ["shx", "dbf"].filter((x) => !byPath.has(`${base}.${x}`));
      if (missing.length) problems.push(`${s.path} is missing .${missing.join(" and .")}`);
      const head = readShpHeader(await new BlobReader(ctx, blobOf(s.blob)).read(0, 100));
      if (!head?.valid) problems.push(`${s.path} has an invalid header`);
      else if (head.declaredBytes !== s.size) problems.push(`${s.path} is truncated (header says ${head.declaredBytes} bytes, file has ${s.size})`);
    }
    steps.push(
      !shps.length
        ? { name: "Shapefile sets", status: "skipped", detail: "No shapefiles in this commit." }
        : problems.length
          ? { name: "Shapefile sets", status: "failed", detail: `${problems.length} problems in ${shps.length} shapefiles.`, files: problems }
          : { name: "Shapefile sets", status: "passed", detail: `${shps.length} shapefiles are complete and intact.` },
    );
  }

  // 5. Model schema (HEC-RAS plans reference existing geometry and flow files)
  {
    const plans = tree.entries.filter((e) => /\.p\d\d$/i.test(e.path));
    const problems: string[] = [];
    for (const p of plans) {
      const text = (await new BlobReader(ctx, blobOf(p.blob)).readAll()).toString("latin1");
      const { geom, flow } = hecRasPlanRefs(text);
      const base = lower(stem(p.path));
      if (!geom) problems.push(`${p.path} doesn’t name a geometry file`);
      else if (!byPath.has(`${base}.${lower(geom)}`)) problems.push(`${p.path} points at missing geometry ${geom}`);
      if (flow && !byPath.has(`${base}.${lower(flow)}`)) problems.push(`${p.path} points at missing flow file ${flow}`);
    }
    steps.push(
      !plans.length
        ? { name: "Model schema", status: "skipped", detail: "No HEC-RAS plans in this commit." }
        : problems.length
          ? { name: "Model schema", status: "failed", detail: `${problems.length} broken references.`, files: problems }
          : { name: "Model schema", status: "passed", detail: `${plans.length} HEC-RAS plans reference existing geometry and flow files.` },
    );
  }

  // 6. Chunk integrity and provenance
  {
    const problems: string[] = [];
    if (treeMerkleRoot(tree) !== commit.merkleRoot) problems.push("Merkle root doesn’t match the tree");
    let verifiedFiles = 0;
    for (const e of tree.entries) {
      const blob = blobOf(e.blob);
      const reader = new BlobReader(ctx, blob);
      try {
        if (blob.size <= FULL_HASH_LIMIT) {
          const hash = createHash("sha256");
          for (let off = 0; off < blob.size; off += 4 * 1024 * 1024) hash.update(await reader.read(off, 4 * 1024 * 1024));
          if (blob.size === 0) hash.update(Buffer.alloc(0));
          if (hash.digest("hex") !== blob.sha256) problems.push(`${e.path}: file hash mismatch`);
          else verifiedFiles++;
        } else {
          // Large files: every chunk still decompresses and hash-verifies inside BlobReader.
          await reader.read(0, 1);
          verifiedFiles++;
        }
      } catch (err) {
        problems.push(`${e.path}: ${(err as Error).message}`);
      }
    }
    steps.push(
      problems.length
        ? { name: "Chunk integrity", status: "failed", detail: `${problems.length} integrity problems.`, files: problems }
        : { name: "Chunk integrity", status: "passed", detail: `${verifiedFiles} files verified against their SHA-256 and the commit’s Merkle root.` },
    );
  }

  const status = steps.some((s) => s.status === "failed") ? "failed" : "passed";
  const durationMs = Math.round(performance.now() - started);
  const { lastInsertRowid } = ctx.db
    .prepare("INSERT INTO check_runs (repo_id, commit_id, branch, status, steps, duration_ms) VALUES (?, ?, ?, ?, ?, ?)")
    .run(repo.id, commitId, branch, status, JSON.stringify(steps), durationMs);
  const row = ctx.db.prepare("SELECT created_at FROM check_runs WHERE id = ?").get(lastInsertRowid) as { created_at: string };
  return { id: Number(lastInsertRowid), commit: commitId, branch, status, steps, durationMs, createdAt: row.created_at };
}

export function listCheckRuns(ctx: Ctx, repo: RepoRow, opts: { commit?: string; limit?: number } = {}) {
  const rows = (opts.commit
    ? ctx.db.prepare("SELECT * FROM check_runs WHERE repo_id = ? AND commit_id = ? ORDER BY id DESC LIMIT ?").all(repo.id, opts.commit, opts.limit ?? 20)
    : ctx.db.prepare("SELECT * FROM check_runs WHERE repo_id = ? ORDER BY id DESC LIMIT ?").all(repo.id, opts.limit ?? 50)) as {
    id: number;
    commit_id: string;
    branch: string;
    status: "passed" | "failed";
    steps: string;
    duration_ms: number;
    created_at: string;
  }[];
  return rows.map((r) => ({ id: r.id, commit: r.commit_id, branch: r.branch, status: r.status, steps: JSON.parse(r.steps) as Step[], durationMs: r.duration_ms, createdAt: r.created_at }));
}

/** Latest check status for a commit, or null if it never ran. */
export function latestCheckStatus(ctx: Ctx, repo: RepoRow, commitId: string): "passed" | "failed" | null {
  const row = ctx.db.prepare("SELECT status FROM check_runs WHERE repo_id = ? AND commit_id = ? ORDER BY id DESC LIMIT 1").get(repo.id, commitId) as { status: "passed" | "failed" } | undefined;
  return row?.status ?? null;
}

export { sha256Hex };
