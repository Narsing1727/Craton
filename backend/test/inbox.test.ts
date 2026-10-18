// The inbox: what concerns a person and why, and their read / unread / done marks kept on the server.

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
const people = ["alice", "bob", "carol", "dave", "eve", "frank"] as const;

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

type Item = { key: string; actor: string; type: string; text: string; detail: string; read: boolean; done: boolean; reason: string; href: string };
const inbox = async (who: string, view = "inbox") => (await call("GET", `/user/inbox?view=${view}`, who)).json as { items: Item[]; unread: number };
const keysOf = (r: { items: Item[] }) => r.items.map((i) => `${i.actor}:${i.type}:${i.reason}`).sort();
const repoOf = () => getRepoFor(ctx, "alice", "basin", (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'alice'").get() as { id: number }).id);

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of people) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "private" })).status, 201);
  const repo = repoOf();
  const grant = ctx.db.prepare("INSERT INTO collaborators (repo_id, user_id, role) VALUES (?, (SELECT id FROM owners WHERE handle = ?), ?)");
  grant.run(repo.id, "bob", "Write");
  for (const u of ["carol", "dave", "eve"]) grant.run(repo.id, u, "Read");
  // Everyone opens their inbox once now, so their "first look" baseline is set before the activity below.
  for (const u of people) await inbox(u);
});

test("work by others in a repository you can write to arrives; your own work and a stranger's view do not", async () => {
  await commitFiles(ctx, repoOf(), { branch: "main", author: "alice", message: "Initial model", timestamp: new Date(), changes: { "a.txt": Buffer.from("a") } });
  assert.deepEqual(keysOf(await inbox("bob")), ["alice:commit:activity"], "a writer sees the push");
  assert.deepEqual(keysOf(await inbox("alice")), [], "your own push never appears");
  assert.deepEqual(keysOf(await inbox("carol")), [], "a reader isn't told about every push");
  assert.deepEqual(keysOf(await inbox("frank")), [], "a stranger sees nothing of a private repository");
  const item = (await inbox("bob")).items[0];
  assert.equal(item.read, false);
  assert.equal(item.detail, "Initial model");
  assert.match(item.key, /^[0-9a-f]{16}$/);
});

test("a reply on something you opened reaches you even in a repository you only read", async () => {
  const issue = await call("POST", "/repos/alice/basin/issues", "carol", { title: "Datum mismatch", body: "Tile 7 sits 0.3 m high.", label: "data-quality" });
  assert.equal(issue.status, 201, issue.text);
  const n = issue.json.number;
  assert.deepEqual(keysOf(await inbox("alice")), ["carol:issue:activity"], "the owner is told about the new issue");
  assert.deepEqual(keysOf(await inbox("carol")), [], "not about her own");

  assert.equal((await call("POST", `/repos/alice/basin/issues/${n}/comments`, "dave", { body: "I see it too." })).status, 201);
  const carol = await inbox("carol");
  assert.deepEqual(keysOf(carol), ["dave:comment:reply"], "carol, who opened it, hears the reply");
  assert.ok((await inbox("alice")).items.some((i) => i.actor === "dave" && i.reason === "activity"));
  assert.deepEqual(keysOf(await inbox("dave")), [], "dave doesn't hear himself");
  assert.deepEqual(keysOf(await inbox("eve")), [], "eve has no stake in it");
});

test("a mention reaches the person named, wherever they can see, and takes priority over other reasons", async () => {
  const n = (await call("GET", "/repos/alice/basin/issues", "alice")).json[0].number;
  await call("POST", `/repos/alice/basin/issues/${n}/comments`, "eve", { body: "cc @dave and @carol, can you check the datum?" });
  const dave = await inbox("dave");
  assert.deepEqual(keysOf(dave), ["eve:comment:mention"], "dave only reads the repository and has no thread of his own, but was named");
  const carol = await inbox("carol");
  assert.ok(carol.items.some((i) => i.actor === "eve" && i.reason === "mention"), "carol is named, which outranks 'reply'");
  assert.equal(carol.items.filter((i) => i.actor === "eve").length, 1, "one item, not one per reason");
});

test("only a real @handle counts: not a longer name, an email address or part of a word", async () => {
  const n = (await call("GET", "/repos/alice/basin/issues", "alice")).json[0].number;
  const before = (await inbox("dave")).items.length;
  for (const body of ["ping @dave2 about it", "mail dave@example.org", "talk to @davey", "see @dave-lab"]) {
    await call("POST", `/repos/alice/basin/issues/${n}/comments`, "eve", { body });
  }
  assert.equal((await inbox("dave")).items.length, before, "none of those name dave");
  await call("POST", `/repos/alice/basin/issues/${n}/comments`, "eve", { body: "thanks (@dave)!" });
  await call("POST", `/repos/alice/basin/issues/${n}/comments`, "eve", { body: "@Dave look" });
  assert.equal((await inbox("dave")).items.length, before + 2, "in brackets, and in any case, he is named");
});

