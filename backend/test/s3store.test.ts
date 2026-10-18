// The S3 chunk store against a small S3-shaped server: path-style requests under a prefix, signed with the SigV4 headers (including the
// session token of a role), missing keys read as absent, and role credentials fetched again before they expire.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { S3Store, roleCredentials } from "../src/storage/s3-store.ts";

const objects = new Map<string, Buffer>();
const seen: { method: string; url: string; auth: string; token: string | undefined; sha: string | undefined }[] = [];
let server: http.Server;
let endpoint = "";

before(async () => {
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => {
      const url = req.url ?? "";
      if (url === "/creds") {
        res.setHeader("content-type", "application/json");
        return res.end(JSON.stringify({ AccessKeyId: "ASIAEXAMPLE", SecretAccessKey: "secret", Token: "role-token", Expiration: new Date(Date.now() + 3_600_000).toISOString() }));
      }
      seen.push({ method: req.method ?? "", url, auth: String(req.headers.authorization ?? ""), token: req.headers["x-amz-security-token"] as string | undefined, sha: req.headers["x-amz-content-sha256"] as string | undefined });
      if (req.method === "PUT") {
        objects.set(url, Buffer.concat(chunks));
        res.statusCode = 200;
        return res.end();
      }
      const body = objects.get(url);
      if (req.method === "DELETE") {
        objects.delete(url);
        res.statusCode = 204;
        return res.end();
      }
      if (!body) {
        res.statusCode = 404;
        return res.end();
      }
      res.statusCode = 200;
      res.end(req.method === "HEAD" ? undefined : body);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const HASH = "ab" + "c".repeat(62);

test("put, get, has, replace and delete work path-style under a prefix, every request signed", async () => {
  const store = new S3Store({ bucket: "craton-chunks", region: "ap-south-1", endpoint, prefix: "prod/", accessKeyId: "AKIAEXAMPLE", secretAccessKey: "secret" });
  assert.equal(store.kind, "aws-s3");
  assert.equal(await store.has(HASH), false);
  assert.equal(await store.get(HASH), null);
  await store.put(HASH, Buffer.from("hello"));
  assert.equal(await store.has(HASH), true);
  assert.deepEqual(await store.get(HASH), Buffer.from("hello"));
  await store.replace(HASH, Buffer.from("smaller"));
  assert.deepEqual(await store.get(HASH), Buffer.from("smaller"));
  await store.delete(HASH);
  assert.equal(await store.get(HASH), null);
  await store.delete(HASH); // already gone is fine

  assert.ok(seen.every((s) => s.url === `/craton-chunks/prod/chunks/ab/${HASH}`), "bucket, prefix, then chunks/<first two>/<hash>");
  assert.ok(seen.every((s) => /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/\d{8}\/ap-south-1\/s3\/aws4_request, SignedHeaders=.*host.*, Signature=[0-9a-f]{64}$/.test(s.auth)));
  assert.ok(seen.every((s) => s.token === undefined));
});

test("a role's session token is signed and sent, and the credentials are fetched again before they run out", async () => {
  seen.length = 0;
  let fetched = 0;
  const store = new S3Store({
    bucket: "b",
    region: "us-east-1",
    endpoint,
    credentials: async () => {
      fetched++;
      // the first answer is already about to expire, so the next request asks again
      return { accessKeyId: "ASIAROLE", secretAccessKey: "s", sessionToken: `token-${fetched}`, expiresAt: fetched === 1 ? Date.now() + 60_000 : Date.now() + 3_600_000 };
    },
  });
  await store.put(HASH, Buffer.from("x"));
  await store.put(HASH, Buffer.from("y"));
  await store.put(HASH, Buffer.from("z"));
  assert.equal(fetched, 2, "once at first, once because the first was inside the five-minute margin, then kept");
  assert.deepEqual(seen.map((s) => s.token), ["token-1", "token-2", "token-2"]);
  assert.match(seen[0].auth, /SignedHeaders=.*x-amz-security-token/);
});

test("role credentials are read from the ECS task endpoint", async () => {
  const c = await roleCredentials({ AWS_CONTAINER_CREDENTIALS_FULL_URI: `${endpoint}/creds` } as NodeJS.ProcessEnv);
  assert.equal(c.accessKeyId, "ASIAEXAMPLE");
  assert.equal(c.sessionToken, "role-token");
  assert.ok((c.expiresAt ?? 0) > Date.now());
});

test("on AWS the bucket is a host name of its own", async () => {
  const store = new S3Store({ bucket: "my-bucket", region: "eu-west-1", accessKeyId: "a", secretAccessKey: "b" });
  assert.equal((store as unknown as { host: string }).host, "my-bucket.s3.eu-west-1.amazonaws.com");
});
