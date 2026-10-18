// What changed between two versions of a CSV table: columns added or removed, and rows added,
// removed or changed cell by cell. Rows are matched by a key (the first column, or pair of
// columns, whose values are unique in both versions: a station id, or station + timestamp), not
// by position, so inserting a row near the top doesn't make every row below it look changed.
// With no usable key, rows are compared by position and the result says so.

import type { Ctx } from "./context.ts";
import { badRequest, notFound } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { BlobReader } from "./chunks.ts";
import { getObject, resolveRef } from "./history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { parseCsv, sniffDelimiter } from "../core/csv.ts";

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ROWS = 200_000;
const SHOWN = { changed: 100, added: 50, removed: 50 };

export type CellChange = { column: string; before: string; after: string; delta: number | null };
export type TableDiff = {
  base: string;
  head: string;
  /** How rows were matched: by these columns, or by position when none was unique. */
  matchedBy: { kind: "key"; columns: string[] } | { kind: "position" };
  columns: { added: string[]; removed: string[]; common: string[] };
  rows: { before: number; after: number; added: number; removed: number; changed: number; unchanged: number };
  changed: { key: string; row: number; cells: CellChange[] }[];
  added: { key: string; row: number; values: Record<string, string> }[];
  removed: { key: string; row: number; values: Record<string, string> }[];
  /** True when more rows changed than are listed. */
  truncated: boolean;
};

type Table = { header: string[]; rows: string[][] };

function toTable(text: string): Table {
  const delimiter = sniffDelimiter(text);
  const all = parseCsv(text, delimiter);
  if (all.length > MAX_ROWS + 1) throw badRequest(`This table has more than ${MAX_ROWS.toLocaleString("en-US")} rows, which is too many to compare in the browser. Use the CLI.`);
  return { header: (all[0] ?? []).map((h) => h.trim()), rows: all.slice(1) };
}

