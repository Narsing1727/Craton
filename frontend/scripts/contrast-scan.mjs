// Text colour against its background on each page, in both themes, against WCAG AA (4.5:1, or 3:1 for large text).
// The background is the nearest opaque colour up the element's ancestors, composited over translucent ones; text over
// images or gradients can't be measured this way and is skipped. Same setup as route-sweep.mjs.
//
//   npm run contrast
//   CRATON_ROUTES=/dashboard CRATON_THEME=light npm run contrast

import fs from "node:fs";
import { chromium } from "playwright-core";

const WEB = process.env.CRATON_WEB ?? "http://localhost:3100";
const R = `/${process.env.CRATON_SWEEP_REPO ?? "narsing/the-first-repo"}`;
const routes = (process.env.CRATON_ROUTES ?? `/,/dashboard,/explore,${R},${R}/blob/vectors/waterways.geojson,${R}/blob/terrain/chalakudy_dem_30m.tif,${R}/pulls,${R}/issues,${R}/commits,${R}/releases,/settings,/settings/tokens,/new,/pricing,/docs,/cli,/api-reference,/help,/changelog,/about,/security,/terms,/privacy,/contact`).split(",");
const themes = process.env.CRATON_THEME ? [process.env.CRATON_THEME] : ["darker", "light"];

const candidates = [process.env.CRATON_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"];
const exe = candidates.find((p) => p && fs.existsSync(p));
if (!exe) throw new Error("No Chrome or Edge found. Set CRATON_BROWSER.");

const browser = await chromium.launch({ executablePath: exe, headless: true });
let total = 0;

for (const theme of themes) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript((t) => { try { localStorage.setItem("craton:theme", t); } catch {} }, theme);
  const page = await ctx.newPage();
  if (process.env.CRATON_SESSION_TOKEN) {
    // A throwaway account's session (see scripts/ui-audit.mjs): signing in as the demo user writes to its security log.
    await ctx.addCookies([{ name: "craton_session", value: process.env.CRATON_SESSION_TOKEN, url: WEB }]);
  } else {
    throw new Error("Set CRATON_SESSION_TOKEN to a throwaway account's session (npm run audit makes one); this script never signs in as a real person.");
  }

  for (const route of routes) {
    await page.goto(`${WEB}${route}`, { waitUntil: "networkidle", timeout: 30000 });
    const offenders = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 1;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      // Any CSS colour (oklch, color-mix, ...) to sRGB through the canvas.
      const rgba = (css) => {
        g.clearRect(0, 0, 1, 1);
        g.fillStyle = "#000";
        g.fillStyle = css;
        g.fillRect(0, 0, 1, 1);
        const d = g.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3] / 255];
      };
      const over = (top, under) => {
        const a = top[3] + under[3] * (1 - top[3]);
        if (a === 0) return [0, 0, 0, 0];
        return [0, 1, 2].map((i) => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a).concat(a);
      };
      const lum = (c) => {
        const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
      };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      const out = new Map();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.nodeValue.trim();
        if (!text) continue;
        const el = node.parentElement;
        if (!el || ["SCRIPT", "STYLE", "NOSCRIPT"].includes(el.tagName)) continue;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        if (r.width === 0 || r.height === 0 || cs.visibility === "hidden" || cs.display === "none" || parseFloat(cs.opacity) === 0) continue;
        if (el.closest("[aria-hidden=true], [disabled], .sr-only")) continue;
        // Background: walk up until opaque; give up on images and gradients.
        let bg = [0, 0, 0, 0], skip = false;
        const stack = [];
        for (let p = el; p; p = p.parentElement) {
          const ps = getComputedStyle(p);
          if (ps.backgroundImage !== "none") { skip = true; break; }
          const c = rgba(ps.backgroundColor);
          if (c[3] > 0) stack.push(c);
          if (c[3] >= 1) break;
        }
        if (skip) continue;
        bg = stack.reduceRight((under, top) => over(top, under), [255, 255, 255, 1]);
        if (stack.length === 0) bg = rgba(getComputedStyle(document.body).backgroundColor).slice(0, 3).concat(1);
        let fg = rgba(cs.color);
        fg = over(fg, bg);
        const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        const got = ratio(fg, bg);
        if (got + 0.005 < need) {
          const key = `${fg.slice(0, 3).map(Math.round)}|${bg.slice(0, 3).map(Math.round)}|${Math.round(size)}`;
          const prev = out.get(key);
          if (prev) prev.count++;
          else out.set(key, { ratio: Math.round(got * 100) / 100, need, size: Math.round(size), fg: fg.slice(0, 3).map(Math.round).join(","), bg: bg.slice(0, 3).map(Math.round).join(","), sample: text.slice(0, 40), count: 1 });
        }
      }
      return [...out.values()].sort((a, b) => b.count - a.count).slice(0, 8);
    });
    total += offenders.length;
    console.log(`${offenders.length ? "FAIL" : "ok  "} [${theme}] ${route}`);
    for (const o of offenders) console.log(`    ${o.ratio}:1 (needs ${o.need}) ${o.size}px rgb(${o.fg}) on rgb(${o.bg})  x${o.count}  "${o.sample}"`);
  }
  await ctx.close();
}
await browser.close();
console.log(total === 0 ? "\nContrast clean." : `\n${total} distinct low-contrast combination(s).`);
