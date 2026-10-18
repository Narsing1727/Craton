// A release's manifest (JSON) and SHA256SUMS as downloads. They list every file, so for a release of thousands of files
// they are megabytes: a download, not part of the Releases page.

import { api } from "@/lib/api";

export const dynamic = "force-dynamic";

const NL = String.fromCharCode(10);

export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; repo: string; tag: string; file: string }> }) {
  const { owner, repo, tag, file } = await params;
  if (file !== "manifest.json" && file !== "SHA256SUMS") return new Response("Not found.", { status: 404 });
  const releases = await api.releases(owner, repo);
  if (!releases) return new Response("The release isn't available: the repository was not found, or the Craton API isn't reachable.", { status: 503 });
  const r = releases.find((x) => x.tag === decodeURIComponent(tag));
  if (!r) return new Response("Release not found.", { status: 404 });
  const body =
    file === "SHA256SUMS"
      ? r.checksums.map((f) => `${f.sha256}  ${f.path}`).join(NL) + NL
      : JSON.stringify(
          {
            repository: `${owner}/${repo}`,
            tag: r.tag,
            commit: r.commit.slice(0, 7),
            merkleRoot: r.merkleRoot,
            size: r.sizeBytes,
            files: r.checksums.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
          },
          null,
          2,
        );
  const safe = `${repo}-${r.tag}`.replace(/[^A-Za-z0-9._-]/g, "_");
  return new Response(body, {
    headers: {
      "content-type": file === "SHA256SUMS" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="${safe}-${file === "SHA256SUMS" ? "SHA256SUMS.txt" : "manifest.json"}"`,
      "cache-control": "private, no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
