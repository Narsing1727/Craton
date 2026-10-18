// Dataset card (licence, topics) and file locks: what makes a shared dataset findable, and what
// stops two people from corrupting a file that can't be merged.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const ids: Record<string, number> = {};

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
  return { status: res.status, json, text };
}

const repoOf = (who: string) => getRepoFor(ctx, "rhea", "basin", ids[who]);
const bytes = (s: string) => Buffer.from(s.repeat(2000));

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "sol", "ines"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    ids[u] = (await ctx.db.get("SELECT id FROM owners WHERE handle = ?", u) as { id: number }).id;
  }
  const made = await call("POST", "/repos", "rhea", { name: "basin", visibility: "private" });
  assert.equal(made.status, 201, made.text);
  const repo = await repoOf("rhea");
  await ctx.db.run("INSERT INTO collaborators (repo_id, user_id, role) VALUES (?, ?, 'Write')", repo.id, ids.sol);
  await commitFiles(ctx, repo, {
    branch: "main",
    author: "rhea",
    message: "Initial",
    timestamp: new Date(),
    changes: { "model/plan.p01": bytes("a"), "terrain/dem.tif": bytes("b"), "README.md": bytes("c") },
  });
});

// ── Licence and topics ─────────────────────────────────────────────────────

test("a repository can declare a licence from the list and up to ten topics", async () => {
  const list = await call("GET", "/licenses", null);
  assert.equal(list.status, 200);
  assert.ok(list.json.some((l: { id: string }) => l.id === "CC-BY-4.0"));

  const before = await call("GET", "/repos/rhea/basin", "rhea");
  assert.equal(before.json.license, "");
  assert.deepEqual(before.json.topics, []);

  const res = await call("PATCH", "/repos/rhea/basin", "rhea", { license: "CC-BY-4.0", topics: ["Flood Modelling", "hec-ras", "flood-modelling", " kerala "] });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.license, "CC-BY-4.0");
  assert.deepEqual(res.json.topics, ["flood-modelling", "hec-ras", "kerala"], "lowercased, de-duplicated, spaces become dashes");
});

test("an unknown licence or a malformed topic list is refused with a reason", async () => {
  assert.equal((await call("PATCH", "/repos/rhea/basin", "rhea", { license: "MY-OWN-LICENCE" })).status, 400);
  assert.match((await call("PATCH", "/repos/rhea/basin", "rhea", { topics: ["ok", "has/slash"] })).json.error.message, /isn’t a valid topic/);
  const eleven = Array.from({ length: 11 }, (_, i) => `t${i}`);
  assert.match((await call("PATCH", "/repos/rhea/basin", "rhea", { topics: eleven })).json.error.message, /at most ten/);
  assert.equal((await call("GET", "/repos/rhea/basin", "rhea")).json.license, "CC-BY-4.0", "a refused change leaves the repository as it was");
  assert.equal((await call("PATCH", "/repos/rhea/basin", "rhea", { license: "" })).json.license, "", "the licence can be cleared");
  await call("PATCH", "/repos/rhea/basin", "rhea", { license: "CC-BY-4.0" });
});

test("topics filter the repository list, and only an admin can set the card", async () => {
  const hit = await call("GET", "/repos?topic=hec-ras", "rhea");
  assert.deepEqual(hit.json.map((r: { name: string }) => r.name), ["basin"]);
  assert.deepEqual((await call("GET", "/repos?topic=lidar", "rhea")).json, []);
  assert.equal((await call("PATCH", "/repos/rhea/basin", "sol", { license: "MIT" })).status, 403, "a writer is not an admin");
});

// ── File locks ─────────────────────────────────────────────────────────────

test("locking a file records who holds it, and a second lock on the same path is refused", async () => {
  const mine = await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "model/plan.p01", reason: "recalibrating Manning’s n" });
  assert.equal(mine.status, 201, mine.text);
  assert.equal(mine.json.holder, "rhea");
  assert.equal(mine.json.reason, "recalibrating Manning’s n");

  const again = await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "model/plan.p01" });
  assert.equal(again.status, 201, "locking what you already hold is a safe retry");

  const clash = await call("POST", "/repos/rhea/basin/locks", "sol", { path: "model/plan.p01" });
  assert.equal(clash.status, 409);
  assert.equal(clash.json.error.code, "locked");
  assert.match(clash.json.error.message, /locked by @rhea/);

  const all = await call("GET", "/repos/rhea/basin/locks", "sol");
  assert.deepEqual(all.json.map((l: { path: string; holder: string }) => [l.path, l.holder]), [["model/plan.p01", "rhea"]]);
});

