// Cloudflare R2 chunk store via the S3 API (zero egress fees, design doc).
// Enabled when R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET are set.
// Note: exercised against the AWS SigV4 test vector in the test suite, not yet against live R2.

import type { ChunkStore } from "./chunk-store.ts";
import { amzDateNow, payloadSha256, signRequest } from "./sigv4.ts";

export class R2Store implements ChunkStore {
  readonly kind = "cloudflare-r2";
  private readonly host: string;
  private readonly bucket: string;
  private readonly accessKeyId: string;
  private readonly secretAccessKey: string;

  constructor(opts: { accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string }) {
    this.host = `${opts.accountId}.r2.cloudflarestorage.com`;
    this.bucket = opts.bucket;
    this.accessKeyId = opts.accessKeyId;
    this.secretAccessKey = opts.secretAccessKey;
  }

  private async request(method: "GET" | "PUT" | "HEAD" | "DELETE", hash: string, body?: Buffer) {
    const path = `/${this.bucket}/chunks/${hash.slice(0, 2)}/${hash}`;
    const payloadHash = body ? payloadSha256(body) : payloadSha256("");
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
    return fetch(`https://${this.host}${path}`, { method, headers: sendHeaders, body: body ? new Uint8Array(body) : undefined });
  }

  async put(hash: string, stored: Buffer) {
    const res = await this.request("PUT", hash, stored);
    if (!res.ok) throw new Error(`R2 PUT ${hash} failed: ${res.status} ${await res.text()}`);
  }

  async get(hash: string) {
    const res = await this.request("GET", hash);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 GET ${hash} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async has(hash: string) {
    const res = await this.request("HEAD", hash);
    return res.ok;
  }

  async delete(hash: string) {
    const res = await this.request("DELETE", hash);
    if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${hash} failed: ${res.status}`);
  }
}
