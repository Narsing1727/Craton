// Download the repository (or ?path=<folder>) at ?ref=<branch|commit> as a ZIP. The API streams it
// from the chunk store; this passes the stream through so the session cookie, not a token in the
// page, decides what the viewer may download.

import { fetchArchive } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const { owner, repo } = await params;
  const q = new URL(request.url).searchParams;
  const upstream = await fetchArchive(owner, repo, q.get("ref") ?? "main", q.get("path") ?? undefined);
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  const headers = new Headers({ "cache-control": "private, no-cache", "x-content-type-options": "nosniff" });
  for (const name of ["content-type", "content-length", "content-disposition", "x-craton-commit"]) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(upstream.body, { headers });
}
