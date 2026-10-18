// Request limits: a sliding-window counter per key (client IP, token, or IP + login name).
// In memory, so it resets on restart and is per process; a multi-instance deployment should move
// this to Redis. Responses carry the draft IETF RateLimit headers and Retry-After on 429.

import { config } from "../config.ts";

type Window = { max: number; windowMs: number };

const hits = new Map<string, number[]>();

/** Record a hit; returns whether it's allowed and how the window stands. */
export function take(key: string, w: Window, now = Date.now()) {
  const since = now - w.windowMs;
  const list = (hits.get(key) ?? []).filter((t) => t > since);
  const allowed = !config.limits.enabled || list.length < w.max;
  if (allowed) list.push(now);
  hits.set(key, list);
  const oldest = list[0] ?? now;
  return { allowed, remaining: Math.max(0, w.max - list.length), resetMs: Math.max(0, oldest + w.windowMs - now), limit: w.max };
}

/** Count without recording (e.g. "is this account locked?"). */
export function count(key: string, w: Window, now = Date.now()) {
  return (hits.get(key) ?? []).filter((t) => t > now - w.windowMs).length;
}

export function clear(key: string) {
  hits.delete(key);
}

export function headersFor(r: ReturnType<typeof take>): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(Math.ceil(r.resetMs / 1000)),
  };
  if (!r.allowed) h["Retry-After"] = String(Math.max(1, Math.ceil(r.resetMs / 1000)));
  return h;
}

/** Drop idle keys now and then so memory stays bounded. */
setInterval(() => {
  const now = Date.now();
  for (const [k, list] of hits) if (!list.length || list[list.length - 1] < now - 60 * 60_000) hits.delete(k);
}, 5 * 60_000).unref();