test("read, unread and done are the account's own marks, and each is reversible", async () => {
  const start = await inbox("bob");
  const total = start.items.length;
  assert.ok(total >= 3 && start.unread === total);
  const [first, second] = start.items;

  const afterRead = (await call("POST", "/user/inbox/read", "bob", { keys: [first.key] })).json;
  assert.equal(afterRead.unread, total - 1, "the reply carries the new count");
  assert.equal((await inbox("bob")).items.find((i) => i.key === first.key)!.read, true);

  assert.equal((await call("POST", "/user/inbox/unread", "bob", { keys: [first.key] })).json.unread, total, "and it can be put back");

  const afterDone = (await call("POST", "/user/inbox/done", "bob", { keys: [second.key] })).json;
  assert.equal(afterDone.unread, total - 1);
  assert.ok(!(await inbox("bob")).items.some((i) => i.key === second.key), "done leaves the inbox");
  assert.deepEqual((await inbox("bob", "done")).items.map((i) => i.key), [second.key], "and is kept in the done view");
  assert.equal((await inbox("bob", "all")).items.length, total, "'all' has both");

  const restored = (await call("POST", "/user/inbox/restore", "bob", { keys: [second.key] })).json;
  assert.equal(restored.unread, total - 1, "undoing a 'done' brings it back as read: you had seen it");
  assert.equal((await inbox("bob")).items.find((i) => i.key === second.key)!.read, true);
});

test("marks belong to one account: bob reading things changes nothing for alice", async () => {
  const bob = await inbox("bob");
  const alice = await inbox("alice");
  assert.ok(alice.unread > 0);
  await call("POST", "/user/inbox/read", "bob", { keys: bob.items.map((i) => i.key) });
  assert.equal((await inbox("alice")).unread, alice.unread);
  // The same event has the same key for both of them, so a mark can only be theirs by account, not by key.
  const shared = bob.items.find((i) => alice.items.some((a) => a.key === i.key));
  assert.ok(shared, "there is an event both can see");
  assert.equal((await inbox("alice")).items.find((i) => i.key === shared!.key)!.read, false);
});

test("mark all as read is one write, clears explicit marks, and leaves done items done", async () => {
  const dave = await inbox("dave");
  assert.ok(dave.unread > 0);
  const doneKey = dave.items[0].key;
  await call("POST", "/user/inbox/done", "dave", { keys: [doneKey] });
  await call("POST", "/user/inbox/unread", "dave", { keys: [dave.items[1].key] });
  const res = await call("POST", "/user/inbox/read-all", "dave");
  assert.equal(res.json.unread, 0);
  const after = await inbox("dave");
  assert.ok(after.items.every((i) => i.read), "everything is read, including the one marked unread by hand");
  assert.ok(!after.items.some((i) => i.key === doneKey), "the done item stayed done");
  assert.equal((await call("GET", "/user/inbox/count", "dave")).json.unread, 0);
  // Something new after that is unread again.
  const n = (await call("GET", "/repos/alice/basin/issues", "alice")).json[0].number;
  await new Promise((r) => setTimeout(r, 5));
  await call("POST", `/repos/alice/basin/issues/${n}/comments`, "eve", { body: "@dave one more thing" });
  assert.equal((await call("GET", "/user/inbox/count", "dave")).json.unread, 1);
});

test("the first look is a week back at most, and never earlier than the account", async () => {
  const [row] = ctx.db.prepare("SELECT inbox_read_before AS b, (SELECT created_at FROM owners WHERE id = owner_id) AS joined FROM users WHERE owner_id = (SELECT id FROM owners WHERE handle = 'frank')").all() as { b: string; joined: string }[];
  assert.equal(row.b, row.joined, "a new account's baseline is when it joined");
  // An old account: only the last week counts, even though it is older.
  ctx.db.prepare("UPDATE owners SET created_at = ? WHERE handle = 'frank'").run(new Date(Date.now() - 90 * 86_400_000).toISOString());
  ctx.db.prepare("UPDATE users SET inbox_read_before = NULL WHERE owner_id = (SELECT id FROM owners WHERE handle = 'frank')").run();
  await inbox("frank");
  const b = (ctx.db.prepare("SELECT inbox_read_before AS b FROM users WHERE owner_id = (SELECT id FROM owners WHERE handle = 'frank')").get() as { b: string }).b;
  const age = Date.now() - new Date(b).getTime();
  assert.ok(age > 6.9 * 86_400_000 && age < 7.1 * 86_400_000, `baseline is about a week ago (${(age / 86_400_000).toFixed(2)} days)`);
});

