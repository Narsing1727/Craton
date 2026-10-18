// A map preview of a raster or shapefile in the shared snapshot.

import { fetchShared } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ token: string; path: string[] }> }) {
  const { token, path } = await params;
  const size = new URL(request.url).searchParams.get("size");
  const upstream = await fetchShared(token, `/render/${path.map((p) => encodeURIComponent(decodeURIComponent(p))).join("/")}${size ? `?size=${encodeURIComponent(size)}` : ""}`);
  if (!upstream) return new Response("The Craton API isn't running.", { status: 503 });
  if (!upstream.ok) return new Response(null, { status: upstream.status });
  return new Response(upstream.body, {
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, max-age=300",
      // An SVG opened on its own must not run anything.
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
      "x-content-type-options": "nosniff",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
