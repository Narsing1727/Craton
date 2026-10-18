// A real browser against a running stack, on a throwaway account (start the API with a throwaway CRATON_DATA_DIR): the
// new-organization page fills the address from the name, says whether it is free, refuses a taken one, and creates it.
//   node scripts/org-e2e.mjs [shots-dir]

import { chromium } from "playwright-core";

const API = process.env.CRATON_API_URL ?? "http://localhost:4000";
const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const shots = process.argv[2];
const stamp = Date.now().toString(36);
const handle = `orgtester${stamp}`;
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};

const signup = await fetch(`${API}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: handle, email: `${handle}@example.org`, password: "a-very-long-password" }) });
if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
const { token } = await signup.json();
const authed = { authorization: `Bearer ${token}`, "content-type": "application/json" };
await fetch(`${API}/v1/user`, { method: "PATCH", headers: authed, body: JSON.stringify({ onboarded: true }) });
await fetch(`${API}/v1/orgs`, { method: "POST", headers: authed, body: JSON.stringify({ handle: `taken-${stamp}`, name: "Already Here" }) });

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addCookies([{ name: "craton_session", value: token, url: WEB }]);
const page = await ctx.newPage();
await page.goto(`${WEB}/orgs/new`, { waitUntil: "networkidle", timeout: 120000 });
const create = page.getByRole("button", { name: "Create organization" });
must(await create.isDisabled(), "Create is off until there is a name");
if (shots) await page.screenshot({ path: `${shots}/org-new-empty.png` });

await page.getByLabel("Organization name").fill(`Basin Lab ${stamp}`);
must((await page.getByLabel("Address").inputValue()) === `basin-lab-${stamp}`, "the address fills itself from the name");
await page.getByText("is available").waitFor({ timeout: 10000 });
must(true, "and it says the address is available");
if (shots) await page.screenshot({ path: `${shots}/org-new-filled.png` });

await page.getByLabel("Address").fill(`taken-${stamp}`);
await page.getByText("That address is taken").waitFor({ timeout: 10000 });
must(await create.isDisabled(), "a taken address is named and cannot be created");
if (shots) await page.screenshot({ path: `${shots}/org-new-taken.png` });

await page.getByLabel("Address").fill("-bad-");
await page.getByText(/Use lowercase letters/).waitFor({ timeout: 5000 });
must(await create.isDisabled(), "a badly formed address says why");

await page.getByLabel("Address").fill(`basin-lab-${stamp}`);
await page.getByText("is available").waitFor({ timeout: 10000 });
await create.click();
await page.waitForURL(`**/orgs/basin-lab-${stamp}`, { timeout: 30000 });
must(true, "creating it opens the organization");
const org = await (await fetch(`${API}/v1/owners/basin-lab-${stamp}`)).json();
must(org.name === `Basin Lab ${stamp}` && org.kind === "org", "with the name that was typed");
await browser.close();
console.log("org e2e passed");
