// A picture in a repository, shown in place instead of downloaded. Only picture types are served this way, each with the one content type its
// extension names, never sniffed and never with scripts allowed (an SVG shown through an <img> cannot run any, and this response says so too).
// Anything else is refused here: the download route is for that.

import { fetchRaw } from "@/lib/api";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", avif: "image/avif", bmp: "image/bmp" };

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string; path: string[] }> }) {
  const { owner, repo, path } = await params;
  const filePath = path.map(decodeURIComponent).join("/");
  const type = TYPES[filePath.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) return new Response("Only pictures are shown in place.", { status: 415 });
  const ref = new URL(request.url).searchParams.get("ref") ?? "main";
  const upstream = await fetchRaw(owner, repo, ref, filePath);
  if (!upstream) return new Response("The Craton API isn't reachable right now.", { status: 503 });
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  const pinned = /^[0-9a-f]{64}$/.test(ref);
  return new Response(upstream.body, {
    headers: {
      "content-type": type,
      "cache-control": pinned ? "private, max-age=31536000, immutable" : "private, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}
