// Encrypting small secrets kept in the database (an authenticator secret has to be read back, so
// it can't be hashed like a password). AES-256-GCM with a random nonce per value; the key comes
// from CRATON_SECRET_KEY (32 bytes, base64 or hex) or, if that isn't set, a key file created once
// next to the database. Keep the key out of backups of the database: a copy of both is enough to
// read every secret.

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.ts";

let cached: Buffer | null = null;

function parseKey(text: string): Buffer {
  const t = text.trim();
  const key = /^[0-9a-f]{64}$/i.test(t) ? Buffer.from(t, "hex") : Buffer.from(t, "base64");
  if (key.length !== 32) throw new Error("CRATON_SECRET_KEY must be 32 bytes, as 64 hex characters or base64.");
  return key;
}

function key(): Buffer {
  if (cached) return cached;
  if (process.env.CRATON_SECRET_KEY) return (cached = parseKey(process.env.CRATON_SECRET_KEY));
  // Tests get a fresh key per process and never write a file into the real data directory.
  if (process.env.NODE_TEST_CONTEXT) return (cached = randomBytes(32));
  const file = path.join(config.dataDir, "secret.key");
  try {
    return (cached = parseKey(fs.readFileSync(file, "utf8")));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  fs.mkdirSync(config.dataDir, { recursive: true });
  const fresh = randomBytes(32);
  fs.writeFileSync(file, fresh.toString("base64"), { mode: 0o600, flag: "wx" });
  return (cached = fresh);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptSecret(stored: string): string {
  const [version, iv, tag, body] = stored.split(".");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised secret format.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}
