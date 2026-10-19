// A shapefile's features (geometry and attribute rows) for the interactive viewer, proxied on the server so the session cookie decides what
// the viewer may see. ?ref=<ref>&path=<file>.

import { fetchFeatures } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const q = new URL(request.url).searchParams;
  const upstream = await fetchFeatures(owner, repo, q.get("ref") ?? "main", q.get("path") ?? "", request.headers.get("if-none-match") ?? undefined);
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  const headers: Record<string, string> = { "cache-control": upstream.headers.get("cache-control") ?? "private, max-age=60" };
  const etag = upstream.headers.get("etag");
  if (etag) headers.etag = etag;
  if (upstream.status === 304) return new Response(null, { status: 304, headers });
  return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json", ...headers } });
}
