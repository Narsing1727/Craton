// Issue and pull request templates read from the repository's default branch.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { parseTemplate } from "../src/services/templates.ts";

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
const repoOf = () => getRepoFor(ctx, "alice", "basin", (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'alice'").get() as { id: number }).id);
const put = (branch: string, files: Record<string, string>, from?: string) =>
  commitFiles(ctx, repoOf(), { branch, author: "alice", message: "templates", timestamp: new Date(), from, changes: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, Buffer.from(v)])) });

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
  assert.equal((await call("POST", "/repos", "alice", { name: "basin", visibility: "private" })).status, 201);
});

test("the header is read, whatever the line endings or quotes, and plain text is all body", () => {
  assert.deepEqual(parseTemplate("---\nname: Bug\nlabel: bug\n---\nSteps:\n"), { meta: { name: "Bug", label: "bug" }, body: "Steps:\n" });
  assert.deepEqual(parseTemplate('---\r\nname: "Data problem"\r\nabout: \'A file looks wrong\'\r\n---\r\nBody').meta, { name: "Data problem", about: "A file looks wrong" });
  assert.deepEqual(parseTemplate("Just text\n---\nnot a header"), { meta: {}, body: "Just text\n---\nnot a header" });
  assert.deepEqual(parseTemplate("﻿---\nname: BOM\n---\nx").meta, { name: "BOM" });
  assert.equal(parseTemplate("---\nname: Unclosed\nstill header").body, "---\nname: Unclosed\nstill header", "an unclosed header is just text");
});

test("an empty repository, and one with no templates, have none", async () => {
  assert.deepEqual((await call("GET", "/repos/alice/basin/templates", "alice")).json, { issues: [], pull: null });
  await put("main", { "README.md": "# Basin" });
  assert.deepEqual((await call("GET", "/repos/alice/basin/templates", "alice")).json, { issues: [], pull: null });
});

test("templates come from the default branch: name, about, label, body; sorted by file", async () => {
  await put("main", {
    ".craton-templates/issue/b-question.md": "Plain template with no header.\n",
    ".craton-templates/issue/a-data.md": "---\nname: Data problem\nabout: A file looks wrong\nlabel: data-quality\n---\nAffected file:\nCRS:\n",
    ".craton-templates/issue/c-odd.md": "---\nname: Odd\nlabel: not-a-label\n---\nx",
    ".craton-templates/issue/notes.txt": "not markdown",
    ".craton-templates/issue/sub/deep.md": "nested, ignored",
    ".craton-templates/pull_request.md": "---\nname: ignored\n---\n## What changed\n\n## Checks\n",
  });
  const res = await call("GET", "/repos/alice/basin/templates", "alice");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.issues, [
    { file: "a-data.md", name: "Data problem", about: "A file looks wrong", label: "data-quality", body: "Affected file:\nCRS:\n" },
    { file: "b-question.md", name: "b question", about: "", label: null, body: "Plain template with no header.\n" },
    { file: "c-odd.md", name: "Odd", about: "", label: null, body: "x" },
  ]);
  assert.equal(res.json.pull, "## What changed\n\n## Checks\n");
});

test("a template on another branch doesn't count until it is merged", async () => {
  await put("draft", { ".craton-templates/issue/z-new.md": "---\nname: Not yet\n---\nx" }, "main");
  const names = ((await call("GET", "/repos/alice/basin/templates", "alice")).json.issues as { name: string }[]).map((t) => t.name);
  assert.ok(!names.includes("Not yet"));
});

test("at most ten, and a huge one is cut off", async () => {
  const many: Record<string, string> = {};
  for (let i = 0; i < 14; i++) many[`.craton-templates/issue/t${String(i).padStart(2, "0")}.md`] = `---\nname: T${i}\n---\nbody`;
  many[".craton-templates/issue/t00.md"] = "---\nname: Big\n---\n" + "x".repeat(40_000);
  await put("main", many);
  const issues = (await call("GET", "/repos/alice/basin/templates", "alice")).json.issues as { name: string; body: string }[];
  assert.equal(issues.length, 10);
  assert.ok(issues.find((t) => t.name === "Big")!.body.length <= 16 * 1024);
});

test("a private repository's templates are not readable by a stranger", async () => {
  assert.equal((await call("GET", "/repos/alice/basin/templates", "bob")).status, 404);
  assert.equal((await call("GET", "/repos/alice/basin/templates", null)).status, 404);
});
