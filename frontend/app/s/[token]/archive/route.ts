// The shared snapshot (or ?path=<folder>) as a ZIP. Passed through from the API with no session
// attached: the link, not who is signed in, decides what is shown.

import { fetchShared } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const path = new URL(request.url).searchParams.get("path");
  const upstream = await fetchShared(token, `/archive${path ? `?path=${encodeURIComponent(path)}` : ""}`);
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  if (!upstream.ok) return new Response(upstream.status === 404 ? "This link doesn't exist or has expired." : await upstream.text(), { status: upstream.status });
  const headers = new Headers({ "cache-control": "private, no-store", "x-content-type-options": "nosniff", "x-robots-tag": "noindex, nofollow" });
  for (const name of ["content-type", "content-length", "content-disposition"]) {
    const v = upstream.headers.get(name);
    if (v) headers.set(name, v);
  }
  return new Response(upstream.body, { headers });
}
