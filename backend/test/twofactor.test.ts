// Two-step verification: the TOTP maths against the RFC 6238 test vectors, then the whole
// account flow: setup, confirm, two-step sign-in, recovery codes, replay, lockout and turning it off.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { base32Decode, base32Encode, hotp, matchTotp, otpauthUrl, stepAt, totpAt } from "../src/core/totp.ts";
import { decryptSecret, encryptSecret } from "../src/services/secrets.ts";
import { sentEmails } from "../src/services/email.ts";
import { clock } from "../src/services/twofactor.ts";
import * as limits from "../src/api/limits.ts";

// ── The maths ──────────────────────────────────────────────────────────────

test("TOTP matches the RFC 6238 SHA-1 test vectors (the last six digits of each 8-digit value)", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [t, eight] of vectors) {
    assert.equal(totpAt(secret, t, 8), eight, `8 digits at T=${t}`);
    assert.equal(totpAt(secret, t), eight.slice(2), `6 digits at T=${t}`);
  }
});

test("HOTP matches the RFC 4226 test vectors", () => {
  const key = Buffer.from("12345678901234567890", "ascii");
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(key, counter), code));
});

test("base32 round-trips and tolerates lowercase, spaces and padding", () => {
  const bytes = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
  assert.ok(base32Decode(base32Encode(bytes)).equals(bytes));
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.ok(base32Decode("mzxw 6ytb-oi====").equals(Buffer.from("foobar")));
  assert.throws(() => base32Decode("not*base32"));
});

test("a code is accepted a step either side (clock drift), not further, and never twice", () => {
  const secret = base32Encode(Buffer.from("12345678901234567890", "ascii"));
  const t = 1_700_000_000;
  const now = totpAt(secret, t), prev = totpAt(secret, t - 30), next = totpAt(secret, t + 30), far = totpAt(secret, t + 90);
  assert.equal(matchTotp(secret, now, t), stepAt(t));
  assert.equal(matchTotp(secret, prev, t), stepAt(t) - 1);
  assert.equal(matchTotp(secret, next, t), stepAt(t) + 1);
  assert.equal(matchTotp(secret, far, t), null, "three steps away is refused");
  assert.equal(matchTotp(secret, now, t, stepAt(t)), null, "a step already used can't be used again");
  assert.equal(matchTotp(secret, prev, t, stepAt(t) - 2), stepAt(t) - 1, "but a later, unused step still works");
  for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5"]) assert.equal(matchTotp(secret, bad, t), null, JSON.stringify(bad));
  assert.equal(matchTotp(secret, `${now.slice(0, 3)} ${now.slice(3)}`, t), stepAt(t), "a code typed with a space is fine");
});

test("the otpauth link carries the issuer, account and parameters apps read", () => {
  const url = otpauthUrl("JBSWY3DPEHPK3PXP", "rhea@example.org", "Craton");
  assert.equal(url, "otpauth://totp/Craton:rhea%40example.org?secret=JBSWY3DPEHPK3PXP&issuer=Craton&algorithm=SHA1&digits=6&period=30");
});

test("stored secrets are encrypted, differ each time, and fail loudly if altered", () => {
  const a = encryptSecret("JBSWY3DPEHPK3PXP"), b = encryptSecret("JBSWY3DPEHPK3PXP");
  assert.notEqual(a, b, "a fresh nonce each time");
  assert.ok(!a.includes("JBSWY3DPEHPK3PXP"));
  assert.equal(decryptSecret(a), "JBSWY3DPEHPK3PXP");
  const parts = a.split(".");
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith("AA") ? "BB" : "AA");
  assert.throws(() => decryptSecret(parts.join(".")), "tampered ciphertext is rejected, not silently misread");
});

// ── The account flow ───────────────────────────────────────────────────────

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const PASSWORD = "a-very-long-password";
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

const login = (name: string, password = PASSWORD) => call("POST", "/auth/login", null, { login: name, password });
// The server's clock is moved by hand: a code is good for one step and can't be used twice, so a
// test that wants a fresh code has to let a step pass, as a person would.
let clockNow = Math.floor(Date.now() / 1000);
clock.unix = () => clockNow;
const tick = (seconds = 30) => (clockNow += seconds);
/** A code the way an authenticator app would show it at the (simulated) current time. */
const codeNow = (secret: string) => totpAt(secret, clockNow);

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  for (const u of ["rhea", "sol"]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email: `${u}@example.org`, password: PASSWORD }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
  }
});

let secret = "";
let recovery: string[] = [];

test("with two-step off, signing in is a single step, and the account says so", async () => {
  const r = await login("rhea");
  assert.equal(r.status, 200);
  assert.ok(r.json.token && !r.json.mfaRequired);
  assert.equal((await call("GET", "/user", "rhea")).json.twoFactor, false);
  assert.deepEqual((await call("GET", "/user/2fa", "rhea")).json, { enabled: false, enabledAt: null, recoveryCodesLeft: 0 });
});

