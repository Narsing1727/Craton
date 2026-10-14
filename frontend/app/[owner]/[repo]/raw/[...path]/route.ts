// Download a file from the Craton API. Runs on the server so the API token never reaches the
// browser. The API serves files up to 16 MB this way; larger ones go through `craton pull`.

import { fetchRaw } from "@/lib/api";

export async function GET(request: Request, { params }: { params: Promise<{ owner: string; repo: string; path: string[] }> }) {
  const { owner, repo, path } = await params;
  const filePath = path.map(decodeURIComponent).join("/");
  const ref = new URL(request.url).searchParams.get("ref") ?? "main";
  const upstream = await fetchRaw(owner, repo, ref, filePath);
  if (!upstream) return new Response("The Craton API isn't reachable right now.", { status: 503 });
  if (!upstream.ok) return new Response(await upstream.text(), { status: upstream.status, headers: { "content-type": "application/json" } });
  const name = filePath.split("/").pop() ?? "download";
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/octet-stream",
      "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"`,
      "x-craton-sha256": upstream.headers.get("x-craton-sha256") ?? "",
    },
  });
}
