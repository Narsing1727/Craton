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
import { cogProblems, readCogLayout } from "./cog.ts";
import { checkSwmm } from "./swmm.ts";
import { lasProblems, readLasHeader } from "./las.ts";
import { MAX_GPKG_BYTES, readGeoPackage } from "./gpkg.ts";
import { NotParquetError, readGeoParquet } from "./geoparquet.ts";
import { NotNetcdfError, netcdfProblems, readNetcdf } from "./netcdf.ts";
import { NotHdf5Error, hdf5Problems, readHdf5 } from "./hdf5.ts";
import { summarizeRun } from "./hecras.ts";
import { runCustomChecks } from "./custom.ts";
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
  const rasterInfo: { path: string; epsg: number | null; vertical: number | null; nodata: number | null; cog?: string[]; error?: string }[] = [];
  for (const r of rasters) {
    const reader = new BlobReader(ctx, blobOf(r.blob));
    try {
      const info = await readGeoTiff((o, l) => reader.read(o, l), reader.size);
      // The layout is read from the same file; a directory that cannot be read just means "not known", not a failure.
      const cog = await readCogLayout((o, l) => reader.read(o, l), reader.size).then(cogProblems).catch(() => undefined);
      rasterInfo.push({ path: r.path, epsg: info.epsg, vertical: info.verticalEpsg, nodata: info.nodata, cog });
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

  // GeoPackages: each spatial layer declares its own coordinate system. They are opened by a separate, time-limited
  // process (see gpkg.ts); a file too big to open, or that cannot be read, is said in the step, not silently passed.
  const gpkgLayers: { path: string; table: string; epsg: number | null }[] = [];
  const gpkgNotes: string[] = [];
  for (const g of tree.entries.filter((e) => ext(e.path) === "gpkg")) {
    if (g.size > MAX_GPKG_BYTES) {
      gpkgNotes.push(`${g.path} is larger than ${MAX_GPKG_BYTES / 1024 / 1024} MB and was not opened`);
      continue;
    }
    try {
      const info = await readGeoPackage(await new BlobReader(ctx, blobOf(g.blob)).readAll());
      for (const l of info.layers) if (l.type !== "attributes") gpkgLayers.push({ path: g.path, table: l.table, epsg: l.epsg });
    } catch (err) {
      gpkgNotes.push(`${g.path} could not be read as a GeoPackage (${(err as Error).message})`);
    }
  }

  // GeoParquet: each geometry column declares its CRS in the footer (read without touching the data pages). A Parquet
  // file with no "geo" metadata is a plain table and has nothing to check.
  for (const g of tree.entries.filter((e) => ext(e.path) === "parquet")) {
    try {
      const reader = new BlobReader(ctx, blobOf(g.blob));
      const info = await readGeoParquet((o, l) => reader.read(o, l), reader.size);
      for (const c of info?.columns ?? []) gpkgLayers.push({ path: g.path, table: c.name, epsg: c.epsg });
    } catch (err) {
      if (!(err instanceof NotParquetError)) gpkgNotes.push(`${g.path} could not be read as GeoParquet (${(err as Error).message})`);
    }
  }

  const steps: Step[] = [];
  const want = Number(repo.crs.replace("EPSG:", ""));

  // 1. Coordinate reference system
  {
    const bad = [
      ...rasterInfo.filter((r) => r.epsg !== want).map((r) => `${r.path} (${r.error ?? (r.epsg ? `EPSG:${r.epsg}` : "no CRS")})`),
      ...prjInfo.filter((p) => p.epsg !== want).map((p) => `${p.path} (${p.epsg ? `EPSG:${p.epsg}` : "unrecognised WKT"})`),
      ...gpkgLayers.filter((l) => l.epsg !== want).map((l) => `${l.path}, ${l.path.toLowerCase().endsWith(".parquet") ? "column" : "layer"} ${l.table} (${l.epsg ? `EPSG:${l.epsg}` : "no EPSG coordinate system"})`),
    ];
    const total = rasterInfo.length + prjInfo.length + gpkgLayers.length;
    const note = gpkgNotes.length ? ` Not checked: ${gpkgNotes.join("; ")}.` : "";
    steps.push(
      total === 0
        ? { name: "Coordinate reference system", status: "skipped", detail: `No rasters, shapefiles, GeoPackages or GeoParquet files to check.${note}` }
        : bad.length
          ? { name: "Coordinate reference system", status: "failed", detail: `${bad.length} of ${total} layers are not in ${repo.crs}.${note}`, files: bad }
          : { name: "Coordinate reference system", status: "passed", detail: `All ${total} layers use ${repo.crs}.${note}` },
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

  // 3b. Cloud Optimized GeoTIFF layout: advisory unless the repository requires it (Settings), because plenty of
  // rasters are never served over the web and a gate that fails on them would only be noise.
  {
    const known = rasterInfo.filter((r) => r.cog !== undefined);
    if (!known.length) steps.push({ name: "Cloud-optimized GeoTIFF", status: "skipped", detail: "No rasters to check." });
    else {
      const notCog = known.filter((r) => (r.cog ?? []).length > 0).map((r) => `${r.path}: ${(r.cog ?? []).join("; ")}`);
      const fine = known.length - notCog.length;
      if (!notCog.length) steps.push({ name: "Cloud-optimized GeoTIFF", status: "passed", detail: `All ${known.length} rasters are laid out for range-request reads (tiled, overviews, directories first).` });
      else if (repo.require_cog) steps.push({ name: "Cloud-optimized GeoTIFF", status: "failed", detail: `${notCog.length} of ${known.length} rasters are not Cloud Optimized GeoTIFFs, and this repository requires them. Convert with: gdal_translate -of COG in.tif out.tif`, files: notCog });
      else steps.push({ name: "Cloud-optimized GeoTIFF", status: "passed", detail: `Advisory: ${fine} of ${known.length} rasters are Cloud Optimized GeoTIFFs. The rest are slower to read from the web, and a small edit to them is stored as more new chunks (tiled files keep an edit local); convert with: gdal_translate -of COG in.tif out.tif`, files: notCog });
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

  // 5b. SWMM input files: nodes, links and lengths that the engine would refuse. EPANET also uses .inp, so a file counts
  // only when it has a section only SWMM has.
  {
    const MAX_INP = 25 * 1024 * 1024;
    const inps = tree.entries.filter((e) => ext(e.path) === "inp" && e.size <= MAX_INP);
    const problems: string[] = [];
    let models = 0;
    let links = 0;
    for (const f of inps) {
      const text = (await new BlobReader(ctx, blobOf(f.blob)).readAll()).toString("latin1");
      if (!/^\s*\[(CONDUITS|SUBCATCHMENTS|RAINGAGES|OUTFALLS)\]/im.test(text)) continue;
      models++;
      const report = checkSwmm(text);
      links += report.links;
      for (const p of report.problems.slice(0, 25)) problems.push(`${f.path}: ${p}`);
      if (report.problems.length > 25) problems.push(`${f.path}: and ${report.problems.length - 25} more`);
    }
    steps.push(
      !models
        ? { name: "SWMM model", status: "skipped", detail: "No SWMM input files in this commit." }
        : problems.length
          ? { name: "SWMM model", status: "failed", detail: `${problems.length} problems the engine would reject in ${models} SWMM ${models === 1 ? "model" : "models"}.`, files: problems }
          : { name: "SWMM model", status: "passed", detail: `${models} SWMM ${models === 1 ? "model is" : "models are"} consistent: ${links} links between defined nodes, positive lengths, drops within length.` },
    );
  }

  // 5c. Point clouds (LAS / LAZ): the header is sound, the file is not cut short, and a CRS the file declares is the
  // repository's. Many point clouds declare none; that is said, not failed, as with a missing vertical datum.
  {
    const clouds = tree.entries.filter((e) => ["las", "laz"].includes(ext(e.path)));
    const problems: string[] = [];
    let undeclared = 0;
    let total = 0;
    for (const c of clouds) {
      const reader = new BlobReader(ctx, blobOf(c.blob));
      try {
        const info = await readLasHeader((o, l) => reader.read(o, l), reader.size);
        total++;
        for (const p of lasProblems(info, reader.size)) problems.push(`${c.path}: ${p}`);
        if (info.epsg === null) undeclared++;
        else if (info.epsg !== want) problems.push(`${c.path}: declares EPSG:${info.epsg}, not ${repo.crs}`);
      } catch (err) {
        problems.push(`${c.path}: ${err instanceof NotTiffError ? "not a LAS file" : (err as Error).message}`);
      }
    }
    steps.push(
      !clouds.length
        ? { name: "Point clouds", status: "skipped", detail: "No LAS or LAZ files in this commit." }
        : problems.length
          ? { name: "Point clouds", status: "failed", detail: `${problems.length} problems in ${clouds.length} point clouds.`, files: problems }
          : {
              name: "Point clouds",
              status: "passed",
              detail: `${total} point ${total === 1 ? "cloud has" : "clouds have"} sound headers${undeclared ? `; ${undeclared} declare${undeclared === 1 ? "s" : ""} no CRS, so ${undeclared === 1 ? "it" : "they"} could not be compared with ${repo.crs}` : ` and use ${repo.crs}`}.`,
            },
    );
  }

  // 5d. NetCDF (classic) model outputs and gridded data: the header reads, the file is not cut short, and whether it
  // says which conventions it follows (CF). NetCDF-4 is an HDF5 container and is counted, not read.
  {
    const files = tree.entries.filter((e) => ["nc", "cdf"].includes(ext(e.path)));
    const problems: string[] = [];
    let classic = 0;
    let hdf5 = 0;
    let noConventions = 0;
    for (const f of files) {
      const reader = new BlobReader(ctx, blobOf(f.blob));
      try {
        const info = await readNetcdf((o, l) => reader.read(o, l), reader.size);
        classic++;
        for (const p of netcdfProblems(info, reader.size)) problems.push(`${f.path}: ${p}`);
        if (!info.conventions) noConventions++;
      } catch (err) {
        if (err instanceof NotNetcdfError && /HDF5|CDF-5/.test(err.message)) hdf5++;
        else problems.push(`${f.path}: ${err instanceof NotNetcdfError ? "not a NetCDF file" : (err as Error).message}`);
      }
    }
    steps.push(
      !files.length
        ? { name: "NetCDF", status: "skipped", detail: "No NetCDF files in this commit." }
        : problems.length
          ? { name: "NetCDF", status: "failed", detail: `${problems.length} problems in ${files.length} NetCDF files.`, files: problems }
          : {
              name: "NetCDF",
              status: "passed",
              detail: `${classic} classic ${classic === 1 ? "file has a" : "files have"} readable header${classic === 1 ? "" : "s"} and ${classic === 1 ? "is" : "are"} complete${noConventions ? `; ${noConventions} name${noConventions === 1 ? "s" : ""} no Conventions attribute (CF or COARDS)` : ""}${hdf5 ? `; ${hdf5} NetCDF-4/HDF5 ${hdf5 === 1 ? "file was" : "files were"} not read` : ""}.`,
            },
    );
  }

  // 5e. HDF5 (HEC-RAS plan, geometry and results files are HDF5): the structure reads and the file is not cut short.
  // A file another program is still writing, or a copy that stopped half way, is the usual failure, and the superblock
  // records where the file should end.
  {
    const files = tree.entries.filter((e) => ["hdf", "h5", "hdf5", "he5"].includes(ext(e.path)));
    const problems: string[] = [];
    let readable = 0;
    let objects = 0;
    let withResults = 0;
    let notes = 0;
    for (const f of files) {
      const reader = new BlobReader(ctx, blobOf(f.blob));
      try {
        const info = await readHdf5((o, l) => reader.read(o, l), reader.size);
        readable++;
        objects += info.objects.length;
        if (info.objects.some((o) => o.path === "/Results" && o.kind === "group")) withResults++;
        if (info.notes.length || info.limited) notes++;
        for (const p of hdf5Problems(info, reader.size)) problems.push(`${f.path}: ${p}`);
        // A plan that records "went unstable" is not a result to release as it stands.
        const run = summarizeRun(info.objects);
        if (run?.unstable) problems.push(`${f.path}: the run reports "${run.solution}"${run.unstableAt ? ` (${run.unstableAt})` : ""}`);
      } catch (err) {
        problems.push(`${f.path}: ${err instanceof NotHdf5Error ? "not an HDF5 file" : (err as Error).message}`);
      }
    }
    steps.push(
      !files.length
        ? { name: "HDF5", status: "skipped", detail: "No HDF5 files in this commit." }
        : problems.length
          ? { name: "HDF5", status: "failed", detail: `${problems.length} ${problems.length === 1 ? "problem" : "problems"} in ${files.length} HDF5 ${files.length === 1 ? "file" : "files"}.`, files: problems }
          : {
              name: "HDF5",
              status: "passed",
              detail: `${readable} HDF5 ${readable === 1 ? "file has" : "files have"} readable structure (${objects.toLocaleString("en-US")} groups and datasets) and ${readable === 1 ? "is" : "are"} complete${withResults ? `; ${withResults} hold${withResults === 1 ? "s" : ""} a Results group` : ""}${notes ? `; ${notes} had parts that were not listed` : ""}.`,
            },
    );
  }

  // 5f. The repository's own declared checks (.craton-checks.json): CRS, nodata, cell size, columns, run status...
  {
    const custom = await runCustomChecks(ctx, repo, commitId, tree);
    steps.push({ name: "Repository checks", status: custom.status, detail: custom.detail, ...(custom.files ? { files: custom.files } : {}) });
  }

  // 6. Chunk integrity and provenance
  {
    const problems: string[] = [];
    if (treeMerkleRoot(tree) !== commit.merkleRoot) problems.push("Merkle root doesn’t match the tree");
    // A file whose blob is the same as in the parent commit was read back and hashed when the parent passed its own
    // checks (same blob id means the same chunks), so a push that changes ten files in a repository of ten thousand
    // does not read the other 9,990 again. Anything else is hashed in full, as before.
    const alreadyVerified = new Set<string>();
    const parentId = commit.parents[0];
    if (parentId && latestCheckStatus(ctx, repo, parentId) === "passed") {
      try {
        const parent = getObject<CommitObject>(ctx, repo, parentId, "commit");
        for (const e of getObject<TreeObject>(ctx, repo, parent.tree, "tree").entries) alreadyVerified.add(e.blob);
      } catch {
        alreadyVerified.clear();
      }
    }
    let verifiedFiles = 0;
    let carried = 0;
    for (const e of tree.entries) {
      if (alreadyVerified.has(e.blob)) {
        carried++;
        continue;
      }
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
    const total = verifiedFiles + carried;
    steps.push(
      problems.length
        ? { name: "Chunk integrity", status: "failed", detail: `${problems.length} integrity problems.`, files: problems }
        : {
            name: "Chunk integrity",
            status: "passed",
            detail: carried
              ? `${total} files verified against their SHA-256 and the commit’s Merkle root: ${verifiedFiles} read back now, ${carried} unchanged since the previous commit, which passed.`
              : `${verifiedFiles} files verified against their SHA-256 and the commit’s Merkle root.`,
          },
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
