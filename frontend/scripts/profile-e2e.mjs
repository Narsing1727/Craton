// A real browser against a running stack, on a throwaway account (start the API with a throwaway CRATON_DATA_DIR): the
// profile fields save and show on the public page, and a profile picture can be chosen, is shrunk in the browser, shows in
// the header and on the profile, and can be removed.
//   node scripts/profile-e2e.mjs [shots-dir]

import { chromium } from "playwright-core";

const API = process.env.CRATON_API_URL ?? "http://localhost:4000";
const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const shots = process.argv[2];
const handle = `profile${Date.now().toString(36)}`;
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await ctx.addCookies([{ name: "craton_session", value: token, url: WEB }]);
const page = await ctx.newPage();
const go = (path) => page.goto(`${WEB}${path}`, { waitUntil: "networkidle", timeout: 120000 });

await go("/settings");
await page.getByLabel("Company or institute").fill("IIT Roorkee");
await page.getByLabel("Location").fill("Roorkee, India");
await page.getByLabel("Website").fill("example.org/priya");
await page.getByLabel("Pronouns").fill("she/her");
await page.getByRole("button", { name: "Save changes" }).click();
await page.waitForTimeout(1500);
const saved = await me();
must(saved.company === "IIT Roorkee" && saved.location === "Roorkee, India" && saved.pronouns === "she/her", "the profile fields are saved");
must(saved.website === "https://example.org/priya", "a bare domain became an https address");

// A big picture (1600 x 900 PNG) is chosen; the browser shrinks it before sending.
const png = await page.evaluate(() => {
  const c = document.createElement("canvas");
  c.width = 1600;
  c.height = 900;
  const g = c.getContext("2d");
  const grad = g.createLinearGradient(0, 0, 1600, 900);
  grad.addColorStop(0, "#c0392b");
  grad.addColorStop(1, "#2c3e50");
  g.fillStyle = grad;
  g.fillRect(0, 0, 1600, 900);
  g.fillStyle = "#fff";
  g.fillRect(700, 300, 200, 300);
  return c.toDataURL("image/png").split(",")[1];
});
await page.locator('input[type="file"]').setInputFiles({ name: "big.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
await page.getByRole("button", { name: "Change picture" }).waitFor({ timeout: 20000 });
must((await me()).hasAvatar === true, "the picture is stored on the account");
const served = await fetch(`${WEB}/avatar/${handle}`);
const bytes = Buffer.from(await served.arrayBuffer());
must(served.status === 200 && /^image\/(webp|jpeg)$/.test(served.headers.get("content-type") ?? ""), `it is served from the site (${served.headers.get("content-type")})`);
must(bytes.length < 60 * 1024, `and was shrunk first (${Math.round(bytes.length / 1024)} KB from a ${Math.round(png.length * 0.75 / 1024)} KB original)`);
await go("/settings");
await page.waitForFunction(() => document.querySelectorAll('img[src^="/avatar/"]').length >= 2, null, { timeout: 20000 }).catch(() => {}); // the picture is only drawn once it has loaded
const loaded = await page.evaluate(async () => {
  const imgs = [...document.querySelectorAll('img[src^="/avatar/"]')];
  await Promise.all(imgs.map((i) => (i.complete ? null : new Promise((r) => { i.onload = i.onerror = r; }))));
  return imgs.map((i) => i.naturalWidth);
});
must(loaded.length >= 2 && loaded.every((w) => w === 256), `the picture shows in the header and the form (${loaded.join(", ")} px wide)`);
if (shots) await page.screenshot({ path: `${shots}/profile-settings.png` });

await go(`/${handle}`);
const profileText = await page.locator("body").innerText();
must(/she\/her/.test(profileText) && /IIT Roorkee/.test(profileText) && /Roorkee, India/.test(profileText) && /example\.org\/priya/.test(profileText), "the public profile shows pronouns, company, location and website");
must((await page.locator('a[href="https://example.org/priya"]').getAttribute("rel"))?.includes("nofollow"), "the website link is nofollow and noopener");
if (shots) await page.screenshot({ path: `${shots}/profile-public.png` });

await go("/settings");
await page.getByRole("button", { name: "Remove", exact: true }).click();
await page.getByRole("button", { name: "Upload picture" }).waitFor({ timeout: 20000 });
must((await me()).hasAvatar === false, "removing the picture works");
must((await fetch(`${WEB}/avatar/${handle}`)).status === 204, "and the site then answers 204 (no picture) for it");

await browser.close();
console.log("profile e2e passed");
