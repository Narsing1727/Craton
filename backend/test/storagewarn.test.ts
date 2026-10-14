// Storage warnings: one email when use crosses 80%, one at 100%, and again after use has fallen back below.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { noteStorageUse } from "../src/services/plans.ts";

test("each threshold warns once, and warns again only after use has dropped below it", async () => {
  const ctx: Ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  const app = createApp(ctx);
  const signup = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "olga", email: "olga@example.org", password: "a-very-long-password" }) });
  assert.equal(signup.status, 201);
  const owner = ctx.db.prepare("SELECT id FROM owners WHERE handle = 'olga'").get() as { id: number };
  const sent = async () => ((await (await app.request("/v1/dev/outbox")).json()) as { kind: string; subject: string }[]).filter((m) => m.kind === "storage-warning");
  const GB = 1024 ** 3;

  noteStorageUse(ctx, owner.id, "free", 10 * GB, 20 * GB); // 50%
  assert.equal((await sent()).length, 0);
  noteStorageUse(ctx, owner.id, "free", 17 * GB, 20 * GB); // 85%
  assert.equal((await sent()).length, 1);
  assert.ok((await sent()).some((m) => /used 80%/.test(m.subject)));
  noteStorageUse(ctx, owner.id, "free", 18 * GB, 20 * GB); // still above 80%: no second email
  assert.equal((await sent()).length, 1);
  noteStorageUse(ctx, owner.id, "free", 20 * GB, 20 * GB); // 100%
  assert.equal((await sent()).length, 2);
  assert.ok((await sent()).some((m) => /at its Craton storage limit/.test(m.subject)));

  noteStorageUse(ctx, owner.id, "free", 5 * GB, 20 * GB); // after clearing space
  noteStorageUse(ctx, owner.id, "free", 19 * GB, 20 * GB); // climbs again: warned again
  assert.equal((await sent()).length, 3);
});
