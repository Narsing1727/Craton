// A push whose checks fail tells the person who pushed it, with the failing steps and a link.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import { geotiff } from "../src/dev/fixtures.ts";

test("failing checks after an upload send one email to the uploader; passing ones send none", async () => {
  const app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const j = (path: string, method: string, token: string | null, body?: unknown) =>
    app.request(`/v1${path}`, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const signup = await j("/auth/signup", "POST", null, { username: "rhea", email: "rhea@example.org", password: "a-very-long-password" });
  const token = ((await signup.json()) as { token: string }).token;
  assert.equal((await j("/repos", "POST", token, { name: "basin", visibility: "private", crs: "EPSG:32643" })).status, 201);

  const upload = async (name: string, data: Buffer) => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(data)], name));
    form.append("paths", JSON.stringify([name]));
    form.append("message", `Add ${name}`);
    const res = await app.request("/v1/repos/rhea/basin/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
    return { status: res.status, json: (await res.json()) as { checks?: { status: string } } };
  };
  const outbox = async () => ((await (await j("/dev/outbox", "GET", null)).json()) as { kind: string; to: string; subject: string; text: string }[]).filter((m) => m.kind === "checks-failed");

  // Matches the repository's CRS: the checks pass, so nothing is sent.
  const good = await upload("good.tif", geotiff({ width: 64, height: 64, epsg: 32643, nodata: -9999, seed: 1 }));
  assert.equal(good.status, 201, JSON.stringify(good.json));
  assert.equal(good.json.checks?.status, "passed");
  assert.equal((await outbox()).length, 0);

  // A different CRS: the CRS check fails, and the uploader is told.
  const bad = await upload("bad.tif", geotiff({ width: 64, height: 64, epsg: 4326, nodata: -9999, seed: 2 }));
  assert.equal(bad.status, 201, JSON.stringify(bad.json));
  assert.equal(bad.json.checks?.status, "failed");
  const mail = await outbox();
  assert.equal(mail.length, 1);
  assert.equal(mail[0].to, "rhea@example.org");
  assert.match(mail[0].subject, /Checks failed: rhea\/basin@main/);
  assert.match(mail[0].text, /\/rhea\/basin\/checks/);
});
