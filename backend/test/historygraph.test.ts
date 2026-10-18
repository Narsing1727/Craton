// Walking a history in one recursive statement must give what walking it a commit at a time did, including across merges.
//
//        X (unrelated root)
//   A ── B ── C ──┐
//         └── D ──┴── E ── F        (E merges C and D)

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import type { RepoRow } from "../src/services/repos.ts";
import { findRepo } from "../src/services/repos.ts";
import { ancestors, commitsBetween, countCommits, isAncestor, listCommits, mergeBase } from "../src/services/history.ts";

let ctx: Ctx;
let repo: RepoRow;
const id = (c: string) => c.toLowerCase().repeat(64).slice(0, 64).replace(/[^0-9a-f]/g, "a");
const [A, B, C, D, E, F, X] = ["a1", "b2", "c3", "d4", "e5", "f6", "ab"].map((c) => c.repeat(32));

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  const app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "ann", email: "ann@example.org", password: "a-very-long-password" }) });
  const token = ((await res.json()) as { token: string }).token;
  assert.equal((await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "graph", visibility: "private" }) })).status, 201);
  repo = await findRepo(ctx, "ann", "graph");
  const add = (commit: string, parents: string[], minute: number) =>
    ctx.db.run("INSERT INTO commits (repo_id, id, tree, parents, author, message, timestamp, merkle_root) VALUES (?, ?, ?, ?, 'ann', ?, ?, ?)", repo.id, commit, "t".repeat(64), JSON.stringify(parents), `commit ${commit.slice(0, 2)}`, `2026-01-01T00:${String(minute).padStart(2, "0")}:00.000Z`, "m".repeat(64));
  await add(X, [], 0);
  await add(A, [], 1);
  await add(B, [A], 2);
  await add(C, [B], 3);
  await add(D, [B], 4);
  await add(E, [C, D], 5);
  await add(F, [E], 6);
});

const short = (ids: Iterable<string>) => [...ids].map((i) => i.slice(0, 2));

test("ancestors: everything reachable, the commit itself included, merges followed on both sides", async () => {
  assert.deepEqual(short(await ancestors(ctx, repo, F)).sort(), ["a1", "b2", "c3", "d4", "e5", "f6"]);
  assert.deepEqual(short(await ancestors(ctx, repo, C)).sort(), ["a1", "b2", "c3"]);
  assert.deepEqual(short(await ancestors(ctx, repo, X)), ["ab"]);
  assert.deepEqual(short(await ancestors(ctx, repo, "9".repeat(64))), ["99"], "a commit we do not have is just itself");
});

test("isAncestor", async () => {
  assert.equal(await isAncestor(ctx, repo, B, F), true);
  assert.equal(await isAncestor(ctx, repo, D, F), true, "through the merge");
  assert.equal(await isAncestor(ctx, repo, F, F), true);
  assert.equal(await isAncestor(ctx, repo, D, C), false);
  assert.equal(await isAncestor(ctx, repo, F, B), false);
  assert.equal(await isAncestor(ctx, repo, X, F), false);
});

test("commitsBetween: what `to` has that `from` does not, newest first", async () => {
  assert.deepEqual(short(await commitsBetween(ctx, repo, C, F)), ["f6", "e5", "d4"]);
  assert.deepEqual(short(await commitsBetween(ctx, repo, null, D)), ["d4", "b2", "a1"]);
  assert.deepEqual(await commitsBetween(ctx, repo, F, F), []);
  assert.deepEqual(short(await commitsBetween(ctx, repo, D, C)), ["c3"]);
  assert.deepEqual(short(await commitsBetween(ctx, repo, B, F)), ["f6", "e5", "d4", "c3"]);
  assert.deepEqual(short(await commitsBetween(ctx, repo, X, B)), ["b2", "a1"]);
});

test("mergeBase: the nearest commit both reach", async () => {
  assert.equal(await mergeBase(ctx, repo, C, D), B);
  assert.equal(await mergeBase(ctx, repo, F, C), C);
  assert.equal(await mergeBase(ctx, repo, C, F), C);
  assert.equal(await mergeBase(ctx, repo, F, F), F);
  assert.equal(await mergeBase(ctx, repo, X, F), null);
});

test("listCommits and countCommits: reachable commits only, newest first, limited", async () => {
  assert.deepEqual(short((await listCommits(ctx, repo, F, 50)).map((c) => c.id)), ["f6", "e5", "d4", "c3", "b2", "a1"]);
  assert.deepEqual(short((await listCommits(ctx, repo, C, 50)).map((c) => c.id)), ["c3", "b2", "a1"], "the other side's commits are not in C's history");
  assert.deepEqual(short((await listCommits(ctx, repo, F, 2)).map((c) => c.id)), ["f6", "e5"]);
  assert.equal(await countCommits(ctx, repo, F), 6);
  assert.equal(await countCommits(ctx, repo, X), 1);
  assert.deepEqual((await listCommits(ctx, repo, F, 1))[0].message, "commit f6");
});

test("a long history is walked in one statement, not one per commit", async () => {
  // 1,500 commits in a line: the old walk made 1,500 round trips for each question.
  const rows: [string, string][] = [];
  let prev = "";
  for (let i = 0; i < 1500; i++) {
    const commit = i.toString(16).padStart(64, "0");
    rows.push([commit, prev]);
    prev = commit;
  }
  await ctx.db.tx(async (db) => {
    for (const [commit, parent] of rows) {
      await db.run("INSERT INTO commits (repo_id, id, tree, parents, author, message, timestamp, merkle_root) VALUES (?, ?, ?, ?, 'ann', 'c', ?, ?)", repo.id, commit, "t".repeat(64), JSON.stringify(parent ? [parent] : []), `2026-02-01T00:00:00.${String(rows.findIndex((r) => r[0] === commit)).padStart(4, "0")}Z`, "m".repeat(64));
    }
  });
  const tip = rows[rows.length - 1][0];
  assert.equal(await countCommits(ctx, repo, tip), 1500);
  assert.equal(await isAncestor(ctx, repo, rows[0][0], tip), true);
  assert.equal((await commitsBetween(ctx, repo, rows[1000][0], tip)).length, 499);
  assert.equal(await mergeBase(ctx, repo, rows[10][0], tip), rows[10][0]);
});
