// Request limits: a sliding-window counter per key (client IP, token, or IP + login name), kept in the shared cache (cache/cache.ts): in
// Redis when one is configured, so every server counts the same hits, else in this server's memory. Responses carry the draft IETF
// RateLimit headers and Retry-After on 429.

import { config } from "../config.ts";
import { getCache, type Window, type WindowResult } from "../cache/cache.ts";

export type { Window };

/** Record a hit; returns whether it's allowed and how the window stands. */
export async function take(key: string, w: Window): Promise<WindowResult> {
  // With limits switched off (development, some tests) nothing is refused, but hits are still counted so the headers are honest.
  if (config.limits.enabled) return getCache().hit(key, w);
  const r = await getCache().hit(key, { ...w, max: Number.MAX_SAFE_INTEGER });
  return { allowed: true, remaining: w.max, resetMs: r.resetMs, limit: w.max };
}

/** Count without recording (e.g. "is this account locked?"). */
export function count(key: string, w: Window) {
  return getCache().count(key, w.windowMs);
}

export function clear(key: string) {
  return getCache().clear(key);
}

export function headersFor(r: WindowResult): Record<string, string> {
  const h: Record<string, string> = {
    "RateLimit-Limit": String(r.limit),
    "RateLimit-Remaining": String(r.remaining),
    "RateLimit-Reset": String(Math.ceil(r.resetMs / 1000)),
  };
  if (!r.allowed) h["Retry-After"] = String(Math.max(1, Math.ceil(r.resetMs / 1000)));
  return h;
}
