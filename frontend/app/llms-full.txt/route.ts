// /llms-full.txt: every reading page as Markdown in one file, for a model that wants the whole site in one request.

import { TWIN_PAGES } from "@/lib/llms";
import { requestOrigin } from "@/lib/origin";
import { siteOrigin, twinMarkdown } from "@/lib/markdown-twin";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const origin = siteOrigin(req);
  const from = requestOrigin(req);
  const parts = await Promise.all(TWIN_PAGES.map(async (p) => ({ p, text: await twinMarkdown(from, origin, p.path) })));
  const body = parts.filter((x) => x.text !== null).map(({ p, text }) => `<!-- ${origin}${p.path} -->\n\n${text}`).join("\n---\n\n");
  return new Response(body || "No page could be read right now.\n", { status: body ? 200 : 502, headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": body ? "public, max-age=300" : "no-store" } });
}
