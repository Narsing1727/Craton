// A few seconds' copy of the pages everyone asks for and nobody is signed in to see (the explore list, trending). A visitor arriving from a
// link, a crawler, a burst after an announcement: all of them get the same answer, so the database answers once per few seconds
// instead of once per visitor. Only for requests with no credentials at all, so nothing personal is ever stored or served from here, and
// only for answers that were a plain 200. Kept in the shared cache, so every server benefits from the first visitor's request.

import type { MiddlewareHandler } from "hono";
import { getCache } from "../cache/cache.ts";
import { counters } from "./metrics.ts";

type Entry = { type: string; total: string | null; body: string };

export function publicPageCache(ttlSeconds: number): MiddlewareHandler {
  return async (c, next) => {
    if (c.req.method !== "GET" || c.req.header("authorization") || c.req.header("cookie")?.includes("craton_session") || c.get("user" as never)) return next();
    const url = new URL(c.req.url);
    const key = `page:${url.pathname}${url.search}`;
    const hit = await getCache().get(key);
    if (hit) {
      try {
        const e = JSON.parse(hit.toString("utf8")) as Entry;
        counters.pageCache.hit++;
        return c.body(e.body, 200, { "content-type": e.type, ...(e.total ? { "x-total-count": e.total } : {}), "x-craton-cache": "hit" });
      } catch {
        // A damaged entry is just a miss.
      }
    }
    counters.pageCache.miss++;
    await next();
    const type = c.res.headers.get("content-type") ?? "";
    if (c.res.status === 200 && type.includes("application/json")) {
      const entry: Entry = { type, total: c.res.headers.get("x-total-count"), body: await c.res.clone().text() };
      await getCache().set(key, JSON.stringify(entry), ttlSeconds);
    }
  };
}
