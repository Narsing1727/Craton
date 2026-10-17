// Time-based one-time passwords, RFC 6238 on top of RFC 4226: HMAC-SHA1, 30-second steps, six
// digits. That is what Google Authenticator, Microsoft Authenticator, 1Password, Authy and every
// other authenticator app implement, so a secret scanned from the QR code works in all of them.

import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const STEP_SECONDS = 30;
export const DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Not a valid base32 secret.");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160 random bits, which is what RFC 4226 recommends for the shared secret. */
export const newTotpSecret = () => base32Encode(randomBytes(20));

/** The HOTP value for one counter (RFC 4226 section 5.3, dynamic truncation). */
export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (unixSeconds: number) => Math.floor(unixSeconds / STEP_SECONDS);

export function totpAt(secretBase32: string, unixSeconds: number, digits = DIGITS): string {
  return hotp(base32Decode(secretBase32), stepAt(unixSeconds), digits);
}

/**
 * The step a code belongs to if it is right for the current step or one either side (clock drift
 * between phone and server), and later than `after` (a code that was already used can't be used
 * again, RFC 6238 section 5.2). Null when it matches nothing.
 */
export function matchTotp(secretBase32: string, code: string, unixSeconds: number, after: number | null = null, window = 1): number | null {
  const given = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const secret = base32Decode(secretBase32);
  const now = stepAt(unixSeconds);
  let hit: number | null = null;
  // Check every step in the window without stopping early, so timing doesn't say which one matched.
  for (let s = now - window; s <= now + window; s++) {
    const expected = Buffer.from(hotp(secret, s));
    const same = expected.length === given.length && expected.equals(Buffer.from(given));
    if (same && (after === null || s > after) && hit === null) hit = s;
  }
  return hit;
}

/** The otpauth:// link an authenticator app reads from the QR code. */
export function otpauthUrl(secretBase32: string, account: string, issuer: string): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
