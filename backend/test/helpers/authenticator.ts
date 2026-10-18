// A software WebAuthn authenticator for tests. It makes the same bytes a real device does: authenticator data with flags and
// a signature counter, a COSE public key in CBOR, an attestation object ("none"), and signatures over
// authenticatorData || SHA-256(clientDataJSON) with ES256, RS256 or EdDSA.

import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

const sha256 = (v: Buffer | string) => createHash("sha256").update(v).digest();
const b64u = (b: Buffer) => b.toString("base64url");

// ── A small CBOR writer (definite lengths, canonical enough for WebAuthn) ───────────────────────

function head(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n]);
  if (n < 256) return Buffer.from([(major << 5) | 24, n]);
  if (n < 65536) return Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  const b = Buffer.alloc(5);
  b[0] = (major << 5) | 26;
  b.writeUInt32BE(n, 1);
  return b;
}
export function encodeCbor(v: unknown): Buffer {
  if (typeof v === "number") return v >= 0 ? head(0, v) : head(1, -1 - v);
  if (typeof v === "string") {
    const raw = Buffer.from(v, "utf8");
    return Buffer.concat([head(3, raw.length), raw]);
  }
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(encodeCbor)]);
  if (v instanceof Map) return Buffer.concat([head(5, v.size), ...[...v].flatMap(([k, x]) => [encodeCbor(k), encodeCbor(x)])]);
  throw new Error(`cannot encode ${typeof v}`);
}

export type Alg = "ES256" | "RS256" | "EdDSA";
export type Options = { challenge: string; rp?: { id: string }; rpId?: string; user?: { id: string } };

export class SoftAuthenticator {
  readonly credentialId = randomBytes(32);
  private readonly privateKey: KeyObject;
  private readonly cose: Map<number, unknown>;
  counter = 0;

  readonly alg: Alg;
  readonly origin: string;
  readonly rp: string;
  /** Whether the device verified the person (PIN, fingerprint) as well as noticing their presence. */
  uv: boolean;
  /** Whether the counter climbs (a hardware key) or stays at zero (a synced passkey). */
  counts: boolean;

  constructor(alg: Alg = "ES256", origin = "http://localhost:3100", rp = "localhost", uv = true, counts = true) {
    this.alg = alg;
    this.origin = origin;
    this.rp = rp;
    this.uv = uv;
    this.counts = counts;
    if (alg === "ES256") {
      const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      const jwk = publicKey.export({ format: "jwk" }) as { x: string; y: string };
      this.privateKey = privateKey;
      this.cose = new Map<number, unknown>([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, "base64url")], [-3, Buffer.from(jwk.y, "base64url")]]);
    } else if (alg === "RS256") {
      const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const jwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
      this.privateKey = privateKey;
      this.cose = new Map<number, unknown>([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, "base64url")], [-2, Buffer.from(jwk.e, "base64url")]]);
    } else {
      const { privateKey, publicKey } = generateKeyPairSync("ed25519");
      const jwk = publicKey.export({ format: "jwk" }) as { x: string };
      this.privateKey = privateKey;
      this.cose = new Map<number, unknown>([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, "base64url")]]);
    }
  }

  get id() {
    return b64u(this.credentialId);
  }

  private clientData(type: string, challenge: string, extra: Record<string, unknown> = {}) {
    return Buffer.from(JSON.stringify({ type, challenge, origin: this.origin, crossOrigin: false, ...extra }));
  }

  private flags(extra = 0) {
    return 0x01 | (this.uv ? 0x04 : 0) | extra;
  }

  private header(rpId: string, flags: number, counter: number) {
    const c = Buffer.alloc(4);
    c.writeUInt32BE(counter);
    return Buffer.concat([sha256(rpId), Buffer.from([flags]), c]);
  }

  /** What the browser returns from navigator.credentials.create(), with the fields as base64url. */
  create(options: Options, tweak: { rpId?: string; flags?: number; clientData?: Record<string, unknown>; type?: string; challenge?: string; credentialId?: Buffer; cose?: Map<number, unknown>; attestation?: Buffer } = {}) {
    if (this.counts) this.counter = this.counter || 0;
    const attested = Buffer.concat([
      Buffer.alloc(16),
      Buffer.from([(this.credentialId.length >> 8) & 255, this.credentialId.length & 255]),
      this.credentialId,
      encodeCbor(tweak.cose ?? this.cose),
    ]);
    const authData = Buffer.concat([this.header(tweak.rpId ?? this.rp, tweak.flags ?? this.flags(0x40 | 0x08), this.counts ? 1 : 0), attested]);
    if (this.counts) this.counter = 1;
    const attestation = tweak.attestation ?? encodeCbor(new Map<string, unknown>([["fmt", "none"], ["attStmt", new Map()], ["authData", authData]]));
    return {
      id: b64u(tweak.credentialId ?? this.credentialId),
      rawId: b64u(tweak.credentialId ?? this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64u(this.clientData(tweak.type ?? "webauthn.create", tweak.challenge ?? options.challenge, tweak.clientData)),
        attestationObject: b64u(attestation),
        transports: ["internal", "hybrid"],
      },
    };
  }

  /** What the browser returns from navigator.credentials.get(). */
  get(options: Options, tweak: { rpId?: string; flags?: number; counter?: number; clientData?: Record<string, unknown>; type?: string; challenge?: string; userHandle?: string; tamper?: boolean } = {}) {
    if (tweak.counter === undefined && this.counts) this.counter += 1;
    const counter = tweak.counter ?? (this.counts ? this.counter : 0);
    const authData = this.header(tweak.rpId ?? this.rp, tweak.flags ?? this.flags(), counter);
    const clientDataJSON = this.clientData(tweak.type ?? "webauthn.get", tweak.challenge ?? options.challenge, tweak.clientData);
    const data = Buffer.concat([authData, sha256(clientDataJSON)]);
    let signature = this.alg === "EdDSA" ? sign(null, data, this.privateKey) : sign("sha256", data, this.privateKey);
    if (tweak.tamper) signature = Buffer.concat([signature.subarray(0, signature.length - 1), Buffer.from([signature[signature.length - 1] ^ 1])]);
    return {
      id: this.id,
      rawId: this.id,
      type: "public-key",
      response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), ...(tweak.userHandle !== undefined ? { userHandle: tweak.userHandle } : {}) },
    };
  }
}
