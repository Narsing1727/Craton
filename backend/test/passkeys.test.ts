// Passkeys (WebAuthn): registering and signing in with a software authenticator, and every way a ceremony can be wrong.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { CborError, decodeCbor } from "../src/core/cbor.ts";
import { SoftAuthenticator, encodeCbor } from "./helpers/authenticator.ts";
import { clear } from "../src/api/limits.ts";

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

const register = async (who: string, auth: SoftAuthenticator, tweak: Parameters<SoftAuthenticator["create"]>[1] = {}, name = "Test key") => {
  const options = (await call("POST", "/user/passkeys/options", who)).json;
  return call("POST", "/user/passkeys", who, { credential: auth.create(options, tweak), name });
};
const signIn = async (auth: SoftAuthenticator, tweak: Parameters<SoftAuthenticator["get"]>[1] = {}) => {
  const options = (await call("POST", "/auth/passkey/options", null)).json;
  return call("POST", "/auth/passkey/login", null, { credential: auth.get(options, tweak) });
};
const code = (r: { json: any }) => r.json?.error?.code;

before(async () => {
  ctx = { db: openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["alice", "bob", "carol"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
});

test("the CBOR reader refuses what it should: truncation, indefinite lengths, tags, repeated keys, deep nesting, huge lengths", () => {
  assert.throws(() => decodeCbor(Buffer.from([0x62, 0x61])), CborError, "text longer than the data");
  assert.throws(() => decodeCbor(Buffer.from([0x5f, 0x41, 0x00, 0xff])), /indefinite/, "indefinite byte string");
  assert.throws(() => decodeCbor(Buffer.from([0xc0, 0x00])), /tags/);
  assert.throws(() => decodeCbor(Buffer.from([0xa2, 0x01, 0x00, 0x01, 0x00])), /repeats a key/);
  assert.throws(() => decodeCbor(Buffer.from([0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])), CborError, "length far past the data");
  assert.throws(() => decodeCbor(Buffer.from(Array(20).fill(0x81).concat([0x00]))), /nested too deeply/);
  assert.throws(() => decodeCbor(Buffer.from([0xa1, 0x41, 0x00, 0x00])), /key is not an integer or text/);
  // And reads what it should, reporting where the item ended.
  const map = new Map<unknown, unknown>([[1, 2], [-1, Buffer.from("ab")], ["fmt", "none"], ["xs", [1, -1, 300]]]);
  const bytes = Buffer.concat([encodeCbor(map), Buffer.from("trailing")]);
  const out = decodeCbor(bytes);
  assert.equal(out.end, bytes.length - "trailing".length);
  const m = out.value as Map<unknown, unknown>;
  assert.deepEqual([m.get(1), m.get("fmt"), m.get("xs")], [2, "none", [1, -1, 300]]);
  assert.ok((m.get(-1) as Buffer).equals(Buffer.from("ab")));
});

test("providers say passkeys are available, and managing them needs a signed-in session", async () => {
  assert.equal((await call("GET", "/auth/providers", null)).json.passkeys, true);
  assert.equal((await call("POST", "/user/passkeys/options", null)).status, 401);
  assert.equal((await call("GET", "/user/passkeys", null)).status, 401);
});

test("registration options name the site, offer the algorithms the server accepts and ask for no attestation", async () => {
  const o = (await call("POST", "/user/passkeys/options", "alice")).json;
  assert.equal(o.rp.id, "localhost");
  assert.deepEqual(o.pubKeyCredParams.map((p: any) => p.alg), [-7, -257, -8]);
  assert.equal(o.attestation, "none");
  assert.equal(o.authenticatorSelection.userVerification, "preferred");
  assert.ok(o.challenge.length >= 40);
  assert.equal(o.user.name, "alice");
  assert.deepEqual(o.excludeCredentials, []);
  // The user handle is stable, random and not the username.
  const again = (await call("POST", "/user/passkeys/options", "alice")).json;
  assert.equal(again.user.id, o.user.id);
  assert.ok(!Buffer.from(o.user.id, "base64url").toString().includes("alice"));
  assert.notEqual((await call("POST", "/user/passkeys/options", "bob")).json.user.id, o.user.id);
});

const keys: Record<string, SoftAuthenticator> = {};
test("passkeys of all three signature types register, and appear in the list", async () => {
  for (const alg of ["ES256", "RS256", "EdDSA"] as const) {
    keys[alg] = new SoftAuthenticator(alg);
    const r = await register("alice", keys[alg], {}, `${alg} key`);
    assert.equal(r.status, 201, `${alg}: ${r.text}`);
  }
  const list = (await call("GET", "/user/passkeys", "alice")).json;
  assert.deepEqual(list.map((p: any) => p.name), ["ES256 key", "RS256 key", "EdDSA key"]);
  assert.ok(list.every((p: any) => p.lastUsedAt === null && p.transports.includes("internal") && p.synced === true));
  assert.equal((await call("GET", "/user/passkeys", "bob")).json.length, 0, "someone else's list is theirs");
  // Registered keys are excluded from the next registration, so one device cannot add itself twice.
  const next = (await call("POST", "/user/passkeys/options", "alice")).json;
  assert.equal(next.excludeCredentials.length, 3);
  const log = (await call("GET", "/user/security-log", "alice")).json as { type: string }[] | { events: { type: string }[] };
  assert.ok((Array.isArray(log) ? log : log.events).filter((e) => e.type === "passkey_added").length >= 3);
});

test("every way a registration can be wrong is refused", async () => {
  const fresh = () => new SoftAuthenticator("ES256");
  const cases: { name: string; tweak: Parameters<SoftAuthenticator["create"]>[1]; auth?: SoftAuthenticator }[] = [
    { name: "another site's origin", auth: new SoftAuthenticator("ES256", "https://evil.example") , tweak: {} },
    { name: "another relying party id", tweak: { rpId: "evil.example" } },
    { name: "no user presence", tweak: { flags: 0x40 } },
    { name: "no attested credential data", tweak: { flags: 0x01 } },
    { name: "the wrong ceremony type", tweak: { type: "webauthn.get" } },
    { name: "a challenge nobody issued", tweak: { challenge: "A".repeat(43) } },
    { name: "a framed (cross-origin) page", tweak: { clientData: { crossOrigin: true } } },
    { name: "a credential id that does not match", tweak: { credentialId: Buffer.alloc(32, 7) } },
    { name: "an unsupported algorithm", tweak: { cose: new Map<number, unknown>([[1, 2], [3, -35], [-1, 2], [-2, Buffer.alloc(48)], [-3, Buffer.alloc(48)]]) } },
    { name: "a point not on the curve", tweak: { cose: new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.alloc(32, 1)], [-3, Buffer.alloc(32, 2)]]) } },
    { name: "a too-small RSA key", tweak: { cose: new Map<number, unknown>([[1, 3], [3, -257], [-1, Buffer.alloc(128, 255)], [-2, Buffer.from([1, 0, 1])]]) } },
    { name: "an attestation object that is not CBOR", tweak: { attestation: Buffer.from("not cbor at all") } },
    { name: "an attestation object without authenticator data", tweak: { attestation: encodeCbor(new Map<string, unknown>([["fmt", "none"]])) } },
  ];
  for (const c of cases) {
    const r = await register("bob", c.auth ?? fresh(), c.tweak);
    assert.equal(r.status, 400, `${c.name}: ${r.status} ${r.text}`);
    assert.equal(code(r), "invalid_passkey", c.name);
  }
  assert.equal((await call("GET", "/user/passkeys", "bob")).json.length, 0, "none of them left a passkey behind");
});

