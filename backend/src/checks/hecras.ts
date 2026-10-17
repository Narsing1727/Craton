// What a HEC-RAS plan results file says about its own run, from the attributes of the groups under Results/*/Summary.
//
// HEC-RAS writes the solution status, the computation time, the largest water-surface error and the run window as
// attributes of `/Results/Unsteady/Summary` (steady plans: `/Results/Steady/Summary`), and mass-balance figures under a
// `Volume Accounting` group. Attribute spellings differ a little between versions and the community documentation does
// not agree on all of them, so names are matched loosely (case, spacing, punctuation) and everything that matched is
// reported as the file wrote it. Nothing here guesses a number: a field that is not there is null.

import type { Hdf5Object, AttributeValue } from "./hdf5.ts";

export type RunSummary = {
  /** The group the figures came from, such as "/Results/Unsteady/Summary". */
  group: string;
  /** Solution status as written ("Unsteady Finished Successfully", "Unsteady Went Unstable"). */
  solution: string | null;
  /** True when the status says the run became unstable. */
  unstable: boolean;
  /** Largest water-surface error the run reported, in the model's own length unit. */
  maxWselError: number | null;
  /** Total computation time as written ("00:00:12", or seconds). */
  computeTotal: string | null;
  /** Wall-clock run window as written. */
  runWindow: string | null;
  /** Peak CPU cores used. */
  cores: number | null;
  /** When the solution went unstable, as written, if it did. */
  unstableAt: string | null;
  /** Mass-balance figures from Volume Accounting groups, as written: "group :: name" to value. */
  volume: { group: string; name: string; value: AttributeValue }[];
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

function find(attrs: Record<string, AttributeValue>, test: (n: string) => boolean): AttributeValue | null {
  for (const [name, value] of Object.entries(attrs)) if (test(norm(name))) return value;
  return null;
}

const asText = (v: AttributeValue | null) => (v === null ? null : Array.isArray(v) ? v.join(", ") : String(v));
const asNumber = (v: AttributeValue | null) => {
  if (v === null) return null;
  const n = Array.isArray(v) ? v[0] : typeof v === "number" ? v : Number.parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

/** The run summary of a results file, or null when the file has no Results summary group (a geometry file, other HDF5). */
export function summarizeRun(objects: Hdf5Object[]): RunSummary | null {
  const summaries = objects.filter((o) => o.kind === "group" && o.attributes && /^\/Results\/(Unsteady|Steady)\/Summary$/i.test(o.path));
  if (!summaries.length) return null;
  // An unsteady plan wins over a steady one when a file somehow holds both.
  const group = summaries.find((o) => /\/Unsteady\//i.test(o.path)) ?? summaries[0];
  const a = group.attributes!;
  const solution = asText(find(a, (n) => n === "solution" || n === "solution status"));
  const unstableText = asText(find(a, (n) => /(time|timestamp).*(unstable)|unstable.*(time|timestamp)/.test(n)));
  const volume: RunSummary["volume"] = [];
  for (const o of objects) {
    if (o.kind !== "group" || !o.attributes || !/Volume Accounting/i.test(o.path)) continue;
    for (const [name, value] of Object.entries(o.attributes).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0))) volume.push({ group: o.path, name, value });
  }
  return {
    group: group.path,
    solution,
    unstable: Boolean(solution && /unstable/i.test(solution)),
    maxWselError: asNumber(find(a, (n) => /max.*(wsel|water surface|wse).*error|(wsel|water surface|wse).*error.*max|^maximum wsel error$/.test(n))),
    computeTotal: asText(find(a, (n) => /computation time total|total computation time|compute time total/.test(n))),
    runWindow: asText(find(a, (n) => /run time window|run window/.test(n))),
    cores: asNumber(find(a, (n) => /(max|maximum).*cores|cores.*(max|used)/.test(n))),
    unstableAt: unstableText,
    volume: volume.slice(0, 24),
  };
}
