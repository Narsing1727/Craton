// Signing in with GitHub, end to end in a real browser: the real web app (:3100), the real API (:4000) with GitHub pointed
// at scripts/mock-google.mjs (:9099, its /gh paths). Start the API with a THROWAWAY data folder: this creates accounts.
// See the header of mock-google.mjs for the environment variables, then:
//
//   CRATON_E2E_DB=<that folder>/craton.db npm run e2e:github
//
// Covers: the button appears only when configured; first sign-in -> username step -> account; returning sign-in;
// an account with no verified email; cancelling at GitHub; connecting and disconnecting from Settings.
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright-core";

const WEB = "http://localhost:3100", API = "http://localhost:4000/v1", MOCK = "http://localhost:9099";
const SHOTS = process.env.CRATON_E2E_SHOTS ?? "e2e-shots";
const DB = process.env.CRATON_E2E_DB;
if (!DB) throw new Error("Set CRATON_E2E_DB to the craton.db of the throwaway API.");
fs.mkdirSync(SHOTS, { recursive: true });
const edge = [process.env.CRATON_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].find((p) => p && fs.existsSync(p));
if (!edge) throw new Error("No Chrome or Edge found. Set CRATON_BROWSER.");
const browser = await chromium.launch({ executablePath: edge, headless: true });

const RUN = Date.now().toString(36).slice(-5);
let failures = 0;
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
};
const who = (o) => fetch(`${MOCK}/_gh_identity?${new URLSearchParams(o)}`).then((r) => r.json());
const fresh = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && !/favicon|Failed to load resource/.test(m.text()) && errors.push(m.text()));
  return { ctx, page, errors };
};
const cookieNames = async (ctx) => (await ctx.cookies()).map((c) => c.name);
const btn = (page) => page.getByRole("link", { name: /continue with github/i });

// 1. The button is there, only because the API says GitHub is configured; first sign-in creates the account.
{
  const { ctx, page, errors } = await fresh();
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  check("login page shows Continue with GitHub", await btn(page).isVisible());
  await page.screenshot({ path: `${SHOTS}/gh-1-login.png` });
  await page.goto(`${WEB}/signup`, { waitUntil: "networkidle" });
  check("signup page shows it too", await btn(page).isVisible());

  await who({ id: String(7000 + (parseInt(RUN, 36) % 1000)), login: `gh-${RUN}`, name: "Octo Person", email: `ghuser${RUN}@example.org` });
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await btn(page).click();
  await page.waitForURL(/\/signup\/github/, { timeout: 20000 });
  const suggested = await page.locator("#username").inputValue();
  check("first sign-in lands on the username step with a suggestion", suggested === `ghuser${RUN}`, `suggested "${suggested}"`);
  check("it says GitHub confirmed the address", (await page.locator("main").innerText()).includes(`GitHub confirmed ghuser${RUN}@example.org`));
  check("no session cookie before a username is chosen", !(await cookieNames(ctx)).includes("craton_session"));
  await page.screenshot({ path: `${SHOTS}/gh-2-username.png` });
  await page.locator("#username").fill(`ghuser${RUN}`);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 20000 });
  check("account created and signed in", (await cookieNames(ctx)).includes("craton_session"));
  check("the pending ticket cookie is gone", !(await cookieNames(ctx)).includes("craton_google_pending"));

  const token = (await ctx.cookies()).find((c) => c.name === "craton_session").value;
  const me = await fetch(`${API}/user`, { headers: { authorization: `Bearer ${token}` } }).then((r) => r.json());
  check("the account is email-verified and named from GitHub", me.emailVerified === true && me.name === "Octo Person", JSON.stringify({ v: me.emailVerified, n: me.name }));
  await fetch(`${API}/user`, { method: "PATCH", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ onboarded: true }) });
  await page.goto(`${WEB}/settings/security`, { waitUntil: "networkidle" });
  const text = await page.locator("main, body").first().innerText();
  check("Sign-in methods shows GitHub connected", text.includes(`Connected as ghuser${RUN}@example.org`) && /GitHub/.test(text));
  check("Disconnect is disabled while GitHub is the only way in", await page.getByRole("button", { name: "Disconnect" }).isDisabled());
  await page.screenshot({ path: `${SHOTS}/gh-3-security.png`, fullPage: true });

  // Returning: straight in.
  await ctx.clearCookies();
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await btn(page).click();
  await page.waitForURL(/\/(dashboard|onboarding)/, { timeout: 20000 });
  check("returning sign-in goes straight to the dashboard", /\/dashboard/.test(page.url()), page.url());
  check("no console or page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  await ctx.close();
}

// 2. No verified email on the GitHub account: refused, in words.
{
  const { ctx, page } = await fresh();
  await who({ id: String(8000 + (parseInt(RUN, 36) % 1000)), login: `noemail-${RUN}`, name: "No Email", email: `unverified${RUN}@example.org`, verified: "0" });
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await btn(page).click();
  await page.waitForURL(/\/login\?github=noemail/, { timeout: 20000 });
  const text = await page.locator("body").innerText();
  check("an account with no verified email is told why", /no verified email address/i.test(text), text.replace(/\s+/g, " ").slice(0, 120));
  check("and no session was started", !(await cookieNames(ctx)).includes("craton_session"));
  await page.screenshot({ path: `${SHOTS}/gh-4-noemail.png` });
  await ctx.close();
}

// 3. Cancelling at GitHub.
{
  const { ctx, page } = await fresh();
  await who({ deny: "1" });
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await btn(page).click();
  await page.waitForURL(/\/login\?github=denied/, { timeout: 20000 });
  await page.getByText(/cancelled/i).first().waitFor({ timeout: 15000 });
  check("cancelling at GitHub says so and signs nobody in", /cancelled/i.test(await page.locator("body").innerText()) && !(await cookieNames(ctx)).includes("craton_session"));
  await ctx.close();
}

// 4. Connect GitHub from Settings to an account that has a password; then disconnect it.
{
  const { ctx, page } = await fresh();
  const user = `pw${RUN}`;
  const signup = await fetch(`${API}/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: user, email: `${user}@example.org`, password: "a-very-long-password" }) }).then((r) => r.json());
  const db = new DatabaseSync(DB);
  db.prepare("UPDATE users SET email_verified_at = '2026-01-01T00:00:00.000Z', onboarded_at = '2026-01-01T00:00:00.000Z' WHERE email = ?").run(`${user}@example.org`);
  db.close();
  await ctx.addCookies([{ name: "craton_session", value: signup.token, url: WEB }]);
  await who({ id: String(9000 + (parseInt(RUN, 36) % 1000)), login: `linked-${RUN}`, name: "Linked", email: `linked${RUN}@example.org` });
  await page.goto(`${WEB}/settings/security`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: /connect github/i }).click();
  await page.waitForURL(/\/settings\/security\?github=linked/, { timeout: 20000 });
  await page.getByText(/GitHub is connected/).first().waitFor({ timeout: 15000 });
  const text = await page.locator("main, body").first().innerText();
  check("connecting from Settings links GitHub", /GitHub is connected/.test(text) && text.includes(`Connected as linked${RUN}@example.org`));
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.waitForFunction(() => /Not connected/.test(document.body.innerText), null, { timeout: 15000 });
  check("and it can be disconnected because a password remains", true);
  await page.screenshot({ path: `${SHOTS}/gh-5-connect.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