test("setup needs the password, hands over a secret and link, and changes nothing until a code is confirmed", async () => {
  assert.equal((await call("POST", "/user/2fa/setup", "rhea", { password: "nope-nope-nope" })).status, 403);
  const r = await call("POST", "/user/2fa/setup", "rhea", { password: PASSWORD });
  assert.equal(r.status, 200, r.text);
  assert.match(r.json.secret, /^[A-Z2-7]{32}$/);
  assert.match(r.json.otpauthUrl, new RegExp(`^otpauth://totp/Craton:rhea%40example\\.org\\?secret=${r.json.secret}&`));
  secret = r.json.secret;
  assert.equal((await call("GET", "/user", "rhea")).json.twoFactor, false, "not on yet");
  assert.ok(!(await login("rhea")).json.mfaRequired, "signing in still needs only a password");
  const stored = await ctx.db.get("SELECT totp_pending FROM users WHERE owner_id = (SELECT id FROM owners WHERE handle = 'rhea')") as { totp_pending: string };
  assert.ok(!stored.totp_pending.includes(secret), "the pending secret is encrypted at rest");
});

test("confirming needs a correct code; then it is on, with ten recovery codes shown once", async () => {
  assert.equal((await call("POST", "/user/2fa/enable", "rhea", { code: "000000" })).json.error.code, "invalid_code");
  assert.equal((await call("POST", "/user/2fa/enable", "sol", { code: codeNow(secret) })).status, 400, "another account can't use rhea's pending secret");
  const r = await call("POST", "/user/2fa/enable", "rhea", { code: codeNow(secret) });
  assert.equal(r.status, 201, r.text);
  recovery = r.json.recoveryCodes;
  assert.equal(recovery.length, 10);
  assert.equal(new Set(recovery).size, 10);
  for (const c of recovery) assert.match(c, /^[2-9a-hjkmnp-z]{5}-[2-9a-hjkmnp-z]{5}$/);
  assert.equal((await call("GET", "/user", "rhea")).json.twoFactor, true);
  assert.equal((await call("GET", "/user/2fa", "rhea")).json.recoveryCodesLeft, 10);
  const stored = await ctx.db.get("SELECT totp_secret FROM users WHERE owner_id = (SELECT id FROM owners WHERE handle = 'rhea')") as { totp_secret: string };
  assert.ok(!stored.totp_secret.includes(secret), "the live secret is encrypted at rest");
  const hashes = await ctx.db.all("SELECT code_hash FROM recovery_codes") as { code_hash: string }[];
  assert.ok(hashes.every((h) => !recovery.some((c) => h.code_hash.includes(c.replace("-", "")))), "recovery codes are stored only as hashes");
  assert.ok(sentEmails.some((m) => m.to === "rhea@example.org" && m.kind === "twofactor" && /is on/.test(m.subject)), "the owner is emailed");
  assert.equal((await call("POST", "/user/2fa/setup", "rhea", { password: PASSWORD })).status, 409, "can't set up again while on");
});

test("the password alone no longer signs in: it earns a ticket, and a code turns that into a session", async () => {
  const first = await login("rhea");
  assert.equal(first.status, 200);
  assert.equal(first.json.mfaRequired, true);
  assert.match(first.json.ticket, /^mfa_/);
  assert.equal(first.json.token, undefined, "no session yet");
  assert.equal((await login("rhea", "wrong-wrong-wrong")).status, 401, "a wrong password never gets a ticket");

  tick();
  const second = await call("POST", "/auth/login/2fa", null, { ticket: first.json.ticket, code: codeNow(secret) });
  assert.equal(second.status, 200, second.text);
  assert.ok(second.json.token);
  const me = await app.request("/v1/user", { headers: { authorization: `Bearer ${second.json.token}` } });
  assert.equal(((await me.json()) as { handle: string }).handle, "rhea");

  const again = await call("POST", "/auth/login/2fa", null, { ticket: first.json.ticket, code: codeNow(secret) });
  assert.equal(again.json.error.code, "invalid_ticket", "a ticket works once");
});

test("a code that was already used cannot be replayed on another sign-in", async () => {
  tick();
  const t1 = (await login("rhea")).json.ticket;
  const code = codeNow(secret);
  assert.equal((await call("POST", "/auth/login/2fa", null, { ticket: t1, code })).status, 200);
  const t2 = (await login("rhea")).json.ticket;
  const replay = await call("POST", "/auth/login/2fa", null, { ticket: t2, code });
  assert.equal(replay.status, 401);
  assert.equal(replay.json.error.code, "invalid_code");
});

test("wrong codes use up a ticket's tries, then it dies even for the right code", async () => {
  const t = (await login("rhea")).json.ticket;
  let last: any;
  for (let i = 0; i < 4; i++) last = await call("POST", "/auth/login/2fa", null, { ticket: t, code: "000000" });
  assert.match(last.json.error.message, /1 try left/);
  last = await call("POST", "/auth/login/2fa", null, { ticket: t, code: "000000" });
  assert.match(last.json.error.message, /no tries left/);
  tick();
  const right = await call("POST", "/auth/login/2fa", null, { ticket: t, code: codeNow(secret) });
  assert.equal(right.json.error.code, "invalid_ticket", "the ticket is gone");
  limits.clear(`mfa:${(await ctx.db.get("SELECT id FROM owners WHERE handle = 'rhea'") as { id: number }).id}`);
});

