// A rate limited request is waited out and carried on, not reported as a failure: a push of thousands of small files
// makes thousands of requests.

import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Remote } from "../src/cli/remote.ts";

test("429 with Retry-After is waited out once, for every request, and then succeeds", { timeout: 30_000 }, async () => {
  let limitedUntil = 0;
  let served = 0;
  let refused = 0;
  const server = http.createServer((req, res) => {
    if (Date.now() < limitedUntil) {
      refused++;
      res.writeHead(429, { "retry-after": "1", "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "rate_limited", message: "Too many requests." } }));
      return;
    }
    served++;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as AddressInfo;
  try {
    const remote = new Remote(`http://127.0.0.1:${port}`, "o", "r", null);
    limitedUntil = Date.now() + 700;
    const t0 = Date.now();
    const results = await Promise.all([remote.request<{ ok: boolean }>("GET", "/a"), remote.request<{ ok: boolean }>("GET", "/b"), remote.request<{ ok: boolean }>("GET", "/c")]);
    const elapsed = Date.now() - t0;
    assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
    assert.ok(elapsed >= 900, `waited about a second (${elapsed} ms)`);
    assert.equal(served, 3);
    assert.ok(refused >= 1 && refused <= 3, `each request was refused at most once (${refused})`);
  } finally {
    server.close();
  }
});
