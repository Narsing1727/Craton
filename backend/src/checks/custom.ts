// Checks a repository declares for itself, in `.craton-checks.json` at its root.
//
//   {
//     "version": 1,
//     "checks": [
//       { "name": "Terrain is on the project grid", "files": "terrain/*.tif",
//         "expect": { "crs": 32643, "nodata": -9999, "cellSize": { "min": 5, "max": 30 }, "within": [75.9, 10.2, 76.4, 10.4] } },
//       { "name": "Gauge tables", "files": "gauges/*.csv",
//         "expect": { "columns": ["station", "datetime", "discharge"], "notEmpty": ["discharge"], "numeric": { "discharge": { "min": 0 } } } },
//       { "name": "Plans finished", "files": "model/*.p??.hdf", "expect": { "run": { "stable": true, "maxWselError": { "max": 0.05 } } } },
//       { "require": ["README.md", "model/*.prj"] },
//       { "files": "**", "expect": { "maxBytes": "500MB" }, "severity": "warn" }
//     ]
//   }
//
// Why a file and not a settings form: the rules are part of the model, they are reviewed in pull requests like the model,
// and they travel with a clone. Why strict: a misspelt key that quietly passes is worse than no check, so an unknown key,
// a wrong type or a bad number is itself a failure, reported with the key's path. What it never does: guess. An
// expectation is judged only from what the file's own header says, and a file kind that can't answer it is skipped
// (and said so if no file at all could answer).

import type { Ctx } from "../services/context.ts";
import type { RepoRow } from "../services/repos.ts";
import { fileInfo } from "../services/files.ts";
import { BlobReader } from "../services/chunks.ts";
import { getObject } from "../services/history.ts";
import { parseCsv, sniffDelimiter } from "../core/csv.ts";
import { matchesAny } from "../core/globs.ts";
import type { BlobObject, TreeObject } from "../core/objects.ts";

export const CONFIG_PATH = ".craton-checks.json";
const MAX_CHECKS = 50;
const MAX_FILE_EVALUATIONS = 2000;
const MAX_CSV_BYTES = 16 * 1024 * 1024;
const MAX_FINDINGS = 100;

type Range = { min?: number; max?: number };
type Expect = Record<string, unknown>;
type Check = { name: string; files: string[] | null; severity: "error" | "warn"; require: string[]; forbid: string[]; expect: Expect };
export type Finding = { check: string; file: string | null; severity: "error" | "warn"; message: string };
type Facts = Awaited<ReturnType<typeof fileInfo>>;

// ── Reading the file ─────────────────────────────────────────────────────────

const KNOWN_TOP = new Set(["version", "checks"]);
const KNOWN_CHECK = new Set(["name", "files", "severity", "require", "forbid", "expect"]);

const SIZE_UNITS: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
function parseSize(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  const m = /^\s*(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)\s*$/i.exec(String(v));
  return m ? Math.round(Number(m[1]) * SIZE_UNITS[m[2].toLowerCase()]) : null;
}

const isRange = (v: unknown): v is Range =>
  typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).every((k) => k === "min" || k === "max") && Object.values(v).every((n) => typeof n === "number" && Number.isFinite(n)) && Object.keys(v).length > 0;
const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s.trim().length > 0);
const toList = (v: unknown): string[] | null => (typeof v === "string" && v.trim() ? [v.trim()] : isStrings(v) ? v.map((s) => s.trim()) : null);

