// A real browser against a running stack, on throwaway accounts (start the API with a throwaway CRATON_DATA_DIR): react to
// a comment, edit and delete your own, and see that someone else's cannot be edited.
//   CRATON_E2E_DATABASE_URL=<postgres address> node scripts/comments-e2e.mjs [shots-dir]

import { chromium } from "playwright-core";

const API = process.env.CRATON_API_URL ?? "http://localhost:4000";
const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const shots = process.argv[2];
const stamp = Date.now().toString(36);
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};
async function account(name) {
  const handle = `${name}${stamp}`;
  const r = await fetch(`${API}/v1/auth/signup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: handle, email: `${handle}@example.org`, password: "a-very-long-password" }) });
  if (!r.ok) throw new Error(`signup failed: ${r.status} ${await r.text()}`);
  const { token } = await r.json();
  await fetch(`${API}/v1/user`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ onboarded: true }) });
  return { handle, token, h: { authorization: `Bearer ${token}`, "content-type": "application/json" } };
}
const owner = await account("own");
const guest = await account("gst");
// A public repository needs a confirmed email; confirm it in the throwaway database, as the sign-in scripts do.
const { openE2eDb } = await import("./e2e-db.mjs");
const db = await openE2eDb();
await db.prepare("UPDATE users SET email_verified_at = now_iso() WHERE owner_id = (SELECT id FROM owners WHERE handle = ?)").run(owner.handle);
await db.close();
const made = await fetch(`${API}/v1/repos`, { method: "POST", headers: owner.h, body: JSON.stringify({ name: "basin", visibility: "public" }) });
if (!made.ok) throw new Error(`repo create failed: ${made.status} ${await made.text()}`);
await fetch(`${API}/v1/repos/${owner.handle}/basin/issues`, { method: "POST", headers: owner.h, body: JSON.stringify({ title: "Gauge 4 reads high" }) });
const R = `${API}/v1/repos/${owner.handle}/basin`;
await fetch(`${R}/issues/1/comments`, { method: "POST", headers: owner.h, body: JSON.stringify({ body: "Looks like the datum." }) });
const theirsRes = await fetch(`${R}/issues/1/comments`, { method: "POST", headers: guest.h, body: JSON.stringify({ body: "Agreed, checking the benchmark." }) });
if (!theirsRes.ok) throw new Error(`guest comment failed: ${theirsRes.status} ${await theirsRes.text()}`);
const theirs = await theirsRes.json();

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: "craton_session", value: owner.token, url: WEB }]);
const page = await ctx.newPage();
await page.goto(`${WEB}/${owner.handle}/basin/issues/1`, { waitUntil: "networkidle", timeout: 120000 });

const mine = page.locator("li", { hasText: "Looks like the datum." }).first();
const other = page.locator("li", { hasText: "Agreed, checking the benchmark." }).first();
await other.waitFor();
must((await other.getByRole("button", { name: "Edit", exact: true }).count()) === 0, "someone else's comment has no Edit button");
must((await mine.getByRole("button", { name: "Edit", exact: true }).count()) === 1, "your own comment has one");

// React from the picker; the count shows and is saved.
await mine.getByRole("button", { name: "Add a reaction" }).click();
await page.getByRole("button", { name: "Rocket" }).click();
await mine.getByRole("button", { name: /Rocket/ }).waitFor();
const saved = async () => (await (await fetch(`${R}/issues/1`, { headers: owner.h })).json()).thread;
await page.waitForTimeout(800);
must((await saved())[0].reactions.rocket?.count === 1, "the reaction is saved on the server");
if (shots) await page.screenshot({ path: `${shots}/comment-reaction.png` });
await page.reload({ waitUntil: "networkidle" });
must((await page.locator("li", { hasText: "Looks like the datum." }).first().getByRole("button", { name: /Rocket/ }).getAttribute("aria-pressed")) === "true", "after a reload it still shows as yours");

// Edit.
await page.locator("li", { hasText: "Looks like the datum." }).first().getByRole("button", { name: "Edit", exact: true }).click();
await page.getByLabel("Edit comment").fill("Looks like the vertical datum.");
await page.getByRole("button", { name: "Save", exact: true }).click();
await page.getByText("(edited)").waitFor({ timeout: 10000 });
must((await saved())[0].body === "Looks like the vertical datum." && (await saved())[0].editedAt, "an edit is saved and marked (edited)");
if (shots) await page.screenshot({ path: `${shots}/comment-edited.png` });

// Someone else reacting is counted.
const guestReact = await fetch(`${R}/comments/${(await saved())[0].id}/reactions/rocket`, { method: "PUT", headers: guest.h });
must(guestReact.ok, `a second person can react (${guestReact.status})`);
await page.reload({ waitUntil: "networkidle" });
const pill = page.locator("li", { hasText: "vertical datum" }).first().getByRole("button", { name: /Rocket/ });
must(/2/.test(await pill.innerText()), "another person's reaction is counted too");

// Delete.
page.once("dialog", (d) => d.accept());
await page.locator("li", { hasText: "vertical datum" }).first().getByRole("button", { name: "Delete", exact: true }).click();
await page.getByText("Comment deleted").waitFor({ timeout: 10000 });
must((await saved()).length === 1 && (await saved())[0].id === theirs.id, "deleting removes it from the server and leaves the other comment");
await browser.close();
console.log("comments e2e passed");
