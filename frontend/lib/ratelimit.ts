// What the web app says when the API answers 429. The API sends Retry-After in seconds; say how long to wait.

/** "Too many requests. Try again in 12 seconds." from a Retry-After value; the API's own sentence when there is none. */
export function waitMessage(retryAfter: string | null | undefined, fallback = "Too many requests. Try again shortly."): string {
  const seconds = Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  if (seconds < 90) return `Too many requests. Try again in ${Math.ceil(seconds)} second${Math.ceil(seconds) === 1 ? "" : "s"}.`;
  return `Too many requests. Try again in about ${Math.ceil(seconds / 60)} minutes.`;
}

/** Thrown by a page read that was rate limited: a real page must not turn into "not found" because the visitor was slowed down. */
export class RateLimited extends Error {
  retryAfter: string | null;
  constructor(retryAfter: string | null) {
    super(waitMessage(retryAfter));
    this.name = "RateLimited";
    this.retryAfter = retryAfter;
  }
}
