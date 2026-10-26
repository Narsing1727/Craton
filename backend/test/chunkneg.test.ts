// "Which of these chunks do you already have?" for a big push: answered a few hundred hashes per statement (not one round trip per hash), and
// still only against what the repository may see.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createApp } from "../src/api/app.ts";
import { openDb, type DB } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

test("a thousand hashes are checked in a handful of statements, and the answer is the same as asking one by one", async () => {
  const real = await openDb(":memory:");
  const seen: string[] = [];
  const db = new Proxy(real, {
    get(t, prop, r) {
      const v = Reflect.get(t, prop, r);
      if (typeof v !== "function") return v;
      if (["get", "all", "run", "insert"].includes(String(prop))) return (...a: unknown[]) => (seen.push(String(a[0])), (v as (...x: unknown[]) => unknown).apply(t, a));
      return v.bind(t);
    },
  }) as DB;
  const app = createApp({ db, store: new MemoryStore() } as Ctx);
  const j = { "content-type": "application/json" };
  const su = await app.request("/v1/auth/signup", { method: "POST", headers: j, body: JSON.stringify({ username: "noor", email: "noor@example.org", password: "a-very-long-password" }) });
  const token = ((await su.json()) as { token: string }).token;
  const h = { authorization: `Bearer ${token}`, ...j };
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: h, body: JSON.stringify({ name: "basin", visibility: "private" }) })).status, 201);
  // 200 chunks the repository has (uploaded one by one), 1,000 it does not
  const have = Array.from({ length: 200 }, (_, i) => `have ${i}`);
  for (const d of have) assert.equal((await app.request(`/v1/repos/noor/basin/chunks/${sha(d)}`, { method: "PUT", headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" }, body: d })).status, 201);
  const lacking = Array.from({ length: 1000 }, (_, i) => sha(`lack ${i}`));
  const asked = [...have.map(sha), ...lacking, sha("have 0")]; // one repeated on purpose
  seen.length = 0;
  const res = await app.request("/v1/repos/noor/basin/chunks/missing", { method: "POST", headers: h, body: JSON.stringify({ hashes: asked }) });
  assert.equal(res.status, 200);
  const missing = ((await res.json()) as { missing: string[] }).missing;
  assert.deepEqual(missing, lacking, "exactly the ones the repository does not have, in the order asked, without the repeat");
  const scopeQueries = seen.filter((q) => /FROM chunk_scopes/.test(q)).length;
  assert.ok(scopeQueries <= 4, `${scopeQueries} statements for ${asked.length} hashes`);
  await real.close();
});

test("a chunk another person's private repository holds is still reported missing", async () => {
  const app = createApp({ db: await openDb(":memory:"), store: new MemoryStore() } as Ctx);
  const j = { "content-type": "application/json" };
  const make = async (u: string) => ((await (await app.request("/v1/auth/signup", { method: "POST", headers: j, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) })).json()) as { token: string }).token;
  const [a, b] = [await make("asha"), await make("bela")];
  for (const [u, t] of [["asha", a], ["bela", b]] as const) assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${t}`, ...j }, body: JSON.stringify({ name: "r", visibility: "private" }) })).status, 201);
  const d = "secret terrain bytes";
  assert.equal((await app.request(`/v1/repos/asha/r/chunks/${sha(d)}`, { method: "PUT", headers: { authorization: `Bearer ${a}`, "content-type": "application/octet-stream" }, body: d })).status, 201);
  const ask = await app.request("/v1/repos/bela/r/chunks/missing", { method: "POST", headers: { authorization: `Bearer ${b}`, ...j }, body: JSON.stringify({ hashes: [sha(d)] }) });
  assert.deepEqual(((await ask.json()) as { missing: string[] }).missing, [sha(d)], "dedup never reveals what others store");
});
