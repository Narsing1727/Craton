// Model review: a checklist, modelling log and sign-off pinned to one commit, with the findings captured as evidence.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { HDF5_SAMPLES } from "./fixtures/hdf5-samples.ts";
import { TEMPLATE } from "../src/services/modelreview.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

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
async function upload(path: string, data: Buffer) {
  const form = new FormData();
  form.append("file", new File([new Uint8Array(data)], path.split("/").pop()!));
  form.append("paths", JSON.stringify([path]));
  form.append("branch", "main");
  return app.request("/v1/repos/alice/model/upload", { method: "POST", headers: { authorization: `Bearer ${tokens.alice}` }, body: form });
}
const R = "/repos/alice/model";

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol", "dave"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  ctx.db.prepare("UPDATE users SET email_verified_at = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = 'alice')").run(new Date().toISOString());
  assert.equal((await call("POST", "/repos", "alice", { name: "model", visibility: "private" })).status, 201);
  assert.equal((await call("PUT", `${R}/collaborators/bob`, "alice", { role: "Write" })).status, 201);
  assert.equal((await call("PUT", `${R}/collaborators/carol`, "alice", { role: "Read" })).status, 201);
  assert.equal((await upload("model/Chalakudy.p01.hdf", HDF5_SAMPLES.finished.bytes)).status, 201);
});

test("the template is served and every item has wording, a hint and a source", async () => {
  const t = await call("GET", "/model-review-template", null);
  assert.equal(t.status, 200);
  assert.equal(t.json.items.length, TEMPLATE.length);
  assert.ok(t.json.items.length >= 20);
  assert.ok(t.json.items.every((i: any) => i.key && i.group && i.text.length > 20 && i.hint && i.source));
  assert.equal(new Set(t.json.items.map((i: any) => i.key)).size, t.json.items.length, "keys are unique");
});

let n = 0;
test("a review pins the commit and its Merkle root and captures what the software can see", async () => {
  const made = await call("POST", `${R}/model-reviews`, "alice", { title: "Chalakudy 2D, 100-year event" });
  assert.equal(made.status, 201, made.text);
  n = made.json.number;
  assert.equal(n, 1);
  assert.equal(made.json.status, "draft");
  assert.equal(made.json.items.length, TEMPLATE.length);
  assert.ok(made.json.items.every((i: any) => i.status === "todo"));
  // Pinned to exactly the head of main and its Merkle root.
  const commits = (await call("GET", `${R}/commits`, "alice")).json as { sha?: string; id?: string; merkleRoot?: string }[];
  const head = commits[0].sha ?? commits[0].id;
  assert.equal(made.json.commit, head);
  assert.match(made.json.merkleRoot, /^[0-9a-f]{64}$/);
  // Evidence: the gate's run, and the plan's own account of its run.
  assert.equal(made.json.evidence.runs.length, 1);
  assert.equal(made.json.evidence.runs[0].solution, "Unsteady Finished Successfully");
  assert.equal(made.json.evidence.checks.status, "passed");
  const stable = made.json.items.find((i: any) => i.key === "run.stable");
  assert.equal(stable.suggestion.status, "pass", "a suggestion, not a decision");
  assert.equal(stable.status, "todo", "the item itself is still the person's to mark");
  assert.ok(made.json.log[0].body.includes("Review opened"));
});

test("a title is required, and an unknown ref is refused", async () => {
  assert.equal((await call("POST", `${R}/model-reviews`, "alice", { title: "  " })).status, 400);
  assert.equal((await call("POST", `${R}/model-reviews`, "alice", { title: "x", ref: "no-such-branch" })).status, 404);
});

