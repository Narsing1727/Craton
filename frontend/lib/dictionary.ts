// A data dictionary kept in the repository itself, in `.craton-dictionary.json` at the root, so it is versioned
// and reviewed like the data it describes:
//
//   { "gauges.csv": { "stage_m": { "description": "Water level above gauge datum", "unit": "m" } } }
//
// Tolerant on read (anything that isn't an object of objects is ignored), bounded on size.

export const DICTIONARY_FILE = ".craton-dictionary.json";

export type DictEntry = { description?: string; unit?: string };
export type Dictionary = Record<string, Record<string, DictEntry>>;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : undefined) || undefined;

export function parseDictionary(text: string | null | undefined): Dictionary {
  if (!text || text.length > 512 * 1024) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {};
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Dictionary = {};
  for (const [file, cols] of Object.entries(raw as Record<string, unknown>).slice(0, 500)) {
    if (!cols || typeof cols !== "object" || Array.isArray(cols)) continue;
    const entries: Record<string, DictEntry> = {};
    for (const [col, e] of Object.entries(cols as Record<string, unknown>).slice(0, 500)) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue;
      const description = clip((e as DictEntry).description, 500);
      const unit = clip((e as DictEntry).unit, 40);
      if (description || unit) entries[col] = { ...(description ? { description } : {}), ...(unit ? { unit } : {}) };
    }
    out[file] = entries;
  }
  return out;
}

/** One row per column of the file, in the file's own order, with what the dictionary says (or nothing). */
export function entriesFor(dict: Dictionary, path: string, columns: string[]) {
  const known = dict[path] ?? {};
  return columns.map((column) => ({ column, entry: known[column] ?? null }));
}

/** A dictionary with this file's columns added as blanks to fill in; descriptions already written are kept. */
export function starterDictionary(dict: Dictionary, path: string, columns: string[]): string {
  const merged: Dictionary = { ...dict };
  const known = merged[path] ?? {};
  merged[path] = Object.fromEntries(columns.map((c) => [c, known[c] ?? { description: "", unit: "" }]));
  return JSON.stringify(merged, null, 2) + "\n";
}

/**
 * The dictionary file text after editing one file's columns. Only columns with a description or a unit are kept;
 * entries for columns that are not in `columns` (a column since removed) and other files are left as they were.
 */
export function withEdits(dict: Dictionary, path: string, columns: string[], edits: Record<string, DictEntry>): string {
  const merged: Dictionary = {};
  for (const [file, cols] of Object.entries(dict)) merged[file] = { ...cols };
  const mine = { ...(merged[path] ?? {}) };
  for (const c of columns) {
    const description = (edits[c]?.description ?? "").trim().slice(0, 500);
    const unit = (edits[c]?.unit ?? "").trim().slice(0, 40);
    if (description || unit) mine[c] = { ...(description ? { description } : {}), ...(unit ? { unit } : {}) };
    else delete mine[c];
  }
  if (Object.keys(mine).length) merged[path] = mine;
  else delete merged[path];
  return JSON.stringify(merged, null, 2) + "\n";
}
