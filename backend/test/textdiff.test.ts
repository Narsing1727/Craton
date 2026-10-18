// Line diffs: correct (applying the script to the old text gives the new text), minimal on small inputs, and wired
// through the API with sensible refusals.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { getRepoFor } from "../src/services/repos.ts";
import { commitFiles } from "../src/dev/push.ts";
import { diffLines, linesOf } from "../src/services/textdiff.ts";

/** Rebuild the new text from the old text and the hunks, to prove the diff says everything that changed. */
function apply(oldLines: string[], hunks: ReturnType<typeof diffLines>["hunks"]) {
  const out: string[] = [];
  let at = 0;
  for (const h of hunks) {
    while (at < h.oldStart - 1) out.push(oldLines[at++]);
    for (const l of h.lines) {
      if (l.t === " ") {
        assert.equal(oldLines[at], l.text, "context lines match the old text");
        out.push(l.text);
        at++;
      } else if (l.t === "-") {
        assert.equal(oldLines[at], l.text, "removed lines match the old text");
        at++;
      } else out.push(l.text);
    }
  }
  while (at < oldLines.length) out.push(oldLines[at++]);
  return out;
}

/** Length of the longest common subsequence, to check the script is a shortest one. */
function lcs(a: string[], b: string[]) {
  const t = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) t[i][j] = a[i - 1] === b[j - 1] ? t[i - 1][j - 1] + 1 : Math.max(t[i - 1][j], t[i][j - 1]);
  return t[a.length][b.length];
}

test("the script rebuilds the new text and is as short as it can be, on random small inputs", () => {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const alphabet = ["a", "b", "c", "d", "e"];
  for (let round = 0; round < 300; round++) {
    const a = Array.from({ length: Math.floor(rnd() * 14) }, () => alphabet[Math.floor(rnd() * alphabet.length)]);
    const b = Array.from({ length: Math.floor(rnd() * 14) }, () => alphabet[Math.floor(rnd() * alphabet.length)]);
    const d = diffLines(a, b);
    assert.deepEqual(apply(a, d.hunks), b, `round ${round}: ${a.join("")} -> ${b.join("")}`);
    assert.equal(d.added + d.removed, a.length + b.length - 2 * lcs(a, b), `round ${round}: shortest edit script`);
    assert.equal(d.replaced, false);
  }
});

test("hunks carry three lines of context and neighbouring changes share a hunk", () => {
  const old = Array.from({ length: 40 }, (_, i) => `line ${i + 1}`);
  const next = [...old];
  next[4] = "line 5 changed";
  next[8] = "line 9 changed";
  next[30] = "line 31 changed";
  const d = diffLines(old, next);
  assert.equal(d.hunks.length, 2, "lines 5 and 9 are within six lines of each other");
  assert.equal(d.hunks[0].oldStart, 2);
  assert.equal(d.hunks[0].lines[0].text, "line 2");
  assert.equal(d.added, 3);
  assert.equal(d.removed, 3);
  assert.deepEqual(apply(old, d.hunks), next);
});

test("text is recognised by content: NUL bytes and invalid UTF-8 are not text, line endings are normalised", () => {
  assert.equal(linesOf(Buffer.from([0x41, 0x00, 0x42])), null);
  assert.equal(linesOf(Buffer.from([0xff, 0xfe, 0x41])), null);
  assert.deepEqual(linesOf(Buffer.from("a\r\nb\n")), ["a", "b"]);
  assert.deepEqual(linesOf(Buffer.from("")), []);
});

let app: ReturnType<typeof createApp>;
let token = "";
before(async () => {
  const ctx: Ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "rhea", email: "rhea@example.org", password: "a-very-long-password" }) });
  token = ((await res.json()) as { token: string }).token;
  await app.request("/v1/repos", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ name: "basin", visibility: "private" }) });
  const owner = await ctx.db.get("SELECT id FROM owners WHERE handle = 'rhea'") as { id: number };
  const repo = await getRepoFor(ctx, "rhea", "basin", owner.id, "write");
  const plan1 = "Plan Title=Calibration\nGeom File=g01\nFlow File=u01\nProgram Version=6.4\nManning n=0.035\n";
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Initial", timestamp: new Date(Date.now() - 5000), changes: { "model/river.p01": Buffer.from(plan1), "terrain/dem.bin": Buffer.from([0, 1, 2, 3]) } });
  await commitFiles(ctx, repo, { branch: "main", author: "rhea", message: "Raise n", timestamp: new Date(), changes: { "model/river.p01": Buffer.from(plan1.replace("0.035", "0.042")), "terrain/dem.bin": Buffer.from([0, 1, 2, 4]) } });
});

const get = async (p: string) => {
  const res = await app.request(`/v1${p}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, json: (await res.json()) as any };
};

test("the API returns the changed line of a plan file, and refuses binaries and missing arguments", async () => {
  const commits = (await get("/repos/rhea/basin/commits")).json as { sha: string }[];
  const [newest, oldest] = [commits[0].sha, commits[1].sha];
  const r = await get(`/repos/rhea/basin/text-diff/${newest}/model/river.p01?base=${oldest}`);
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.added, 1);
  assert.equal(r.json.removed, 1);
  const changed = r.json.hunks[0].lines.filter((l: any) => l.t !== " ").map((l: any) => `${l.t}${l.text}`);
  assert.deepEqual(changed, ["-Manning n=0.035", "+Manning n=0.042"]);
  assert.equal((await get(`/repos/rhea/basin/text-diff/${newest}/terrain/dem.bin?base=${oldest}`)).json.error.code, "not_text");
  assert.equal((await get(`/repos/rhea/basin/text-diff/${newest}/model/river.p01`)).status, 400);
  assert.equal((await get(`/repos/rhea/basin/text-diff/${newest}/nope.txt?base=${oldest}`)).status, 404);
});
