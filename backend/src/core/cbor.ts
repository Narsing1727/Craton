// A reader for the small part of CBOR (RFC 8949) that WebAuthn uses: the attestation object and the credential public key
// (a COSE key). Definite lengths only, as CTAP2's canonical form requires; indefinite lengths, tags and big floats are
// refused rather than half understood. Every length is checked against what is actually left, nesting is capped, and
// nothing allocates from an attacker-chosen number before it has been checked.

export class CborError extends Error {}

export type CborValue = number | bigint | string | boolean | null | undefined | Buffer | CborValue[] | Map<CborValue, CborValue>;

const MAX_DEPTH = 8;
const MAX_ITEMS = 512;

/** Decode one item from the start of `buf`; says how many bytes it used, because authenticator data has more after it. */
export function decodeCbor(buf: Buffer, offset = 0): { value: CborValue; end: number } {
  const state = { pos: offset };
  const value = item(buf, state, 0);
  return { value, end: state.pos };
}

function need(buf: Buffer, pos: number, n: number) {
  if (n < 0 || pos + n > buf.length) throw new CborError("CBOR ended early");
}

function argument(buf: Buffer, s: { pos: number }, info: number): number | bigint {
  if (info < 24) return info;
  if (info === 24) {
    need(buf, s.pos, 1);
    return buf[s.pos++];
  }
  if (info === 25) {
    need(buf, s.pos, 2);
    const v = buf.readUInt16BE(s.pos);
    s.pos += 2;
    return v;
  }
  if (info === 26) {
    need(buf, s.pos, 4);
    const v = buf.readUInt32BE(s.pos);
    s.pos += 4;
    return v;
  }
  if (info === 27) {
    need(buf, s.pos, 8);
    const v = buf.readBigUInt64BE(s.pos);
    s.pos += 8;
    return v <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(v) : v;
  }
  throw new CborError("indefinite or reserved CBOR length");
}

function length(buf: Buffer, s: { pos: number }, info: number): number {
  const n = argument(buf, s, info);
  if (typeof n !== "number" || n > buf.length) throw new CborError("CBOR length is larger than the data");
  return n;
}

function item(buf: Buffer, s: { pos: number }, depth: number): CborValue {
  if (depth > MAX_DEPTH) throw new CborError("CBOR is nested too deeply");
  need(buf, s.pos, 1);
  const head = buf[s.pos++];
  const major = head >> 5;
  const info = head & 0x1f;
  switch (major) {
    case 0:
      return argument(buf, s, info);
    case 1: {
      const n = argument(buf, s, info);
      return typeof n === "number" ? -1 - n : -1n - n;
    }
    case 2: {
      const n = length(buf, s, info);
      need(buf, s.pos, n);
      const out = Buffer.from(buf.subarray(s.pos, s.pos + n));
      s.pos += n;
      return out;
    }
    case 3: {
      const n = length(buf, s, info);
      need(buf, s.pos, n);
      const out = buf.subarray(s.pos, s.pos + n).toString("utf8");
      s.pos += n;
      return out;
    }
    case 4: {
      const n = length(buf, s, info);
      if (n > MAX_ITEMS) throw new CborError("CBOR array is too long");
      const out: CborValue[] = [];
      for (let i = 0; i < n; i++) out.push(item(buf, s, depth + 1));
      return out;
    }
    case 5: {
      const n = length(buf, s, info);
      if (n > MAX_ITEMS) throw new CborError("CBOR map is too large");
      const out = new Map<CborValue, CborValue>();
      for (let i = 0; i < n; i++) {
        const k = item(buf, s, depth + 1);
        if (typeof k !== "number" && typeof k !== "string") throw new CborError("CBOR map key is not an integer or text");
        if (out.has(k)) throw new CborError("CBOR map repeats a key");
        out.set(k, item(buf, s, depth + 1));
      }
      return out;
    }
    case 7:
      if (info === 20) return false;
      if (info === 21) return true;
      if (info === 22) return null;
      if (info === 23) return undefined;
      throw new CborError("unsupported CBOR simple value or float");
    default:
      throw new CborError("CBOR tags are not supported");
  }
}
