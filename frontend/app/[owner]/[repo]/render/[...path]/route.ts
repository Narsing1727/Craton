// Map previews drawn by the Craton API from the stored bytes: a hillshade PNG for GeoTIFFs, an
// SVG for shapefiles, and with ?base=<ref> the difference from that version. Proxied on the
// server so the session cookie, not a token in the page, decides what the viewer may see.

import { fetchRender } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string; path: string[] }> }) {
  const { owner, repo, path } = await params;
  const filePath = path.map(decodeURIComponent).join("/");
  const q = new URL(request.url).searchParams;
  const size = Number(q.get("size")) || undefined;
  const upstream = await fetchRender(owner, repo, q.get("ref") ?? "main", filePath, { base: q.get("base") ?? undefined, size, ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  // The API decides how long a preview may be kept: a year when it is pinned to a commit, minutes
  // behind a branch name, and always with an ETag so a revisit is a 304.
  const cacheHeaders: Record<string, string> = { "cache-control": upstream.headers.get("cache-control") ?? "private, max-age=300" };
  const etag = upstream.headers.get("etag");
  if (etag) cacheHeaders.etag = etag;
  if (upstream.status === 304) return new Response(null, { status: 304, headers: cacheHeaders });
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      ...cacheHeaders,
      // An SVG opened on its own must not run anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
    },
  });
}