test("items are marked, notes kept, and the log only ever grows", async () => {
  const marked = await call("PUT", `${R}/model-reviews/${n}/items/run.stable`, "alice", { status: "pass", note: "Plan 01 finished; no warnings." });
  assert.equal(marked.status, 200);
  const item = marked.json.items.find((i: any) => i.key === "run.stable");
  assert.deepEqual([item.status, item.note, item.updatedBy], ["pass", "Plan 01 finished; no warnings.", "alice"]);
  assert.equal(marked.json.counts.pass, 1);
  assert.equal((await call("PUT", `${R}/model-reviews/${n}/items/not.an.item`, "alice", { status: "pass" })).status, 404);
  assert.equal((await call("PUT", `${R}/model-reviews/${n}/items/run.stable`, "alice", { status: "great" })).status, 400);
  const logged = await call("POST", `${R}/model-reviews/${n}/log`, "alice", { body: "Mesh refined to 10 m near the levee; Manning's n from the land-cover table." });
  assert.equal(logged.status, 201);
  assert.equal(logged.json.log.length, 2);
  assert.equal((await call("POST", `${R}/model-reviews/${n}/log`, "alice", { body: " " })).status, 400);
});

test("permissions: a reader can see it but not change it; a stranger cannot tell it exists", async () => {
  assert.equal((await call("GET", `${R}/model-reviews/${n}`, "carol")).status, 200);
  assert.equal((await call("PUT", `${R}/model-reviews/${n}/items/run.mass`, "carol", { status: "pass" })).status, 403);
  assert.equal((await call("POST", `${R}/model-reviews/${n}/log`, "carol", { body: "hello" })).status, 403);
  assert.equal((await call("GET", `${R}/model-reviews`, "dave")).status, 404);
  assert.equal((await call("GET", `${R}/model-reviews`, null)).status, 404);
});

test("approval needs every item decided and every failure explained; the decision is recorded and the review locks", async () => {
  assert.equal((await call("POST", `${R}/model-reviews/${n}/decision`, "bob", { decision: "approve" })).status, 409, "not submitted yet");
  assert.equal((await call("POST", `${R}/model-reviews/${n}/submit`, "alice")).status, 200);
  assert.equal((await call("POST", `${R}/model-reviews/${n}/submit`, "alice")).status, 409, "already in review");
  const todo = await call("POST", `${R}/model-reviews/${n}/decision`, "bob", { decision: "approve" });
  assert.equal(todo.status, 409);
  assert.equal(todo.json.error.code, "incomplete");

  // Mark everything: one failure without a note first.
  for (const t of TEMPLATE) {
    const status = t.key === "mesh.quality" ? "fail" : "pass";
    assert.equal((await call("PUT", `${R}/model-reviews/${n}/items/${t.key}`, "bob", { status, note: status === "fail" ? "" : "ok" })).status, 200);
  }
  const bare = await call("POST", `${R}/model-reviews/${n}/decision`, "bob", { decision: "approve" });
  assert.equal(bare.status, 409);
  assert.equal(bare.json.error.code, "unexplained");
  await call("PUT", `${R}/model-reviews/${n}/items/mesh.quality`, "bob", { status: "fail", note: "Two sliver cells at the weir; accepted, outside the area of interest." });

  const noComment = await call("POST", `${R}/model-reviews/${n}/decision`, "bob", { decision: "request_changes" });
  assert.equal(noComment.status, 400, "asking for changes needs a reason");

  const approved = await call("POST", `${R}/model-reviews/${n}/decision`, "bob", { decision: "approve", comment: "Reviewed against the TUFLOW checklist." });
  assert.equal(approved.status, 200, approved.text);
  assert.equal(approved.json.status, "approved");
  assert.deepEqual([approved.json.signoffs[0].user, approved.json.signoffs[0].independent], ["bob", true]);
  assert.equal(approved.json.signoffs[0].commit, approved.json.commit, "the sign-off names the commit it covers");

  // Locked, but the log stays open and the record is not deletable.
  assert.equal((await call("PUT", `${R}/model-reviews/${n}/items/run.mass`, "alice", { status: "fail", note: "changed my mind" })).status, 409);
  assert.equal((await call("POST", `${R}/model-reviews/${n}/log`, "alice", { body: "Added after approval: survey benchmark confirmed." })).status, 201);
  assert.equal((await call("POST", `${R}/model-reviews/${n}/evidence`, "alice", {})).status, 409);
  assert.equal((await call("DELETE", `${R}/model-reviews/${n}`, "alice")).status, 403);
});

