// Share links: a private repository's snapshot, readable by someone with no account, for a limited
// time. The properties that matter: it is a pinned snapshot, the bytes are exact, a token can't
// reach anything else, expired / revoked / invented tokens look identical, and guessing is slowed.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { geotiff } from "../src/dev/fixtures.ts";
import * as limits from "../src/api/limits.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const files: Record<string, Buffer> = {};

async function call(method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
/** What a person with only the link does: no Authorization header at all. */
const anon = (path: string) => app.request(`/v1${path}`);

const repoOf = (owner = "rhea", name = "basin") => getRepoFor(ctx, owner, name, (ctx.db.prepare("SELECT id FROM owners WHERE handle = ?").get(owner) as { id: number }).id);
let link: { id: number; token: string; path: string; url: string; commit: string; expiresAt: string };

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "sol", "ines"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  assert.equal((await call("POST", "/repos", "rhea", { name: "basin", visibility: "private", description: "Chalakudy model" })).status, 201);
  assert.equal((await call("POST", "/repos", "ines", { name: "other", visibility: "private" })).status, 201);
  ctx.db.prepare("INSERT INTO collaborators (repo_id, user_id, role) VALUES (?, (SELECT id FROM owners WHERE handle = 'sol'), 'Write')").run(repoOf().id);
  files["terrain/dem.tif"] = geotiff({ width: 128, height: 128, epsg: 32643, nodata: -9999, seed: 3 });
  files["model/plan.p01"] = Buffer.from("Plan Title=Calibration\n".repeat(50));
  files["notes/readme.txt"] = crypto.randomBytes(900_000); // several chunks
  await commitFiles(ctx, repoOf(), { branch: "main", author: "rhea", message: "Calibrated model", timestamp: new Date("2026-09-01T10:00:00Z"), changes: files });
  await commitFiles(ctx, repoOf("ines", "other"), { branch: "main", author: "ines", message: "Secret", timestamp: new Date(), changes: { "secret.txt": Buffer.from("not yours") } });
});

test("an admin makes a link that expires; the address is shown once and only its hash is stored", async () => {
  const made = await call("POST", "/repos/rhea/basin/share-links", "rhea", { expiresInDays: 7, note: "For the water authority" });
  assert.equal(made.status, 201, made.text);
  link = made.json;
  assert.match(link.token, /^bcn_share_[A-Za-z0-9_-]{32}$/);
  assert.equal(link.path, `/s/${link.token}`);
  assert.match(link.url, /\/s\/bcn_share_/);
  assert.ok(Math.abs(new Date(link.expiresAt).getTime() - (Date.now() + 7 * 86_400_000)) < 60_000);
  assert.match(link.commit, /^[0-9a-f]{64}$/);

  const dump = JSON.stringify(ctx.db.prepare("SELECT * FROM share_links").all());
  assert.ok(!dump.includes(link.token), "the token itself is not in the database");
  const list = await call("GET", "/repos/rhea/basin/share-links", "rhea");
  assert.ok(!list.text.includes(link.token), "and not in the listing");
  assert.deepEqual(list.json.expiryChoices, [1, 7, 30, 90]);
  assert.equal(list.json.links[0].note, "For the water authority");
  assert.equal(list.json.links[0].active, true);
  assert.equal(list.json.links[0].uses, 0);
});

test("only admins make or see links, and the expiry must be one of the offered choices", async () => {
  assert.equal((await call("POST", "/repos/rhea/basin/share-links", "sol", { expiresInDays: 7 })).status, 403, "a writer is not an admin");
  assert.equal((await call("GET", "/repos/rhea/basin/share-links", "sol")).status, 403);
  assert.equal((await call("GET", "/repos/rhea/basin/share-links", "ines")).status, 404, "a stranger can't tell the repository exists");
  for (const days of [0, 3, 365, -1, "forever"]) assert.equal((await call("POST", "/repos/rhea/basin/share-links", "rhea", { expiresInDays: days })).status, 400, `rejects ${days}`);
  assert.equal((await call("POST", "/repos/rhea/basin/share-links", "rhea", { ref: "no-such-branch" })).status, 404);
});

