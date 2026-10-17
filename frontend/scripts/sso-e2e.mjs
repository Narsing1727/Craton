// Single sign-on end to end in a real browser: the real web app (:3100), the real API (:4000) and scripts/mock-oidc.mjs
// (:9101). Start the API with a THROWAWAY data folder and CRATON_WEBHOOKS_ALLOW_PRIVATE=1; this creates accounts.
//
//   node scripts/mock-oidc.mjs &
//   CRATON_E2E_DB=<that folder>/craton.db npm run e2e:sso
//
// Covers: an owner connects the provider; "Continue with single sign-on" with a work email; first sign-in -> username -> account
// in the organization; the setup shows as tested; requiring it refuses a member's password; an address outside the verified domain.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const WEB = "http://localhost:3100", API = "http://localhost:4000/v1", MOCK = "http://localhost:9101";
const SHOTS = process.env.CRATON_E2E_SHOTS ?? "e2e-shots";
const DB = process.env.CRATON_E2E_DB;
if (!DB) throw new Error("Set CRATON_E2E_DB to the craton.db of the throwaway API.");
fs.mkdirSync(SHOTS, { recursive: true });
const edge = [process.env.CRATON_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && fs.existsSync(p));
if (!edge) throw new Error("No Chrome or Edge found. Set CRATON_BROWSER.");
const browser = await chromium.launch({ executablePath: edge, headless: true });

const RUN = Date.now().toString(36).slice(-5);
const domain = `sso-${RUN}.org`;
const org = `lab${RUN}`;
let failures = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); if (!ok) failures++; };
const who = (o) => fetch(`${MOCK}/_identity?${new URLSearchParams(o)}`).then((r) => r.json());
const j = { "content-type": "application/json" };
const signup = async (u, email) => {
  const body = await (await fetch(`${API}/auth/signup`, { method: "POST", headers: j, body: JSON.stringify({ username: u, email, password: "a-very-long-password" }) })).json();
  if (!body.token) throw new Error(`signup failed (restart the throwaway API to clear its rate limits): ${JSON.stringify(body)}`);
  return body.token;
};

// Setup: an owner with a confirmed address, an organization with a verified domain, and a colleague with a password.
const owner = `own${RUN}`, mate = `mate${RUN}`;
const ownerTok = await signup(owner, `${owner}@${domain}`);
const mateTok = await signup(mate, `${mate}@${domain}`);
const db = new DatabaseSync(DB);
db.prepare("UPDATE users SET email_verified_at = '2026-01-01T00:00:00.000Z', onboarded_at = '2026-01-01T00:00:00.000Z' WHERE email IN (?, ?)").run(`${owner}@${domain}`, `${mate}@${domain}`);
await fetch(`${API}/orgs`, { method: "POST", headers: { authorization: `Bearer ${ownerTok}`, ...j }, body: JSON.stringify({ handle: org, name: "Lab" }) });
db.prepare("INSERT INTO org_domains (org_id, domain, token, verified_at) VALUES ((SELECT id FROM owners WHERE handle = ?), ?, 't', '2026-01-01T00:00:00.000Z')").run(org, domain);
await fetch(`${API}/orgs/${org}/members`, { method: "POST", headers: { authorization: `Bearer ${ownerTok}`, ...j }, body: JSON.stringify({ handle: mate, role: "Member" }) });
db.close();

