// "Cite this repository": APA, BibTeX and CITATION.cff for a dataset, built only from facts the
// repository really has (owner, name, description, licence, topics, latest release, head commit).
// If the repository ships its own CITATION.cff, that file is returned as written and its fields
// win. Nothing is invented: no DOI unless the file gives one, no authors beyond the owner.

import type { Ctx } from "./context.ts";
import type { RepoRow } from "./repos.ts";
import { BlobReader } from "./chunks.ts";
import { getObject } from "./history.ts";
import type { BlobObject, CommitObject, TreeObject } from "../core/objects.ts";
import { config } from "../config.ts";

export type Citation = {
  source: "generated" | "CITATION.cff";
  cff: string;
  bibtex: string;
  apa: string;
  /** Things that would make the citation better, in plain words. */
  hints: string[];
};

type Fields = {
  title: string;
  authors: string[];
  version?: string;
  released: string; // YYYY-MM-DD
  doi?: string;
  license?: string;
  url: string;
  abstract?: string;
  keywords: string[];
  commit?: string;
};

const yamlQuote = (s: string) => JSON.stringify(s); // JSON strings are valid YAML double-quoted scalars

function toCff(f: Fields): string {
  const lines = [
    "cff-version: 1.2.0",
    "message: If you use this dataset, please cite it as below.",
    "type: dataset",
    `title: ${yamlQuote(f.title)}`,
    "authors:",
    ...f.authors.map((a) => `  - name: ${yamlQuote(a)}`),
  ];
  if (f.version) lines.push(`version: ${yamlQuote(f.version)}`);
  lines.push(`date-released: ${f.released}`);
  if (f.doi) lines.push(`doi: ${yamlQuote(f.doi)}`);
  if (f.license) lines.push(`license: ${f.license}`);
  lines.push(`url: ${yamlQuote(f.url)}`);
  if (f.commit) lines.push(`commit: ${f.commit}`);
  if (f.abstract) lines.push(`abstract: ${yamlQuote(f.abstract)}`);
  if (f.keywords.length) lines.push("keywords:", ...f.keywords.map((k) => `  - ${yamlQuote(k)}`));
  return `${lines.join("\n")}\n`;
}

