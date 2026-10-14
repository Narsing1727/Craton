// HTTP client for the Craton API, used by the CLI.

import { CliError } from "./local.ts";

/** Node's fetch says only "fetch failed"; the reason (refused, not found, timed out) is on the error's cause. */
export function networkReason(err: unknown): string {
  const cause = (err as { cause?: { code?: string; message?: string } }).cause;
  const code = cause?.code;
  if (code === "ECONNREFUSED") return "connection refused; nothing is listening there";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "the host name was not found";
  if (code === "ETIMEDOUT" || code === "UND_ERR_CONNECT_TIMEOUT") return "the connection timed out";
  if (code === "ECONNRESET") return "the connection was reset";
  return cause?.message ?? (err as Error).message ?? "unknown error";
}

/** The one sentence the CLI shows when a server cannot be reached, in every command. */
export function unreachableMessage(server: string, err: unknown): string {
  return `Can’t reach ${server}: ${networkReason(err)}. Is the server running? A repository remembers the server it was cloned from; \`craton doctor\` checks the address, your sign-in and the connection.`;
}

/** How many times one request may wait out a rate limit before giving up. */
const MAX_RATE_WAITS = 10;
/** When the server last said to wait until; every request in this process holds back until then, not just the one that was told. */
let pausedUntil = 0;

export class Remote {
  readonly server: string;
  readonly owner: string;
  readonly name: string;
  private readonly token: string | null;

  constructor(server: string, owner: string, name: string, token: string | null) {
    this.server = server;
    this.owner = owner;
    this.name = name;
    this.token = token;
  }

  private url(p: string) {
    return `${this.server}/v1/repos/${this.owner}/${this.name}${p}`;
  }

  async request<T>(method: string, p: string, body?: unknown, raw?: Buffer, attempt = 1, idemKey?: string, rateWaits = 0): Promise<T> {
    // A retry (network error or 5xx below) might be retrying a request the server actually
    // finished — the response just never made it back. Give mutating requests one idempotency
    // key, generated on the first attempt and carried through every retry of that same call, so a
    // retry replays the first outcome instead of applying twice (e.g. two commits on one push).
    const mutating = method === "POST" || method === "PUT" || method === "PATCH" || method === "DELETE";
    const key = idemKey ?? (mutating ? crypto.randomUUID() : undefined);
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    if (raw) headers["content-type"] = "application/octet-stream";
    if (key) headers["idempotency-key"] = key;
    let res: Response;
    const hold = pausedUntil - Date.now();
    if (hold > 0) await new Promise((r) => setTimeout(r, hold));
    try {
      res = await fetch(p.startsWith("http") ? p : this.url(p), {
        method,
        headers,
        body: raw ? new Uint8Array(raw) : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      // Flaky field connections: retry transient network failures with backoff.
      if (attempt < 4) {
        await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
        return this.request(method, p, body, raw, attempt + 1, key, rateWaits);
      }
      throw new CliError(unreachableMessage(this.server, err));
    }
    // Rate limited: the server says how long to wait. A push of thousands of small files makes thousands of requests,
    // so waiting out the window (and carrying on with the same idempotency key) is the normal way through, not a failure.
    if (res.status === 429 && rateWaits < MAX_RATE_WAITS) {
      const seconds = Math.min(60, Math.max(1, Number(res.headers.get("retry-after")) || 5));
      const until = Date.now() + seconds * 1000;
      if (until > pausedUntil + 1000) process.stderr.write(`
  rate limited by the server; waiting ${seconds} s and continuing
`);
      pausedUntil = Math.max(pausedUntil, until);
      await new Promise((r) => setTimeout(r, Math.max(0, pausedUntil - Date.now())));
      return this.request(method, p, body, raw, attempt, key, rateWaits + 1);
    }
    if (res.status >= 500 && attempt < 4) {
      await new Promise((r) => setTimeout(r, 300 * 2 ** attempt));
      return this.request(method, p, body, raw, attempt + 1, key, rateWaits);
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`;
      let code = "http_error";
      let details: unknown;
      try {
        const j = (await res.json()) as { error?: { message: string; code: string; details?: unknown } };
        if (j.error) ({ message, code, details } = j.error);
      } catch {}
      // A private repository you cannot see answers exactly like one that does not exist (so its existence is not
      // revealed); say what could be behind it, and where to look.
      if (res.status === 404 && /^Repository not found$/i.test(message)) {
        message = this.token
          ? `${this.owner}/${this.name} was not found, or your token cannot see it. Check the name; \`craton doctor\` checks your sign-in and access.`
          : `${this.owner}/${this.name} was not found. If it is private, sign in first: craton auth login --token <token>. \`craton doctor\` checks the rest.`;
      }
      const err = new CliError(message) as CliError & { code?: string; details?: unknown; status?: number };
      err.code = code;
      err.details = details;
      err.status = res.status;
      throw err;
    }
    if (res.status === 204) return undefined as T;
    const type = res.headers.get("content-type") ?? "";
    return (type.includes("json") ? await res.json() : Buffer.from(await res.arrayBuffer())) as T;
  }
}
