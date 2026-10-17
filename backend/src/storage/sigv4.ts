// AWS Signature Version 4 for S3-compatible APIs (Cloudflare R2 uses region "auto").
// Implements the header-based signing described in the AWS S3 API reference.

import { createHash, createHmac } from "node:crypto";

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding as S3 expects: everything except unreserved characters; "/" kept in paths. */
export function uriEncode(value: string, keepSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch) || (keepSlash && ch === "/")) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

export type SignInput = {
  method: string;
  host: string;
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  payloadHash: string;
  amzDate: string; // YYYYMMDDTHHMMSSZ
  region: string;
  service: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export function signRequest(input: SignInput) {
  const date = input.amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": input.amzDate,
    ...Object.fromEntries(Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalQuery = Object.entries(input.query ?? {})
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonicalRequest = [input.method, uriEncode(input.path, true), canonicalQuery, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const scope = `${date}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", input.amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${input.secretAccessKey}`, date);
  const kRegion = hmac(kDate, input.region);
  const kService = hmac(kRegion, input.service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  const signed: Record<string, string> = {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  return { signature, headers: signed };
}

export const payloadSha256 = sha256;
export const amzDateNow = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
