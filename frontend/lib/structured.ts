// What a plain-text model file is made of, so a viewer can show its outline instead of one long block: a SWMM input file is `[SECTIONS]` of
// rows, and a HEC-RAS project, plan, flow or geometry file is mostly `Key=Value` settings (with data rows between them).

export type Section = { name: string; line: number; rows: number; sample: string[] };
export type Pair = { key: string; value: string; line: number };
export type Structure = { kind: "sections"; sections: Section[] } | { kind: "pairs"; pairs: Pair[]; total: number; others: number };

const MAX_PAIRS = 400;

/** Files whose lines are mostly `Key=Value` settings: HEC-RAS (project, plan, geometry, flow, run files) and the usual configuration formats. */
const SETTINGS_FILE = /\.(?:[a-z]\d\d|prj|ini|cfg|conf|properties|env)$/i;

export function structureOf(text: string, name = ""): Structure | null {
  const lines = text.split(/\r?\n/);

  // SWMM-style: lines that are `[NAME]` start a section; `;` starts a comment.
  const sections: Section[] = [];
  let at: Section | null = null;
  lines.forEach((raw, i) => {
    const line = raw.trim();
    const head = /^\[([A-Za-z_ ]{2,32})\]$/.exec(line);
    if (head) {
      at = { name: head[1], line: i + 1, rows: 0, sample: [] };
      sections.push(at);
    } else if (at && line && !line.startsWith(";")) {
      at.rows++;
      if (at.sample.length < 6) at.sample.push(line);
    }
  });
  if (sections.length >= 2) return { kind: "sections", sections };

  // Key=Value settings, in the kinds of file that are made of them (a script also has `x=1` lines, and is not a settings file).
  if (!SETTINGS_FILE.test(name)) return null;
  const pairs: Pair[] = [];
  let content = 0;
  let total = 0;
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    content++;
    const m = /^([^=\r\n,]{1,64})=(.*)$/.exec(raw);
    if (m && !raw.startsWith(" ") && !raw.startsWith(";") && !raw.startsWith("#")) {
      total++;
      if (pairs.length < MAX_PAIRS) pairs.push({ key: m[1].trim(), value: m[2].trim(), line: i + 1 });
    }
  });
  if (total >= 3) return { kind: "pairs", pairs, total, others: content - total };
  return null;
}

/** The kind of file a name says it is, for choosing a viewer: markdown, JSON, or just text. */
export function textKind(name: string): "markdown" | "json" | "text" {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "json" || ext === "geojson" || ext === "topojson") return "json";
  return "text";
}
