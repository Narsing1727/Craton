// Passkeys: sign in with a key pair kept by the person's device, proved with the WebAuthn protocol (W3C Level 2/3).
//
// What is checked, in the order the specification gives, for every ceremony:
//   - the challenge is one this server issued, for this purpose (and, when creating, this person), unused, under five minutes old;
//   - the browser says the page's origin is one of ours, and the request was not made from inside another site's frame;
//   - the authenticator's data names our relying party id (a hash of it) and says the person was present;
//   - when signing in: the signature, by the stored public key, over the authenticator data and the hash of the client data;
//     and the signature counter, when the authenticator keeps one, has moved forward (a copy of the key would not).
// Attestation (a statement about the authenticator model) is not used: a passkey is trusted because the person registered
// it while signed in, not because of what made it, so the registration request asks for none and the statement is ignored.
// Public keys are stored as SubjectPublicKeyInfo DER. ES256, RS256 and EdDSA are accepted, which covers platform
// authenticators (Windows Hello signs with RS256), security keys and password managers.

import { createHash, createPublicKey, randomBytes, verify as verifySignature } from "node:crypto";
import type { Ctx } from "./context.ts";
import { ApiError, badRequest, conflict, notFound } from "./context.ts";
import { config } from "../config.ts";
import { CborError, decodeCbor } from "../core/cbor.ts";

const ALGS = [-7, -257, -8] as const;
const CHALLENGE_MINUTES = 5;
const MAX_PER_USER = 20;
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;
const FLAG_BE = 0x08;
const FLAG_BS = 0x10;
const FLAG_AT = 0x40;

const sha256 = (v: Buffer | string) => createHash("sha256").update(v).digest();
const b64u = (b: Buffer) => b.toString("base64url");
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();

/** The relying party id: the site name passkeys are bound to. */
export const rpId = () => config.passkey.rpId || new URL(config.webUrl).hostname;
/** The web origins whose pages may use a passkey with this server. */
export const allowedOrigins = () => (config.passkey.origins.length ? config.passkey.origins : [new URL(config.webUrl).origin]);

const bad = (message: string) => new ApiError(400, "invalid_passkey", message);

function text(v: unknown, what: string, max = 4096): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) throw bad(`The browser's answer is missing ${what}.`);
  return v;
}
function bytes(v: unknown, what: string, max = 16384): Buffer {
  const s = text(v, what, Math.ceil(max * 1.4));
  if (!/^[A-Za-z0-9_-]+$/.test(s)) throw bad(`The browser's answer has a malformed ${what}.`);
  const out = Buffer.from(s, "base64url");
  if (out.length > max) throw bad(`The browser's answer has an oversized ${what}.`);
  return out;
}

// ── Challenges ───────────────────────────────────────────────────────────────

async function newChallenge(ctx: Ctx, kind: "create" | "get", userId: number | null) {
  await ctx.db.run("DELETE FROM passkey_challenges WHERE expires_at < ?", iso());
  const challenge = b64u(randomBytes(32));
  await ctx.db.run("INSERT INTO passkey_challenges (hash, kind, user_id, expires_at) VALUES (?, ?, ?, ?)", sha256(challenge).toString("hex"), kind, userId, iso(CHALLENGE_MINUTES * 60_000));
  return challenge;
}

/** Single use: gone as soon as it is looked at, whatever happens next. */
async function consumeChallenge(ctx: Ctx, challenge: string, kind: "create" | "get", userId: number | null) {
  const hash = sha256(challenge).toString("hex");
  const row = await ctx.db.get("SELECT kind, user_id, expires_at FROM passkey_challenges WHERE hash = ?", hash) as { kind: string; user_id: number | null; expires_at: string } | undefined;
  await ctx.db.run("DELETE FROM passkey_challenges WHERE hash = ?", hash);
  if (!row || row.expires_at < iso()) throw bad("This passkey request expired or was already used. Start again.");
  if (row.kind !== kind || row.user_id !== userId) throw bad("This passkey request was not made for this step.");
}

