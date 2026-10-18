// A stand-in for an organization's OpenID Connect provider (Entra ID, Okta, Keycloak…) for local end-to-end runs of single
// sign-on: discovery, an authorize endpoint (no UI, it redirects straight back), keys, a token endpoint that enforces PKCE
// and the client secret, and /_identity to choose who "the provider" says is signing in next.
//
//   node scripts/mock-oidc.mjs                      (port 9101; issuer http://localhost:9101)
//   then start the API with CRATON_WEBHOOKS_ALLOW_PRIVATE=1 (a development machine may reach a provider on localhost over http)
//   and run: CRATON_E2E_DB=<throwaway>/craton.db npm run e2e:sso
import http from "node:http";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";

const PORT = 9101;
const ISSUER = `http://localhost:${PORT}`;
const CLIENT_ID = "e2e-sso-client";
const CLIENT_SECRET = "e2e-sso-secret";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 });
const b64 = (v) => Buffer.from(typeof v === "string" ? v : JSON.stringify(v)).toString("base64url");
let identity = { sub: "sso-1", email: "e2e.person@example.org", name: "E2E Person" };
const codes = new Map();

http
  .createServer((req, res) => {
    const url = new URL(req.url, ISSUER);
    res.setHeader("content-type", "application/json");
    if (url.pathname === "/_identity") {
      identity = { sub: url.searchParams.get("sub") ?? identity.sub, email: url.searchParams.get("email") ?? identity.email, name: url.searchParams.get("name") ?? identity.name };
      return res.end(JSON.stringify(identity));
    }
    if (url.pathname === "/.well-known/openid-configuration") {
      return res.end(JSON.stringify({ issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`, token_endpoint_auth_methods_supported: ["client_secret_post"] }));
    }
    if (url.pathname === "/jwks") return res.end(JSON.stringify({ keys: [{ ...key.publicKey.export({ format: "jwk" }), kid: "e2e", alg: "RS256", use: "sig" }] }));
    if (url.pathname === "/authorize") {
      const back = new URL(url.searchParams.get("redirect_uri"));
      const code = randomBytes(8).toString("hex");
      codes.set(code, { nonce: url.searchParams.get("nonce"), challenge: url.searchParams.get("code_challenge"), identity: { ...identity } });
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state"));
      res.statusCode = 302;
      res.setHeader("location", back.toString());
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (d) => (raw += d));
      req.on("end", () => {
        const f = new URLSearchParams(raw);
        const entry = codes.get(f.get("code"));
        codes.delete(f.get("code"));
        const ok = entry && f.get("client_id") === CLIENT_ID && f.get("client_secret") === CLIENT_SECRET && createHash("sha256").update(f.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
        if (!ok) {
          res.statusCode = 400;
          return res.end(JSON.stringify({ error: "invalid_grant" }));
        }
        const now = Math.floor(Date.now() / 1000);
        const head = b64({ alg: "RS256", kid: "e2e", typ: "JWT" });
        const body = b64({ iss: ISSUER, aud: CLIENT_ID, iat: now, exp: now + 600, nonce: entry.nonce, ...entry.identity });
        const sig = sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key.privateKey).toString("base64url");
        res.end(JSON.stringify({ id_token: `${head}.${body}.${sig}`, access_token: "unused" }));
      });
      return;
    }
    res.statusCode = 404;
    res.end("{}");
  })
  .listen(PORT, "127.0.0.1", () => console.log(`mock oidc on ${PORT} (issuer ${ISSUER}, client ${CLIENT_ID} / ${CLIENT_SECRET})`));