/** Validators for each expectation key: return a problem sentence, or null when the value is well formed. */
const SHAPES: Record<string, (v: unknown) => string | null> = {
  crs: (v) => (Number.isInteger(v) || (Array.isArray(v) && v.length > 0 && v.every(Number.isInteger)) ? null : "an EPSG code, or a list of them"),
  nodata: (v) => (v === "defined" || (typeof v === "number" && Number.isFinite(v)) ? null : 'a number, or "defined"'),
  cellSize: (v) => (isRange(v) ? null : "{ min?, max? } in the coordinate system's units"),
  width: (v) => (isRange(v) ? null : "{ min?, max? } in cells"),
  height: (v) => (isRange(v) ? null : "{ min?, max? } in cells"),
  dataType: (v) => (toList(v) ? null : 'a type name such as "float32", or a list'),
  cog: (v) => (v === true ? null : "true"),
  within: (v) => (Array.isArray(v) && v.length === 4 && v.every((n) => typeof n === "number" && Number.isFinite(n)) && (v[0] as number) < (v[2] as number) && (v[1] as number) < (v[3] as number) ? null : "[west, south, east, north] in degrees"),
  geometry: (v) => (toList(v) ? null : 'a shape type such as "Polygon", or a list'),
  fields: (v) => (isStrings(v) ? null : "a list of field names"),
  features: (v) => (isRange(v) ? null : "{ min?, max? }"),
  columns: (v) => (isStrings(v) ? null : "a list of column names"),
  rows: (v) => (isRange(v) ? null : "{ min?, max? }"),
  notEmpty: (v) => (isStrings(v) ? null : "a list of column names"),
  unique: (v) => (isStrings(v) ? null : "a list of column names that together identify a row"),
  numeric: (v) => (typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0 && Object.values(v).every((r) => isRange(r) || (typeof r === "object" && r !== null && Object.keys(r).length === 0)) ? null : "{ column: { min?, max? } }"),
  sorted: (v) => (typeof v === "string" && v.trim() ? null : "a column name"),
  points: (v) => (isRange(v) ? null : "{ min?, max? }"),
  variables: (v) => (isStrings(v) ? null : "a list of variable names"),
  groups: (v) => (isStrings(v) ? null : "a list of top-level group names"),
  run: (v) =>
    typeof v === "object" && v !== null && !Array.isArray(v) && Object.keys(v).length > 0 && Object.entries(v).every(([k, x]) => (k === "stable" ? x === true : k === "maxWselError" ? isRange(x) : k === "solutionContains" ? typeof x === "string" && x.length > 0 : false))
      ? null
      : "{ stable?: true, solutionContains?: text, maxWselError?: { max } }",
  minBytes: (v) => (parseSize(v) !== null ? null : 'a size such as 1024 or "5MB"'),
  maxBytes: (v) => (parseSize(v) !== null ? null : 'a size such as 1024 or "500MB"'),
};

export function parseConfig(text: string): { checks: Check[]; problems: string[] } {
  const problems: string[] = [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    return { checks: [], problems: [`${CONFIG_PATH} is not valid JSON: ${(err as Error).message}`] };
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { checks: [], problems: [`${CONFIG_PATH} must be a JSON object with a "checks" list.`] };
  const top = raw as Record<string, unknown>;
  for (const k of Object.keys(top)) if (!KNOWN_TOP.has(k)) problems.push(`unknown key "${k}" (known: version, checks)`);
  if (top.version !== undefined && top.version !== 1) problems.push(`"version" must be 1, not ${JSON.stringify(top.version)}`);
  if (!Array.isArray(top.checks)) return { checks: [], problems: [...problems, '"checks" must be a list'] };
  if (top.checks.length > MAX_CHECKS) problems.push(`at most ${MAX_CHECKS} checks (there are ${top.checks.length})`);

  const checks: Check[] = [];
  top.checks.slice(0, MAX_CHECKS).forEach((c, i) => {
    const at = `checks[${i}]`;
    if (typeof c !== "object" || c === null || Array.isArray(c)) return void problems.push(`${at} must be an object`);
    const o = c as Record<string, unknown>;
    for (const k of Object.keys(o)) if (!KNOWN_CHECK.has(k)) problems.push(`${at}: unknown key "${k}" (known: ${[...KNOWN_CHECK].join(", ")})`);
    if (o.severity !== undefined && o.severity !== "error" && o.severity !== "warn") problems.push(`${at}.severity must be "error" or "warn"`);
    const files = o.files === undefined ? null : toList(o.files);
    if (o.files !== undefined && !files) problems.push(`${at}.files must be a path pattern or a list of them`);
    const need = o.require === undefined ? [] : toList(o.require);
    if (o.require !== undefined && !need) problems.push(`${at}.require must be a path pattern or a list of them`);
    const forbid = o.forbid === undefined ? [] : toList(o.forbid);
    if (o.forbid !== undefined && !forbid) problems.push(`${at}.forbid must be a path pattern or a list of them`);
    const expect = (o.expect ?? {}) as Expect;
    if (o.expect !== undefined && (typeof o.expect !== "object" || o.expect === null || Array.isArray(o.expect))) problems.push(`${at}.expect must be an object`);
    else {
      for (const [k, v] of Object.entries(expect)) {
        const shape = SHAPES[k];
        if (!shape) problems.push(`${at}.expect: unknown expectation "${k}" (known: ${Object.keys(SHAPES).join(", ")})`);
        else {
          const why = shape(v);
          if (why) problems.push(`${at}.expect.${k} must be ${why}`);
        }
      }
    }
    if (Object.keys(expect).length && !files) problems.push(`${at}: "expect" needs "files" to say which files it applies to`);
    if (!Object.keys(expect).length && !(need && need.length) && !(forbid && forbid.length)) problems.push(`${at}: does nothing; give it "expect", "require" or "forbid"`);
    checks.push({
      name: typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 80) : `Check ${i + 1}`,
      files,
      severity: o.severity === "warn" ? "warn" : "error",
      require: need ?? [],
      forbid: forbid ?? [],
      expect,
    });
  });
  return { checks, problems };
}

