// A cache and counter store that several API servers can share: Redis (CRATON_REDIS_URL; AWS ElastiCache, Valkey and Redis all work),
// or, with no URL, a copy of the same in the server's own memory.
//
// What goes through it, and why none of it can break a request:
//   - request rate limits, counted across every server (a sliding window per key);
//   - rendered tiles and previews (bytes, a pure function of the stored data, so they never go stale), shared between servers and kept
//     across restarts;
//   - short-lived copies of the public pages everyone hits (the explore list, trending), and idempotency keys.
// It is only ever a speed-up. Every operation is guarded: if Redis does not answer, the call behaves as a miss (or, for a rate limit, as
// a counter local to this server), and after a failure Redis is left alone for a few seconds instead of slowing every request down with
// timeouts. Nothing that must be right (accounts, tokens, repositories, who may read what) is ever kept here.

import { Redis } from "ioredis";

export type Window = { max: number; windowMs: number };
export type WindowResult = { allowed: boolean; remaining: number; resetMs: number; limit: number };

export interface Cache {
  readonly kind: "memory" | "redis";
  get(key: string): Promise<Buffer | null>;
  set(key: string, value: Buffer | string, ttlSeconds: number): Promise<void>;
  del(...keys: string[]): Promise<void>;
  /** Sliding window: is one more hit under `max` within `windowMs`? If so it is recorded. */
  hit(key: string, w: Window): Promise<WindowResult>;
  /** How many hits are in the window, without recording one. */
  count(key: string, windowMs: number): Promise<number>;
  clear(key: string): Promise<void>;
  /** Take a lock for `ttlMs`: true for the one caller that gets it, false for everyone else until it runs out. Servers sharing Redis share the lock. */
  lock(key: string, ttlMs: number): Promise<boolean>;
  /** "ok", or why the shared store is not being used right now. */
  status(): Promise<string>;
  close(): Promise<void>;
}

// ── In this server's memory ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_ENTRIES = 5000;

export class MemoryCache implements Cache {
  readonly kind = "memory" as const;
  private readonly values = new Map<string, { value: Buffer; expires: number }>();
  private readonly hits = new Map<string, number[]>();
  private readonly sweeper: NodeJS.Timeout;

  constructor() {
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [k, v] of this.values) if (v.expires <= now) this.values.delete(k);
      for (const [k, list] of this.hits) if (!list.length || list[list.length - 1] < now - 60 * 60_000) this.hits.delete(k);
    }, 60_000);
    this.sweeper.unref();
  }

  async get(key: string) {
    const hit = this.values.get(key);
    if (!hit) return null;
    if (hit.expires <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    // Recently used entries move to the back, so the front is what to drop first.
    this.values.delete(key);
    this.values.set(key, hit);
    return hit.value;
  }

  async set(key: string, value: Buffer | string, ttlSeconds: number) {
    this.values.delete(key);
    this.values.set(key, { value: Buffer.isBuffer(value) ? value : Buffer.from(value), expires: Date.now() + ttlSeconds * 1000 });
    while (this.values.size > MAX_ENTRIES) this.values.delete(this.values.keys().next().value!);
  }

  async del(...keys: string[]) {
    for (const k of keys) this.values.delete(k);
  }

  async hit(key: string, w: Window, now = Date.now()): Promise<WindowResult> {
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - w.windowMs);
    const allowed = list.length < w.max;
    if (allowed) list.push(now);
    this.hits.set(key, list);
    const oldest = list[0] ?? now;
    return { allowed, remaining: Math.max(0, w.max - list.length), resetMs: Math.max(0, oldest + w.windowMs - now), limit: w.max };
  }

  async count(key: string, windowMs: number, now = Date.now()) {
    return (this.hits.get(key) ?? []).filter((t) => t > now - windowMs).length;
  }

  async clear(key: string) {
    this.hits.delete(key);
  }

  private readonly locks = new Map<string, number>();

  async lock(key: string, ttlMs: number) {
    const now = Date.now();
    if ((this.locks.get(key) ?? 0) > now) return false;
    this.locks.set(key, now + ttlMs);
    return true;
  }

  async status() {
    return "ok";
  }

  async close() {
    clearInterval(this.sweeper);
  }
}

// ── Redis ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

// One round trip, atomic: drop the hits that left the window, count, and record this one if there is room. Hits are members of a sorted
// set scored by time; the member carries a random suffix so two hits in the same millisecond are two members.
const WINDOW_SCRIPT = `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local max = tonumber(ARGV[3])
local record = ARGV[4] == '1'
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - window)
local count = redis.call('ZCARD', KEYS[1])
local allowed = 0
if record and count < max then
  redis.call('ZADD', KEYS[1], now, ARGV[5])
  redis.call('PEXPIRE', KEYS[1], window)
  count = count + 1
  allowed = 1
elseif (not record) then
  allowed = 1
end
local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
local reset = 0
if oldest[2] then reset = math.max(0, tonumber(oldest[2]) + window - now) end
return {allowed, count, reset}
`;

