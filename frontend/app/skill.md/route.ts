// /skill.md: an agent skill file for working with a Craton repository.

import { skillMd } from "@/lib/llms";
import { publicApiUrl, siteOrigin } from "@/lib/markdown-twin";

export const dynamic = "force-dynamic";

export const GET = (req: Request) => new Response(skillMd(siteOrigin(req), publicApiUrl()), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=3600" } });