// ── Judging ──────────────────────────────────────────────────────────────────

const inRange = (n: number, r: Range) => (r.min === undefined || n >= r.min) && (r.max === undefined || n <= r.max);
const rangeText = (r: Range) => (r.min !== undefined && r.max !== undefined ? `between ${r.min} and ${r.max}` : r.min !== undefined ? `at least ${r.min}` : `at most ${r.max}`);
const rasterType = (r: NonNullable<Facts["raster"]>) => `${r.sampleFormat === "float" ? "float" : r.sampleFormat === "int" ? "int" : "uint"}${r.bitsPerSample}`;

type Verdict = { applies: boolean; problems: string[] };
const skip: Verdict = { applies: false, problems: [] };
const ok: Verdict = { applies: true, problems: [] };
const bad = (...problems: string[]): Verdict => ({ applies: true, problems });

/** Column values of a CSV, read once per file when an expectation needs them. */
async function readTable(ctx: Ctx, repo: RepoRow, f: Facts): Promise<{ header: string[]; rows: string[][] } | null> {
  if (!f.path.toLowerCase().endsWith(".csv") || f.size > MAX_CSV_BYTES) return null;
  const text = (await new BlobReader(ctx, getObject<BlobObject>(ctx, repo, f.blob, "blob")).readAll()).toString("utf8");
  const parsed = parseCsv(text, sniffDelimiter(text));
  return { header: (parsed[0] ?? []).map((c) => c.trim()), rows: parsed.slice(1) };
}

type Judge = (value: any, f: Facts, table: () => Promise<{ header: string[]; rows: string[][] } | null>) => Promise<Verdict> | Verdict;

const JUDGES: Record<string, Judge> = {
  crs: (v, f) => {
    const want = (Array.isArray(v) ? v : [v]) as number[];
    const have = f.raster ? f.raster.epsg : f.vector ? f.vector.epsg : f.pointCloud ? f.pointCloud.epsg : undefined;
    if (have === undefined) return skip;
    return have !== null && want.includes(have) ? ok : bad(`coordinate system is ${have === null ? "not declared" : `EPSG:${have}`}, expected ${want.map((e) => `EPSG:${e}`).join(" or ")}`);
  },
  nodata: (v, f) => {
    if (!f.raster) return skip;
    const have = f.raster.nodata;
    if (v === "defined") return have !== null ? ok : bad("no nodata value is declared");
    return have === v ? ok : bad(`nodata is ${have === null ? "not declared" : have}, expected ${v}`);
  },
  cellSize: (v: Range, f) => {
    if (!f.raster) return skip;
    const s = f.raster.pixelScale;
    if (!s) return bad("cell size is not recorded");
    const sizes = [Math.abs(s[0]), Math.abs(s[1])];
    return sizes.every((n) => inRange(n, v)) ? ok : bad(`cell size is ${sizes[0]} x ${sizes[1]}, expected ${rangeText(v)}`);
  },
  width: (v: Range, f) => (!f.raster ? skip : inRange(f.raster.width, v) ? ok : bad(`width is ${f.raster.width} cells, expected ${rangeText(v)}`)),
  height: (v: Range, f) => (!f.raster ? skip : inRange(f.raster.height, v) ? ok : bad(`height is ${f.raster.height} cells, expected ${rangeText(v)}`)),
  dataType: (v, f) => {
    if (!f.raster) return skip;
    const want = (toList(v) ?? []).map((s) => s.toLowerCase());
    const have = rasterType(f.raster).toLowerCase();
    return want.includes(have) ? ok : bad(`data type is ${have}, expected ${want.join(" or ")}`);
  },
  cog: (_v, f) => {
    if (!f.raster) return skip;
    if (f.cog === null) return bad("the layout could not be read to judge Cloud-Optimised GeoTIFF");
    return f.cog.length === 0 ? ok : bad(`not Cloud-Optimised: ${f.cog.join("; ")}`);
  },
  within: (v: number[], f) => {
    if (!(f.raster || f.vector)) return skip;
    if (!f.extent) return bad("its location could not be placed (coordinate system not recognised)");
    const [w, s, e, n] = f.extent;
    return w >= v[0] && s >= v[1] && e <= v[2] && n <= v[3] ? ok : bad(`extent ${[w, s, e, n].map((x) => x.toFixed(3)).join(", ")} is not inside ${v.join(", ")}`);
  },
  geometry: (v, f) => {
    if (!f.vector) return skip;
    const want = (toList(v) ?? []).map((s) => s.toLowerCase());
    return want.includes(f.vector.shapeType.toLowerCase()) ? ok : bad(`geometry is ${f.vector.shapeType}, expected ${want.join(" or ")}`);
  },
  fields: (v: string[], f) => {
    if (!f.vector) return skip;
    const have = new Set(f.vector.fields.map((x) => x.name.toLowerCase()));
    const missing = v.filter((n) => !have.has(n.toLowerCase()));
    return missing.length ? bad(`missing field${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`) : ok;
  },
  features: (v: Range, f) => {
    if (!f.vector) return skip;
    if (f.vector.features === null) return bad("the feature count could not be read (no .dbf beside it)");
    return inRange(f.vector.features, v) ? ok : bad(`${f.vector.features} features, expected ${rangeText(v)}`);
  },
  columns: (v: string[], f) => {
    if (!f.table) return skip;
    const have = new Set(f.table.columns);
    const missing = v.filter((c) => !have.has(c));
    return missing.length ? bad(`missing column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`) : ok;
  },
  rows: (v: Range, f) => (!f.table ? skip : inRange(f.table.rows, v) ? ok : bad(`${f.table.rows} rows, expected ${rangeText(v)}`)),
  notEmpty: async (v: string[], f, table) => {
    if (!f.table) return skip;
    const t = await table();
    if (!t) return bad("too large to read for this check");
    const problems: string[] = [];
    for (const col of v) {
      const at = t.header.indexOf(col);
      if (at < 0) problems.push(`column ${col} is missing`);
      else {
        const blank = t.rows.reduce((n, r) => n + ((r[at] ?? "").trim() === "" ? 1 : 0), 0);
        if (blank) problems.push(`${blank} empty cell${blank === 1 ? "" : "s"} in ${col}`);
      }
    }
    return problems.length ? bad(...problems) : ok;
  },
  numeric: async (v: Record<string, Range>, f, table) => {
    if (!f.table) return skip;
    const t = await table();
    if (!t) return bad("too large to read for this check");
    const problems: string[] = [];
    for (const [col, range] of Object.entries(v)) {
      const at = t.header.indexOf(col);
      if (at < 0) {
        problems.push(`column ${col} is missing`);
        continue;
      }
      let notNumber = 0;
      let outside = 0;
      let first: number | null = null;
      for (let i = 0; i < t.rows.length; i++) {
        const cell = (t.rows[i][at] ?? "").trim();
        if (cell === "") continue;
        const n = Number(cell);
        if (!Number.isFinite(n)) notNumber++;
        else if (!inRange(n, range)) {
          outside++;
          if (first === null) first = i + 2;
        }
      }
      if (notNumber) problems.push(`${notNumber} value${notNumber === 1 ? "" : "s"} in ${col} ${notNumber === 1 ? "is" : "are"} not a number`);
      if (outside) problems.push(`${outside} value${outside === 1 ? "" : "s"} in ${col} outside ${rangeText(range)} (first at line ${first})`);
    }
    return problems.length ? bad(...problems) : ok;
  },
  unique: async (v: string[], f, table) => {
    if (!f.table) return skip;
    const t = await table();
    if (!t) return bad("too large to read for this check");
    const at = v.map((c) => t.header.indexOf(c));
    if (at.some((i) => i < 0)) return bad(`column ${v[at.findIndex((i) => i < 0)]} is missing`);
    const seen = new Set<string>();
    let dup = 0;
    for (const r of t.rows) {
      const key = at.map((i) => r[i] ?? "").join("\u0000");
      if (seen.has(key)) dup++;
      else seen.add(key);
    }
    return dup ? bad(`${dup} duplicate row${dup === 1 ? "" : "s"} by ${v.join(" + ")}`) : ok;
  },
  sorted: async (v: string, f, table) => {
    if (!f.table) return skip;
    const t = await table();
    if (!t) return bad("too large to read for this check");
    const at = t.header.indexOf(v);
    if (at < 0) return bad(`column ${v} is missing`);
    let prev = "";
    for (let i = 0; i < t.rows.length; i++) {
      const cell = (t.rows[i][at] ?? "").trim();
      if (cell === "") continue;
      if (prev !== "" && cell < prev) return bad(`${v} goes backwards at line ${i + 2} (${prev} then ${cell})`);
      prev = cell;
    }
    return ok;
  },
  points: (v: Range, f) => (!f.pointCloud ? skip : inRange(f.pointCloud.pointCount, v) ? ok : bad(`${f.pointCloud.pointCount} points, expected ${rangeText(v)}`)),
  variables: (v: string[], f) => {
    if (!f.netcdf) return skip;
    const have = new Set(f.netcdf.variables.map((x) => x.name));
    const missing = v.filter((n) => !have.has(n));
    return missing.length ? bad(`missing variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`) : ok;
  },
  groups: (v: string[], f) => {
    if (!f.hdf5) return skip;
    const have = new Set(f.hdf5.top);
    const missing = v.filter((n) => !have.has(n));
    return missing.length ? bad(`missing top-level group${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`) : ok;
  },
  run: (v: { stable?: true; solutionContains?: string; maxWselError?: Range }, f) => {
    if (!f.hdf5) return skip;
    const run = f.hdf5.run;
    if (!run) return bad("it has no Results summary, so the run status is unknown");
    const problems: string[] = [];
    if (v.stable && run.unstable) problems.push(`the run reports "${run.solution}"`);
    if (v.solutionContains && !(run.solution ?? "").toLowerCase().includes(v.solutionContains.toLowerCase())) problems.push(`solution status is "${run.solution ?? "not recorded"}", expected it to contain "${v.solutionContains}"`);
    if (v.maxWselError) {
      if (run.maxWselError === null) problems.push("no maximum WSEL error is recorded");
      else if (!inRange(run.maxWselError, v.maxWselError)) problems.push(`maximum WSEL error is ${run.maxWselError}, expected ${rangeText(v.maxWselError)}`);
    }
    return problems.length ? bad(...problems) : ok;
  },
  minBytes: (v, f) => {
    const min = parseSize(v)!;
    return f.size >= min ? ok : bad(`${f.size} bytes is smaller than ${min}`);
  },
  maxBytes: (v, f) => {
    const max = parseSize(v)!;
    return f.size <= max ? ok : bad(`${f.size.toLocaleString("en-US")} bytes is larger than ${max.toLocaleString("en-US")}`);
  },
};

