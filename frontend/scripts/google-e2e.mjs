// Signing in with Google, end to end in a real browser: the real web app (:3100), the real API (:4000) with Google
// pointed at scripts/mock-google.mjs (:9099). Uses a Chromium-based browser already on the machine (set CRATON_BROWSER
// to its path if it is not found). Start the API with a THROWAWAY data folder: this creates accounts.
//
//   CRATON_E2E_DB=<that folder>/craton.db npm run e2e:google
//
// Covers: the button appears only when configured; first sign-in -> username step -> account; returning sign-in;
// cancelling at Google; a forged callback; an account whose address was never confirmed; two-step verification after
// Google; connecting and disconnecting Google from Settings.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const WEB = "http://localhost:3100", API = "http://localhost:4000/v1", MOCK = "http://localhost:9099";
const SHOTS = process.env.CRATON_E2E_SHOTS ?? "e2e-shots";
const DB = process.env.CRATON_E2E_DB;
if (!DB) throw new Error("Set CRATON_E2E_DB to the craton.db of the throwaway API (the test marks two accounts verified and two-step-enabled directly).");
fs.mkdirSync(SHOTS, { recursive: true });
const edge = [process.env.CRATON_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) => p && fs.existsSync(p));
if (!edge) throw new Error("No Chrome or Edge found. Set CRATON_BROWSER.");
const browser = await chromium.launch({ executablePath: edge, headless: true });

