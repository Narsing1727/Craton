// What every call to an object store (S3, R2) goes through, so one bad second at the provider is not one failed push.
//
// A real object store answers 503 SlowDown when a bucket is hit hard, resets a connection now and then, and sometimes simply never answers.
// Without this, one such call in a push of ten thousand chunks fails the whole push, and a call that hangs holds the push forever. Here:
//   - every attempt has a time limit (longer for bigger bodies), so nothing waits for ever;
//   - network errors, time-outs and the answers a store gives to say "try again" (408, 429, 500, 502, 503, 504, and 400 RequestTimeout) are
//     tried again with exponential back-off and full jitter (and the store's own Retry-After when it sends one), signing each attempt afresh;
//   - an answer that says the role's credentials ran out is retried once after they are fetched again;
//   - after several calls in a row that used up all their attempts, the store is treated as down for a few seconds: calls fail at once
//     with StorageUnavailableError (HTTP 503 + Retry-After at the API) instead of each waiting out its own time-outs, and one probe at a time
//     tests whether it is back. Answers that are the caller's fault (403 AccessDenied, 400) never trigger any of this.
// The counters are in /metrics.

export const storeStats = { requests: 0, retries: 0, failures: 0, breakerOpened: 0, breakerRejected: 0, timeouts: 0 };

/** The object store could not be reached or kept failing: the request can be repeated later. The API answers 503. */
export class StorageUnavailableError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 5) {
    super(message);
    this.name = "StorageUnavailableError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type RetryPolicy = {
  /** Most tries of one call (1 = no retries). */
  attempts: number;
  /** Back-off before the second try; doubles each time, up to maxMs, then a random part of it is waited (full jitter). */
  baseMs: number;
  maxMs: number;
  /** Time limit of one attempt without a body; each megabyte of body adds perMegabyteMs. */
  timeoutMs: number;
  perMegabyteMs: number;
  /** Calls in a row that used up their attempts before the store counts as down, and for how long. */
  breakerFailures: number;
  breakerOpenMs: number;
};

export const DEFAULT_POLICY: RetryPolicy = { attempts: 5, baseMs: 200, maxMs: 5000, timeoutMs: 30_000, perMegabyteMs: 4000, breakerFailures: 5, breakerOpenMs: 10_000 };

export type Answer = { status: number; headers: Headers; body: Buffer };

const RETRY_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function retryAfterMs(headers: Headers, cap: number): number | null {
  const v = headers.get("retry-after");
  if (!v) return null;
  const seconds = Number(v);
  if (Number.isFinite(seconds)) return Math.min(cap, Math.max(0, seconds * 1000));
  const date = Date.parse(v);
  return Number.isFinite(date) ? Math.min(cap, Math.max(0, date - Date.now())) : null;
}

export class ObjectRequester {
  private consecutiveFailures = 0;
  private openUntil = 0;
  private probing = false;

  private readonly label: string;
  private readonly policy: RetryPolicy;
  /** Called when the store says the credentials ran out: drop what is cached so the next attempt fetches new ones. */
  private readonly onCredentialsExpired?: () => void;

  constructor(label: string, policy: RetryPolicy = DEFAULT_POLICY, onCredentialsExpired?: () => void) {
    this.label = label;
    this.policy = policy;
    this.onCredentialsExpired = onCredentialsExpired;
  }

  /**
   * Run `send` (which signs and sends one request) until it gives an answer that is not a "try again", or the attempts are used up.
   * A 404 and every other answer that is not a "try again" is returned as it is; the caller decides what it means.
   */
  async call(label: string, send: (signal: AbortSignal) => Promise<Response>, bodyBytes = 0): Promise<Answer> {
    storeStats.requests++;
    const p = this.policy;
    let probe = false;
    if (this.openUntil > 0) {
      const wait = this.openUntil - Date.now();
      if (wait > 0 || this.probing) {
        storeStats.breakerRejected++;
        throw new StorageUnavailableError(`${this.label} is not answering; not trying again for a few seconds.`, Math.max(1, Math.ceil(Math.max(wait, 1000) / 1000)));
      }
      this.probing = true; // the cool-off is over: this one call tests whether the store is back
      probe = true;
    }
    const timeout = p.timeoutMs + Math.ceil(bodyBytes / 1048576) * p.perMegabyteMs;
    let last = "";
    let refreshed = false;
    try {
      for (let attempt = 1; attempt <= p.attempts; attempt++) {
        let answer: Answer | null = null;
        let again = false;
        let waitHint: number | null = null;
        try {
          const res = await send(AbortSignal.timeout(timeout));
          const body = Buffer.from(await res.arrayBuffer());
          answer = { status: res.status, headers: res.headers, body };
        } catch (err) {
          const e = err as Error;
          if (e.name === "TimeoutError" || e.name === "AbortError") storeStats.timeouts++;
          last = e.name === "TimeoutError" ? `no answer within ${Math.round(timeout / 1000)} s` : e.cause instanceof Error ? `${e.message} (${e.cause.message})` : e.message;
          again = true;
        }
        if (answer) {
          const text = answer.status >= 400 ? answer.body.subarray(0, 2048).toString("utf8") : "";
          if (answer.status === 403 && !refreshed && this.onCredentialsExpired && /ExpiredToken|InvalidToken|TokenRefreshRequired|RequestExpired/.test(text)) {
            refreshed = true;
            this.onCredentialsExpired();
            attempt--; // fetching the credentials again is not one of the tries
            continue;
          }
          if (RETRY_STATUS.has(answer.status) || (answer.status === 400 && /RequestTimeout|SlowDown|InternalError/.test(text))) {
            last = `answered ${answer.status}${/<Code>([^<]+)<\/Code>/.exec(text)?.[1] ? ` ${/<Code>([^<]+)<\/Code>/.exec(text)![1]}` : ""}`;
            waitHint = retryAfterMs(answer.headers, p.maxMs);
            again = true;
          } else {
            this.consecutiveFailures = 0;
            if (probe) this.close();
            return answer;
          }
        }
        if (again && attempt < p.attempts) {
          storeStats.retries++;
          const ceiling = Math.min(p.maxMs, p.baseMs * 2 ** (attempt - 1));
          await sleep(waitHint ?? Math.random() * ceiling);
        }
      }
    } finally {
      if (probe) this.probing = false;
    }
    // every attempt failed
    storeStats.failures++;
    this.consecutiveFailures++;
    if (probe || this.consecutiveFailures >= p.breakerFailures) {
      if (this.openUntil === 0 || probe) storeStats.breakerOpened++;
      this.openUntil = Date.now() + p.breakerOpenMs;
    }
    throw new StorageUnavailableError(`${this.label} ${label} did not succeed after ${p.attempts} tries: ${last}`);
  }

  private close() {
    this.openUntil = 0;
    this.consecutiveFailures = 0;
  }
}
