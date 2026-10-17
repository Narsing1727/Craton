// One file from the shared snapshot, streamed from the API with no session attached.

import { fetchShared } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ token: string; path: string[] }> }) {
  const { token, path } = await params;
  const upstream = await fetchShared(token, `/file/${path.map((p) => encodeURIComponent(decodeURIComponent(p))).join("/")}`);
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  if (!upstream.ok) return new Response(upstream.status === 404 ? "That file isn't in this shared snapshot." : await upstream.text(), { status: upstream.status });
  const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow" });
  for (const name of ["content-type", "content-length", "content-disposition", "x-craton-sha256"]) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(upstream.body, { headers });
}
