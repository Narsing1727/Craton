// Adding files from the browser. The page posts the files here and this passes them on to the API
// as the signed-in person (the session cookie never reaches JavaScript), streaming rather than
// buffering. Cookie-authenticated, so it refuses requests that did not come from this site.

import { forwardUpload } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ owner: string; repo: string }> }) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (origin && host) {
    let same = false;
    try {
      same = new URL(origin).host === host;
    } catch {}
    if (!same) return Response.json({ error: { code: "forbidden", message: "That request didn’t come from this site." } }, { status: 403 });
  }
  const { owner, repo } = await params;
  const upstream = await forwardUpload(owner, repo, request);
  if (!upstream) return Response.json({ error: { code: "offline", message: "The Craton API isn’t running." } }, { status: 503 });
  return new Response(upstream.body, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" } });
}
