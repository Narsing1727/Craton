// A raster's layout for the zoomable viewer (size, zoom levels, colour range), proxied on the server so the session cookie decides
// what the viewer may see. ?ref=<ref>&path=<file>.

import { fetchTileInfo } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const q = new URL(request.url).searchParams;
  const upstream = await fetchTileInfo(owner, repo, q.get("ref") ?? "main", q.get("path") ?? "");
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json", "cache-control": "private, max-age=60" } });
}
