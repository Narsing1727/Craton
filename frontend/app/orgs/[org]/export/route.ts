// Download the files of an organization's repositories as one ZIP (organization settings, owners only). The API
// streams it from stored chunks; this route adds the session token and passes the stream through.

import { getSessionToken } from "@/lib/session";

const BASE = process.env.CRATON_API_URL ?? "http://localhost:4000";

export async function GET(_req: Request, { params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const token = await getSessionToken();
  if (!token) return new Response("Sign in to export repositories.", { status: 401 });
  let upstream: Response;
  try {
    upstream = await fetch(`${BASE}/v1/orgs/${encodeURIComponent(org)}/export/repositories`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  } catch {
    return new Response("The Craton API isn't reachable.", { status: 503 });
  }
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  const headers = new Headers();
  for (const h of ["content-type", "content-length", "content-disposition", "cache-control"]) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { headers });
}
