// schema.org "Dataset" markup for a public repository, as Google's Dataset Search asks for it
// (developers.google.com/search/docs/appearance/structured-data/dataset): name and description (50 to 5,000
// characters) are required; licence, creator, keywords, version, dates, spatial coverage and a download are
// recommended. Everything comes from facts the repository has; a field with nothing behind it is left out, never
// invented. Only metadata about the dataset is described, not its values.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { getObject } from "./history.ts";
import { footprintOf } from "./extent.ts";
import { dataTypesOf } from "../core/datatypes.ts";
import { LICENSES } from "./licenses.ts";
import type { CommitObject, TreeObject } from "../core/objects.ts";
import { config } from "../config.ts";

const MIN_DESCRIPTION = 50;
const MAX_DESCRIPTION = 5000;

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}

export async function datasetJsonLd(ctx: Ctx, repo: RepoRow): Promise<Record<string, unknown>> {
  const owner = ctx.db.prepare("SELECT handle, name, kind FROM owners WHERE id = ?").get(repo.owner_id) as { handle: string; name: string; kind: string };
  const url = `${config.webUrl}/${owner.handle}/${repo.name}`;
  const release = ctx.db.prepare("SELECT tag, created_at FROM releases WHERE repo_id = ? AND prerelease = 0 ORDER BY id DESC LIMIT 1").get(repo.id) as { tag: string; created_at: string } | undefined;
  const head = ctx.db.prepare("SELECT commit_id FROM refs WHERE repo_id = ? AND kind = 'branch' AND name = ?").get(repo.id, repo.default_branch) as { commit_id: string } | undefined;

  let paths: string[] = [];
  let bytes = 0;
  let spatial: number[] | null = null;
  if (head) {
    const commit = getObject<CommitObject>(ctx, repo, head.commit_id, "commit");
    const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
    paths = tree.entries.map((e) => e.path);
    bytes = tree.entries.reduce((n, e) => n + e.size, 0);
    try {
      spatial = (await footprintOf(ctx, repo, head.commit_id)).bbox;
    } catch {
      spatial = null;
    }
  }
  const types = dataTypesOf(paths);

  // A description of at least 50 characters from what is true; the owner's own words come first.
  const facts = [
    paths.length ? `${paths.length.toLocaleString("en-US")} ${paths.length === 1 ? "file" : "files"}, ${formatBytes(bytes)}` : null,
    types.length ? `data types: ${types.join(", ")}` : null,
    repo.crs ? `coordinate system ${repo.crs}` : null,
  ].filter(Boolean);
  const own = (repo.description ?? "").trim();
  let description = own;
  const generated = `${repo.name} is a geospatial dataset kept under version control on Craton${facts.length ? ` (${facts.join("; ")})` : ""}. Every version is recorded with a Merkle root, so a copy can be checked against it.`;
  if (description.length < MIN_DESCRIPTION) description = own ? `${own.replace(/\.+$/, "")}. ${generated}` : generated;
  description = description.slice(0, MAX_DESCRIPTION);

  const licence = repo.license && repo.license !== "proprietary" ? LICENSES.find((l) => l.id === repo.license) : undefined;
  const topics = JSON.parse(repo.topics) as string[];
  const ld: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${owner.handle}/${repo.name}`,
    description,
    url,
    identifier: url,
    isAccessibleForFree: true,
    creator: { "@type": owner.kind === "org" ? "Organization" : "Person", name: owner.name || owner.handle, url: `${config.webUrl}/${owner.handle}` },
    includedInDataCatalog: { "@type": "DataCatalog", name: "Craton" },
    dateModified: repo.updated_at,
    datePublished: repo.created_at,
    distribution: [
      {
        "@type": "DataDownload",
        encodingFormat: "application/zip",
        contentUrl: `${url}/archive?ref=${encodeURIComponent(release?.tag ?? repo.default_branch)}`,
      },
    ],
  };
  const keywords = [...topics, ...types].filter((v, i, a) => a.indexOf(v) === i);
  if (keywords.length) ld.keywords = keywords;
  if (licence) ld.license = licence.url;
  if (release) ld.version = release.tag;
  if (spatial && spatial.length === 4) {
    // GeoShape box: "south west north east" (latitude then longitude of the lower corner, then of the upper corner).
    const [w, s, e, n] = spatial;
    ld.spatialCoverage = { "@type": "Place", geo: { "@type": "GeoShape", box: `${s} ${w} ${n} ${e}` } };
  }
  return ld;
}