test("an item older than the baseline starts read", async () => {
  // Move bob's baseline into the future: everything so far is 'before' it.
  ctx.db.prepare("UPDATE users SET inbox_read_before = ? WHERE owner_id = (SELECT id FROM owners WHERE handle = 'bob')").run(new Date(Date.now() + 60_000).toISOString());
  ctx.db.prepare("DELETE FROM inbox_state WHERE user_id = (SELECT id FROM owners WHERE handle = 'bob')").run();
  const bob = await inbox("bob");
  assert.ok(bob.items.length > 0 && bob.unread === 0);
  await call("POST", "/user/inbox/unread", "bob", { keys: [bob.items[0].key] });
  assert.equal((await inbox("bob")).unread, 1, "an explicit unread beats the baseline");
});

test("bad input is refused with a reason, and you must be signed in", async () => {
  for (const body of [{}, { keys: [] }, { keys: ["nope"] }, { keys: "abc" }, { keys: ["0123456789abcdef", "zzzz"] }]) assert.equal((await call("POST", "/user/inbox/read", "bob", body)).status, 400, JSON.stringify(body));
  assert.equal((await call("POST", "/user/inbox/read", "bob", { keys: Array.from({ length: 201 }, (_, i) => i.toString(16).padStart(16, "0")) })).status, 400, "more than 200 at a time");
  assert.match((await call("POST", "/user/inbox/done", "bob", { keys: ["nope"] })).json.error.message, /isn’t an inbox item/);
  assert.equal((await call("GET", "/user/inbox", null)).status, 401);
  assert.equal((await call("GET", "/user/inbox/count", null)).status, 401);
  assert.equal((await call("POST", "/user/inbox/read-all", null)).status, 401);
});

test("a mark on a key that matches nothing is harmless", async () => {
  const before = (await inbox("carol")).unread;
  assert.equal((await call("POST", "/user/inbox/read", "carol", { keys: ["0123456789abcdef"] })).status, 200);
  assert.equal((await inbox("carol")).unread, before);
});

test("deleting a repository takes its history with it, so a new one that reuses the id starts clean", async () => {
  assert.equal((await call("POST", "/repos", "eve", { name: "scratch", visibility: "private" })).status, 201);
  const eveId = (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'eve'").get() as { id: number }).id;
  const old = getRepoFor(ctx, "eve", "scratch", eveId);
  await commitFiles(ctx, old, { branch: "main", author: "eve", message: "secret survey", timestamp: new Date(), changes: { "s.txt": Buffer.from("s") } });
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM ref_log WHERE repo_id = ?").get(old.id) as { n: number }).n, 1);
  assert.equal((await call("DELETE", "/repos/eve/scratch", "eve", {})).status, 204);
  assert.equal((ctx.db.prepare("SELECT COUNT(*) AS n FROM ref_log WHERE repo_id = ?").get(old.id) as { n: number }).n, 0, "no orphaned history");
  assert.equal((await call("POST", "/repos", "frank", { name: "fresh", visibility: "private" })).status, 201);
  const feed = (await call("GET", "/repos/frank/fresh/activity", "frank")).json as { detail: string }[];
  assert.ok(!feed.some((e) => e.detail === "secret survey"), "a new repository never shows another's history");
});

test("a lock held for more than a week reminds its holder, and the reminder goes when the lock is released", async () => {
  assert.equal((await call("POST", "/repos/alice/basin/locks", "bob", { path: "model/plan.p01", reason: "recalibrating" })).status, 201);
  const before = await inbox("bob");
  assert.ok(!before.items.some((i) => i.type === "lock"), "a fresh lock needs no reminder");
  ctx.db.prepare("UPDATE file_locks SET created_at = ? WHERE path = 'model/plan.p01'").run(new Date(Date.now() - 9 * 86_400_000).toISOString());
  const stale = await inbox("bob");
  const reminder = stale.items.find((i) => i.type === "lock");
  assert.ok(reminder, "the old lock now shows up");
  assert.equal(reminder!.reason, "lock");
  assert.match(reminder!.text, /model\/plan\.p01 has been locked by you for 9 days/);
  assert.equal(reminder!.href, "/alice/basin/blob/model/plan.p01");
  assert.match(reminder!.key, /^[0-9a-f]{16}$/);
  // Other people with access are not reminded of someone else's lock.
  assert.ok(!(await inbox("alice")).items.some((i) => i.type === "lock"));
  // Marking it done works like any item, and releasing the lock removes it altogether.
  assert.equal((await call("POST", "/user/inbox/done", "bob", { keys: [reminder!.key] })).status, 200);
  assert.ok(!(await inbox("bob")).items.some((i) => i.type === "lock"));
  assert.ok((await inbox("bob", "done")).items.some((i) => i.type === "lock"));
  assert.equal((await call("DELETE", "/repos/alice/basin/locks/model%2Fplan.p01", "bob")).status, 204);
  assert.ok(!(await inbox("bob", "done")).items.some((i) => i.type === "lock"));
});
