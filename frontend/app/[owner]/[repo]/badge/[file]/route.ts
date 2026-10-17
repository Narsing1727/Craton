// Status badges (checks.svg, release.svg, size.svg, license.svg), served from the web origin so READMEs and wikis
// can embed them by the address people use to browse (and so the page's own image policy allows them). Public
// repositories only; the API decides.

const API = (process.env.CRATON_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const ALLOWED = /^(checks|release|size|license)\.svg$/;

export async function GET(_request: Request, { params }: { params: Promise<{ owner: string; repo: string; file: string }> }) {
  const { owner, repo, file } = await params;
  if (!ALLOWED.test(file)) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  try {
    const upstream = await fetch(`${API}/v1/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/badge/${file}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
    if (!upstream.ok) return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
    return new Response(await upstream.text(), {
      headers: {
        "content-type": "image/svg+xml; charset=utf-8",
        "cache-control": "public, max-age=300",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("The Craton API isn't running.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}
