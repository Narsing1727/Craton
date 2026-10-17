// A profile picture, served from the site's own address so it works wherever a person's name does (and under the page's
// Content-Security-Policy). The API holds the bytes; this passes them through with the same version tag, so browsers
// revalidate on every use (a changed or removed picture shows at once, an unchanged one costs a 304), and answers 204 No Content when the person has none (not a 404, which every browser would log as an error on each page; the avatar then shows their initials).

const BASE = process.env.CRATON_API_URL ?? "http://localhost:4000";

export async function GET(request: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(handle)) return new Response(null, { status: 204 });
  try {
    const upstream = await fetch(`${BASE}/v1/avatars/${encodeURIComponent(handle)}`, {
      headers: request.headers.get("if-none-match") ? { "if-none-match": request.headers.get("if-none-match")! } : {},
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    const headers = new Headers();
    for (const name of ["content-type", "etag", "x-content-type-options", "content-security-policy"]) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (upstream.status === 200 || upstream.status === 304) {
      headers.set("cache-control", "public, no-cache");
      return new Response(upstream.status === 304 ? null : upstream.body, { status: upstream.status, headers });
    }
    return new Response(null, { status: 204, headers: { "cache-control": "no-cache" } });
  } catch {
    return new Response(null, { status: 204 });
  }
}
