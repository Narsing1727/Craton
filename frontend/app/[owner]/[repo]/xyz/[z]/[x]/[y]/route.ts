// A raster as a Web Mercator map tile, for the map viewer, proxied on the server like the other pictures so the session cookie decides what
// may be seen. ?ref=<ref>&path=<file>&ramp=<colour map>, or &base=<ref> for the elevation change.

import { fetchXyz } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string; z: string; x: string; y: string }> }) {
  const { owner, repo, z, x, y } = await params;
  const q = new URL(request.url).searchParams;
  const upstream = await fetchXyz(owner, repo, q.get("ref") ?? "main", q.get("path") ?? "", z, x, y, { ramp: q.get("ramp") ?? undefined, base: q.get("base") ?? undefined, ifNoneMatch: request.headers.get("if-none-match") ?? undefined });
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  const headers: Record<string, string> = { "cache-control": upstream.headers.get("cache-control") ?? "private, max-age=300" };
  const etag = upstream.headers.get("etag");
  if (etag) headers.etag = etag;
  if (upstream.status === 304) return new Response(null, { status: 304, headers });
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  return new Response(upstream.body, { headers: { "content-type": "image/png", ...headers, "x-content-type-options": "nosniff" } });
}
