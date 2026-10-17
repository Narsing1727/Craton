// A stand-in for Google for local end-to-end runs: an authorize endpoint (no UI, it redirects straight back), a token
// endpoint that enforces PKCE, JWKS, and /_identity to choose who "Google" says is signing in next. Real Google
// credentials are never needed to exercise the flow.
//
//   node scripts/mock-google.mjs                       (port 9099)
//   then start the API with:
//     CRATON_DATA_DIR=<a throwaway folder> CRATON_GOOGLE_CLIENT_ID=e2e.apps.googleusercontent.com CRATON_GOOGLE_CLIENT_SECRET=e2e-secret
//     CRATON_GOOGLE_AUTH_URL=http://localhost:9099/auth CRATON_GOOGLE_TOKEN_URL=http://localhost:9099/token
//     CRATON_GOOGLE_JWKS_URL=http://localhost:9099/certs   node src/server.ts
//   and run: npm run e2e:google
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const CLIENT_ID = "e2e.apps.googleusercontent.com";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
let identity = { sub: "g-1", email: "e2e.user@example.org", name: "E2E User", email_verified: true };
let deny = false;
const codes = new Map();

http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost:9099");
    if (url.pathname === "/_identity") {
      deny = url.searchParams.get("deny") === "1";
      identity = {
        sub: url.searchParams.get("sub") ?? identity.sub,
        email: url.searchParams.get("email") ?? identity.email,
        name: url.searchParams.get("name") ?? identity.name,
        email_verified: url.searchParams.get("verified") !== "0",
      };
      res.end(JSON.stringify({ identity, deny }));
      return;
    }
    if (url.pathname === "/auth") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      if (deny) {
        back.searchParams.set("error", "access_denied");
        back.searchParams.set("state", url.searchParams.get("state"));
      } else {
        const code = randomBytes(8).toString("hex");
        codes.set(code, { nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge"), identity: { ...identity } });
        back.searchParams.set("code", code);
        back.searchParams.set("state", url.searchParams.get("state"));
      }
      res.statusCode = 302;
      res.setHeader("location", back.toString());
      return res.end();
    }
    if (url.pathname === "/certs") {
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256", use: "sig" }] }));
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const f = new URLSearchParams(raw);
        const entry = codes.get(f.get("code"));
        codes.delete(f.get("code"));
        const ok = entry && f.get("client_id") === CLIENT_ID && createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
        res.setHeader("content-type", "application/json");
        if (!ok) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: "invalid_grant" }));
        }
        const now = Math.floor(Date.now() / 1000);
        const head = b64({ alg: "RS256", kid: "e2e", typ: "JWT" });
        const body = b64({ iss: "https://accounts.google.com", aud: CLIENT_ID, iat: now, exp: now + 600, nonce: entry.nonce, ...entry.identity });
        const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key.privateKey).toString("base64url");
        res.end(JSON.stringify({ id_token: `${head}.${body}.${sig}`, access_token: "unused" }));
      });
      return;
    }
    res.statusCode = 404;
    res.end();
  })
  .listen(9099, "127.0.0.1", () => console.log("mock google on 9099"));
