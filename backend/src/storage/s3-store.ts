// Amazon S3 (or any S3-compatible service with an endpoint of its own) chunk store, signed with the same SigV4 code as R2.
//
// Credentials, in the order AWS itself looks for them:
//   1. CRATON_S3_ACCESS_KEY_ID / CRATON_S3_SECRET_ACCESS_KEY (or AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN);
//   2. the role of an ECS / Fargate task (AWS_CONTAINER_CREDENTIALS_RELATIVE_URI or _FULL_URI);
//   3. the role of an EC2 instance (instance metadata, IMDSv2).
// Role credentials are short-lived; they are fetched again shortly before they run out.

import type { ChunkStore } from "./chunk-store.ts";
import { amzDateNow, payloadSha256, signRequest } from "./sigv4.ts";

export type S3Credentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string; expiresAt?: number };

export type S3Options = {
  bucket: string;
  region: string;
  /** Leave empty for AWS. For MinIO and the like: `https://host:9000`, used path-style (`/bucket/key`). */
  endpoint?: string;
  /** A folder inside the bucket, for example `craton/prod`. */
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  /** Where role credentials come from; tests replace it. */
  credentials?: () => Promise<S3Credentials>;
};

const EARLY = 5 * 60_000; // ask for new role credentials this long before they expire

async function fetchJson(url: string, init: RequestInit = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return res;
}

/** Credentials from the task or instance role the process runs under. */
export async function roleCredentials(env: NodeJS.ProcessEnv = process.env): Promise<S3Credentials> {
  const relative = env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
  const full = env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
  let body: { AccessKeyId: string; SecretAccessKey: string; Token?: string; SessionToken?: string; Expiration?: string };
  if (relative || full) {
    const headers: Record<string, string> = {};
    if (env.AWS_CONTAINER_AUTHORIZATION_TOKEN) headers.authorization = env.AWS_CONTAINER_AUTHORIZATION_TOKEN;
    body = (await (await fetchJson(full ?? `http://169.254.170.2${relative}`, { headers })).json()) as typeof body;
  } else {
    const base = "http://169.254.169.254/latest";
    const token = await (await fetchJson(`${base}/api/token`, { method: "PUT", headers: { "x-aws-ec2-metadata-token-ttl-seconds": "21600" } })).text();
    const auth = { "x-aws-ec2-metadata-token": token };
    const role = (await (await fetchJson(`${base}/meta-data/iam/security-credentials/`, { headers: auth })).text()).split("\n")[0].trim();
    if (!role) throw new Error("this machine has no instance role");
    body = (await (await fetchJson(`${base}/meta-data/iam/security-credentials/${role}`, { headers: auth })).json()) as typeof body;
  }
  return {
    accessKeyId: body.AccessKeyId,
    secretAccessKey: body.SecretAccessKey,
    sessionToken: body.Token ?? body.SessionToken,
    expiresAt: body.Expiration ? Date.parse(body.Expiration) : undefined,
  };
}

export class S3Store implements ChunkStore {
  readonly kind = "aws-s3";
  private readonly host: string;
  private readonly origin: string;
  private readonly pathPrefix: string;
  private readonly region: string;
  private readonly prefix: string;
  private readonly credentials: () => Promise<S3Credentials>;
  private cached: S3Credentials | null = null;
  private inFlight: Promise<S3Credentials> | null = null;

  constructor(opts: S3Options) {
    this.region = opts.region;
    this.prefix = (opts.prefix ?? "").replace(/^\/+|\/+$/g, "");
    if (opts.endpoint) {
      const url = new URL(opts.endpoint);
      this.host = url.host;
      this.origin = `${url.protocol}//${url.host}`;
      this.pathPrefix = `/${opts.bucket}`;
    } else {
      this.host = `${opts.bucket}.s3.${opts.region}.amazonaws.com`;
      this.origin = `https://${this.host}`;
      this.pathPrefix = "";
    }
    this.credentials =
      opts.credentials ??
      (opts.accessKeyId && opts.secretAccessKey
        ? async () => ({ accessKeyId: opts.accessKeyId!, secretAccessKey: opts.secretAccessKey!, sessionToken: opts.sessionToken })
        : roleCredentials);
  }

  private async creds() {
    if (this.cached && (!this.cached.expiresAt || this.cached.expiresAt - Date.now() > EARLY)) return this.cached;
    this.inFlight ??= this.credentials().finally(() => (this.inFlight = null));
    this.cached = await this.inFlight;
    return this.cached;
  }

  private keyFor(hash: string) {
    return `${this.prefix ? `${this.prefix}/` : ""}chunks/${hash.slice(0, 2)}/${hash}`;
  }

  private async request(method: "GET" | "PUT" | "HEAD" | "DELETE", hash: string, body?: Buffer) {
    const c = await this.creds();
    const path = `${this.pathPrefix}/${this.keyFor(hash)}`;
    const extra: Record<string, string> = c.sessionToken ? { "x-amz-security-token": c.sessionToken } : {};
    const { headers } = signRequest({
      method,
      host: this.host,
      path,
      headers: extra,
      payloadHash: payloadSha256(body ?? ""),
      amzDate: amzDateNow(),
      region: this.region,
      service: "s3",
      accessKeyId: c.accessKeyId,
      secretAccessKey: c.secretAccessKey,
    });
    const { host: _host, ...sendHeaders } = headers;
    return fetch(`${this.origin}${path}`, { method, headers: sendHeaders, body: body ? new Uint8Array(body) : undefined });
  }

  async put(hash: string, stored: Buffer) {
    const res = await this.request("PUT", hash, stored);
    if (!res.ok) throw new Error(`S3 PUT ${hash} failed: ${res.status} ${await res.text()}`);
  }

  async replace(hash: string, stored: Buffer) {
    await this.put(hash, stored); // a PUT replaces the object in one step
  }

  async get(hash: string) {
    const res = await this.request("GET", hash);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`S3 GET ${hash} failed: ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async has(hash: string) {
    const res = await this.request("HEAD", hash);
    return res.ok;
  }

  async delete(hash: string) {
    const res = await this.request("DELETE", hash);
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE ${hash} failed: ${res.status}`);
  }
}