const RUN = Date.now().toString(36).slice(-5);
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};
const who = (o) => fetch(`${MOCK}/_identity?${new URLSearchParams(o)}`).then((r) => r.json());
const j = (path, body, token) => fetch(`${API}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { ctx, page, errors };
};
const cookieNames = async (ctx) => (await ctx.cookies()).map((c) => c.name);

// 1. The button is there, only because the API says Google is configured.
{
  const { ctx, page, errors } = await fresh();
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  const btn = page.getByRole("link", { name: /continue with google/i });
  check("login page shows Continue with Google", await btn.isVisible());
  await page.screenshot({ path: `${SHOTS}/1-login.png` });
  await page.goto(`${WEB}/signup`, { waitUntil: "networkidle" });
  check("signup page shows it too", await page.getByRole("link", { name: /continue with google/i }).isVisible());

  // 2. First sign-in: choose a username, account created, signed in, onboarding.
  await who({ sub: `g-1-${RUN}`, email: `e2e.user${RUN}@example.org`, name: "E2E User" });
  await page.goto(`${WEB}/login?next=%2Fnew`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /continue with google/i }).click();
  await page.waitForURL(/\/signup\/google/);
  const suggested = await page.locator("#username").inputValue();
  check("first sign-in lands on the username step with a suggestion", suggested === `e2e-user${RUN}`, `suggested "${suggested}"`);
  check("no session cookie before a username is chosen", !(await cookieNames(ctx)).includes("craton_session"));
  await page.screenshot({ path: `${SHOTS}/2-username.png` });
  await page.locator("#username").fill(`e2euser${RUN}`);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 15000 });
  check("account created and signed in (session cookie set, onboarding next)", (await cookieNames(ctx)).includes("craton_session"));
  check("the pending ticket cookie is gone", !(await cookieNames(ctx)).includes("craton_google_pending"));

  // 3. Settings shows the Google connection and no password.
  await page.goto(`${WEB}/settings/security`, { waitUntil: "networkidle" }).catch(() => {});
  // an un-onboarded user may be bounced; finish onboarding through the API-backed session first
  if (/onboarding/.test(page.url())) {
    await page.evaluate(() => fetch("/settings", { method: "HEAD" }));
  }
  const me = await (async () => {
    const c = (await ctx.cookies()).find((x) => x.name === "craton_session");
    return fetch(`${API}/user`, { headers: { authorization: `Bearer ${c.value}` } }).then((r) => r.json());
  })();
  check("the account is email-verified and named from Google", me.emailVerified === true && me.handle === `e2euser${RUN}` && me.name === "E2E User", JSON.stringify({ h: me.handle, v: me.emailVerified, n: me.name }));
  const token = (await ctx.cookies()).find((x) => x.name === "craton_session").value;
  await fetch(`${API}/user`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ onboarded: true }) });
  await page.goto(`${WEB}/settings/security`, { waitUntil: "networkidle" });
  const text = await page.locator("main, body").first().innerText();
  check("Sign-in methods card shows Google as connected", text.includes(`Connected as e2e.user${RUN}@example.org`));
  check("password card explains there is no password", /no password/i.test(text) && /Add a password/i.test(text));
  check("Disconnect is disabled while Google is the only way in", await page.getByRole("button", { name: "Disconnect" }).isDisabled());
  await page.screenshot({ path: `${SHOTS}/3-security.png`, fullPage: true });

  // 4. Sign out, sign in again with Google: straight in, no username step.
  await ctx.clearCookies();
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /continue with google/i }).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 15000 });
  check("returning sign-in goes straight to the dashboard", /\/dashboard/.test(page.url()), page.url());
  check("no console or page errors on the way", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// 5. Cancelling at Google, and a callback from another browser.
{
  const { ctx, page } = await fresh();
  await who({ deny: "1" });
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /continue with google/i }).click();
  await page.waitForURL(/\/login\?google=denied/);
  await page.waitForLoadState("networkidle");
  check("cancelling shows a plain notice", /cancelled/i.test(await page.locator("body").innerText()));
  await who({ deny: "0" });
  await page.goto(`${WEB}/auth/google/callback?code=abc&state=made-up`, { waitUntil: "networkidle" });
  await page.waitForLoadState("networkidle");
  check("a callback with no matching cookie is refused", /\/login\?google=expired/.test(page.url()) && /expired/i.test(await page.locator("body").innerText()), page.url());
  check("no session from a forged callback", !(await cookieNames(ctx)).includes("craton_session"));
  await ctx.close();
}

// 6. An account whose address was never confirmed is not taken over.
{
  await j("/auth/signup", { username: `squatter${RUN}`, email: `victim${RUN}@example.org`, password: "a-very-long-password" });
  const { ctx, page } = await fresh();
  await who({ sub: `g-9-${RUN}`, email: `victim${RUN}@example.org`, name: "Victim", verified: "1" });
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /continue with google/i }).click();
  await page.waitForURL(/\/login\?google=unverified/);
  await page.waitForLoadState("networkidle");
  check("unconfirmed account: refused with an explanation, no session", /never confirmed/i.test(await page.locator("body").innerText()) && !(await cookieNames(ctx)).includes("craton_session"));
  await ctx.close();
}

// 7. Two-step verification: Google answers who, the code is still required.
{
  const r = await (await j("/auth/signup", { username: `guarded${RUN}`, email: `guarded${RUN}@example.org`, password: "a-very-long-password" })).json();
  const db = new DatabaseSync(DB);
  db.prepare(`UPDATE users SET email_verified_at = '2026-01-01T00:00:00.000Z', totp_secret = 'x', totp_enabled_at = '2026-01-01T00:00:00.000Z' WHERE email = 'guarded${RUN}@example.org'`).run();
  db.close();
  const { ctx, page } = await fresh();
  await who({ sub: `g-10-${RUN}`, email: `guarded${RUN}@example.org`, name: "Guarded", verified: "1" });
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /continue with google/i }).click();
  await page.waitForURL(/\/login\?mfa=1/);
  await page.waitForLoadState("networkidle");
  const body = await page.locator("body").innerText();
  check("two-step account: sign-in page shows the code step", /two-step verification/i.test(body) && (await page.locator('input[name="code"], #code').count()) > 0);
  check("and no session yet", !(await cookieNames(ctx)).includes("craton_session"));
  await page.screenshot({ path: `${SHOTS}/7-mfa.png` });
  await ctx.close();
}

// 8. Connect Google from settings to an existing password account.
{
  await j("/auth/signup", { username: `linker${RUN}`, email: `linker${RUN}@example.org`, password: "a-very-long-password" });
  const db = new DatabaseSync(DB);
  db.prepare(`UPDATE users SET onboarded_at = '2026-01-01T00:00:00.000Z', email_verified_at = '2026-01-01T00:00:00.000Z' WHERE email = 'linker${RUN}@example.org'`).run();
  db.close();
  const { ctx, page, errors } = await fresh();
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.getByLabel(/email or username/i).fill(`linker${RUN}`);
  await page.locator("#password").fill("a-very-long-password");
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await who({ sub: `g-20-${RUN}`, email: `linker.work${RUN}@example.org`, name: "Linker" });
  await page.goto(`${WEB}/settings/security`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /connect google/i }).click();
  await page.waitForURL(/\/settings\/security\?google=linked/, { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  const text = await page.locator("body").innerText();
  check("connected from settings: confirmation and the new address shown", /Google is connected/.test(text) && text.includes(`Connected as linker.work${RUN}@example.org`));
  await page.screenshot({ path: `${SHOTS}/8-linked.png`, fullPage: true });
  // Disconnect works because this account has a password.
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.waitForFunction(() => /Not connected/.test(document.body.innerText), null, { timeout: 10000 });
  check("disconnect works while a password exists", true);
  const log = await page.locator("body").innerText();
  check("both events are in the security log", /Google connected/.test(log) && /Google disconnected/.test(log));
  check("no console or page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
