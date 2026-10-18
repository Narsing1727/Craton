// A real browser against a running stack, on a throwaway account (start the API with a throwaway CRATON_DATA_DIR): a LAS point cloud's
// file page shows a picture of the cloud seen from above, with its point count and elevation range.
//   CRATON_E2E_DB=<throwaway craton.db> node scripts/cloud-e2e.mjs [shots-dir]

import { chromium } from "playwright-core";
import { las } from "../../backend/test/helpers/lasfile.ts";

const API = process.env.CRATON_API_URL ?? "http://localhost:4000";
const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const shots = process.argv[2];
const handle = `cloud${Date.now().toString(36)}`;
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};
const signup = await fetch(`${API}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: handle, email: `${handle}@example.org`, password: "a-very-long-password" }) });
if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
const { token } = await signup.json();
const h = { authorization: `Bearer ${token}`, "content-type": "application/json" };
await fetch(`${API}/v1/user`, { method: "PATCH", headers: h, body: JSON.stringify({ onboarded: true }) });
const dbFile = process.env.CRATON_E2E_DB;
if (!dbFile) throw new Error("Set CRATON_E2E_DB to the throwaway API's craton.db.");
const { DatabaseSync } = await import("node:sqlite");
const db = new DatabaseSync(dbFile);
db.prepare("UPDATE users SET email_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(handle);
db.close();
const made = await fetch(`${API}/v1/repos`, { method: "POST", headers: h, body: JSON.stringify({ name: "survey", visibility: "public" }) });
if (!made.ok) throw new Error(`repo create failed: ${made.status} ${await made.text()}`);
const form = new FormData();
form.append("file", new File([new Uint8Array(las(120_000, { seed: 3 }))], "flight.las"));
form.append("paths", JSON.stringify(["flight.las"]));
form.append("message", "add flight");
const up = await fetch(`${API}/v1/repos/${handle}/survey/upload`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: form });
if (!up.ok) throw new Error(`upload failed: ${up.status} ${await up.text()}`);

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
await ctx.addCookies([{ name: "craton_session", value: token, url: WEB }]);
const page = await ctx.newPage();
await page.goto(`${WEB}/${handle}/survey/blob/flight.las`, { waitUntil: "networkidle", timeout: 120000 });
const text = await page.locator("main").innerText();
must(/Point cloud/.test(text), "the page calls it a point cloud");
must(/120,000 points/.test(text) && /elevation/.test(text), "with its point count and elevation range");
const img = page.locator('img[alt*="seen from above"]');
await img.waitFor({ timeout: 20000 });
const natural = await img.evaluate(async (el) => {
  if (!el.complete) await new Promise((r) => (el.onload = el.onerror = r));
  return [el.naturalWidth, el.naturalHeight];
});
must(natural[0] > 100 && natural[1] > 20, `the picture loads (${natural.join(" x ")})`);
if (shots) await page.screenshot({ path: `${shots}/cloud-preview.png` });
await browser.close();
console.log("cloud e2e passed");
