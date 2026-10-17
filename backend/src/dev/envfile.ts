// Reading and updating a KEY=value settings file (backend/.env) without disturbing what else is in it.

/** `text` with `values` set: a key already present is replaced in place, a new one is added at the end. */
export function upsertEnv(text: string, values: Record<string, string>): string {
  const lines = text.length ? text.replace(/\r\n/g, "\n").split("\n") : [];
  const pending = new Map(Object.entries(values));
  const out = lines.map((line) => {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (m && pending.has(m[1])) {
      const v = pending.get(m[1])!;
      pending.delete(m[1]);
      return `${m[1]}=${quote(v)}`;
    }
    return line;
  });
  while (out.length && out[out.length - 1] === "") out.pop();
  for (const [k, v] of pending) out.push(`${k}=${quote(v)}`);
  return out.join("\n") + "\n";
}

/** Plain values stay bare; anything with spaces, quotes or # is quoted so the loader reads it back unchanged. */
function quote(v: string): string {
  return /^[A-Za-z0-9_./:@+-]*$/.test(v) ? v : JSON.stringify(v);
}

/** The values in a settings file, by name (comments and blank lines ignored). */
export function readEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.startsWith('"') && v.endsWith('"')) {
      try {
        v = JSON.parse(v);
      } catch {}
    }
    out[m[1]] = v;
  }
  return out;
}
