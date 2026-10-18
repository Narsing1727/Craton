// /llms.txt: a short map of the site for language models, in the llmstxt.org layout.

import { llmsTxt } from "@/lib/llms";
import { publicApiUrl, siteOrigin } from "@/lib/markdown-twin";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => new Response(llmsTxt(siteOrigin(req), publicApiUrl()), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } });
