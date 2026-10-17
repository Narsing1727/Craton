// GeoPackage (an OGC standard vector format, and what QGIS saves by default): which layers it holds, how many features,
// and which coordinate system each declares. GeoPackage is a SQLite database, so reading it means opening SQLite; the
// bytes are written to a private temporary file, opened read-only by a separate process with a time limit (killed if it
// overruns), and removed.
//
// A GeoPackage is identified by SQLite's application_id ("GPKG", or "GP10"/"GP11" for the first versions); its
// gpkg_contents table lists the layers and gpkg_spatial_ref_sys maps each layer's srs_id to an authority code.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type GpkgLayer = {
  table: string;
  /** "features", "tiles", "attributes", "2d-gridded-coverage" (or an extension's own). */
  type: string;
  srsId: number | null;
  /** The EPSG code behind srsId, null when the layer has no spatial reference or its authority is not EPSG. */
  epsg: number | null;
  features: number | null;
  extent: [number, number, number, number] | null;
};

export type GpkgInfo = { applicationId: string; userVersion: number; layers: GpkgLayer[] };

const SQLITE_MAGIC = "SQLite format 3\0";
/** Bigger files are not opened here: reading them needs the whole file on disk, which a check should not do for free. */
export const MAX_GPKG_BYTES = 128 * 1024 * 1024;

export class NotGpkgError extends Error {}

export function looksLikeSqlite(head: Buffer) {
  return head.length >= 16 && head.toString("latin1", 0, 16) === SQLITE_MAGIC;
}

export async function readGeoPackage(data: Buffer, timeoutMs = 5000): Promise<GpkgInfo> {
  if (!looksLikeSqlite(data)) throw new NotGpkgError("Not a SQLite file");
  if (data.length > MAX_GPKG_BYTES) throw new Error(`GeoPackage is larger than ${MAX_GPKG_BYTES / 1024 / 1024} MB; it is not opened here`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "craton-gpkg-"));
  const file = path.join(dir, `${randomUUID()}.gpkg`);
  fs.writeFileSync(file, data, { mode: 0o600 });
  try {
    const info = await new Promise<GpkgInfo>((resolve, reject) => {
      const script = fileURLToPath(new URL("./gpkg-worker.ts", import.meta.url));
      const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", script, file], { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
      let out = "";
      let timedOut = false;
      // The answer is given only after the process has exited: its open file would otherwise block removing the
      // temporary file on Windows.
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);
      child.stdout.on("data", (d: Buffer) => {
        out += d.toString("utf8");
        if (out.length > 4 * 1024 * 1024) child.kill("SIGKILL");
      });
      child.once("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.once("close", () => {
        clearTimeout(timer);
        if (timedOut) return reject(new Error(`Reading the GeoPackage took longer than ${timeoutMs / 1000} s`));
        try {
          const m = JSON.parse(out.trim().split("\n").pop() ?? "") as { ok: boolean; info?: GpkgInfo; error?: string };
          if (m.ok && m.info) resolve(m.info);
          else reject(new Error(m.error ?? "Could not read the GeoPackage"));
        } catch {
          reject(new Error("Could not read the GeoPackage"));
        }
      });
    });
    if (!["GPKG", "GP10", "GP11"].includes(info.applicationId)) throw new NotGpkgError("A SQLite file, but not a GeoPackage");
    return info;
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // A leftover temporary file is not worth failing a check over; the system's temp cleanup takes it.
    }
  }
}
