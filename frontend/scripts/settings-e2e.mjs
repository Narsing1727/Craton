// A real browser against a running stack, on a throwaway account (start the API with a throwaway CRATON_DATA_DIR): the
// Notifications and Preferences settings pages save, persist across a reload, and really change behaviour.
//   node scripts/settings-e2e.mjs [shots-dir]

import { chromium } from "playwright-core";

const API = process.env.CRATON_API_URL ?? "http://localhost:4000";
const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const shots = process.argv[2];
const handle = `settings${Date.now().toString(36)}`;
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};

const signup = await fetch(`${API}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: handle, email: `${handle}@example.org`, password: "a-very-long-password" }) });
if (!signup.ok) throw new Error(`signup failed: ${signup.status} ${await signup.text()}`);
const { token } = await signup.json();
await fetch(`${API}/v1/user`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ onboarded: true }) });
const me = async () => (await fetch(`${API}/v1/user`, { headers: { authorization: `Bearer ${token}` } })).json();

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addCookies([{ name: "craton_session", value: token, url: WEB }]);
const page = await ctx.newPage();
const go = (path) => page.goto(`${WEB}${path}`, { waitUntil: "networkidle", timeout: 120000 });

// Notifications: switch one off, it is saved on the account and still off after a reload.
await go("/settings/notifications");
const nav = await page.getByRole("navigation", { name: "Settings" }).innerText();
must(/Notifications/.test(nav) && /Preferences/.test(nav), "the settings menu lists Notifications and Preferences");
const review = page.getByRole("switch", { name: "Review requests" });
must((await review.getAttribute("aria-checked")) === "true", "review-request emails start on");
await review.click();
await page.waitForTimeout(1200);
must((await me()).notify.review_requests === false, "switching it off is saved on the account");
await go("/settings/notifications");
must((await page.getByRole("switch", { name: "Review requests" }).getAttribute("aria-checked")) === "false", "and it is still off after a reload");
must((await page.getByRole("switch", { name: "Failed checks on your pushes" }).getAttribute("aria-checked")) === "true", "the others stayed on");
if (shots) await page.screenshot({ path: `${shots}/settings-notifications.png` });

// Preferences: less motion, shortcuts, default visibility.
await go("/settings/preferences");
await page.getByRole("switch", { name: "Reduce motion" }).click();
must(await page.evaluate(() => document.documentElement.classList.contains("reduce-motion")), "Reduce motion takes effect at once");
await go("/settings/preferences");
must(await page.evaluate(() => document.documentElement.classList.contains("reduce-motion")), "and is applied again after a reload, before paint");
const duration = await page.evaluate(() => getComputedStyle(document.querySelector("button")).transitionDuration);
must(/^0(\.0+1)?m?s/.test(duration) || duration.startsWith("1e-05"), `transitions are effectively off (${duration})`);

await page.keyboard.press("?");
await page.waitForTimeout(500);
must(await page.getByRole("dialog").count() > 0, "with shortcuts on, ? opens the shortcut list");
await page.keyboard.press("Escape");
await page.getByRole("switch", { name: "Single-key shortcuts" }).click();
await page.locator("body").click({ position: { x: 5, y: 5 } });
await page.keyboard.press("?");
await page.waitForTimeout(500);
must((await page.getByRole("dialog").count()) === 0, "with shortcuts off, ? does nothing");
await page.keyboard.press("Control+k");
await page.waitForTimeout(500);
must((await page.getByRole("dialog").count()) > 0, "but Ctrl K still opens the command menu");
await page.keyboard.press("Escape");

await page.getByRole("radio", { name: /^Private/ }).click();
await page.waitForTimeout(1200);
must((await me()).defaultVisibility === "private", "choosing Private is saved on the account");
if (shots) await page.screenshot({ path: `${shots}/settings-preferences.png`, fullPage: true });
await go("/new");
must((await page.getByRole("radio", { name: /Private/ }).first().getAttribute("aria-checked")) === "true" || (await page.locator("[role=radio][data-checked], [role=radio][aria-checked=true]").filter({ hasText: /Private/ }).count()) > 0, "the new repository form starts on Private");

await browser.close();
console.log("settings e2e passed");
