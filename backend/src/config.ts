// Runtime configuration. Every value can be overridden with an environment variable.
// The three product decisions from ../DECISIONS.md live here as single settings.

import path from "node:path";

const env = process.env;
const root = path.resolve(import.meta.dirname, "..");

import fs from "node:fs";

/** This package's own version, so the server and the CLI can say which build they are. */
function readVersion(): string {
  try {
    return (JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const config = {
  /** The build's version, the API's compatibility number, and the oldest CLI that is expected to work against it. */
  version: readVersion(),
  apiVersion: 1,
  minCliVersion: "0.1.0",
  port: Number(env.PORT ?? 4000),
  /**
   * One JSON line per API request on standard output when CRATON_ACCESS_LOG=1: time, method, route pattern, status,
   * milliseconds, request id, who. Never bodies, query strings or tokens. `write` is replaceable so tests can listen.
   */
  accessLog: { enabled: env.CRATON_ACCESS_LOG === "1", write: (line: string) => void process.stdout.write(line + String.fromCharCode(10)) } as { enabled: boolean; write: (line: string) => void },
  /** Where the SQLite database and local chunk store live. */
  dataDir: path.resolve(env.CRATON_DATA_DIR ?? path.join(root, "data")),
  /** Where the web app lives, for links the API writes (password reset). */
  webUrl: (env.CRATON_WEB_URL ?? "http://localhost:3100").replace(/\/+$/, ""),
  /** Origins allowed to call the API from a browser. */
  /** Socket addresses allowed to pass on the browser's address (x-craton-client-ip): the web app. */
  trustedProxies: (env.CRATON_TRUSTED_PROXIES ?? "127.0.0.1,::1,::ffff:127.0.0.1").split(",").map((s) => s.trim()),
  corsOrigins: (env.CRATON_CORS_ORIGINS ?? "http://localhost:3100").split(","),

  /** Render map previews in the background after a push. CRATON_PREWARM_PREVIEWS=off to disable. */
  prewarmPreviews: env.CRATON_PREWARM_PREVIEWS !== "off",

  /**
   * Webhooks call URLs that users typed, so private and loopback addresses are refused. Set
   * CRATON_WEBHOOKS_ALLOW_PRIVATE=1 only on a development machine (and in tests) to reach localhost.
   * autoDeliver: send as soon as an event happens; the tests turn it off to deliver on demand.
   */
  webhooks: { allowPrivate: env.CRATON_WEBHOOKS_ALLOW_PRIVATE === "1", autoDeliver: true } as { allowPrivate: boolean; autoDeliver: boolean },

  /** Files added from the browser (bigger ones go through the CLI, which resumes and verifies every chunk). */
  upload: { maxBytes: Number(env.CRATON_UPLOAD_MAX_MB ?? 100) * 1024 * 1024, maxFiles: 200 },

  /** Content-defined chunking sizes (bytes). Average 128 KB, like the UI promises. */
  chunking: { min: 32 * 1024, avg: 128 * 1024, max: 512 * 1024 },

  /** DECISIONS.md #3: cross-account dedup covers public data only. */
  dedupScope: "public-plus-owner" as const,

  /** DECISIONS.md #2: store byte-identical originals; no format conversion on ingest. */
  normalizeOnIngest: false,

  /** DECISIONS.md #1: plan limits, bytes stored after deduplication (design doc numbers). */
  plans: {
    free: { storageBytes: 20 * 1024 ** 3, privateRepos: 3 },
    team: { storageBytes: 200 * 1024 ** 3, privateRepos: Infinity },
  },

  /**
   * Transactional email. With EMAIL_API_KEY set, mail goes through Resend or Postmark; otherwise
   * it's written to data/outbox/ (and logged) so every flow still works in development.
   */
  email: {
    provider: (env.EMAIL_PROVIDER ?? "resend") as "resend" | "postmark",
    apiKey: env.EMAIL_API_KEY ?? "",
    from: env.EMAIL_FROM ?? "Craton <no-reply@craton.local>",
  },

  /** A file lock older than this many days is reported as stale, so the holder and the admins are nudged to let go. */
  locks: { staleAfterDays: Number(env.CRATON_LOCK_STALE_DAYS ?? 7) },

  /** Request limits (per client IP or token, per window). Set CRATON_RATE_LIMITS=off to disable. */
  limits: {
    enabled: env.CRATON_RATE_LIMITS !== "off",
    api: { max: Number(env.CRATON_API_RATE ?? 1200), windowMs: 60_000 },
    login: { max: 10, windowMs: 15 * 60_000 },
    signup: { max: 10, windowMs: 60 * 60_000 },
    reset: { max: 5, windowMs: 60 * 60_000 },
    /** Failed sign-ins on one account before it's locked for the window. */
    lockout: { max: 10, windowMs: 15 * 60_000 },
  },

  /** Cloudflare R2 (S3 API). When all four are set, chunks are stored in R2 instead of on disk. */
  r2: {
    accountId: env.R2_ACCOUNT_ID ?? "",
    accessKeyId: env.R2_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.R2_SECRET_ACCESS_KEY ?? "",
    bucket: env.R2_BUCKET ?? "",
  },
} as const;

export const r2Enabled = () => Boolean(config.r2.accountId && config.r2.accessKeyId && config.r2.secretAccessKey && config.r2.bucket);