test("anyone with the link sees the repository's files, with no sign-in and nothing cached or indexed", async () => {
  const res = await anon(`/shared/${link.token}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "private, no-store");
  assert.equal(res.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  const view = (await res.json()) as any;
  assert.deepEqual([view.repository.owner, view.repository.name, view.repository.description], ["rhea", "basin", "Chalakudy model"]);
  assert.deepEqual(view.files.map((f: any) => f.path).sort(), Object.keys(files).sort());
  assert.equal(view.totalBytes, Object.values(files).reduce((n, b) => n + b.length, 0));
  assert.equal(view.snapshot.message, "Calibrated model");
  assert.equal(view.note, "For the water authority");
  const used = (await call("GET", "/repos/rhea/basin/share-links", "rhea")).json.links[0];
  assert.equal(used.uses, 1);
  assert.ok(used.lastUsedAt);
});

test("it is a snapshot: later pushes do not show up, and files added later are not reachable", async () => {
  await commitFiles(ctx, repoOf(), { branch: "main", author: "rhea", message: "Later work", timestamp: new Date(), changes: { "later.txt": Buffer.from("added after sharing"), "model/plan.p01": Buffer.from("changed") } });
  const view = (await (await anon(`/shared/${link.token}`)).json()) as any;
  assert.ok(!view.files.some((f: any) => f.path === "later.txt"));
  assert.equal(view.files.find((f: any) => f.path === "model/plan.p01").size, files["model/plan.p01"].length, "the shared version of a changed file is the old one");
  assert.equal((await anon(`/shared/${link.token}/file/later.txt`)).status, 404);
  const old = Buffer.from(await (await anon(`/shared/${link.token}/file/model/plan.p01`)).arrayBuffer());
  assert.ok(old.equals(files["model/plan.p01"]));
});

test("a file downloads byte for byte, with its length, checksum and a safe filename", async () => {
  const res = await anon(`/shared/${link.token}/file/notes/readme.txt`);
  assert.equal(res.status, 200);
  const body = Buffer.from(await res.arrayBuffer());
  assert.ok(body.equals(files["notes/readme.txt"]));
  assert.equal(Number(res.headers.get("content-length")), body.length);
  assert.equal(res.headers.get("x-craton-sha256"), crypto.createHash("sha256").update(body).digest("hex"));
  assert.match(res.headers.get("content-disposition") ?? "", /^attachment; filename="readme\.txt"/);
  assert.equal(res.headers.get("content-type"), "application/octet-stream");
});

test("the snapshot (or one folder) downloads as a ZIP holding only what was shared", async () => {
  const res = await anon(`/shared/${link.token}/archive`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  const zip = Buffer.from(await res.arrayBuffer());
  assert.equal(Number(res.headers.get("content-length")), zip.length);
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.equal(zip.readUInt16LE(end + 10), 3, "three files, not four: the later one isn't in the snapshot");
  const folder = await anon(`/shared/${link.token}/archive?path=model`);
  const z2 = Buffer.from(await folder.arrayBuffer());
  assert.equal(z2.readUInt16LE(z2.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 10), 1);
  assert.equal((await anon(`/shared/${link.token}/archive?path=../../etc`)).status, 400);
  assert.equal((await anon(`/shared/${link.token}/archive?path=missing`)).status, 404);
});

test("a raster has a preview through the link", async () => {
  const res = await anon(`/shared/${link.token}/render/terrain/dem.tif?size=128`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.deepEqual([...Buffer.from(await res.arrayBuffer()).subarray(1, 4)].map((c) => String.fromCharCode(c)).join(""), "PNG");
  assert.equal((await anon(`/shared/${link.token}/render/model/plan.p01`)).status, 415);
});

test("the link opens only its own repository: it can't be used to read another's files or anything else", async () => {
  assert.equal((await anon(`/shared/${link.token}/file/secret.txt`)).status, 404);
  assert.equal((await anon(`/repos/rhea/basin`)).status, 404, "the link is not a credential for the normal API");
  const asBearer = await app.request("/v1/repos/rhea/basin", { headers: { authorization: `Bearer ${link.token}` } });
  assert.equal(asBearer.status, 404, "nor as a bearer token");
  assert.equal((await anon(`/shared/${link.token}/file/..%2F..%2Fother%2Fsecret.txt`)).status, 404);
});

test("expired, revoked, invented and malformed tokens all answer the same way", async () => {
  limits.clear("share-miss:local");
  const second = (await call("POST", "/repos/rhea/basin/share-links", "rhea", { expiresInDays: 1 })).json;
  ctx.db.prepare("UPDATE share_links SET expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1000).toISOString(), second.id);
  const third = (await call("POST", "/repos/rhea/basin/share-links", "rhea", { expiresInDays: 30 })).json;
  assert.equal((await call("DELETE", `/repos/rhea/basin/share-links/${third.id}`, "rhea")).status, 204);

  const bodies = new Set<string>();
  for (const t of [second.token, third.token, `bcn_share_${crypto.randomBytes(24).toString("base64url")}`, "nonsense", "bcn_share_", "../x"]) {
    const res = await anon(`/shared/${encodeURIComponent(t)}`);
    assert.equal(res.status, 404, t);
    bodies.add(JSON.stringify(((await res.json()) as any).error));
  }
  assert.equal(bodies.size, 1, "no way to tell expired from revoked from never-existed");
  const listed = (await call("GET", "/repos/rhea/basin/share-links", "rhea")).json.links;
  assert.deepEqual(listed.map((l: any) => [l.id, l.active]), [[third.id, false], [second.id, false], [link.id, true]]);
  assert.ok(listed.find((l: any) => l.id === third.id).revokedAt);
  assert.equal((await call("DELETE", `/repos/rhea/basin/share-links/${third.id}`, "rhea")).status, 404, "already revoked");
});

test("guessing tokens is throttled", async () => {
  limits.clear("share-miss:local");
  let last = 0;
  for (let i = 0; i < 40; i++) last = (await anon(`/shared/bcn_share_${crypto.randomBytes(24).toString("base64url")}`)).status;
  assert.equal(last, 429);
  assert.equal((await anon(`/shared/${link.token}`)).status, 429, "while throttled, even a good link waits");
  limits.clear("share-miss:local");
  assert.equal((await anon(`/shared/${link.token}`)).status, 200);
});

test("a repository can have twenty active links, and deleting the repository removes them", async () => {
  limits.clear("share-miss:local");
  const before = (await call("GET", "/repos/rhea/basin/share-links", "rhea")).json.links.filter((l: any) => l.active).length;
  for (let i = before; i < 20; i++) assert.equal((await call("POST", "/repos/rhea/basin/share-links", "rhea", { expiresInDays: 1 })).status, 201);
  assert.match((await call("POST", "/repos/rhea/basin/share-links", "rhea", { expiresInDays: 1 })).json.error.message, /up to 20 active/);
  assert.equal((await call("DELETE", "/repos/rhea/basin", "rhea")).status, 204);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM share_links").get() as { n: number }).n, 0);
  assert.equal((await anon(`/shared/${link.token}`)).status, 404, "the link dies with the repository");
});