// ── Running ──────────────────────────────────────────────────────────────────

export type CustomResult = { status: "passed" | "failed" | "skipped"; detail: string; files?: string[] } ;

/** Run the repository's own checks against one commit's tree, or say there are none. */
export async function runCustomChecks(ctx: Ctx, repo: RepoRow, commitId: string, tree: TreeObject): Promise<CustomResult> {
  const entry = tree.entries.find((e) => e.path === CONFIG_PATH);
  if (!entry) return { status: "skipped", detail: `No ${CONFIG_PATH}: the repository declares no checks of its own.` };
  const text = (await new BlobReader(ctx, getObject<BlobObject>(ctx, repo, entry.blob, "blob")).readAll()).toString("utf8");
  const { checks, problems } = parseConfig(text);
  if (problems.length) return { status: "failed", detail: `${CONFIG_PATH} has ${problems.length} ${problems.length === 1 ? "problem" : "problems"}.`, files: problems.slice(0, MAX_FINDINGS).map((p) => `${CONFIG_PATH}: ${p}`) };

  const paths = tree.entries.map((e) => e.path).filter((p) => p !== CONFIG_PATH);
  const findings: Finding[] = [];
  const facts = new Map<string, Facts | Error>();
  let evaluations = 0;
  let judged = 0;

  for (const check of checks) {
    const add = (file: string | null, message: string) => findings.push({ check: check.name, file, severity: check.severity, message });
    for (const pattern of check.require) if (!paths.some((p) => matchesAny([pattern], p))) add(null, `no file matches the required pattern ${pattern}`);
    for (const pattern of check.forbid) for (const p of paths.filter((x) => matchesAny([pattern], x))) add(p, `matches the forbidden pattern ${pattern}`);
    if (!check.files || !Object.keys(check.expect).length) continue;

    const matched = paths.filter((p) => matchesAny(check.files!, p));
    if (!matched.length) {
      add(null, `no file matches ${check.files.join(", ")}`);
      continue;
    }
    const applied = new Set<string>();
    for (const path of matched) {
      if (++evaluations > MAX_FILE_EVALUATIONS) {
        add(null, `stopped after ${MAX_FILE_EVALUATIONS} file evaluations`);
        break;
      }
      let f = facts.get(path);
      if (!f) {
        try {
          f = await fileInfo(ctx, repo, commitId, path, { history: false });
        } catch (err) {
          f = err as Error;
        }
        facts.set(path, f);
      }
      if (f instanceof Error) {
        add(path, `could not be read: ${f.message}`);
        continue;
      }
      let table: Promise<{ header: string[]; rows: string[][] } | null> | null = null;
      const readOnce = () => (table ??= readTable(ctx, repo, f as Facts));
      for (const [key, value] of Object.entries(check.expect)) {
        const verdict = await JUDGES[key](value, f, readOnce);
        if (verdict.applies) applied.add(key);
        judged++;
        for (const p of verdict.problems) add(path, `${key}: ${p}`);
      }
    }
    for (const key of Object.keys(check.expect)) {
      if (!applied.has(key)) add(null, `"${key}" applies to none of the ${matched.length} matched file${matched.length === 1 ? "" : "s"}, so it checked nothing`);
    }
  }

  const errors = findings.filter((f) => f.severity === "error");
  const warnings = findings.filter((f) => f.severity === "warn");
  const line = (f: Finding) => `${f.file ?? CONFIG_PATH}: [${f.check}] ${f.message}${f.severity === "warn" ? " (warning)" : ""}`;
  if (errors.length) {
    return {
      status: "failed",
      detail: `${errors.length} of ${checks.length} ${checks.length === 1 ? "check" : "checks"} found problems${warnings.length ? `, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.`,
      files: [...errors, ...warnings].slice(0, MAX_FINDINGS).map(line),
    };
  }
  return {
    status: "passed",
    detail: `${checks.length} ${checks.length === 1 ? "check" : "checks"} passed (${judged} file expectations judged)${warnings.length ? `; ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}.`,
    ...(warnings.length ? { files: warnings.slice(0, MAX_FINDINGS).map(line) } : {}),
  };
}