test("paths must be plain relative file paths, and strangers cannot lock", async () => {
  for (const path of ["", "../etc/passwd", "a//b", "a/./b"]) {
    assert.equal((await call("POST", "/repos/rhea/basin/locks", "rhea", { path })).status, 400, `rejects "${path}"`);
  }
  assert.equal((await call("POST", "/repos/rhea/basin/locks", "ines", { path: "x.tif" })).status, 404, "a stranger can't even see the private repository");
  assert.equal((await call("POST", "/repos/rhea/basin/locks", null, { path: "x.tif" })).status, 404, "signed-out visitors get the same answer: the repository stays hidden");
});

test("a push that changes a file locked by someone else is refused, naming the holder; the holder can still push it", async () => {
  const repo = await repoOf("rhea");
  const attempt = commitFiles(ctx, repo, { branch: "main", author: "sol", message: "Tweak plan", timestamp: new Date(), changes: { "model/plan.p01": bytes("z") } });
  await assert.rejects(attempt, (err: any) => {
    assert.equal(err.status, 409);
    assert.equal(err.code, "locked");
    assert.match(err.message, /model\/plan\.p01 \(@rhea\)/);
    return true;
  });

  // An unrelated file is fine, and so is the holder's own change to the locked one.
  await commitFiles(ctx, repo, { branch: "main", author: "sol", message: "Update readme", timestamp: new Date(), changes: { "README.md": bytes("d") } });
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "New plan", timestamp: new Date(), changes: { "model/plan.p01": bytes("y") } });
});

test("deleting a locked file and branching around the lock are both caught", async () => {
  const repo = await repoOf("rhea");
  await assert.rejects(commitFiles(ctx, repo, { branch: "main", author: "sol", message: "Remove plan", timestamp: new Date(), changes: { "model/plan.p01": null } }), { code: "locked" });
  // A new branch that edits the locked file can't be pushed either: it is measured from where it forks off main.
  await assert.rejects(commitFiles(ctx, repo, { branch: "sneaky", from: "main", author: "sol", message: "Edit on a branch", timestamp: new Date(), changes: { "model/plan.p01": bytes("q") } }), { code: "locked" });
  // ...but a branch that leaves the locked file alone is fine.
  await commitFiles(ctx, repo, { branch: "polish", from: "main", author: "sol", message: "Docs", timestamp: new Date(), changes: { "README.md": bytes("e") } });
});

test("only the holder can release a lock; an admin can force it; then the push goes through", async () => {
  const notMine = await call("DELETE", "/repos/rhea/basin/locks/model%2Fplan.p01", "sol");
  assert.equal(notMine.status, 403);
  assert.match(notMine.json.error.message, /Only @rhea can release/);
  assert.equal((await call("DELETE", "/repos/rhea/basin/locks/model%2Fplan.p01?force=true", "sol")).status, 403, "force needs admin access");

  assert.equal((await call("DELETE", "/repos/rhea/basin/locks/model%2Fplan.p01?force=true", "rhea")).status, 204, "the owner can force");
  assert.equal((await call("DELETE", "/repos/rhea/basin/locks/model%2Fplan.p01", "rhea")).status, 404, "already released");
  await commitFiles(ctx, await repoOf("rhea"), { branch: "main", author: "sol", message: "Tweak plan", timestamp: new Date(), changes: { "model/plan.p01": bytes("w") } });
});

test("the holder releases their own lock", async () => {
  await call("POST", "/repos/rhea/basin/locks", "sol", { path: "terrain/dem.tif" });
  assert.equal((await call("DELETE", "/repos/rhea/basin/locks/terrain%2Fdem.tif", "sol")).status, 204);
  assert.deepEqual((await call("GET", "/repos/rhea/basin/locks", "sol")).json, []);
});

// ── Citation ───────────────────────────────────────────────────────────────