// 1. The owner connects the provider.
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1200 } });
  await ctx.addCookies([{ name: "craton_session", value: ownerTok, url: WEB }]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${WEB}/orgs/${org}/settings`, { waitUntil: "networkidle" });
  check("the Single sign-on card shows the redirect address to register", (await page.locator("body").innerText()).includes("/auth/sso/callback"));
  await page.getByPlaceholder(/login.microsoftonline/).fill("http://localhost:9101");
  await page.locator("label", { hasText: "Client id" }).locator("input").fill("e2e-sso-client");
  await page.locator("label", { hasText: "Client secret" }).locator("input").fill("e2e-sso-secret");
  await page.getByRole("button", { name: "Connect provider" }).click();
  await page.getByText("Not tested yet").waitFor({ timeout: 15000 });
  check("connecting saves it, untested, and offers Require", await page.getByRole("switch", { name: "Require single sign-on" }).isDisabled());
  await page.screenshot({ path: `${SHOTS}/sso-1-setup.png`, fullPage: true });
  check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// 2. A new colleague signs in through the provider.
const person = `pat${RUN}`;
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  await who({ sub: `sso-${RUN}`, email: `${person}@${domain}`, name: "Pat Person" });
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  const link = page.getByRole("link", { name: /^single sign-on$/i });
  check("the sign-in page offers single sign-on once an organization has it", await link.isVisible());
  await page.screenshot({ path: `${SHOTS}/sso-2-login.png` });
  await link.click();
  await page.waitForURL(/\/login\/sso/);
  await page.getByLabel("Work email").fill("someone@elsewhere.org");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/\/login\/sso\?error=none/);
  check("an address no organization owns is told so", /No organization has single sign-on/.test(await page.locator("body").innerText()));
  await page.getByLabel("Work email").fill(`${person}@${domain}`);
  await page.getByRole("button", { name: "Continue" }).click();
  // A dev server compiles each route the first time it is visited; give it room.
  await page.waitForURL(/\/signup\/sso/, { timeout: 120000 });
  check("first sign-in lands on the username step", (await page.locator("#username").inputValue()) === person);
  await page.getByText(`confirmed ${person}@${domain}`).first().waitFor({ timeout: 15000 }).catch(() => {});
  check("it says the provider confirmed the address", (await page.locator("body").innerText()).includes(`confirmed ${person}@${domain}`));
  check("no session before a username is chosen", !(await ctx.cookies()).some((c) => c.name === "craton_session"));
  await page.screenshot({ path: `${SHOTS}/sso-3-username.png` });
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 120000 });
  check("account created and signed in", (await ctx.cookies()).some((c) => c.name === "craton_session"));
  await ctx.close();
}

// 3. The organization lists the new person, and the setup now counts as tested.
{
  const members = await (await fetch(`${API}/owners/${org}`)).json();
  check("the person is a member of the organization", members.members.some((m) => m.handle === person && m.role === "Member"));
  const cfg = await (await fetch(`${API}/orgs/${org}/sso`, { headers: { authorization: `Bearer ${ownerTok}` } })).json();
  check("the setup is marked tested", Boolean(cfg.testedAt));
}

// 4. The owner requires it; a member's password is then refused, an outside address is refused at the provider's answer.
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 1200 } });
  await ctx.addCookies([{ name: "craton_session", value: ownerTok, url: WEB }]);
  const page = await ctx.newPage();
  await page.goto(`${WEB}/orgs/${org}/settings`, { waitUntil: "networkidle" });
  const toggle = page.getByRole("switch", { name: "Require single sign-on" });
  await toggle.click();
  await page.waitForFunction(() => /now required/.test(document.body.innerText), null, { timeout: 15000 });
  check("an owner can require it after it has been tested", true);
  await page.screenshot({ path: `${SHOTS}/sso-4-required.png`, fullPage: true });
  await ctx.close();

  const c2 = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const p2 = await c2.newPage();
  await p2.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await p2.locator('input[name="login"]').fill(mate);
  await p2.locator('input[name="password"]').fill("a-very-long-password");
  await p2.locator('button[type="submit"]').click();
  await p2.getByText(/requires single sign-on/).first().waitFor({ timeout: 15000 });
  check("a member's password is refused, in words", true);
  check("no session was started", !(await c2.cookies()).some((c) => c.name === "craton_session"));
  await p2.screenshot({ path: `${SHOTS}/sso-5-refused.png` });
  await c2.close();

  const ownerLogin = await fetch(`${API}/auth/login`, { method: "POST", headers: j, body: JSON.stringify({ login: owner, password: "a-very-long-password" }) });
  check("an owner can still use a password", ownerLogin.status === 200);

  const c3 = await browser.newContext();
  const p3 = await c3.newPage();
  await who({ sub: "sso-outside", email: `intruder@other-company.com`, name: "Intruder" });
  await p3.goto(`${WEB}/login/sso?email=${encodeURIComponent(`x@${domain}`)}`, { waitUntil: "networkidle" });
  await p3.getByRole("button", { name: "Continue" }).click();
  await p3.waitForURL(/\/login\?sso=domain/, { timeout: 120000 });
  await p3.getByText(/isn.t at a domain/).first().waitFor({ timeout: 15000 }).catch(() => {});
  check("an address outside the verified domain is refused", /isn’t at a domain/.test(await p3.locator("body").innerText()) && !(await c3.cookies()).some((c) => c.name === "craton_session"));
  await c3.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
