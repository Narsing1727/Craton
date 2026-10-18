// What a Craton access token looks like.
//
//   crt_pat_<30 random characters><6-character checksum>     personal access token
//   crt_ses_<30 random characters><6-character checksum>     web session
//
// The prefix says what it is and who issued it, and the checksum (CRC-32 of the random part, in base 62) lets a scanner
// tell a real-looking token from a lookalike without asking the server, so a scan can be quick and quiet about what it
// finds. The checksum is not a secret and adds nothing to the token's strength; the 30 random characters (about 178 bits)
// do. Tokens issued before this format (bcn_pat_…, bcn_s_…) still sign in, and are recognised by looking them up.

import { crc32 } from "node:zlib";
import { randomInt } from "node:crypto";

const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const RANDOM_LENGTH = 30;
const CHECK_LENGTH = 6;

export type TokenKind = "pat" | "ses";

/** A number as exactly `width` base-62 digits. */
function base62(value: number, width: number): string {
  let out = "";
  let n = value;
  for (let i = 0; i < width; i++) {
    out = ALPHABET[n % 62] + out;
    n = Math.floor(n / 62);
  }
  return out;
}

/** The 6 checksum characters for 30 random ones. */
export const checksumOf = (random: string) => base62(crc32(random) >>> 0, CHECK_LENGTH);

export function makeToken(kind: TokenKind): string {
  let random = "";
  for (let i = 0; i < RANDOM_LENGTH; i++) random += ALPHABET[randomInt(62)];
  return `crt_${kind}_${random}${checksumOf(random)}`;
}

/** Matches a token anywhere in text. The groups are the kind and the 36 characters after the prefix. */
export const TOKEN_IN_TEXT = /(?<![A-Za-z0-9_])crt_(pat|ses)_([0-9A-Za-z]{36})(?![A-Za-z0-9_])/g;
/** The older format, found in text only to be looked up (it has no checksum). */
export const LEGACY_TOKEN_IN_TEXT = /(?<![A-Za-z0-9_])bcn_(?:pat|s)_[A-Za-z0-9_-]{32}(?![A-Za-z0-9_-])/g;

/**
 * True when the 36 characters carry a correct checksum. GitHub's tokens (ghp_…) use the same scheme, so this also
 * lets a scan skip lookalikes of theirs.
 */
export function checksumValid(body36: string): boolean {
  if (!/^[0-9A-Za-z]{36}$/.test(body36)) return false;
  return checksumOf(body36.slice(0, RANDOM_LENGTH)) === body36.slice(RANDOM_LENGTH);
}