test("the export is a document that names the commit, the Merkle root, the evidence, the checklist and the sign-off", async () => {
  const res = await app.request(`/v1${R}/model-reviews/${n}/export?download=1`, { headers: { authorization: `Bearer ${tokens.carol}` } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type") ?? "", /markdown/);
  assert.match(res.headers.get("content-disposition") ?? "", /model-review-1\.md/);
  const md = await res.text();
  const review = (await call("GET", `${R}/model-reviews/${n}`, "alice")).json;
  assert.ok(md.includes(`# Model review 1: Chalakudy 2D, 100-year event`));
  assert.ok(md.includes(review.merkleRoot) && md.includes(review.commit));
  assert.ok(md.includes("Approved by @bob"));
  assert.ok(md.includes("independent review"));
  assert.ok(md.includes("### Run and results") && md.includes("| PASS |") && md.includes("| FAIL |"));
  assert.ok(md.includes("Unsteady Finished Successfully"), "the plan's own run status is in the document");
  assert.ok(md.includes("Added after approval"), "the log is complete");
});

test("a re-pin follows the branch, shows an unstable run as a failing suggestion, and the author's own approval is flagged", async () => {
  // Reopen, push a plan that went unstable, refresh the evidence.
  assert.equal((await call("POST", `${R}/model-reviews/${n}/reopen`, "bob", { reason: " " })).status, 400);
  const open = await call("POST", `${R}/model-reviews/${n}/reopen`, "bob", { reason: "New plan added after calibration." });
  assert.equal(open.status, 200);
  assert.equal(open.json.status, "draft");
  assert.equal((await upload("model/Chalakudy.p02.hdf", HDF5_SAMPLES.unstable.bytes)).status, 201);
  const refreshed = await call("POST", `${R}/model-reviews/${n}/evidence`, "alice", {});
  assert.equal(refreshed.status, 200);
  assert.equal(refreshed.json.evidence.runs.length, 2);
  const stable = refreshed.json.items.find((i: any) => i.key === "run.stable");
  assert.equal(stable.suggestion.status, "fail");
  assert.match(stable.suggestion.detail, /Chalakudy\.p02\.hdf: Unsteady Went Unstable/);
  assert.equal(refreshed.json.evidence.checks.status, "failed", "the gate fails the unstable plan too");
  assert.ok(refreshed.json.log.some((l: any) => /re-pinned/.test(l.body)));

  // The author approving their own review is allowed but is not called independent.
  await call("PUT", `${R}/model-reviews/${n}/items/run.stable`, "alice", { status: "fail", note: "Plan 02 is a failed experiment kept for the record." });
  assert.equal((await call("POST", `${R}/model-reviews/${n}/submit`, "alice")).status, 200);
  const self = await call("POST", `${R}/model-reviews/${n}/decision`, "alice", { decision: "approve" });
  assert.equal(self.status, 200, self.text);
  const last = self.json.signoffs[self.json.signoffs.length - 1];
  assert.deepEqual([last.user, last.independent], ["alice", false]);
  const md = (await call("GET", `${R}/model-reviews/${n}/export`, "alice")).text;
  assert.ok(md.includes("NOT independent"));
});

test("the list shows counts and the last decision; a review that is not approved can be deleted by an admin", async () => {
  const list = await call("GET", `${R}/model-reviews`, "carol");
  assert.equal(list.json.length, 1);
  assert.equal(list.json[0].status, "approved");
  assert.equal(list.json[0].counts.todo, 0);
  assert.equal(list.json[0].lastDecision.by, "alice");
  const second = await call("POST", `${R}/model-reviews`, "alice", { title: "Scratch review" });
  assert.equal(second.json.number, 2);
  assert.equal((await call("DELETE", `${R}/model-reviews/2`, "bob")).status, 403, "deleting needs admin");
  assert.equal((await call("DELETE", `${R}/model-reviews/2`, "alice")).status, 204);
  assert.equal((await call("GET", `${R}/model-reviews/2`, "alice")).status, 404);
});