test("a challenge is single use, belongs to the person it was issued to, and is not for sign-in", async () => {
  const auth = new SoftAuthenticator("ES256");
  const options = (await call("POST", "/user/passkeys/options", "bob")).json;
  const credential = auth.create(options);
  assert.equal((await call("POST", "/user/passkeys", "carol", { credential })).status, 400, "carol cannot use bob's challenge");
  assert.equal((await call("POST", "/user/passkeys", "bob", { credential })).status, 400, "and it is gone once looked at, even by the wrong person");
  const second = (await call("POST", "/user/passkeys/options", "bob")).json;
  assert.equal((await call("POST", "/user/passkeys", "bob", { credential: auth.create(second) })).status, 201);
  assert.equal((await call("POST", "/user/passkeys", "bob", { credential: auth.create(second) })).status, 400, "replaying a finished registration");
  // A sign-in challenge cannot be used to register.
  const login = (await call("POST", "/auth/passkey/options", null)).json;
  const other = new SoftAuthenticator("ES256");
  assert.equal((await call("POST", "/user/passkeys", "carol", { credential: other.create(login) })).status, 400);
  // Nor can one passkey belong to two accounts.
  const opt = (await call("POST", "/user/passkeys/options", "carol")).json;
  const dup = await call("POST", "/user/passkeys", "carol", { credential: auth.create(opt) });
  assert.equal(dup.status, 409);
  assert.equal(code(dup), "passkey_exists");
});