test("a repository with no CITATION.cff gets a citation built only from what it really has, and hints for the rest", async () => {
  await call("PATCH", "/repos/rhea/basin", "rhea", { description: "Calibrated HEC-RAS model for the Chalakudy basin", license: "CC-BY-4.0", topics: ["hec-ras", "kerala"] });
  const c = await call("GET", "/repos/rhea/basin/citation", "rhea");
  assert.equal(c.status, 200, c.text);
  assert.equal(c.json.source, "generated");
  assert.match(c.json.cff, /^cff-version: 1\.2\.0$/m);
  assert.match(c.json.cff, /^type: dataset$/m);
  assert.match(c.json.cff, /^title: "basin"$/m);
  assert.match(c.json.cff, /^license: CC-BY-4\.0$/m);
  assert.match(c.json.cff, /^  - "hec-ras"$/m);
  assert.doesNotMatch(c.json.cff, /doi:/, "no DOI is invented");
  assert.doesNotMatch(c.json.cff, /^version:/m, "no release yet, so no version");
  const year = new Date().getUTCFullYear();
  assert.ok(c.json.apa.startsWith(`rhea. (${year}). basin [Data set]. Craton. http`), c.json.apa);
  assert.match(c.json.bibtex, /^@misc\{rhea\d{4}basin,/);
  assert.match(c.json.bibtex, /author = \{rhea\}/);
  assert.ok(c.json.hints.some((h: string) => /No release yet/.test(h)));
  assert.ok(!c.json.hints.some((h: string) => /No licence/.test(h)), "the licence is set, so no nag about it");
});

test("a release adds a version and date to the citation", async () => {
  const made = await call("POST", "/repos/rhea/basin/releases", "rhea", { tag: "v1.0.0", title: "Calibrated", notes: "First calibrated model", target: "main" });
  assert.ok(made.status === 201 || made.status === 200, made.text);
  const c = await call("GET", "/repos/rhea/basin/citation", "rhea");
  assert.match(c.json.cff, /^version: "v1.0.0"$/m);
  assert.ok(c.json.apa.includes("basin (Version v1.0.0) [Data set]"), c.json.apa);
  assert.ok(!c.json.hints.some((h: string) => /No release yet/.test(h)));
});

test("a CITATION.cff in the repository is returned as written and its authors, version and DOI win", async () => {
  const cff = [
    "cff-version: 1.2.0",
    'message: "Please cite this dataset."',
    "title: Chalakudy basin HEC-RAS model",
    "authors:",
    "  - family-names: Menon",
    "    given-names: Priya",
    "  - name: Hydrolab Kerala",
    "version: 2.1.0",
    "date-released: 2026-08-14",
    'doi: "10.5281/zenodo.1234567"',
    "license: CC-BY-4.0",
  ].join("\n");
  await commitFiles(ctx, await repoOf("rhea"), { branch: "main", author: "rhea", message: "Add citation", timestamp: new Date(), changes: { "CITATION.cff": Buffer.from(`${cff}\n`) } });
  const c = await call("GET", "/repos/rhea/basin/citation", "rhea");
  assert.equal(c.json.source, "CITATION.cff");
  assert.equal(c.json.cff, `${cff}\n`, "returned exactly as the repository has it");
  assert.match(c.json.apa, /^Menon, P\., Hydrolab Kerala\. \(2026\)\. Chalakudy basin HEC-RAS model \(Version 2\.1\.0\) \[Data set\]\. Craton\. https:\/\/doi\.org\/10\.5281\/zenodo\.1234567$/);
  assert.match(c.json.bibtex, /doi = \{10\.5281\/zenodo\.1234567\}/);
  assert.match(c.json.bibtex, /author = \{Menon, P\. and Hydrolab Kerala\}/);
  assert.deepEqual(c.json.hints, [], "it has a DOI, so nothing to add");
});

test("a stranger cannot read a private repository's citation", async () => {
  assert.equal((await call("GET", "/repos/rhea/basin/citation", "ines")).status, 404);
});

// ── Restoring an earlier version of a file ─────────────────────────────────

test("restoring a file adds a new commit with the old bytes and keeps all history", async () => {
  const repo = await repoOf("rhea");
  const read = async (ref: string) => {
    const r = await app.request(`/v1/repos/rhea/basin/raw/${ref}/model/plan.p01`, { headers: { authorization: `Bearer ${tokens.rhea}` } });
    return Buffer.from(await r.arrayBuffer());
  };
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Plan v1", timestamp: new Date("2026-05-01T10:00:00Z"), changes: { "model/plan.p01": bytes("one") } });
  const v1 = (await call("GET", "/repos/rhea/basin/refs", "rhea")).json.branches.find((b: any) => b.name === "main").commit_id;
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Plan v2 (broken)", timestamp: new Date("2026-05-02T10:00:00Z"), changes: { "model/plan.p01": bytes("two") } });
  const v2 = (await call("GET", "/repos/rhea/basin/refs", "rhea")).json.branches.find((b: any) => b.name === "main").commit_id;
  const before = (await call("GET", "/repos/rhea/basin/commits?limit=100", "rhea")).json.length;

  const res = await call("POST", "/repos/rhea/basin/restore", "rhea", { path: "model/plan.p01", from: v1 });
  assert.equal(res.status, 201, res.text);
  assert.equal(res.json.before, v2);
  assert.ok((await read("main")).equals(bytes("one")), "main now has the v1 bytes");
  assert.ok((await read(v2)).equals(bytes("two")), "the broken version is still there in history");

  const commits = (await call("GET", "/repos/rhea/basin/commits?limit=100", "rhea")).json;
  assert.equal(commits.length, before + 1, "exactly one commit was added");
  assert.equal(commits[0].sha, res.json.commit);
  assert.deepEqual(commits[0].parents, [v2], "it sits on top of the previous tip");
  assert.match(commits[0].message, /^Restore model\/plan\.p01 to [0-9a-f]{7}$/);
  assert.equal(commits[0].author, "rhea");

  // And the restore can itself be undone.
  assert.equal((await call("POST", "/repos/rhea/basin/restore", "rhea", { path: "model/plan.p01", from: v2, message: "Bring back v2" })).status, 201);
  assert.ok((await read("main")).equals(bytes("two")));
});

test("restoring refuses when nothing would change, the version lacks the file, or the target isn't a branch", async () => {
  const tip = (await call("GET", "/repos/rhea/basin/refs", "rhea")).json.branches.find((b: any) => b.name === "main").commit_id;
  const same = await call("POST", "/repos/rhea/basin/restore", "rhea", { path: "model/plan.p01", from: tip });
  assert.equal(same.status, 409);
  assert.equal(same.json.error.code, "nothing_to_restore");
  assert.equal((await call("POST", "/repos/rhea/basin/restore", "rhea", { path: "model/missing.p99", from: tip })).status, 404);
  assert.equal((await call("POST", "/repos/rhea/basin/restore", "rhea", { path: "model/plan.p01", from: tip, branch: tip })).status, 400, "a commit id is not a branch");
  assert.equal((await call("POST", "/repos/rhea/basin/restore", "rhea", { path: "model/plan.p01" })).status, 400);
});

test("restoring respects locks held by others, write access and privacy", async () => {
  const first = (await call("GET", "/repos/rhea/basin/commits?limit=100", "rhea")).json.find((c: any) => c.message === "Initial").sha;
  await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "README.md", reason: "rewriting" });
  await commitFiles(ctx, await repoOf("rhea"), { branch: "main", author: "rhea", message: "Edit readme", timestamp: new Date(), changes: { "README.md": bytes("zz") } });
  const blocked = await call("POST", "/repos/rhea/basin/restore", "sol", { path: "README.md", from: first });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.json.error.code, "locked");
  await call("DELETE", "/repos/rhea/basin/locks/README.md", "rhea");
  assert.equal((await call("POST", "/repos/rhea/basin/restore", "sol", { path: "README.md", from: first })).status, 201, "once released, a writer can restore");
  assert.equal((await call("POST", "/repos/rhea/basin/restore", "ines", { path: "README.md", from: first })).status, 404, "a stranger can't see the repository");
  assert.equal((await call("POST", "/repos/rhea/basin/restore", null, { path: "README.md", from: first })).status, 404);
});

test("a lock reports how long it has been held and becomes stale after a week", async () => {
  const made = await call("POST", "/repos/rhea/basin/locks", "rhea", { path: "model/old.g01", reason: "geometry edit" });
  assert.equal(made.status, 201);
  assert.equal(made.json.ageDays, 0);
  assert.equal(made.json.stale, false);
  // Backdate it ten days, as if forgotten.
  const tenDays = new Date(Date.now() - 10 * 86_400_000).toISOString();
  await ctx.db.run("UPDATE file_locks SET created_at = ? WHERE path = 'model/old.g01'", tenDays);
  const list = await call("GET", "/repos/rhea/basin/locks", "sol");
  const old = (list.json as { path: string; ageDays: number; stale: boolean }[]).find((l) => l.path === "model/old.g01")!;
  assert.equal(old.ageDays, 10);
  assert.equal(old.stale, true);
  assert.equal((await call("DELETE", "/repos/rhea/basin/locks/model%2Fold.g01", "rhea")).status, 204);
});
