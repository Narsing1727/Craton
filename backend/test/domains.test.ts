// Organization domains: proof by a DNS TXT record, one holder per verified domain, and joining only through a CONFIRMED address.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../src/api/app.ts";
import { openDb } from "../src/db/db.ts";
import { MemoryStore } from "../src/storage/chunk-store.ts";
import type { Ctx } from "../src/services/context.ts";
import { normalizeDomain, resolver } from "../src/services/domains.ts";

let ctx: Ctx;
let app: ReturnType<typeof createApp>;
const tokens: Record<string, string> = {};

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
  return { status: res.status, json };
}

const signUp = async (u: string, email: string, confirm = true) => {
  const res = await app.request("/v1/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, email, password: "a-very-long-password" }) });
  assert.equal(res.status, 201);
  tokens[u] = ((await res.json()) as { token: string }).token;
  if (confirm) await ctx.db.run("UPDATE users SET email_verified_at = ? WHERE lower(email) = lower(?)", new Date().toISOString(), email);
};
const members = async (org: string) => ((await call("GET", `/owners/${org}`, null)).json.members as { handle: string; role: string }[]).map((m) => `${m.handle}:${m.role}`).sort();
let dns: Record<string, string[][]> = {};

before(async () => {
  ctx = { db: await openDb(":memory:"), store: new MemoryStore() };
  app = createApp(ctx);
  resolver.txt = async (name: string) => {
    if (!(name in dns)) throw Object.assign(new Error("no data"), { code: "ENODATA" });
    return dns[name];
  };
  await signUp("owen", "owen@hydrolab.org");
  await signUp("maya", "maya@hydrolab.org");
  await signUp("ravi", "ravi@other.org");
  assert.equal((await call("POST", "/orgs", "owen", { handle: "hydrolab", name: "Hydrolab" })).status, 201);
  assert.equal((await call("POST", "/orgs", "ravi", { handle: "rival", name: "Rival" })).status, 201);
  assert.equal((await call("POST", "/orgs/hydrolab/members", "owen", { handle: "ravi", role: "Maintainer" })).status, 201);
});

test("what people type becomes a domain, and domains nobody can prove are refused", () => {
  assert.equal(normalizeDomain("HydroLab.org"), "hydrolab.org");
  assert.equal(normalizeDomain("https://www.hydrolab.org/people?x=1"), "hydrolab.org");
  assert.equal(normalizeDomain("priya@hydrolab.org"), "hydrolab.org");
  assert.equal(normalizeDomain("hydrolab.org."), "hydrolab.org");
  for (const bad of ["", "localhost", "gmail.com", "Outlook.com", "co.uk", "ac.in", "192.168.1.1", "not a domain", "-x.org", "a..org"]) {
    assert.throws(() => normalizeDomain(bad), (e: any) => e.status === 400, bad);
  }
  assert.equal(normalizeDomain("iitr.ac.in"), "iitr.ac.in");
});

test("only an owner manages domains; adding one gives the exact DNS record to publish", async () => {
  assert.equal((await call("GET", "/orgs/hydrolab/domains", "ravi")).status, 403, "a maintainer may not");
  assert.equal((await call("POST", "/orgs/hydrolab/domains", "maya", { domain: "hydrolab.org" })).status, 404, "a non-member does not even see the organization");
  const added = await call("POST", "/orgs/hydrolab/domains", "owen", { domain: "https://hydrolab.org" });
  assert.equal(added.status, 201);
  assert.equal(added.json.domain, "hydrolab.org");
  assert.equal(added.json.verified, false);
  assert.equal(added.json.record.type, "TXT");
  assert.equal(added.json.record.name, "_craton-challenge.hydrolab.org");
  assert.match(added.json.record.value, /^craton-verify=[0-9a-f]{36}$/);
  assert.equal((await call("POST", "/orgs/hydrolab/domains", "owen", { domain: "hydrolab.org" })).json.error.code, "domain_exists");
  assert.equal((await call("POST", "/orgs/hydrolab/domains", "owen", { domain: "gmail.com" })).status, 400);
});

test("verification says what it found; the right record verifies, and nobody sees it as verified before", async () => {
  const record = (await call("GET", "/orgs/hydrolab/domains", "owen")).json.domains[0].record;
  assert.equal((await call("GET", "/owners/hydrolab", null)).json.verifiedDomains.length, 0);
  const none = await call("POST", "/orgs/hydrolab/domains/hydrolab.org/verify", "owen");
  assert.equal(none.status, 422);
  assert.equal(none.json.error.code, "dns_record_missing");
  assert.match(none.json.error.message, /No TXT record at _craton-challenge\.hydrolab\.org yet/);
  dns[record.name] = [["v=spf1 -all"], ["craton-verify=wrong"]];
  const wrong = await call("POST", "/orgs/hydrolab/domains/hydrolab.org/verify", "owen");
  assert.match(wrong.json.error.message, /Found 2 TXT records .* but not the one Craton expects/);
  // A long record split into chunks by the resolver is joined before it is compared.
  dns[record.name] = [["craton-verify=", record.value.slice("craton-verify=".length)]];
  const ok = await call("POST", "/orgs/hydrolab/domains/hydrolab.org/verify", "owen");
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.verified, true);
  assert.ok(!("record" in ok.json), "nothing left to publish");
  assert.deepEqual((await call("GET", "/owners/hydrolab", null)).json.verifiedDomains, ["hydrolab.org"]);
  assert.equal((await call("POST", "/orgs/hydrolab/domains/hydrolab.org/verify", "owen")).json.verified, true, "verifying twice is harmless");
});