const bibEscape = (s: string) => s.replace(/[&%$#_]/g, (c) => `\\${c}`);

function toBibtex(f: Fields): string {
  const key = (f.authors[0] ?? "craton").toLowerCase().replace(/[^a-z0-9]+/g, "") + f.released.slice(0, 4) + f.title.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12);
  const rows: [string, string][] = [
    ["author", f.authors.map(bibEscape).join(" and ")],
    ["title", `{${bibEscape(f.title)}}`],
    ["year", f.released.slice(0, 4)],
    ["publisher", "Craton"],
    ["howpublished", `\\url{${f.url}}`],
  ];
  if (f.version) rows.push(["version", f.version]);
  if (f.doi) rows.push(["doi", f.doi]);
  rows.push(["note", `Dataset${f.license ? `, licence ${f.license}` : ""}${f.commit ? `, commit ${f.commit.slice(0, 12)}` : ""}`]);
  return `@misc{${key},\n${rows.map(([k, v]) => `  ${k} = {${v.replace(/^\{(.*)\}$/, "$1")}}`).join(",\n")}\n}\n`;
}

/** APA 7 for a data set: Author. (Year). Title (Version) [Data set]. Publisher. URL */
function toApa(f: Fields): string {
  const authors = f.authors.join(", ");
  const link = f.doi ? `https://doi.org/${f.doi}` : f.url;
  return `${authors}${authors.endsWith(".") ? "" : "."} (${f.released.slice(0, 4)}). ${f.title}${f.version ? ` (Version ${f.version})` : ""} [Data set]. Craton. ${link}`;
}

/** Just enough CFF reading for the fields above: top-level scalars, `authors:` names, `keywords:`. */
function parseCff(text: string): Partial<Fields> {
  const scalar = (key: string) => {
    const m = text.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
    if (!m) return undefined;
    const v = m[1].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
    return v;
  };
  const authors: string[] = [];
  const block = text.match(/^authors:[ \t]*\n((?:[ \t]+.*\n?|\n)+)/m)?.[1];
  if (block) {
    for (const item of block.split(/^[ \t]*-[ \t]+/m).slice(1)) {
      const get = (k: string) => item.match(new RegExp(`${k}:[ \\t]*"?([^"\\n]+?)"?[ \\t]*$`, "m"))?.[1];
      const family = get("family-names"), given = get("given-names"), name = get("name");
      const person = [given, family].filter(Boolean).join(" ");
      const apaName = family ? `${family}${given ? `, ${given.split(/\s+/).map((p) => `${p[0]}.`).join(" ")}` : ""}` : "";
      const label = apaName || name || person;
      if (label) authors.push(label);
    }
  }
  const keywords = [...(text.match(/^keywords:[ \t]*\n((?:[ \t]+-.*\n?)+)/m)?.[1].matchAll(/^[ \t]+-[ \t]+"?([^"\n]+?)"?[ \t]*$/gm) ?? [])].map((m) => m[1]);
  return {
    title: scalar("title"),
    authors: authors.length ? authors : undefined,
    version: scalar("version"),
    released: scalar("date-released")?.slice(0, 10),
    doi: scalar("doi"),
    license: scalar("license"),
    url: scalar("url") ?? scalar("repository-code"),
    abstract: scalar("abstract"),
    keywords,
    commit: scalar("commit"),
  };
}

export async function citationFor(ctx: Ctx, repo: RepoRow): Promise<Citation> {
  const owner = ctx.db.prepare("SELECT name, handle FROM owners WHERE id = ?").get(repo.owner_id) as { name: string; handle: string };
  const release = ctx.db.prepare("SELECT tag, created_at FROM releases WHERE repo_id = ? AND prerelease = 0 ORDER BY id DESC LIMIT 1").get(repo.id) as { tag: string; created_at: string } | undefined;
  const head = ctx.db.prepare("SELECT c.id, c.timestamp FROM refs r JOIN commits c ON c.repo_id = r.repo_id AND c.id = r.commit_id WHERE r.repo_id = ? AND r.kind = 'branch' AND r.name = ?").get(repo.id, repo.default_branch) as { id: string; timestamp: string } | undefined;

  const topics = JSON.parse(repo.topics) as string[];
  const generated: Fields = {
    title: repo.name,
    authors: [owner.name || owner.handle],
    version: release?.tag,
    released: (release?.created_at ?? head?.timestamp ?? repo.updated_at).slice(0, 10),
    license: repo.license && repo.license !== "proprietary" ? repo.license : undefined,
    url: `${config.webUrl}/${owner.handle}/${repo.name}`,
    abstract: repo.description || undefined,
    keywords: topics,
    commit: head?.id,
  };

  let own: string | null = null;
  if (head) {
    const commit = getObject<CommitObject>(ctx, repo, head.id, "commit");
    const tree = getObject<TreeObject>(ctx, repo, commit.tree, "tree");
    const entry = tree.entries.find((e) => e.path === "CITATION.cff");
    if (entry && entry.size <= 64 * 1024) own = (await new BlobReader(ctx, getObject<BlobObject>(ctx, repo, entry.blob, "blob")).readAll()).toString("utf8");
  }

  const parsed = own ? parseCff(own) : {};
  const f: Fields = { ...generated, ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v !== undefined && !(Array.isArray(v) && !v.length))) } as Fields;

  const hints: string[] = [];
  if (!own) {
    if (!release) hints.push("No release yet, so this cites the repository by date and commit. Publish a release to give it a version.");
    if (!repo.license) hints.push("No licence is set. Add one in Settings so reusers know the terms.");
    if (!repo.description) hints.push("Add a description: it becomes the abstract.");
    hints.push("Add a CITATION.cff file to the repository to control exactly how it is cited (authors, DOI).");
  } else if (!f.doi) {
    hints.push("This CITATION.cff has no DOI. Datasets cited with one are easier to find.");
  }

  return { source: own ? "CITATION.cff" : "generated", cff: own ?? toCff(f), bibtex: toBibtex(f), apa: toApa(f), hints };
}
