// What a person says about themselves, and their profile picture: the fields are checked, the picture is judged by its bytes
// (never by what the client called it), anyone can fetch it, and it can be taken down.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");

async function call(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { ...headers };
  if (who) h.authorization = `Bearer ${tokens[who]}`;
  const raw = body instanceof Buffer;
  if (body !== undefined && !raw && !h["content-type"]) h["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers: h, body: body === undefined ? undefined : raw ? new Uint8Array(body) : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null;
  try {
    json = JSON.parse(buf.toString());
  } catch {}
  return { status: res.status, json, buf, headers: res.headers };
}

before(async () => {
  app = createApp({ db: openDb(":memory:"), store: new MemoryStore() } as Ctx);
  for (const u of ["alice", "bob"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
});

test("website, location, company and pronouns are saved, shown publicly, and checked", async () => {
  const saved = (await call("PATCH", "/user", "alice", { website: "example.org/lab", location: " Kochi, India ", company: "Hydrolab", pronouns: "she/her" })).json;
  assert.equal(saved.website, "https://example.org/lab", "a bare domain gets https");
  assert.equal(saved.location, "Kochi, India");
  const pub = (await call("GET", "/owners/alice", null)).json;
  assert.deepEqual([pub.website, pub.location, pub.company, pub.pronouns], ["https://example.org/lab", "Kochi, India", "Hydrolab", "she/her"]);
  assert.equal((await call("PATCH", "/user", "alice", { website: "javascript:alert(1)" })).status, 400, "no script addresses");
  assert.equal((await call("PATCH", "/user", "alice", { website: "https://user:pw@example.org" })).status, 400, "no credentials in the address");
  assert.equal((await call("PATCH", "/user", "alice", { website: "https://localhost" })).status, 400, "a real domain");
  assert.equal((await call("PATCH", "/user", "alice", { pronouns: "x".repeat(41) })).status, 400);
  assert.equal((await call("PATCH", "/user", "alice", { location: "bad\u0007place" })).status, 400);
  assert.equal((await call("PATCH", "/user", "alice", { website: "" })).json.website, "", "and any of them can be cleared");
  assert.equal((await call("GET", "/owners/alice", null)).json.location, "Kochi, India", "a refused change leaves the rest alone");
});

test("a picture is stored, served to anyone with a version, and revalidated", async () => {
  assert.equal((await call("GET", "/avatars/alice", null)).status, 404);
  assert.equal((await call("GET", "/user", "alice")).json.hasAvatar, false);
  const put = await call("PUT", "/user/avatar", "alice", PNG, { "content-type": "image/png" });
  assert.equal(put.status, 200);
  assert.equal(put.json.hasAvatar, true);
  const got = await call("GET", "/avatars/alice", null);
  assert.equal(got.status, 200);
  assert.equal(got.headers.get("content-type"), "image/png");
  assert.equal(got.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(got.buf, PNG);
  const etag = got.headers.get("etag")!;
  assert.equal((await call("GET", "/avatars/alice", null, undefined, { "if-none-match": etag })).status, 304);
  assert.equal((await call("GET", "/owners/alice", null)).json.hasAvatar, true);
});

test("only real PNG, JPEG and WebP bytes are accepted, whatever they are called, and only up to 512 KB", async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  assert.equal((await call("PUT", "/user/avatar", "bob", svg, { "content-type": "image/png" })).status, 400, "an SVG called a PNG is still an SVG");
  assert.equal((await call("PUT", "/user/avatar", "bob", Buffer.from("GIF89a..........."), { "content-type": "image/gif" })).status, 400);
  assert.equal((await call("PUT", "/user/avatar", "bob", Buffer.alloc(0))).status, 400);
  const big = Buffer.concat([PNG, Buffer.alloc(513 * 1024)]);
  assert.equal((await call("PUT", "/user/avatar", "bob", big, { "content-type": "image/png" })).status, 400);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
  assert.equal((await call("PUT", "/user/avatar", "bob", jpeg, { "content-type": "image/jpeg" })).status, 200);
  assert.equal((await call("GET", "/avatars/bob", null)).headers.get("content-type"), "image/jpeg");
  assert.equal((await call("PUT", "/user/avatar", null, PNG)).status, 401, "signed out, nothing changes");
});

test("a picture can be taken down, and only by its owner", async () => {
  assert.equal((await call("DELETE", "/user/avatar", "alice")).json.hasAvatar, false);
  assert.equal((await call("GET", "/avatars/alice", null)).status, 404);
  assert.equal((await call("GET", "/avatars/bob", null)).status, 200, "bob's is untouched");
});
