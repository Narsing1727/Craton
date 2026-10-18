// The review as a Markdown file to attach to a submission. The API builds it; this route adds the session token (public
// repositories need none) and passes the document through as a download.

import { getSessionToken } from "@/lib/session";

const BASE = process.env.CRATON_API_URL ?? "http://localhost:4000";

export async function GET(_req: Request, { params }: { params: Promise<{ owner: string; repo: string; n: string }> }) {
  const { owner, repo, n } = await params;
  const token = await getSessionToken();
  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/model-reviews/${encodeURIComponent(n)}/export?download=1`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      cache: "no-store",
    });
  } catch {
    return new Response("The Craton API isn't reachable.", { status: 503 });
  }
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  const headers = new Headers();
  for (const h of ["content-type", "content-disposition", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { headers });
}