test("a recovery code signs in once and is then spent; the count goes down", async () => {
  const t = (await login("rhea")).json.ticket;
  const ok = await call("POST", "/auth/login/2fa", null, { ticket: t, code: recovery[0].toUpperCase().replace("-", " ") });
  assert.equal(ok.status, 200, "case, dashes and spaces don't matter");
  assert.equal((await call("GET", "/user/2fa", "rhea")).json.recoveryCodesLeft, 9);
  const t2 = (await login("rhea")).json.ticket;
  assert.equal((await call("POST", "/auth/login/2fa", null, { ticket: t2, code: recovery[0] })).json.error.code, "invalid_code", "used codes stay used");
  const t3 = (await login("rhea")).json.ticket;
  assert.equal((await call("POST", "/auth/login/2fa", null, { ticket: t3, code: recovery[1] })).status, 200);
});

test("an account is locked out of code guessing across tickets", async () => {
  const id = (await ctx.db.get("SELECT id FROM owners WHERE handle = 'rhea'") as { id: number }).id;
  limits.clear(`mfa:${id}`);
  let locked: any;
  for (let i = 0; i < 12 && !locked; i++) {
    const t = (await login("rhea")).json.ticket;
    const r = await call("POST", "/auth/login/2fa", null, { ticket: t, code: "111111" });
    if (r.json?.error?.code === "account_locked") locked = r;
  }
  assert.ok(locked, "after enough wrong codes the account stops accepting guesses");
  assert.equal(locked.status, 429);
  limits.clear(`mfa:${id}`);
});

test("changing anything needs the password and a current code; access tokens cannot touch it", async () => {
  const noCode = await call("POST", "/user/2fa/recovery-codes", "rhea", { password: PASSWORD, code: "" });
  assert.equal(noCode.status, 400);
  tick();
  const wrongPw = await call("POST", "/user/2fa/recovery-codes", "rhea", { password: "nope-nope-nope", code: codeNow(secret) });
  assert.equal(wrongPw.status, 403);
  const fresh = await call("POST", "/user/2fa/recovery-codes", "rhea", { password: PASSWORD, code: codeNow(secret) });
  assert.equal(fresh.status, 201, fresh.text);
  assert.equal(fresh.json.recoveryCodes.length, 10);
  assert.equal((await call("GET", "/user/2fa", "rhea")).json.recoveryCodesLeft, 10, "the old codes are gone, ten new ones exist");
  const t = (await login("rhea")).json.ticket;
  assert.equal((await call("POST", "/auth/login/2fa", null, { ticket: t, code: recovery[2] })).json.error.code, "invalid_code", "an old recovery code no longer works");

  const pat = (await call("POST", "/user/tokens", "rhea", { note: "ci", scopes: ["repo"] })).json.token;
  tokens.pat = pat;
  assert.equal((await call("POST", "/user/2fa/disable", "pat", { password: PASSWORD, code: "123456" })).status, 403, "an access token can't switch security off");
});

test("turning it off needs the password and a code, then sign-in is one step again and the owner is told", async () => {
  assert.equal((await call("POST", "/user/2fa/disable", "rhea", { password: PASSWORD, code: "000000" })).status, 400);
  tick();
  const off = await call("POST", "/user/2fa/disable", "rhea", { password: PASSWORD, code: codeNow(secret) });
  assert.equal(off.status, 200, off.text);
  assert.equal((await call("GET", "/user", "rhea")).json.twoFactor, false);
  const r = await login("rhea");
  assert.ok(r.json.token && !r.json.mfaRequired);
  assert.equal((await ctx.db.get("SELECT COUNT(*) AS n FROM recovery_codes WHERE user_id = (SELECT id FROM owners WHERE handle = 'rhea')") as { n: number }).n, 0, "recovery codes are deleted");
  assert.ok(sentEmails.some((m) => m.to === "rhea@example.org" && m.kind === "twofactor" && /turned off/.test(m.subject)));
  limits.clear(`2fa:${(await ctx.db.get("SELECT id FROM owners WHERE handle = 'rhea'") as { id: number }).id}`); // this test has used up the 10 tries per 15 minutes
  assert.equal((await call("POST", "/user/2fa/disable", "rhea", { password: PASSWORD, code: "123456" })).status, 400, "already off");
});

test("a password reset does not switch two-step off", async () => {
  const setup = (await call("POST", "/user/2fa/setup", "sol", { password: PASSWORD })).json;
  assert.equal((await call("POST", "/user/2fa/enable", "sol", { code: codeNow(setup.secret) })).status, 201);
  await call("POST", "/auth/forgot", null, { login: "sol" });
  const mail = [...sentEmails].reverse().find((m) => m.kind === "reset" && m.to === "sol@example.org")!;
  const token = mail.text.match(/token=([^\s]+)/)![1];
  assert.equal((await call("POST", "/auth/reset", null, { token, password: "another-long-password" })).status, 200);
  const r = await login("sol", "another-long-password");
  assert.equal(r.json.mfaRequired, true, "knowing the reset link is not enough to get past the second step");
});
