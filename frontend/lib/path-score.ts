// Ranking for the Go to file finder: how well a typed query matches a file path.

/**
 * How well `query` matches `path`, or null for no match. Letters must appear in order; matches in
 * the file name beat matches in folders, runs of consecutive letters beat scattered ones, and a
 * shorter path wins a tie.
 */
export function scorePath(query: string, path: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return 0;
  const lower = path.toLowerCase();
  const nameStart = lower.lastIndexOf("/") + 1;
  let score = 0, at = 0, run = 0;
  for (const ch of q) {
    const found = lower.indexOf(ch, at);
    if (found < 0) return null;
    run = found === at && at > 0 ? run + 1 : 0;
    score += 1 + run * 2 + (found >= nameStart ? 3 : 0) + (found === 0 || "/._-".includes(lower[found - 1]) ? 2 : 0);
    at = found + 1;
  }
  if (lower.slice(nameStart).includes(q)) score += 25; // the whole query sits in the file name
  return score - path.length * 0.05;
}
