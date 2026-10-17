// Runs as its own process: reads the GeoPackage metadata tables of one SQLite file (argv[2]) and prints the result as
// one line of JSON. It is a separate process so the parent can stop it: a SQLite file from a stranger can carry a view
// or query that never finishes, and a synchronous native query cannot be interrupted from inside its own thread (a
// worker thread's terminate() waits for it), but a process can always be killed.

import { DatabaseSync } from "node:sqlite";

type Row = Record<string, unknown>;

function run(file: string) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    // Nothing in the file may run code of its own while it is read.
    db.exec("PRAGMA trusted_schema = OFF");
    const pragma = (name: string) => Number((db.prepare(`PRAGMA ${name}`).get() as Row)[name]);
    const applicationId = pragma("application_id");
    const userVersion = pragma("user_version");
    const app = Buffer.alloc(4);
    app.writeUInt32BE(applicationId >>> 0, 0);
    // Only a GeoPackage has the tables below; anything else is reported as it is and not queried.
    if (!["GPKG", "GP10", "GP11"].includes(app.toString("latin1"))) return { applicationId: app.toString("latin1"), userVersion, layers: [] };

    const srs = new Map<number, { organization: string; code: number }>();
    for (const r of db.prepare("SELECT srs_id, organization, organization_coordsys_id FROM gpkg_spatial_ref_sys").all() as Row[]) {
      srs.set(Number(r.srs_id), { organization: String(r.organization ?? ""), code: Number(r.organization_coordsys_id) });
    }
    const layers = [] as {
      table: string;
      type: string;
      srsId: number | null;
      epsg: number | null;
      features: number | null;
      extent: [number, number, number, number] | null;
    }[];
    for (const r of db.prepare("SELECT table_name, data_type, srs_id, min_x, min_y, max_x, max_y FROM gpkg_contents").all() as Row[]) {
      const table = String(r.table_name);
      const srsId = r.srs_id === null || r.srs_id === undefined ? null : Number(r.srs_id);
      const s = srsId === null ? undefined : srs.get(srsId);
      let features: number | null = null;
      if (String(r.data_type) === "features" || String(r.data_type) === "attributes") {
        try {
          features = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${table.replace(/"/g, '""')}"`).get() as Row).n);
        } catch {
          features = null;
        }
      }
      const nums = [r.min_x, r.min_y, r.max_x, r.max_y].map((v) => (v === null || v === undefined ? NaN : Number(v)));
      layers.push({
        table,
        type: String(r.data_type),
        srsId,
        epsg: s && s.organization.toUpperCase() === "EPSG" && s.code > 0 ? s.code : null,
        features,
        extent: nums.every(Number.isFinite) ? (nums as [number, number, number, number]) : null,
      });
    }
    return { applicationId: app.toString("latin1"), userVersion, layers };
  } finally {
    db.close();
  }
}

try {
  process.stdout.write(JSON.stringify({ ok: true, info: run(String(process.argv[2])) }) + "\n");
} catch (err) {
  process.stdout.write(JSON.stringify({ ok: false, error: (err as Error).message }) + "\n");
}
