// A real browser against a running stack, on a throwaway account (start the API with a throwaway CRATON_DATA_DIR): the
// release form takes an optional model run, the release shows it, and a bad run time is refused before anything is sent.
//   node scripts/release-run-e2e.mjs [shots-dir]

import { chromium } from "playwright-core";

const API = process.env.CRATON_API_URL ?? "http://localhost:4000";
const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const shots = process.argv[2];
const handle = `rel${Date.now().toString(36)}`;
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};

const signup = await fetch(`${API}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: handle, email: `${handle}@example.org`, password: "a-very-long-password" }) });
if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
const { token } = await signup.json();
const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
await fetch(`${API}/v1/user`, { method: "PATCH", headers: h, body: JSON.stringify({ onboarded: true }) });
// The sample project gives the repository files to release; a private one needs a plan, so confirm the email and go public.
const { DatabaseSync } = await import("node:sqlite");
const dbFile = process.env.CRATON_E2E_DB;
if (!dbFile) throw new Error("Set CRATON_E2E_DB to the throwaway API's craton.db (it confirms the email).");
const db = new DatabaseSync(dbFile);
db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(handle);
db.close();
const made = await fetch(`${API}/v1/repos`, { method: "POST", headers: h, body: JSON.stringify({ name: "basin", visibility: "public", sample: true }) });
if (!made.ok) throw new Error(`repo create failed: ${made.status} ${await made.text()}`);

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addCookies([{ name: "craton_session", value: token, url: WEB }]);
const page = await ctx.newPage();
await page.goto(`${WEB}/${handle}/basin/releases/new`, { waitUntil: "networkidle", timeout: 120000 });

await page.getByLabel("Run time (minutes)").fill("abc");
await page.getByRole("button", { name: "Publish release" }).click();
await page.getByText("Enter the run time in minutes").waitFor({ timeout: 5000 });
must(((await (await fetch(`${API}/v1/repos/${handle}/basin/releases`, { headers: h })).json()).length) === 0, "a bad run time is refused before anything is published");

await page.getByLabel("Software").fill("HEC-RAS");
await page.getByLabel("Version").fill("6.5");
await page.getByLabel("Plan or scenario").fill("p01 100-year flood");
await page.getByLabel("Run time (minutes)").fill("90");
await page.getByLabel("Run notes").fill("Manning n from calibration v3");
if (shots) await page.screenshot({ path: `${shots}/release-run-form.png`, fullPage: true });
await page.getByRole("button", { name: "Publish release" }).click();
await page.waitForURL(`**/${handle}/basin/releases`, { timeout: 30000 });
const stored = (await (await fetch(`${API}/v1/repos/${handle}/basin/releases`, { headers: h })).json())[0];
must(stored.run?.software === "HEC-RAS" && stored.run.version === "6.5" && stored.run.runtimeSeconds === 5400, "the run is saved with the release (90 minutes = 5400 s)");
const text = await page.locator("main").innerText();
must(/Model run/.test(text) && /HEC-RAS 6\.5/.test(text) && /p01 100-year flood/.test(text) && /1 h 30 min/.test(text), "the releases page shows software, plan and run time");
must(/Manning n from calibration v3/.test(text), "and the run notes");
if (shots) await page.screenshot({ path: `${shots}/release-run-page.png` });
await browser.close();
console.log("release run e2e passed");
