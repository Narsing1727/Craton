// What is at one pixel of a raster, for the viewer's cursor readout, proxied on the server so the session cookie decides what it may see.
// ?ref=<ref>&path=<file>&column=<n>&row=<n>.

import { fetchPixel } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const q = new URL(request.url).searchParams;
  const upstream = await fetchPixel(owner, repo, q.get("ref") ?? "main", q.get("path") ?? "", q.get("column") ?? "", q.get("row") ?? "");
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json", "cache-control": "private, max-age=300" } });
}
