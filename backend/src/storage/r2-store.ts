// Cloudflare R2 chunk store via the S3 API (zero egress fees, design doc).
// Enabled when R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are set.
// Note: exercised against the AWS SigV4 test vector in the test suite, not yet against live R2.

import type { ChunkStore } from "./chunk-store.ts";
import { amzDateNow, payloadSha256, signRequest } from "./sigv4.ts";
import { DEFAULT_POLICY, ObjectRequester, type RetryPolicy } from "./resilient.ts";

export class R2Store implements ChunkStore {
  readonly kind = "cloudflare-r2";
  private readonly host: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;
  private readonly requester: ObjectRequester;

  constructor(opts: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; retry?: Partial<RetryPolicy> }) {
    this.requester = new ObjectRequester("Cloudflare R2", { ...DEFAULT_POLICY, ...opts.retry });
    this.host = `${opts.accountId}.r2.cloudflarestorage.com`;
    this.bucket = opts.bucket;
    this.accessKeyId = opts.accessKeyId;
    this.secretAccessKey = opts.secretAccessKey;
  }

  /** One signed request, tried again when the store says so (see resilient.ts); each attempt is signed afresh. */
  private request(method: "GET" | "PUT" | "HEAD" | "DELETE", hash: string, body?: Buffer) {
    const path = `/${this.bucket}/chunks/${hash.slice(0, 2)}/${hash}`;
    const payloadHash = payloadSha256(body ?? "");
    return this.requester.call(
      `${method} ${hash.slice(0, 12)}`,
      async (signal) => {
        const { headers } = signRequest({
          method,
          host: this.host,
          path,
          payloadHash,
          amzDate: amzDateNow(),
          region: "auto",
          service: "s3",
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        });
        const { host: _host, ...sendHeaders } = headers;
        return fetch(`https://${this.host}${path}`, { method, headers: sendHeaders, body: body ? new Uint8Array(body) : undefined, signal });
      },
      body?.length ?? 0,
    );
  }

  async put(hash: string, stored: Buffer) {
    const res = await this.request("PUT", hash, stored);
    if (res.status < 200 || res.status >= 300) throw new Error(`R2 PUT ${hash} failed: ${res.status} ${res.body.toString("utf8", 0, 300)}`);
  }

  async replace(hash: string, stored: Buffer) {
    await this.put(hash, stored); // an object store's PUT replaces the object
  }

  async get(hash: string) {
    const res = await this.request("GET", hash);
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) throw new Error(`R2 GET ${hash} failed: ${res.status}`);
    return res.body;
  }

  async has(hash: string) {
    const res = await this.request("HEAD", hash);
    if (res.status === 404) return false;
    if (res.status < 200 || res.status >= 300) throw new Error(`R2 HEAD ${hash} failed: ${res.status}`);
    return true;
  }

  async delete(hash: string) {
    const res = await this.request("DELETE", hash);
    if ((res.status < 200 || res.status >= 300) && res.status !== 404) throw new Error(`R2 DELETE ${hash} failed: ${res.status}`);
  }
}
