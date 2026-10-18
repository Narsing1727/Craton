// Walk a page with the Tab key and report what a keyboard user would struggle with: focused elements with no visible
// focus indicator, and focus that stops moving. Also lists controls without a name, fields without a label, images
// without alt text, duplicate ids and pages without exactly one h1. Same setup as route-sweep.mjs (demo account, Edge or Chrome).
//
//   npm run focus
//   CRATON_ROUTES=/hydrolab/chalakudy-basin,/settings npm run focus

import fs from "node:fs";
import { chromium } from "playwright-core";

const WEB = process.env.CRATON_WEB ?? "http://localhost:3100";
const R = "/hydrolab/chalakudy-basin";
const routes = (process.env.CRATON_ROUTES ?? `${R},${R}/blob/gauges.csv,${R}/blob/terrain/basin_dem.tif,${R}/pulls,${R}/pull/142,${R}/issues,${R}/commits,${R}/releases,${R}/settings,${R}/settings/collaborators,/dashboard,/settings,/settings/tokens,/settings/security,/new,/explore,/docs,/cli,/api-reference,/pricing,/help,/changelog,/about,/security`).split(",");
const STEPS = Number(process.env.CRATON_STEPS ?? 70);

const candidates = [process.env.CRATON_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const exe = candidates.find((p) => p && fs.existsSync(p));
if (!exe) throw new Error("No Chrome or Edge found. Set CRATON_BROWSER.");

const browser = await chromium.launch({ executablePath: exe, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
if (process.env.CRATON_SESSION_TOKEN) {
  // A throwaway account's session (see scripts/ui-audit.mjs): signing in as the demo user writes to its security log.
  await ctx.addCookies([{ name: "craton_session", value: process.env.CRATON_SESSION_TOKEN, url: WEB }]);
} else {
  await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="login"]', "priyam");
  await page.fill('input[name="password"]', "craton-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForURL(/dashboard/, { timeout: 20000 });
}

let problems = 0;
for (const route of routes) {
  await page.goto(`${WEB}${route}`, { waitUntil: "networkidle", timeout: 30000 });
  await page.evaluate(() => (document.activeElement instanceof HTMLElement ? document.activeElement.blur() : null));
  const seen = new Map();
  let stuck = 0, last = "";
  const bad = [];
  for (let i = 0; i < STEPS; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      const props = ["outlineStyle", "outlineWidth", "boxShadow", "textDecorationLine", "backgroundColor", "borderTopColor", "borderBottomColor", "color", "opacity"];
      const snap = () => props.map((k) => getComputedStyle(el)[k]).join("|");
      const focused = snap();
      const outline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
      const shadow = cs.boxShadow && cs.boxShadow !== "none";
      // A list row can ring itself through its link's ::after (see globals.css).
      const pseudo = ["::after", "::before"].some((p) => { const ps = getComputedStyle(el, p); return ps.outlineStyle !== "none" && parseFloat(ps.outlineWidth) > 0; });
      // Anything that looks different when focused counts as an indicator: a ring, an underline, a fill, a border.
      el.blur();
      const changed = snap() !== focused;
      el.focus({ preventScroll: true });
      const label = (el.getAttribute("aria-label") || el.textContent || el.getAttribute("title") || el.getAttribute("name") || el.getAttribute("href") || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return { tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || "", label, indicator: outline || shadow || changed || pseudo, visible: r.width > 0 && r.height > 0, key: `${el.tagName}|${label}|${Math.round(r.x)}|${Math.round(r.y)}` };
    });
    if (!info) continue;
    stuck = info.key === last ? stuck + 1 : 0;
    last = info.key;
    if (stuck >= 3) {
      console.log(`  FOCUS STUCK on ${route} at <${info.tag}> "${info.label}"`);
      problems++;
      break;
    }
    if (seen.has(info.key)) break; // the tab order wrapped around
    seen.set(info.key, info);
    if (!info.indicator && info.visible) bad.push(info);
  }
  for (const b of bad) {
    problems++;
    console.log(`  NO FOCUS RING on ${route}: <${b.tag}${b.role ? ` role=${b.role}` : ""}> "${b.label}"`);
  }
  // Structure a screen reader depends on: names for controls, labels for fields, alt text, unique ids, one h1.
  const found = await page.evaluate(() => {
    const issues = [];
    const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
    const name = (el) => (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || el.textContent || "").trim() || el.querySelector("img[alt]:not([alt=''])")?.getAttribute("alt") || "";
    for (const el of document.querySelectorAll("button, a[href], [role=button]")) {
      if (visible(el) && !name(el)) issues.push(`${el.tagName.toLowerCase()} with no accessible name (${String(el.className).slice(0, 50)})`);
    }
    for (const el of document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]), select, textarea")) {
      if (!visible(el)) continue;
      const labelled = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || el.getAttribute("title") || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest("label");
      if (!labelled) issues.push(`${el.tagName.toLowerCase()}[name=${el.getAttribute("name") ?? ""}] has no label`);
    }
    for (const el of document.querySelectorAll("img:not([alt])")) issues.push(`img with no alt (${(el.getAttribute("src") || "").slice(0, 60)})`);
    const ids = new Map();
    for (const el of document.querySelectorAll("[id]")) ids.set(el.id, (ids.get(el.id) ?? 0) + 1);
    for (const [id, n] of ids) if (n > 1) issues.push(`id "${id}" used ${n} times`);
    const h1 = [...document.querySelectorAll("h1")].length;
    if (h1 !== 1) issues.push(`${h1} h1 elements`);
    return issues;
  });
  for (const f of found) {
    problems++;
    console.log(`  A11Y on ${route}: ${f}`);
  }
  console.log(`${bad.length ? "FAIL" : "ok  "} ${route.padEnd(48)} ${seen.size} stops`);
}
await browser.close();
console.log(problems === 0 ? "\nKeyboard walk clean." : `\n${problems} problem(s).`);
