// Markdown versions of the reading pages. The page a person reads is fetched from this same site and converted, so the
// Markdown can never say something the page does not. Only pages in TWIN_PAGES; nothing signed-in is ever fetched
// (no cookie or token is forwarded), so what comes back is what any visitor sees.

import { htmlToMarkdown } from "@/lib/html-to-markdown";
import { TWIN_PAGES } from "@/lib/llms";
import { requestOrigin } from "@/lib/origin";

/** Where the CLI and API are reached by people (the same rule as the CLI page). */
export const publicApiUrl = () => (process.env.CRATON_PUBLIC_API_URL ?? process.env.CRATON_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");

/** The address a reader used, unless the operator said what the public address is. */
export const siteOrigin = (req: Request) => (process.env.CRATON_SITE_URL ?? requestOrigin(req)).replace(/\/+$/, "");

const cache = new Map<string, { at: number; text: string }>();
const KEEP_MS = 60_000;

/** The Markdown of one page, or null when it cannot be read. `fetchFrom` is where this server reaches itself. */
export async function twinMarkdown(fetchFrom: string, publicOrigin: string, path: string): Promise<string | null> {
  if (!TWIN_PAGES.some((p) => p.path === path)) return null;
  const key = `${fetchFrom}${path}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.text;
  try {
    const res = await fetch(`${fetchFrom}${path}`, { headers: { accept: "text/html" }, cache: "no-store", signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return null;
    const text = htmlToMarkdown(await res.text(), publicOrigin);
    cache.set(key, { at: Date.now(), text });
    return text;
  } catch {
    return null;
  }
}

const headers = (canonical: string) => ({
  "content-type": "text/markdown; charset=utf-8",
  "cache-control": "public, max-age=300",
  // The page itself is the one to index; the Markdown is for readers that ask for it.
  "x-robots-tag": "noindex",
  link: `<${canonical}>; rel="canonical"`,
  vary: "Accept",
});

/** The response for `<path>.md`. */
export async function twinResponse(req: Request, path: string): Promise<Response> {
  const origin = siteOrigin(req);
  // The page is read from the address the request came in on, which this server can reach (a bind address is never used).
  const text = await twinMarkdown(requestOrigin(req), origin, path);
  if (text === null) return new Response("This page could not be read right now.\n", { status: 502, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  return new Response(`<!-- Markdown version of ${origin}${path} -->\n\n${text}`, { headers: headers(`${origin}${path}`) });
}
