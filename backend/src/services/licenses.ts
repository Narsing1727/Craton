// Licences a repository can declare. Open-data licences first, since that is what shared hydro and
// GIS datasets use; "proprietary" means all rights reserved. The ids are SPDX identifiers (the
// ones GitHub, Hugging Face and CITATION.cff all use), so they can be passed on unchanged.

export const LICENSES = [
  { id: "CC0-1.0", name: "CC0 1.0 (public domain dedication)", url: "https://creativecommons.org/publicdomain/zero/1.0/" },
  { id: "CC-BY-4.0", name: "Creative Commons Attribution 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  { id: "CC-BY-SA-4.0", name: "Creative Commons Attribution-ShareAlike 4.0", url: "https://creativecommons.org/licenses/by-sa/4.0/" },
  { id: "ODbL-1.0", name: "Open Database License 1.0", url: "https://opendatacommons.org/licenses/odbl/1-0/" },
  { id: "ODC-By-1.0", name: "Open Data Commons Attribution 1.0", url: "https://opendatacommons.org/licenses/by/1-0/" },
  { id: "PDDL-1.0", name: "Open Data Commons Public Domain Dedication 1.0", url: "https://opendatacommons.org/licenses/pddl/1-0/" },
  { id: "OGL-UK-3.0", name: "Open Government Licence v3.0 (UK)", url: "https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/" },
  { id: "MIT", name: "MIT", url: "https://spdx.org/licenses/MIT.html" },
  { id: "Apache-2.0", name: "Apache 2.0", url: "https://www.apache.org/licenses/LICENSE-2.0" },
  { id: "proprietary", name: "All rights reserved", url: null },
] as const;

export const licenseIds = new Set<string>(LICENSES.map((l) => l.id));
export const licenseById = (id: string) => LICENSES.find((l) => l.id === id) ?? null;

const TOPIC = /^[a-z0-9][a-z0-9-]{0,29}$/;

/** Normalise a topic list: lowercase, trimmed, de-duplicated, at most ten, each a short slug. */
export function cleanTopics(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const out: string[] = [];
  for (const raw of input) {
    const t = String(raw).trim().toLowerCase().replace(/\s+/g, "-");
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

export function invalidTopic(topics: string[]): string | null {
  if (topics.length > 10) return "Use at most ten topics.";
  const bad = topics.find((t) => !TOPIC.test(t));
  return bad ? `“${bad}” isn’t a valid topic. Use lowercase letters, numbers and dashes, up to 30 characters.` : null;
}
