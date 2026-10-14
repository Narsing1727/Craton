// How complete a repository's description of itself is, so people who publish data are nudged to say what it
// is, how it may be used and where it is. Pure: the same inputs always give the same list.

export type CompletenessInput = {
  description: string;
  license: string;
  topics?: string[];
  verticalDatum: number | null;
  nodata: number | null;
  footprint: number[] | null;
  hasRelease: boolean;
  hasReadme: boolean;
};

export type CompletenessItem = {
  id: "description" | "license" | "topics" | "readme" | "datum" | "nodata" | "footprint" | "release";
  label: string;
  done: boolean;
  /** What to do, in a sentence. */
  hint: string;
  /** Where to do it, relative to the repository's own path. */
  where: "settings" | "upload" | "releases/new";
};

export function repoCompleteness(r: CompletenessInput) {
  const items: CompletenessItem[] = [
    { id: "description", label: "Description", done: r.description.trim().length >= 10, hint: "Say in a sentence what this data is and what it is for.", where: "settings" },
    { id: "license", label: "Licence", done: r.license.trim().length > 0, hint: "Without a licence nobody can lawfully reuse the data.", where: "settings" },
    { id: "topics", label: "Topics", done: (r.topics?.length ?? 0) > 0, hint: "Topics are how people find this on Explore.", where: "settings" },
    { id: "readme", label: "README", done: r.hasReadme, hint: "Add a README.md describing the files, their source and known limits.", where: "upload" },
    { id: "datum", label: "Vertical datum", done: r.verticalDatum !== null, hint: "Elevations mean nothing without their datum (for example EPSG:5703).", where: "settings" },
    { id: "nodata", label: "Nodata value", done: r.nodata !== null, hint: "Declare the value that marks cells without data.", where: "settings" },
    { id: "footprint", label: "Located data", done: r.footprint !== null, hint: "Add a georeferenced GeoTIFF or shapefile so the repository can say where it is.", where: "upload" },
    { id: "release", label: "A release", done: r.hasRelease, hint: "Tag a release so a version can be cited and pinned.", where: "releases/new" },
  ];
  const done = items.filter((i) => i.done).length;
  return { items, done, total: items.length, percent: Math.round((done / items.length) * 100) };
}