test("signing in with each kind of passkey needs no username, returns a session, and is recorded as a passkey sign-in", async () => {
  for (const alg of ["ES256", "RS256", "EdDSA"] as const) {
    const r = await signIn(keys[alg]);
    assert.equal(r.status, 200, `${alg}: ${r.text}`);
    const me = await app.request("/v1/user", { headers: { authorization: `Bearer ${r.json.token}` } });
    assert.equal(((await me.json()) as { handle: string }).handle, "alice");
  }
  const log = (await call("GET", "/user/security-log", "alice")).json as { type: string; detail: string }[] | { events: { type: string; detail: string }[] };
  assert.ok((Array.isArray(log) ? log : log.events).some((e) => e.type === "signed_in" && e.detail === "passkey"));
  const list = (await call("GET", "/user/passkeys", "alice")).json;
  assert.ok(list.every((p: any) => p.lastUsedAt !== null), "last used is kept");
});

test("every way a sign-in can be wrong is refused with the same plain answer", async () => {
  const auth = keys.ES256;
  const wrongKey = new SoftAuthenticator("ES256");
  const attempts: { name: string; run: () => Promise<{ status: number; json: any }> }[] = [
    { name: "a tampered signature", run: () => signIn(auth, { tamper: true }) },
    { name: "a passkey nobody registered", run: () => signIn(wrongKey) },
    { name: "a different relying party id", run: () => signIn(auth, { rpId: "evil.example" }) },
    { name: "no user presence", run: () => signIn(auth, { flags: 0x00 }) },
    { name: "another site's origin", run: () => signIn(new Proxy(auth, { get: (t, k) => (k === "origin" ? "https://evil.example" : (t as any)[k]) }) as SoftAuthenticator) },
    { name: "a challenge nobody issued", run: () => signIn(auth, { challenge: "B".repeat(43) }) },
    { name: "the wrong ceremony type", run: () => signIn(auth, { type: "webauthn.create" }) },
    { name: "a user handle of someone else", run: () => signIn(auth, { userHandle: Buffer.from("someone else").toString("base64url") }) },
  ];
  for (const a of attempts) {
    const r = await a.run();
    assert.ok([400, 401].includes(r.status), `${a.name}: ${r.status}`);
    assert.ok(["invalid_passkey"].includes(code(r)), `${a.name}: ${code(r)}`);
    assert.equal(r.json.token, undefined, a.name);
  }
  // A challenge cannot be replayed.
  const options = (await call("POST", "/auth/passkey/options", null)).json;
  const credential = auth.get(options);
  assert.equal((await call("POST", "/auth/passkey/login", null, { credential })).status, 200);
  assert.equal((await call("POST", "/auth/passkey/login", null, { credential })).status, 400);
  // A registration challenge is not good for signing in.
  const reg = (await call("POST", "/user/passkeys/options", "alice")).json;
  assert.equal((await call("POST", "/auth/passkey/login", null, { credential: auth.get(reg) })).status, 400);
});

test("the right user handle is accepted, and a counter that goes backwards is refused and recorded", async () => {
  const handle = (await call("POST", "/user/passkeys/options", "alice")).json.user.id as string;
  assert.equal((await signIn(keys.ES256, { userHandle: handle })).status, 200);
  const rollback = await signIn(keys.ES256, { counter: 1 });
  assert.equal(rollback.status, 401);
  assert.equal(code(rollback), "passkey_cloned");
  assert.equal(rollback.json.token, undefined);
  const log = (await call("GET", "/user/security-log", "alice")).json as { type: string }[] | { events: { type: string }[] };
  assert.ok((Array.isArray(log) ? log : log.events).some((e) => e.type === "passkey_rollback"));
  // It did not poison the stored counter: the next honest sign-in works.
  keys.ES256.counter = 50;
  assert.equal((await signIn(keys.ES256, { counter: 51 })).status, 200);
});

test("synced passkeys keep a counter of zero and are not mistaken for copies", async () => {
  const synced = new SoftAuthenticator("ES256", "http://localhost:3100", "localhost", true, false);
  assert.equal((await register("carol", synced)).status, 201);
  for (let i = 0; i < 3; i++) assert.equal((await signIn(synced)).status, 200, `sign-in ${i}`);
});

