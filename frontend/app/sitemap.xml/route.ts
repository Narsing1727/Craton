// /sitemap.xml: the public pages and the public repositories the API lists for an anonymous visitor. The address
// written into it is CRATON_SITE_URL when set (behind a proxy the request's own origin may be an internal one).

import { sitemapXml, type SitemapRepo } from "@/lib/sitemap";

const BASE = (process.env.CRATON_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // The address a crawler used (the Host header), unless the operator has said what the public address is.
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  const origin = (process.env.CRATON_SITE_URL ?? (host ? `${proto}://${host}` : new URL(req.url).origin)).replace(/\/+$/, "");
  let repos: SitemapRepo[] = [];
  try {
    // No Authorization header: what an anonymous crawler could see anyway.
    const res = await fetch(`${BASE}/v1/repos`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (res.ok) repos = ((await res.json()) as SitemapRepo[]).slice(0, 5000);
  } catch {}
  return new Response(sitemapXml(origin, repos), { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