async function userHandle(ctx: Ctx, userId: number): Promise<string> {
  const row = await ctx.db.get("SELECT handle FROM passkey_users WHERE user_id = ?", userId) as { handle: string } | undefined;
  if (row) return row.handle;
  const handle = b64u(randomBytes(32));
  await ctx.db.run("INSERT INTO passkey_users (user_id, handle) VALUES (?, ?)", userId, handle);
  return handle;
}

// ── Reading what the browser sends ───────────────────────────────────────────

function checkClientData(raw: Buffer, type: "webauthn.create" | "webauthn.get") {
  let data: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    throw bad("The browser's client data is not valid JSON.");
  }
  if (data.type !== type) throw bad("The browser's answer is for a different kind of request.");
  if (typeof data.challenge !== "string") throw bad("The browser's answer has no challenge.");
  if (typeof data.origin !== "string" || !allowedOrigins().includes(data.origin)) throw bad("The browser's answer came from a page that is not this site.");
  if (data.crossOrigin === true) throw bad("Passkeys can't be used from inside another site's frame.");
  return data.challenge;
}

function parseAuthData(buf: Buffer) {
  if (buf.length < 37) throw bad("The authenticator data is too short.");
  return { rpIdHash: buf.subarray(0, 32), flags: buf[32], counter: buf.readUInt32BE(33), rest: buf.subarray(37) };
}

function checkAuthData(a: ReturnType<typeof parseAuthData>) {
  if (!a.rpIdHash.equals(sha256(rpId()))) throw bad("The passkey belongs to a different site.");
  if (!(a.flags & FLAG_UP)) throw bad("The authenticator did not confirm that someone was present.");
}

/** The COSE public key from a credential, as SubjectPublicKeyInfo DER, with its algorithm. */
function coseToSpki(key: unknown): { alg: number; spki: Buffer } {
  if (!(key instanceof Map)) throw bad("The public key is not a COSE key.");
  const kty = key.get(1);
  const alg = key.get(3);
  if (typeof alg !== "number" || !(ALGS as readonly number[]).includes(alg)) throw bad("This passkey uses a signature type this server does not accept (it accepts ES256, RS256 and EdDSA).");
  let jwk: Record<string, string>;
  if (kty === 2 && alg === -7) {
    const x = key.get(-2);
    const y = key.get(-3);
    if (key.get(-1) !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw bad("The ES256 public key is malformed.");
    jwk = { kty: "EC", crv: "P-256", x: b64u(x), y: b64u(y) };
  } else if (kty === 3 && alg === -257) {
    const n = key.get(-1);
    const e = key.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256 || n.length > 1024 || e.length === 0 || e.length > 8) throw bad("The RS256 public key is malformed or shorter than 2048 bits.");
    jwk = { kty: "RSA", n: b64u(n), e: b64u(e) };
  } else if (kty === 1 && alg === -8) {
    const x = key.get(-2);
    if (key.get(-1) !== 6 || !Buffer.isBuffer(x) || x.length !== 32) throw bad("The EdDSA public key is malformed.");
    jwk = { kty: "OKP", crv: "Ed25519", x: b64u(x) };
  } else throw bad("The public key's type does not match its algorithm.");
  try {
    return { alg, spki: createPublicKey({ key: jwk, format: "jwk" }).export({ type: "spki", format: "der" }) as Buffer };
  } catch {
    throw bad("The public key is not a valid key.");
  }
}

function signatureOk(alg: number, spki: Buffer, data: Buffer, signature: Buffer) {
  try {
    const key = createPublicKey({ key: spki, format: "der", type: "spki" });
    return verifySignature(alg === -8 ? null : "sha256", data, key, signature);
  } catch {
    return false;
  }
}

// ── Registering ──────────────────────────────────────────────────────────────

export type PasskeyRow = { id: string; name: string; created_at: string; last_used_at: string | null; transports: string; device_type: string; backed_up: number };