const numeric = (s: string) => (s.trim() !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

/** A column of decimal numbers is a measurement (stage, discharge), not an identity: correcting a reading must not look like a different row. */
const isMeasurement = (t: Table, col: string) => {
  const i = t.header.indexOf(col);
  return t.rows.some((r) => /^[-+]?\d*\.\d+(e[-+]?\d+)?$/i.test((r[i] ?? "").trim()));
};

/**
 * The first single column, then pair, then triple of common, non-measurement columns whose values
 * are non-empty and unique in both tables, and mostly the same set in both (so it identifies rows
 * rather than being regenerated each time).
 */
function findKey(a: Table, b: Table, common: string[]): string[] | null {
  const idx = (t: Table, cols: string[]) => cols.map((c) => t.header.indexOf(c));
  const shared = (cols: string[]) => {
    const ids = (t: Table) => new Set(t.rows.map((r) => idx(t, cols).map((i) => r[i] ?? "").join("\u0000")));
    const x = ids(a), y = ids(b);
    const both = [...x].filter((k) => y.has(k)).length;
    return both >= 0.5 * Math.min(x.size, y.size);
  };
  const unique = (t: Table, cols: string[]) => {
    const at = idx(t, cols);
    const seen = new Set<string>();
    for (const row of t.rows) {
      const key = at.map((i) => row[i] ?? "").join("\u0000");
      if (at.every((i) => (row[i] ?? "") === "") || seen.has(key)) return false;
      seen.add(key);
    }
    return true;
  };
  const front = common.filter((c) => !isMeasurement(a, c) && !isMeasurement(b, c)).slice(0, 5);
  const candidates: string[][] = [];
  for (const c of front) candidates.push([c]);
  for (let i = 0; i < front.length; i++) for (let j = i + 1; j < front.length; j++) candidates.push([front[i], front[j]]);
  for (let i = 0; i < front.length; i++) for (let j = i + 1; j < front.length; j++) for (let k = j + 1; k < front.length; k++) candidates.push([front[i], front[j], front[k]]);
  return candidates.find((cols) => unique(a, cols) && unique(b, cols) && shared(cols)) ?? null;
}

export function diffTables(base: string, head: string, before: string, after: string): TableDiff {
  const a = toTable(before), b = toTable(after);
  const common = a.header.filter((h) => b.header.includes(h));
  const columns = { added: b.header.filter((h) => !a.header.includes(h)), removed: a.header.filter((h) => !b.header.includes(h)), common };
  const key = common.length ? findKey(a, b, common) : null;

  const at = (t: Table, cols: string[]) => cols.map((c) => t.header.indexOf(c));
  const valuesOf = (t: Table, row: string[]) => Object.fromEntries(t.header.map((h, i) => [h, row[i] ?? ""]));
  const rowKey = (t: Table, row: string[], i: number) => (key ? at(t, key).map((k) => row[k] ?? "").join(" · ") : `row ${i + 1}`);

  const changed: TableDiff["changed"] = [], added: TableDiff["added"] = [], removed: TableDiff["removed"] = [];
  let nChanged = 0, nAdded = 0, nRemoved = 0, nSame = 0;

  const compare = (ra: string[], rb: string[]) => {
    const cells: CellChange[] = [];
    for (const c of common) {
      const x = ra[a.header.indexOf(c)] ?? "", y = rb[b.header.indexOf(c)] ?? "";
      if (x === y) continue;
      const nx = numeric(x), ny = numeric(y);
      cells.push({ column: c, before: x, after: y, delta: nx !== null && ny !== null ? Math.round((ny - nx) * 1e6) / 1e6 : null });
    }
    return cells;
  };

  if (key) {
    const ka = at(a, key), kb = at(b, key);
    const old = new Map<string, number>();
    a.rows.forEach((row, i) => old.set(ka.map((k) => row[k] ?? "").join("\u0000"), i));
    const seen = new Set<string>();
    b.rows.forEach((row, i) => {
      const id = kb.map((k) => row[k] ?? "").join("\u0000");
      seen.add(id);
      const j = old.get(id);
      if (j === undefined) {
        nAdded++;
        if (added.length < SHOWN.added) added.push({ key: rowKey(b, row, i), row: i + 2, values: valuesOf(b, row) });
        return;
      }
      const cells = compare(a.rows[j], row);
      if (!cells.length) return void nSame++;
      nChanged++;
      if (changed.length < SHOWN.changed) changed.push({ key: rowKey(b, row, i), row: i + 2, cells });
    });
    a.rows.forEach((row, i) => {
      const id = ka.map((k) => row[k] ?? "").join("\u0000");
      if (seen.has(id)) return;
      nRemoved++;
      if (removed.length < SHOWN.removed) removed.push({ key: rowKey(a, row, i), row: i + 2, values: valuesOf(a, row) });
    });
  } else {
    const n = Math.max(a.rows.length, b.rows.length);
    for (let i = 0; i < n; i++) {
      const ra = a.rows[i], rb = b.rows[i];
      if (!ra && rb) {
        nAdded++;
        if (added.length < SHOWN.added) added.push({ key: `row ${i + 1}`, row: i + 2, values: valuesOf(b, rb) });
      } else if (ra && !rb) {
        nRemoved++;
        if (removed.length < SHOWN.removed) removed.push({ key: `row ${i + 1}`, row: i + 2, values: valuesOf(a, ra) });
      } else {
        const cells = compare(ra, rb);
        if (!cells.length) nSame++;
        else {
          nChanged++;
          if (changed.length < SHOWN.changed) changed.push({ key: `row ${i + 1}`, row: i + 2, cells });
        }
      }
    }
  }

  return {
    base,
    head,
    matchedBy: key ? { kind: "key", columns: key } : { kind: "position" },
    columns,
    rows: { before: a.rows.length, after: b.rows.length, added: nAdded, removed: nRemoved, changed: nChanged, unchanged: nSame },
    changed,
    added,
    removed,
    truncated: nChanged > changed.length || nAdded > added.length || nRemoved > removed.length,
  };
}

async function entryAt(ctx: Ctx, repo: RepoRow, commitId: string, path: string) {
  const commit = await getObject<CommitObject>(ctx, repo, commitId, "commit");
  return (await getObject<TreeObject>(ctx, repo, commit.tree, "tree")).entries.find((e) => e.path === path) ?? null;
}

/** Identity of a table comparison, without reading anything: the two blobs. Used for the HTTP ETag. */
export async function tableDiffKey(ctx: Ctx, repo: RepoRow, base: string, head: string, path: string): Promise<string | null> {
  const a = await entryAt(ctx, repo, await resolveRef(ctx, repo, base), path), b = await entryAt(ctx, repo, await resolveRef(ctx, repo, head), path);
  return a && b ? `table:${a.blob}:${b.blob}` : null;
}

export async function tableDiff(ctx: Ctx, repo: RepoRow, base: string, head: string, path: string): Promise<TableDiff> {
  if (!/\.(csv|tsv)$/i.test(path)) throw badRequest("Table comparison works for .csv and .tsv files.");
  const baseId = await resolveRef(ctx, repo, base), headId = await resolveRef(ctx, repo, head);
  const a = await entryAt(ctx, repo, baseId, path), b = await entryAt(ctx, repo, headId, path);
  if (!a || !b) throw notFound(`${path} in both versions`);
  const read = async (blobId: string) => {
    const blob = await getObject<BlobObject>(ctx, repo, blobId, "blob");
    if (blob.size > MAX_BYTES) throw badRequest(`This table is over ${MAX_BYTES / 1024 / 1024} MB, which is too large to compare in the browser. Use the CLI.`);
    return (await new BlobReader(ctx, blob).readAll()).toString("utf8");
  };
  const [before, after] = await Promise.all([read(a.blob), read(b.blob)]);
  return diffTables(baseId, headId, before, after);
}
