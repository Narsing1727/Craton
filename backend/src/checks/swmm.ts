// Structural checks on a SWMM5 input (.inp) file, the kind of mistake the engine only reports after a run (or, worse,
// runs through): a conduit between nodes that do not exist, a zero or negative length, an elevation drop larger than
// the pipe is long, two nodes with one name. These are the engine's own error conditions (SWMM's "elevation drop
// exceeds conduit length", "conduits cannot have zero or negative lengths", a name used by more than one object), read
// without running it.
//
// It is deliberately small: the sections below are enough for the rules, and anything it does not understand it
// leaves alone rather than guessing.

export type SwmmReport = { nodes: number; links: number; problems: string[] };

const NODE_SECTIONS = new Set(["JUNCTIONS", "OUTFALLS", "STORAGE", "DIVIDERS"]);
/** Link sections whose rows begin "name from-node to-node". */
const LINK_SECTIONS = new Set(["CONDUITS", "PUMPS", "ORIFICES", "WEIRS", "OUTLETS"]);

function sections(text: string): Map<string, string[][]> {
  const out = new Map<string, string[][]>();
  let current: string[][] | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    const head = line.match(/^\[([A-Za-z_]+)\]$/);
    if (head) {
      const name = head[1].toUpperCase();
      current = out.get(name) ?? [];
      out.set(name, current);
      continue;
    }
    current?.push(line.split(/\s+/));
  }
  return out;
}

export function checkSwmm(text: string): SwmmReport {
  const problems: string[] = [];
  const s = sections(text);

  // Nodes: name -> invert elevation (the second column of every node section).
  const invert = new Map<string, number>();
  const seen = new Map<string, string>();
  for (const sec of NODE_SECTIONS) {
    for (const row of s.get(sec) ?? []) {
      const [name, elev] = row;
      if (!name) continue;
      if (seen.has(name)) problems.push(`Node ${name} is defined twice (${seen.get(name)} and ${sec.toLowerCase()})`);
      else seen.set(name, sec.toLowerCase());
      const e = Number(elev);
      if (Number.isFinite(e)) invert.set(name, e);
    }
  }

  // Link offsets are depths above the node invert unless [OPTIONS] says LINK_OFFSETS ELEVATION.
  const optionRow = (s.get("OPTIONS") ?? []).find((r) => r[0]?.toUpperCase() === "LINK_OFFSETS");
  const offsetsAreElevations = optionRow?.[1]?.toUpperCase() === "ELEVATION";

  let links = 0;
  const linkNames = new Set<string>();
  for (const sec of LINK_SECTIONS) {
    for (const row of s.get(sec) ?? []) {
      const [name, from, to] = row;
      if (!name || !from || !to) continue;
      links++;
      if (linkNames.has(name)) problems.push(`Link ${name} is defined twice`);
      linkNames.add(name);
      for (const end of [from, to]) if (!seen.has(end)) problems.push(`${sec === "CONDUITS" ? "Conduit" : "Link"} ${name} uses node ${end}, which is not defined`);
    }
  }

  for (const row of s.get("CONDUITS") ?? []) {
    const [name, from, to, lengthText, , inOffText, outOffText] = row;
    if (!name || !from || !to) continue;
    const length = Number(lengthText);
    if (Number.isFinite(length) && length <= 0) {
      problems.push(`Conduit ${name} has a length of ${lengthText}; a conduit needs a positive length`);
      continue;
    }
    const up = invert.get(from);
    const down = invert.get(to);
    if (up === undefined || down === undefined || !Number.isFinite(length)) continue;
    const inOff = Number(inOffText ?? 0) || 0;
    const outOff = Number(outOffText ?? 0) || 0;
    const drop = offsetsAreElevations ? inOff - outOff : up + inOff - (down + outOff);
    if (drop > length) problems.push(`Conduit ${name} drops ${drop.toFixed(2)} over a length of ${length}; the drop cannot exceed the length (check the length, the invert elevations and the offsets)`);
  }

  // A subcatchment's outlet must be one thing: a node or another subcatchment, not both.
  const subs = new Set((s.get("SUBCATCHMENTS") ?? []).map((r) => r[0]).filter(Boolean));
  for (const row of s.get("SUBCATCHMENTS") ?? []) {
    const [name, , outlet] = row;
    if (name && outlet && seen.has(outlet) && subs.has(outlet)) problems.push(`Subcatchment ${name} drains to ${outlet}, which is both a node and a subcatchment`);
  }

  return { nodes: seen.size, links, problems };
}
