import { test } from "node:test";
import assert from "node:assert/strict";
import { RateLimited, waitMessage } from "../lib/ratelimit.ts";

test("the wait is said in seconds, then in minutes", () => {
  assert.equal(waitMessage("1"), "Too many requests. Try again in 1 second.");
  assert.equal(waitMessage("12"), "Too many requests. Try again in 12 seconds.");
  assert.equal(waitMessage("180"), "Too many requests. Try again in about 3 minutes.");
});

test("no usable Retry-After falls back to a plain sentence", () => {
  for (const v of [null, undefined, "", "soon", "0", "-4"]) assert.equal(waitMessage(v), "Too many requests. Try again shortly.");
  assert.equal(waitMessage(null, "Slow down."), "Slow down.");
});

test("a rate limited read is an error carrying the wait", () => {
  const e = new RateLimited("30");
  assert.ok(e instanceof Error);
  assert.equal(e.message, "Too many requests. Try again in 30 seconds.");
  assert.equal(e.retryAfter, "30");
});
