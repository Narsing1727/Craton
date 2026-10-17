// The integrity step reads a file back only when it changed since the parent commit; the rest is carried over from the
// parent's passed check, and says so.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";

let app: ReturnType<typeof createApp>;
let token = "";
const call = (method: string, p: string, body?: unknown) =>
  app.request(`/v1${p}`, { method, headers: { authorization: `Bearer ${token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
async function put(files: Record<string, string>) {
  const form = new FormData();
  const paths: string[] = [];
  for (const [name, text] of Object.entries(files)) {
    form.append("file", new File([text], name.split("/").pop()!));
    paths.push(name);
  }
  form.append("paths", JSON.stringify(paths));
  form.append("branch", "main");
  return app.request("/v1/repos/rhea/notes/upload", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
}
const integrity = async () => {
  const runs = (await (await call("GET", "/repos/rhea/notes/checks")).json()) as { steps: { name: string; status: string; detail: string }[] }[];
  return runs[0].steps.find((s) => s.name === "Chunk integrity")!;
};

before(async () => {
  app = createApp({ db: openDb(":memory:"), store: new MemoryStore() });
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  assert.equal((await call("POST", "/repos", { name: "notes", visibility: "private" })).status, 201);
});

test("the first commit is read back in full, later commits read back only what changed", async () => {
  const files: Record<string, string> = {};
  for (let i = 0; i < 12; i++) files[`logs/day-${i}.txt`] = `readings for day ${i}\n`.repeat(20);
  assert.equal((await put(files)).status, 201);
  let s = await integrity();
  assert.equal(s.status, "passed");
  assert.match(s.detail, /^12 files verified against their SHA-256/);
  assert.ok(!/unchanged since/.test(s.detail), "nothing to carry over on the first commit");

  assert.equal((await put({ "logs/day-3.txt": "corrected readings\n".repeat(10), "logs/day-new.txt": "a new day\n" })).status, 201);
  s = await integrity();
  assert.equal(s.status, "passed");
  assert.match(s.detail, /^13 files verified .*: 2 read back now, 11 unchanged since the previous commit, which passed\.$/);
});

test("a change to one file is still read back and checked against its hash", async () => {
  // Corrupt the stored bytes of the chunk of a file that the next push changes: the new version has its own chunks, so
  // it passes; the point is that the changed file is always read, never carried over.
  assert.equal((await put({ "logs/day-5.txt": "re-surveyed\n".repeat(30) })).status, 201);
  const s = await integrity();
  assert.match(s.detail, /1 read back now, 12 unchanged/);
});
