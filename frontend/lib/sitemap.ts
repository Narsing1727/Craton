// sitemap.xml for search engines: the public pages and the public repositories, nothing else. Pure, so it is tested
// without a server; the route handler feeds it what the API lists for an anonymous visitor.

export type SitemapRepo = { owner: string; name: string; visibility?: string; updatedAt?: string };

const PAGES = ["/", "/explore", "/trending", "/docs", "/cli", "/api-reference", "/pricing", "/about", "/help", "/changelog", "/security", "/privacy", "/terms", "/contact"];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Only public repositories are listed, even if the caller hands in more. */
export function sitemapXml(origin: string, repos: SitemapRepo[]): string {
  const base = origin.replace(/\/+$/, "");
  const urls: { loc: string; lastmod?: string }[] = PAGES.map((p) => ({ loc: base + (p === "/" ? "/" : p) }));
  for (const r of repos) {
    if (r.visibility && r.visibility !== "public") continue;
    urls.push({ loc: `${base}/${encodeURIComponent(r.owner)}/${encodeURIComponent(r.name)}`, lastmod: r.updatedAt?.slice(0, 10) });
  }
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'];
  for (const u of urls) lines.push(`  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${esc(u.lastmod)}</lastmod>` : ""}</url>`);
  lines.push("</urlset>");
  return lines.join(String.fromCharCode(10)) + String.fromCharCode(10);
}