const COOL_OFF_MS = 5000;

export class RedisCache implements Cache {
  readonly kind = "redis" as const;
  private readonly redis: Redis;
  private readonly prefix: string;
  /** What this server counts on its own while Redis is not answering. */
  private readonly local = new MemoryCache();
  private downUntil = 0;
  private lastError = "";

  constructor(url: string, prefix: string) {
    this.prefix = prefix;
    this.redis = new Redis(url, {
      lazyConnect: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      // A command waits for the connection (the first ones after a start, or a reconnect) for at most this long, then counts as a failure;
      // after a failure Redis is left alone for a few seconds (COOL_OFF_MS), so a Redis that is away costs one short wait, not one per request.
      commandTimeout: 800,
      retryStrategy: (times) => Math.min(200 * 2 ** Math.min(times, 5), 5000),
    });
    // An unhandled 'error' event would stop the process; a cache that is away is not worth that.
    this.redis.on("error", (err) => {
      this.lastError = err.message;
    });
    // The cache must never be what keeps a process alive: the HTTP server does that for a real one, and a script or a test that is done
    // should be able to end without closing it.
    this.redis.on("connect", () => (this.redis.stream as { unref?: () => void } | undefined)?.unref?.());
  }

  private usable() {
    return Date.now() >= this.downUntil;
  }

  private async guarded<T>(work: () => Promise<T>, fallback: () => Promise<T> | T): Promise<T> {
    if (!this.usable()) return fallback();
    try {
      return await work();
    } catch (err) {
      this.lastError = (err as Error).message;
      this.downUntil = Date.now() + COOL_OFF_MS;
      return fallback();
    }
  }

  async get(key: string) {
    return this.guarded(() => this.redis.getBuffer(this.prefix + key), () => null);
  }

  async set(key: string, value: Buffer | string, ttlSeconds: number) {
    await this.guarded(async () => void (await this.redis.set(this.prefix + key, value, "EX", Math.max(1, Math.floor(ttlSeconds)))), () => undefined);
  }

  async del(...keys: string[]) {
    if (!keys.length) return;
    await this.guarded(async () => void (await this.redis.del(...keys.map((k) => this.prefix + k))), () => undefined);
  }

  async hit(key: string, w: Window): Promise<WindowResult> {
    return this.guarded(
      async () => {
        const [allowed, count, reset] = (await this.redis.eval(WINDOW_SCRIPT, 1, this.prefix + key, Date.now(), w.windowMs, w.max, "1", `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`)) as [number, number, number];
        return { allowed: allowed === 1, remaining: Math.max(0, w.max - count), resetMs: reset, limit: w.max };
      },
      () => this.local.hit(key, w),
    );
  }

  async count(key: string, windowMs: number) {
    return this.guarded(
      async () => {
        const [, count] = (await this.redis.eval(WINDOW_SCRIPT, 1, this.prefix + key, Date.now(), windowMs, 0, "0", "x")) as [number, number, number];
        return count;
      },
      () => this.local.count(key, windowMs),
    );
  }

  async clear(key: string) {
    await this.local.clear(key);
    await this.guarded(async () => void (await this.redis.del(this.prefix + key)), () => undefined);
  }

  async lock(key: string, ttlMs: number) {
    return this.guarded(
      async () => (await this.redis.set(`${this.prefix}lock:${key}`, String(process.pid), "PX", Math.max(1, Math.floor(ttlMs)), "NX")) === "OK",
      // Redis is away: this server cannot know about the others, so it behaves as a single one (a duplicate run is better than none).
      () => this.local.lock(key, ttlMs),
    );
  }

  async status() {
    if (!this.usable()) return `degraded: ${this.lastError || "not answering"} (local limits in use)`;
    try {
      await this.redis.ping();
      return "ok";
    } catch (err) {
      this.lastError = (err as Error).message;
      this.downUntil = Date.now() + COOL_OFF_MS;
      return `degraded: ${this.lastError} (local limits in use)`;
    }
  }

  async close() {
    await this.local.close();
    this.redis.disconnect();
  }
}

// ── The one the process uses ────────────────────────────────────────────────────────────────────────────────────────────────────────

let current: Cache | null = null;

/** The shared cache: Redis when CRATON_REDIS_URL (or CRATON_TEST_REDIS, for the test suite) is set, else this server's memory. */
export function getCache(): Cache {
  if (!current) {
    const url = process.env.CRATON_REDIS_URL || process.env.CRATON_TEST_REDIS || "";
    // Test processes run side by side against one Redis: each gets keys of its own.
    const prefix = process.env.CRATON_REDIS_PREFIX ?? (process.env.NODE_TEST_CONTEXT ? `t${process.pid}:${Math.random().toString(36).slice(2, 8)}:` : "craton:");
    current = url ? new RedisCache(url, prefix) : new MemoryCache();
  }
  return current;
}

/** Replace the cache (tests). */
export async function setCache(next: Cache | null) {
  const old = current;
  current = next;
  if (old && old !== next) await old.close();
}
