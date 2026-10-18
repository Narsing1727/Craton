// SCIM 2.0 provisioning: the token owners make, and what an identity provider (Okta, Entra ID) does with it.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";

let app: ReturnType<typeof createApp>;
let ctx: Ctx;
const tokens: Record<string, string> = {};
let scimToken = "";

async function call(method: string, path: string, who: string | null, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.authorization = `Bearer ${tokens[who]}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app.request(`/v1${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, type: res.headers.get("content-type") ?? "" };
}

/** What the identity provider sends: only its own provisioning token. */
async function scim(method: string, path: string, body?: unknown, token = scimToken, org = "hydrolab") {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, "content-type": "application/scim+json" };
  const res = await app.request(`/v1/scim/v2/${org}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, json, type: res.headers.get("content-type") ?? "" };
}

const members = async () => ((await call("GET", "/owners/hydrolab", null)).json.members as { handle: string; role: string }[]).map((m) => `${m.handle}:${m.role}`).sort();

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() } as Ctx;
  app = createApp(ctx);
  for (const [u, email] of [["owen", "owen@hydrolab.org"], ["maya", "maya@hydrolab.org"], ["rhea", "rhea@gmail.com"], ["zed", "zed@hydrolab.org"]]) {
    const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email, password: "a-very-long-password" }) });
    tokens[u] = ((await res.json()) as { token: string }).token;
    if (u !== "zed") await ctx.db.run("UPDATE users SET email_verified_at = ? WHERE lower(email) = lower(?)", new Date().toISOString(), email);
  }
  assert.equal((await call("POST", "/orgs", "owen", { handle: "hydrolab", name: "Hydrolab" })).status, 201);
  assert.equal((await call("POST", "/orgs", "rhea", { handle: "other-org", name: "Other" })).status, 201);
});

test("the database was brought to the schema version that has provisioning, by a migration", async () => {
  const v = await ctx.db.get<{ version: number }>("SELECT version FROM schema_version");
  assert.ok(v!.version >= 2);
  assert.ok(await ctx.db.get("SELECT 1 FROM org_scim_tokens LIMIT 1").then(() => true));
});

test("only an owner makes a token, and only once a domain is verified; the token is shown once", async () => {
  assert.equal((await call("POST", "/orgs/hydrolab/scim/tokens", "owen", { note: "Okta" })).status, 400, "no verified domain yet");
  await ctx.db.run("INSERT INTO org_domains (org_id, domain, token, verified_at) VALUES ((SELECT id FROM owners WHERE handle = 'hydrolab'), 'hydrolab.org', 't', ?)", new Date().toISOString());
  assert.equal((await call("POST", "/orgs/hydrolab/scim/tokens", "rhea", { note: "x" })).status, 404, "not a member");
  const made = await call("POST", "/orgs/hydrolab/scim/tokens", "owen", { note: "Okta" });
  assert.equal(made.status, 201);
  assert.match(made.json.token, /^scim_[A-Za-z0-9_-]{40,}$/);
  assert.match(made.json.baseUrl, /\/v1\/scim\/v2\/hydrolab$/);
  scimToken = made.json.token;
  const overview = await call("GET", "/orgs/hydrolab/scim", "owen");
  assert.equal(overview.status, 200);
  assert.deepEqual(overview.json.tokens.map((t: any) => t.note), ["Okta"]);
  assert.ok(!JSON.stringify(overview.json).includes(scimToken), "the token itself is never listed again");
  const stored = await ctx.db.get<{ token_hash: string }>("SELECT token_hash FROM org_scim_tokens");
  assert.notEqual(stored!.token_hash, scimToken, "only a hash is kept");
});

test("every SCIM call needs the token, for that organization only; errors are SCIM-shaped", async () => {
  const none = await app.request("/v1/scim/v2/hydrolab/Users");
  assert.equal(none.status, 401);
  assert.match(none.headers.get("content-type") ?? "", /scim\+json/);
  assert.deepEqual(Object.keys((await none.json()) as object).sort(), ["detail", "schemas", "status"]);
  assert.equal((await scim("GET", "/Users", undefined, "scim_wrong")).status, 401);
  assert.equal((await scim("GET", "/Users", undefined, tokens.owen)).status, 401, "a user's own token is not a provisioning token");
  assert.equal((await scim("GET", "/Users", undefined, scimToken, "other-org")).status, 401, "another organization's address");
  const ok = await scim("GET", "/ServiceProviderConfig");
  assert.equal(ok.status, 200);
  assert.equal(ok.json.patch.supported, true);
  assert.match(ok.type, /scim\+json/);
  assert.equal((await scim("GET", "/ResourceTypes")).json.Resources[0].name, "User");
  assert.equal((await scim("GET", "/Schemas")).status, 200);
});

test("the owner is listed; users are found by userName, id and externalId", async () => {
  const list = await scim("GET", "/Users");
  assert.equal(list.status, 200);
  assert.equal(list.json.totalResults, 1);
  assert.equal(list.json.Resources[0].userName, "owen@hydrolab.org");
  assert.equal(list.json.Resources[0].active, true);
  const byName = await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "OWEN@hydrolab.org"')}`);
  assert.equal(byName.json.totalResults, 1, "email matching ignores case");
  assert.equal((await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "nobody@hydrolab.org"')}`)).json.totalResults, 0);
  assert.equal((await scim("GET", `/Users?filter=${encodeURIComponent('name.givenName sw "x"')}`)).json.scimType, "invalidFilter");
});

