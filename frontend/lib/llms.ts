// What /llms.txt, /llms-full.txt and /skill.md say, and which pages have a Markdown version (/docs.md and the like).
// Pure, so it is tested without a server; the route handlers feed it the address the reader used.

/** Reading pages that have a Markdown version at `<path>.md`, in the order they are listed. */
export const TWIN_PAGES: { path: string; title: string; summary: string }[] = [
  { path: "/docs", title: "Documentation", summary: "Getting started, supported formats, chunking and deduplication, checks, secret scanning, branches, reviews, model review, webhooks, rate limits" },
  { path: "/api-reference", title: "API reference", summary: "Every REST endpoint with its method, path and auth, the push protocol, the MCP server and the Python client" },
  { path: "/cli", title: "CLI", summary: "Installing the craton command line and every command it has" },
  { path: "/pricing", title: "Pricing", summary: "Plans, storage and what each includes" },
  { path: "/security", title: "Security", summary: "How data, accounts and tokens are protected, and how to report a problem" },
  { path: "/about", title: "About", summary: "What Craton is for and who it is for" },
  { path: "/changelog", title: "Changelog", summary: "What changed in each release" },
  { path: "/help", title: "Help", summary: "Answers to common questions" },
];

const trim = (s: string) => s.replace(/\/+$/, "");

/** The Markdown address of a reading page. */
export const twinUrl = (origin: string, path: string) => `${trim(origin)}${path}.md`;

/** /llms.txt, in the llmstxt.org layout: a title, a short summary, then lists of links with a note each. */
export function llmsTxt(origin: string, apiOrigin: string): string {
  const site = trim(origin);
  const api = trim(apiOrigin);
  const list = (pages: typeof TWIN_PAGES) => pages.map((p) => `- [${p.title}](${twinUrl(site, p.path)}): ${p.summary}`).join("\n");
  return `# Craton

> Craton is version control for hydrology and GIS data: git for DEMs, rasters, shapefiles, HEC-RAS and SWMM models, point clouds and time series. Files are stored as content-defined chunks, so a small change to a large file uploads and downloads only the chunks that changed; every commit carries a Merkle root that proves every byte; history is append-only.

On every push it checks GeoTIFF and cloud-optimised GeoTIFF structure, shapefiles, GeoPackage and GeoParquet contents, NetCDF and HDF5 files, LAS point clouds, HEC-RAS and SWMM projects, coordinate systems and units, and any rules a repository writes itself in \`.craton-checks.json\`. It refuses pushes that contain credentials, supports file locks for files that cannot be merged, map and table diffs, pull requests with code owners, signed webhooks, and a model review pinned to one commit.

The links below are Markdown versions of the pages people read. Any of those pages can also be fetched as Markdown by sending \`Accept: text/markdown\`.

## Docs

${list(TWIN_PAGES.slice(0, 3))}

## For agents

- [Skill file](${site}/skill.md): how to work with a Craton repository from a command line or the API, and the rules that matter
- [OpenAPI document](${api}/v1/openapi.json): the whole REST API in machine-readable form
- [Everything in one file](${site}/llms-full.txt): the pages above, concatenated

## Optional

${list(TWIN_PAGES.slice(3))}
- [Sitemap](${site}/sitemap.xml): public pages and public repositories
`;
}

/** /skill.md: an agent skill (name and description in front matter, then instructions). Everything in it is true of the CLI and API as built. */
export function skillMd(origin: string, apiOrigin: string): string {
  const site = trim(origin);
  const api = trim(apiOrigin);
  return `---
name: craton
description: Work with a Craton repository, which is version control for hydrology and GIS data (DEMs, rasters, shapefiles, HEC-RAS and SWMM models, point clouds, gauge tables). Use it to clone, change, check, push or review such data, or to read what changed between versions.
---

# Working with Craton

Craton keeps large geospatial and hydrology files under version control. A file is split into chunks, only changed chunks travel, and every commit has a Merkle root. History is append-only: nothing is rewritten, a rollback is a new commit.

Server: ${api} (API under \`/v1\`). Web: ${site}. Reference: ${site}/api-reference.md, ${site}/cli.md, ${site}/docs.md.

## Sign in

Use a personal access token from Settings → Personal access tokens (\`crt_pat_…\`). Give it the narrowest scope; if the job only reads, a read-only one.

\`\`\`
craton auth login --token <token> --server ${api}
\`\`\`

In CI or a tool, set \`CRATON_TOKEN\` instead. Never write a token into a file that is committed: a push that contains a credential is refused (see "Secrets" below).

## Everyday commands

\`\`\`
craton clone <owner>/<repo> --server ${api}   # add --only terrain/,model/ to take part of it
craton status                                  # what changed, in chunks
craton add <paths>
craton commit -m "what and why"
craton push                                    # uploads only new chunks, then the repository's checks run
craton pull
craton branch <name>      /  craton switch <name>
craton log [path]  /  craton diff  /  craton blame <path>
craton stats <raster>                          # cell statistics and change
craton fsck                                    # verify files against the Merkle root
craton doctor                                  # Node, server, token, access, disk space
\`\`\`

\`push\`, \`status\`, \`log\` and \`clone\` take \`--json\` for one JSON object per line. Exit codes: 0 success, 1 a failed job, 2 a usage mistake.

## Rules that matter

- **Pull before you push.** A push moves a branch only if it is a fast-forward of the tip you last saw; otherwise it is refused (\`stale_ref\` or \`non_fast_forward\`). Run \`craton pull\`, then push again. There is no force.
- **Locks.** Some files cannot be merged (a HEC-RAS geometry, a binary model). \`craton lock <path>\` says you are editing it and \`craton locks\` shows who holds what. A push that changes a file locked by someone else is refused (\`locked\`), and a repository can require a lock before a push (\`lock_required\`).
- **Checks run on every push** and their result is printed. A failed step names the file and the reason. A repository can add its own rules in \`.craton-checks.json\` at its root.
- **Branch protection.** The default branch may require a pull request, passing checks, an approval or a code owner's approval. Work on a branch and open a pull request.
- **Secrets.** A push or upload that adds a token, cloud key, private key or database password is refused with the file and line, never the secret: 422 \`secret_detected\`. Take it out, and rotate it if it was real. Only a repository administrator can push past it, with \`craton push --allow-secrets "reason"\`; the reason goes to the audit log. A line that is only an example may carry \`craton:allow-secret\`.
- **Large data goes through the CLI,** not the browser upload (100 MB and 200 files at a time).

## Using the API

\`\`\`
curl -H "Authorization: Bearer $CRATON_TOKEN" ${api}/v1/repos/<owner>/<repo>
curl -H "Authorization: Bearer $CRATON_TOKEN" "${api}/v1/repos/<owner>/<repo>/commits?limit=20"
\`\`\`

Errors are \`{ "error": { "code", "message", "details" } }\`; a 429 carries \`Retry-After\`. Requests are limited to 1,200 per minute per token. The whole API is described at ${api}/v1/openapi.json.

## Read-only access from an assistant

An MCP server (stdio) answers what-changed, release, file-listing, gauge-fit, blame, text-diff, review-owner and raster-statistics questions with the same token. See "Terminal and assistants" in ${site}/api-reference.md.

## Citing data

A repository's citation (APA, BibTeX, CITATION.cff) is at \`/v1/repos/<owner>/<repo>/citation\`. A release has a stable tag, and the commit's Merkle root identifies the exact bytes.
`;
}