test("two-step verification still applies unless the device verified the person", async () => {
  const touch = new SoftAuthenticator("ES256", "http://localhost:3100", "localhost", false);
  assert.equal((await register("bob", touch)).status, 201);
  ctx.db.prepare("UPDATE users SET totp_secret = 'x', totp_enabled_at = '2026-01-01T00:00:00.000Z' WHERE owner_id = (SELECT id FROM owners WHERE handle = 'bob')").run();
  const asked = await signIn(touch);
  assert.equal(asked.status, 200);
  assert.equal(asked.json.mfaRequired, true, "a key that was only touched is one factor");
  assert.equal(asked.json.token, undefined);
  touch.uv = true;
  const direct = await signIn(touch);
  assert.ok(typeof direct.json.token === "string", "a verified passkey is two factors in one");
});

test("renaming and removing are the owner's, and the last way into an account cannot be removed", async () => {
  const list = (await call("GET", "/user/passkeys", "alice")).json as { id: string }[];
  assert.equal((await call("PATCH", `/user/passkeys/${list[0].id}`, "bob", { name: "mine now" })).status, 404);
  assert.equal((await call("DELETE", `/user/passkeys/${list[0].id}`, "bob")).status, 404);
  assert.equal((await call("PATCH", `/user/passkeys/${list[0].id}`, "alice", { name: "  " })).status, 400);
  const renamed = await call("PATCH", `/user/passkeys/${list[0].id}`, "alice", { name: "Work laptop" });
  assert.equal(renamed.json.find((p: any) => p.id === list[0].id).name, "Work laptop");

  // An account with no password and no Google can lose passkeys only down to one.
  ctx.db.prepare("UPDATE users SET password_hash = 'oauth$' WHERE owner_id = (SELECT id FROM owners WHERE handle = 'carol')").run();
  const mine = (await call("GET", "/user/passkeys", "carol")).json as { id: string }[];
  assert.equal(mine.length, 1);
  const refused = await call("DELETE", `/user/passkeys/${mine[0].id}`, "carol");
  assert.equal(refused.status, 409);
  assert.equal(code(refused), "last_sign_in_method");
  // With a password it can go, and then the key no longer signs anyone in.
  assert.equal((await call("DELETE", `/user/passkeys/${list[0].id}`, "alice")).status, 204);
  assert.equal((await call("GET", "/user/passkeys", "alice")).json.length, 2);
  assert.equal(code(await signIn(keys.ES256)), "invalid_passkey", "the removed key signs nobody in");
});

test("a removed passkey stops working", async () => {
  const gone = new SoftAuthenticator("ES256");
  assert.equal((await register("alice", gone)).status, 201);
  assert.equal((await signIn(gone)).status, 200);
  assert.equal((await call("DELETE", `/user/passkeys/${gone.id}`, "alice")).status, 204);
  const r = await signIn(gone);
  assert.equal(r.status, 401);
  assert.equal(code(r), "invalid_passkey");
});

test("an account is limited to twenty passkeys, and the options request is rate limited per account", async () => {
  const uid = (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'alice'").get() as { id: number }).id;
  const insert = (n: number) => ctx.db.prepare("INSERT INTO passkeys (id, user_id, name, public_key, alg) VALUES (?, ?, 'filler', x'00', -7)").run(`filler-${n}-${Math.random()}`, uid);
  const have = (await call("GET", "/user/passkeys", "alice")).json.length as number;
  for (let n = have; n < 19; n++) insert(n);
  // The hourly limit on asking to add one may already be spent by this file's earlier registrations; clear it to test the cap.
  clear(`passkey-add:${uid}`);
  assert.equal((await call("POST", "/user/passkeys/options", "alice")).status, 200, "nineteen: one more is allowed");
  insert(99);
  const over = await call("POST", "/user/passkeys/options", "alice");
  assert.equal(over.status, 409);
  assert.equal(code(over), "too_many");
});

test("asking to add passkeys is rate limited per account", async () => {
  const uid = (ctx.db.prepare("SELECT id FROM owners WHERE handle = 'carol'").get() as { id: number }).id;
  clear(`passkey-add:${uid}`);
  let last = 0;
  for (let i = 0; i < 25 && last !== 429; i++) last = (await call("POST", "/user/passkeys/options", "carol")).status;
  assert.equal(last, 429);
  clear(`passkey-add:${uid}`);
});