test("creating a person adds a Member and makes the account when there is none; others stay out", async () => {
  const made = await scim("POST", "/Users", { schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"], userName: "Ada@hydrolab.org", externalId: "okta-1", name: { givenName: "Ada", familyName: "Lovelace" }, emails: [{ value: "ada@hydrolab.org", primary: true }], active: true });
  assert.equal(made.status, 201, JSON.stringify(made.json));
  assert.equal(made.json.userName, "ada@hydrolab.org");
  assert.equal(made.json.displayName, "Ada Lovelace");
  assert.equal(made.json.externalId, "okta-1");
  assert.equal(made.json.active, true);
  assert.match(made.json.meta.location, /\/Users\/\d+$/);
  assert.ok((await members()).includes("ada:Member"));
  const account = await ctx.db.get<{ email_verified_at: string | null; password_hash: string }>("SELECT email_verified_at, password_hash FROM users WHERE email = 'ada@hydrolab.org'");
  assert.ok(account!.email_verified_at, "the verified domain vouches for the address");
  assert.ok(!account!.password_hash.startsWith("scrypt$"), "no password: she signs in through single sign-on");

  assert.equal((await scim("POST", "/Users", { userName: "ada@hydrolab.org" })).status, 409, "already a member");
  assert.equal((await scim("POST", "/Users", { userName: "ada@hydrolab.org" })).json.scimType, "uniqueness");
  const outside = await scim("POST", "/Users", { userName: "eve@gmail.com" });
  assert.equal(outside.status, 400, "gmail.com is not a domain this organization has verified");
  assert.equal(outside.json.scimType, "invalidValue");
  assert.equal((await scim("POST", "/Users", { userName: "not-an-address" })).status, 400);
  assert.equal((await scim("POST", "/Users", { userName: "other@hydrolab.org", externalId: "okta-1" })).status, 409, "an externalId belongs to one person");
});

test("an existing account with a confirmed address is joined; one never confirmed is refused", async () => {
  const joined = await scim("POST", "/Users", { userName: "maya@hydrolab.org", name: { formatted: "Not Her Real Name" } });
  assert.equal(joined.status, 201);
  assert.ok((await members()).includes("maya:Member"));
  assert.notEqual((await call("GET", "/owners/maya", null)).json.name, "Not Her Real Name", "a name the person already has is theirs");
  const refused = await scim("POST", "/Users", { userName: "zed@hydrolab.org" });
  assert.equal(refused.status, 409, "zed never confirmed that address");
  assert.ok(!(await members()).some((m) => m.startsWith("zed:")));
});

test("PATCH deactivates and reactivates, in the forms Okta and Entra send", async () => {
  const ada = (await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "ada@hydrolab.org"')}`)).json.Resources[0];
  const off = await scim("PATCH", `/Users/${ada.id}`, { schemas: ["urn:ietf:params:scim:api:messages:2.0:PatchOp"], Operations: [{ op: "Replace", path: "active", value: "False" }] });
  assert.equal(off.status, 200);
  assert.equal(off.json.active, false);
  assert.ok(!(await members()).some((m) => m.startsWith("ada:")), "she lost the organization");
  assert.equal((await call("GET", "/owners/ada", null)).status, 200, "her account is still hers");
  assert.equal((await scim("GET", `/Users/${ada.id}`)).json.active, false, "still known to the provider, inactive");
  const on = await scim("PATCH", `/Users/${ada.id}`, { Operations: [{ op: "replace", value: { active: true, externalId: "okta-1b" } }] });
  assert.equal(on.json.active, true);
  assert.equal(on.json.externalId, "okta-1b");
  assert.ok((await members()).includes("ada:Member"));
  assert.equal((await scim("PATCH", `/Users/${ada.id}`, { Operations: [{ op: "move", path: "x" }] })).status, 400);
  assert.equal((await scim("PATCH", `/Users/${ada.id}`, { Operations: [] })).status, 400);
  assert.equal((await scim("PATCH", `/Users/${ada.id}`, { Operations: [{ op: "replace", path: "userName", value: "someone-else@hydrolab.org" }] })).json.scimType, "mutability");
});

test("PUT replaces what the provider owns; the name of an account it made follows the directory", async () => {
  const ada = (await scim("GET", `/Users?filter=${encodeURIComponent('externalId eq "okta-1b"')}`)).json.Resources[0];
  const put = await scim("PUT", `/Users/${ada.id}`, { userName: "ada@hydrolab.org", externalId: "okta-2", displayName: "Ada King", active: true });
  assert.equal(put.status, 200);
  assert.equal(put.json.displayName, "Ada King");
  assert.equal(put.json.externalId, "okta-2");
  const off = await scim("PUT", `/Users/${ada.id}`, { userName: "ada@hydrolab.org", active: false });
  assert.equal(off.json.active, false);
  await scim("PUT", `/Users/${ada.id}`, { userName: "ada@hydrolab.org", active: true });
});

test("an owner can not be removed by provisioning, whatever the directory says", async () => {
  const owen = (await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "owen@hydrolab.org"')}`)).json.Resources[0];
  const off = await scim("PATCH", `/Users/${owen.id}`, { Operations: [{ op: "replace", path: "active", value: false }] });
  assert.equal(off.status, 409);
  assert.equal((await scim("DELETE", `/Users/${owen.id}`)).status, 409);
  assert.ok((await members()).includes("owen:Owner"));
});

test("DELETE removes the person from the organization and the provider's record of them; the account stays", async () => {
  const maya = (await scim("GET", `/Users?filter=${encodeURIComponent('userName eq "maya@hydrolab.org"')}`)).json.Resources[0];
  assert.equal((await scim("DELETE", `/Users/${maya.id}`)).status, 204);
  assert.ok(!(await members()).some((m) => m.startsWith("maya:")));
  assert.equal((await scim("GET", `/Users/${maya.id}`)).status, 404);
  assert.equal((await call("GET", "/owners/maya", null)).status, 200);
  assert.equal((await scim("DELETE", "/Users/999999")).status, 404);
  assert.equal((await scim("GET", "/Users/not-a-number")).status, 404);
});

test("pages are counted from one and capped; Groups are an empty list", async () => {
  const all = await scim("GET", "/Users?count=1&startIndex=1");
  assert.equal(all.json.itemsPerPage, 1);
  assert.ok(all.json.totalResults >= 2);
  const second = await scim("GET", "/Users?count=1&startIndex=2");
  assert.notEqual(second.json.Resources[0].id, all.json.Resources[0].id);
  assert.equal((await scim("GET", "/Users?count=0")).json.Resources.length, 0);
  assert.equal((await scim("GET", "/Groups")).json.totalResults, 0);
});

test("a removed token stops working at once; a bad body is a SCIM error", async () => {
  assert.equal((await scim("POST", "/Users", "not json at all")).status, 400);
  const overview = await call("GET", "/orgs/hydrolab/scim", "owen");
  const id = overview.json.tokens[0].id;
  assert.ok(overview.json.tokens[0].lastUsedAt, "use is recorded");
  assert.equal((await call("DELETE", `/orgs/hydrolab/scim/tokens/${id}`, "owen")).status, 204);
  assert.equal((await scim("GET", "/Users")).status, 401);
  assert.equal((await call("DELETE", `/orgs/hydrolab/scim/tokens/${id}`, "owen")).status, 404);
});