export async function registrationOptions(ctx: Ctx, user: { id: number; handle: string; name: string }) {
  const have = await ctx.db.all("SELECT id, transports FROM passkeys WHERE user_id = ?", user.id) as { id: string; transports: string }[];
  if (have.length >= MAX_PER_USER) throw conflict("too_many", `An account can have up to ${MAX_PER_USER} passkeys. Remove one first.`);
  return {
    challenge: await newChallenge(ctx, "create", user.id),
    rp: { id: rpId(), name: "Craton" },
    user: { id: await userHandle(ctx, user.id), name: user.handle, displayName: user.name || user.handle },
    pubKeyCredParams: ALGS.map((alg) => ({ type: "public-key", alg })),
    timeout: CHALLENGE_MINUTES * 60_000,
    attestation: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
    excludeCredentials: have.map((c) => ({ type: "public-key", id: c.id, transports: c.transports ? c.transports.split(",") : undefined })),
  };
}

type Registration = { id?: unknown; rawId?: unknown; type?: unknown; response?: { clientDataJSON?: unknown; attestationObject?: unknown; transports?: unknown } };

export async function finishRegistration(ctx: Ctx, user: { id: number }, input: { credential?: Registration; name?: unknown }) {
  const cred = input.credential;
  if (!cred || typeof cred !== "object" || cred.type !== "public-key" || !cred.response) throw bad("The browser sent no passkey.");
  const clientData = bytes(cred.response.clientDataJSON, "client data");
  await consumeChallenge(ctx, checkClientData(clientData, "webauthn.create"), "create", user.id);

  let attestation: unknown;
  try {
    attestation = decodeCbor(bytes(cred.response.attestationObject, "attestation object", 65536)).value;
  } catch (err) {
    throw bad(err instanceof CborError ? `The attestation object is malformed (${err.message}).` : "The attestation object is malformed.");
  }
  if (!(attestation instanceof Map) || !Buffer.isBuffer(attestation.get("authData"))) throw bad("The attestation object has no authenticator data.");
  const auth = parseAuthData(attestation.get("authData") as Buffer);
  checkAuthData(auth);
  if (!(auth.flags & FLAG_AT)) throw bad("The authenticator did not include a new credential.");
  if (auth.rest.length < 18) throw bad("The credential data is too short.");
  const idLength = auth.rest.readUInt16BE(16);
  if (idLength < 1 || idLength > 1023 || auth.rest.length < 18 + idLength) throw bad("The credential id is malformed.");
  const credentialId = auth.rest.subarray(18, 18 + idLength);
  if (!credentialId.equals(bytes(cred.rawId, "credential id", 1023))) throw bad("The credential id does not match.");
  let cose: unknown;
  try {
    cose = decodeCbor(auth.rest, 18 + idLength).value;
  } catch {
    throw bad("The public key is malformed.");
  }
  const { alg, spki } = coseToSpki(cose);

  const id = b64u(credentialId);
  if (await ctx.db.get("SELECT 1 FROM passkeys WHERE id = ?", id)) throw conflict("passkey_exists", "That passkey is already registered.");
  const name = (typeof input.name === "string" ? input.name : "").replace(/\s+/g, " ").trim().slice(0, 60) || "Passkey";
  const transports = Array.isArray(cred.response.transports) ? cred.response.transports.filter((t): t is string => typeof t === "string" && /^[a-z-]{1,16}$/.test(t)).slice(0, 6).join(",") : "";
  await ctx.db.run("INSERT INTO passkeys (id, user_id, name, public_key, alg, sign_count, transports, device_type, backed_up) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, user.id, name, spki, alg, auth.counter, transports, auth.flags & FLAG_BE ? "multiDevice" : "singleDevice", auth.flags & FLAG_BS ? 1 : 0);
  return { id, name };
}

// ── Signing in ───────────────────────────────────────────────────────────────

/** Options for the browser: no list of credentials, so the device offers whichever passkeys it holds for this site. */
export async function loginOptions(ctx: Ctx) {
  return { challenge: await newChallenge(ctx, "get", null), rpId: rpId(), timeout: CHALLENGE_MINUTES * 60_000, userVerification: "preferred", allowCredentials: [] as unknown[] };
}

type Assertion = { id?: unknown; rawId?: unknown; type?: unknown; response?: { clientDataJSON?: unknown; authenticatorData?: unknown; signature?: unknown; userHandle?: unknown } };

const refused = () => new ApiError(401, "invalid_passkey", "That passkey couldn’t be verified. Try again, or sign in another way.");

/** Who this assertion proves, and whether the authenticator also verified the person (a PIN, fingerprint or face). */
export async function finishLogin(ctx: Ctx, input: { credential?: Assertion }): Promise<{ userId: number; userVerified: boolean; credentialId: string; rolledBack: boolean }> {
  const cred = input.credential;
  if (!cred || typeof cred !== "object" || cred.type !== "public-key" || !cred.response) throw bad("The browser sent no passkey.");
  const clientDataRaw = bytes(cred.response.clientDataJSON, "client data");
  await consumeChallenge(ctx, checkClientData(clientDataRaw, "webauthn.get"), "get", null);

  const credentialId = b64u(bytes(cred.rawId, "credential id", 1023));
  const row = await ctx.db.get("SELECT user_id, public_key, alg, sign_count FROM passkeys WHERE id = ?", credentialId) as { user_id: number; public_key: Buffer; alg: number; sign_count: number } | undefined;
  if (!row) throw refused();

  const authData = bytes(cred.response.authenticatorData, "authenticator data", 4096);
  const auth = parseAuthData(authData);
  checkAuthData(auth);
  // When the device returns who it thinks the account is, it must be this account.
  if (typeof cred.response.userHandle === "string" && cred.response.userHandle.length > 0) {
    const expected = await ctx.db.get("SELECT handle FROM passkey_users WHERE user_id = ?", row.user_id) as { handle: string } | undefined;
    if (!expected || expected.handle !== cred.response.userHandle) throw refused();
  }
  const signature = bytes(cred.response.signature, "signature", 2048);
  if (!signatureOk(row.alg, Buffer.from(row.public_key), Buffer.concat([authData, sha256(clientDataRaw)]), signature)) throw refused();

  // A counter that does not move forward means the key may have been copied. Counters of zero (synced passkeys) are exempt.
  const rolledBack = (row.sign_count > 0 || auth.counter > 0) && auth.counter <= row.sign_count;
  if (!rolledBack) {
    await ctx.db.run("UPDATE passkeys SET sign_count = ?, last_used_at = ?, backed_up = ?, device_type = ? WHERE id = ?", auth.counter, iso(), auth.flags & FLAG_BS ? 1 : 0, auth.flags & FLAG_BE ? "multiDevice" : "singleDevice", credentialId);
  }
  return { userId: row.user_id, userVerified: Boolean(auth.flags & FLAG_UV), credentialId, rolledBack };
}

// ── Managing ─────────────────────────────────────────────────────────────────

export async function listPasskeys(ctx: Ctx, userId: number) {
  return (await ctx.db.all("SELECT id, name, created_at, last_used_at, transports, device_type, backed_up FROM passkeys WHERE user_id = ? ORDER BY created_at", userId) as PasskeyRow[]).map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    lastUsedAt: p.last_used_at,
    transports: p.transports ? p.transports.split(",") : [],
    synced: p.device_type === "multiDevice",
    backedUp: Boolean(p.backed_up),
  }));
}

export const countPasskeys = async (ctx: Ctx, userId: number) => (await ctx.db.get("SELECT COUNT(*) AS n FROM passkeys WHERE user_id = ?", userId) as { n: number }).n;

export async function renamePasskey(ctx: Ctx, userId: number, id: string, name: unknown) {
  const clean = (typeof name === "string" ? name : "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (!clean) throw badRequest("Give the passkey a name, such as “Work laptop”.");
  if (Number((await ctx.db.run("UPDATE passkeys SET name = ? WHERE id = ? AND user_id = ?", clean, id, userId)).changes) === 0) throw notFound("Passkey");
}

export async function removePasskey(ctx: Ctx, userId: number, id: string) {
  if (Number((await ctx.db.run("DELETE FROM passkeys WHERE id = ? AND user_id = ?", id, userId)).changes) === 0) throw notFound("Passkey");
}
