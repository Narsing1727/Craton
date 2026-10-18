// One 256-pixel tile of a raster for the zoomable viewer, proxied on the server like the previews. ?ref=<ref>&path=<file>.
// The API sets how long a tile may be kept (a year when pinned to a commit) and an ETag, so a revisit is a 304.

import { fetchTile } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string; z: string; x: string; y: string }> }) {
  const { owner, repo, z, x, y } = await params;
  const q = new URL(request.url).searchParams;
  const upstream = await fetchTile(owner, repo, q.get("ref") ?? "main", q.get("path") ?? "", z, x, y, request.headers.get("if-none-match") ?? undefined);
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  const headers: Record<string, string> = { "cache-control": upstream.headers.get("cache-control") ?? "private, max-age=300" };
  const etag = upstream.headers.get("etag");
  if (etag) headers.etag = etag;
  if (upstream.status === 304) return new Response(null, { status: 304, headers });
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  return new Response(upstream.body, { headers: { "content-type": "image/png", ...headers, "x-content-type-options": "nosniff" } });
}
