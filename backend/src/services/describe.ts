// A short, stable, line-by-line description of a file whose bytes are not text but whose header says what is in it
// (a LAS point cloud, a NetCDF file, an HDF5 file such as a HEC-RAS plan). Two descriptions compared line by line show what changed between two
// versions: more points, a wider extent, another coordinate system, a variable added. Only the header is read.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { BlobReader } from "./chunks.ts";
import { getObject } from "./history.ts";
import type { BlobObject } from "../core/objects.ts";
import { readLasHeader } from "../checks/las.ts";
import { NotNetcdfError, readNetcdf } from "../checks/netcdf.ts";
import { readHdf5, type Hdf5Info } from "../checks/hdf5.ts";

const n2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = (v: number) => v.toLocaleString("en-US");

/** Whether `path` is a kind of file this module can describe. */
export function isDescribable(path: string) {
  return /\.(las|laz|nc|cdf|hdf|h5|hdf5|he5)$/i.test(path);
}

export async function describeStructured(ctx: Ctx, repo: RepoRow, blobId: string, path: string): Promise<string[] | null> {
  if (!isDescribable(path)) return null;
  const blob = getObject<BlobObject>(ctx, repo, blobId, "blob");
  const reader = new BlobReader(ctx, blob);
  const read = (o: number, l: number) => reader.read(o, l);
  try {
    if (/\.la[sz]$/i.test(path)) {
      const h = await readLasHeader(read, reader.size);
      return [
        `format: ${h.compressed ? "LAZ" : "LAS"} ${h.version}, point format ${h.pointFormat}`,
        `points: ${n0(h.pointCount)}`,
        `crs: ${h.epsg ? `EPSG:${h.epsg}` : "not declared"}`,
        `x: ${n2(h.min[0])} to ${n2(h.max[0])}`,
        `y: ${n2(h.min[1])} to ${n2(h.max[1])}`,
        `z: ${n2(h.min[2])} to ${n2(h.max[2])}`,
        `scale: ${h.scale.join(" ")}`,
        `software: ${h.generatingSoftware || "not recorded"}`,
      ];
    }
    if (/\.(hdf|h5|hdf5|he5)$/i.test(path)) return hdf5Lines(await readHdf5(read, reader.size));
    let nc;
    try {
      nc = await readNetcdf(read, reader.size);
    } catch (err) {
      // NetCDF-4 is an HDF5 container: describe it by its groups and variables.
      if (err instanceof NotNetcdfError && /HDF5/.test(err.message)) return hdf5Lines(await readHdf5(read, reader.size));
      throw err;
    }
    const lines = [`format: NetCDF classic ${nc.format}`, `conventions: ${nc.conventions ?? "not declared"}`];
    for (const d of nc.dimensions) lines.push(`dimension ${d.name}: ${d.length === null ? `unlimited (${n0(nc.records)} records)` : n0(d.length)}`);
    for (const v of nc.variables) {
      const units = v.attributes.find((a) => a.name === "units");
      lines.push(`variable ${v.name}: ${v.type} (${v.dimensions.join(", ")})${units && typeof units.value === "string" ? ` [${units.value}]` : ""}`);
    }
    for (const a of nc.attributes) if (typeof a.value === "string" && a.value.length <= 200 && a.name !== "Conventions") lines.push(`attribute ${a.name}: ${a.value}`);
    return lines;
  } catch {
    return null;
  }
}

/** Most object lines a description carries; the rest is counted. A results file can hold thousands. */
const MAX_LINES = 300;
/** Most attribute lines; a plan file has a few dozen that matter. */
const MAX_ATTRIBUTE_LINES = 120;

/**
 * One line per group and dataset, sorted by path, so two versions compare line by line: a dataset's shape changing
 * ("[12, 4040]" to "[24, 4040]" when a run is extended), a group appearing, a dataset's type changing.
 */
function hdf5Lines(info: Hdf5Info): string[] {
  const groups = info.objects.filter((o) => o.kind === "group").length;
  const datasets = info.objects.filter((o) => o.kind === "dataset").length;
  const lines = [`format: HDF5, superblock version ${info.version}`, `groups: ${n0(groups)}`, `datasets: ${n0(datasets)}`];
  const sorted = [...info.objects].filter((o) => o.path !== "/").sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  let attributeLines = 0;
  const attributeText = (path: string, attributes: Record<string, string | number | number[]> | undefined) => {
    if (!attributes) return;
    for (const name of Object.keys(attributes).sort()) {
      if (attributeLines++ >= MAX_ATTRIBUTE_LINES) return;
      const v = attributes[name];
      const text = Array.isArray(v) ? v.join(", ") : String(v);
      lines.push(`attribute ${path === "/" ? "" : path}/${name}: ${text.length > 200 ? `${text.slice(0, 200)}…` : text}`);
    }
  };
  attributeText("/", info.objects.find((o) => o.path === "/")?.attributes);
  for (const o of sorted.slice(0, MAX_LINES)) {
    if (o.kind === "dataset") lines.push(`dataset ${o.path}: ${o.type ?? "unknown type"} ${o.shape === null ? "(empty)" : o.shape.length === 0 ? "scalar" : `[${o.shape.join(", ")}]`}`);
    else if (o.kind === "group") {
      lines.push(`group ${o.path}: ${n0(o.links ?? 0)} ${o.links === 1 ? "link" : "links"}`);
      attributeText(o.path, o.attributes);
    }
    else if (o.kind === "soft-link") lines.push(`link ${o.path}`);
    else if (o.kind === "external-link") lines.push(`external link ${o.path}`);
    else lines.push(`${o.kind} ${o.path}`);
  }
  if (sorted.length > MAX_LINES) lines.push(`… and ${n0(sorted.length - MAX_LINES)} more`);
  if (info.limited) lines.push("listing stopped at the object limit");
  for (const note of info.notes) lines.push(`not read: ${note}`);
  return lines;
}