test("one organization per verified domain: another cannot add it, or take it by racing", async () => {
  const taken = await call("POST", "/orgs/rival/domains", "ravi", { domain: "hydrolab.org" });
  assert.equal(taken.status, 409);
  assert.equal(taken.json.error.code, "domain_taken");
  // Two organizations may hold the same UNVERIFIED claim; the first to prove it wins.
  assert.equal((await call("POST", "/orgs/rival/domains", "ravi", { domain: "rival.example.org" })).status, 201);
  assert.equal((await call("POST", "/orgs", "maya", { handle: "mayas", name: "Mayas" })).status, 201);
  assert.equal((await call("POST", "/orgs/mayas/domains", "maya", { domain: "rival.example.org" })).status, 201);
  const rec = (await call("GET", "/orgs/rival/domains", "ravi")).json.domains[0].record;
  dns[rec.name] = [[rec.value]];
  assert.equal((await call("POST", "/orgs/rival/domains/rival.example.org/verify", "ravi")).status, 200);
  const rec2 = (await call("GET", "/orgs/mayas/domains", "maya")).json.domains[0].record;
  dns[rec2.name] = [[rec2.value]];
  const late = await call("POST", "/orgs/mayas/domains/rival.example.org/verify", "maya");
  assert.equal(late.status, 409);
  assert.equal(late.json.error.code, "domain_taken");
});

test("joining by address needs a verified domain, and only ever follows a CONFIRMED address", async () => {
  // Not verified: refused (the second org's domain is unverified).
  assert.equal((await call("PATCH", "/orgs/mayas/domains/rival.example.org", "maya", { autoJoin: true })).status, 400);
  assert.equal((await call("PATCH", "/orgs/hydrolab/domains/hydrolab.org", "owen", { autoJoin: "yes" })).status, 400);
  await signUp("ines", "ines@hydrolab.org", false); // signed up, never confirmed
  const on = await call("PATCH", "/orgs/hydrolab/domains/hydrolab.org", "owen", { autoJoin: true });
  assert.equal(on.status, 200);
  assert.equal(on.json.autoJoin, true);
  assert.equal(on.json.joined, 1, "maya has a confirmed address there; ines does not; owen is already in");
  assert.deepEqual(await members("hydrolab"), ["maya:Member", "owen:Owner", "ravi:Maintainer"]);
  // ines confirms her address the real way: the link from the dev outbox.
  const mail = ((await (await app.request("/v1/dev/outbox")).json()) as { kind: string; to: string; text: string }[]).find((m) => m.kind === "verify" && m.to === "ines@hydrolab.org")!;
  const verified = await call("POST", "/auth/verify", null, { token: mail.text.match(/token=(\S+)/)![1] });
  assert.equal(verified.status, 200);
  assert.deepEqual(verified.json.joined, ["hydrolab"]);
  assert.ok((await members("hydrolab")).includes("ines:Member"));
  // A different domain is not matched: sub-domains and look-alikes do not join.
  await signUp("sam", "sam@mail.hydrolab.org");
  await signUp("lex", "lex@hydrolab.org.evil.example");
  const ids = await members("hydrolab");
  assert.ok(!ids.some((m) => m.startsWith("sam:") || m.startsWith("lex:")));
});

test("turning joining off and removing a domain leave existing members where they are", async () => {
  const off = await call("PATCH", "/orgs/hydrolab/domains/hydrolab.org", "owen", { autoJoin: false });
  assert.equal(off.json.autoJoin, false);
  await signUp("tia", "tia@hydrolab.org");
  assert.ok(!(await members("hydrolab")).some((m) => m.startsWith("tia:")), "not joined while off");
  assert.equal((await call("DELETE", "/orgs/hydrolab/domains/hydrolab.org", "owen")).status, 204);
  assert.deepEqual((await call("GET", "/owners/hydrolab", null)).json.verifiedDomains, []);
  assert.ok((await members("hydrolab")).includes("maya:Member"));
  assert.equal((await call("DELETE", "/orgs/hydrolab/domains/hydrolab.org", "owen")).status, 404);
});

test("a DNS outage is not reported as a missing record", async () => {
  await call("POST", "/orgs/hydrolab/domains", "owen", { domain: "flaky.example.org" });
  const old = resolver.txt;
  resolver.txt = async () => {
    throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" });
  };
  try {
    const res = await call("POST", "/orgs/hydrolab/domains/flaky.example.org/verify", "owen");
    assert.equal(res.status, 502);
    assert.equal(res.json.error.code, "dns_error");
  } finally {
    resolver.txt = old;
  }
});
