// Visit every important route as the demo user and report anything wrong: a console error, a failed
// request, an HTTP error, a page that crashed or fell through to "not found". Cheap to run and it
// has found real bugs (a crashing API reference, a first-run 404, dead links) that type checks and
// unit tests cannot see.
//
//   npm run build && npm start     (and the API: `npm start` in ../backend)
//   npm run sweep
//   CRATON_WIDTH=390 npm run sweep     (the same routes in a phone-sized window; also reports pages wider than it)
//
// Uses a Chromium-based browser already on the machine (Edge or Chrome); set CRATON_BROWSER to its
// path if it isn't found. Signs in as the seeded demo account (`npm run seed` in ../backend).

import fs from "node:fs";
import { chromium } from "playwright-core";

const WEB = process.env.CRATON_WEB ?? "http://localhost:3100", API = process.env.CRATON_API ?? "http://localhost:4000/v1";
const R = "/hydrolab/chalakudy-basin";
// A real commit and pull request to visit.
const login = await (await fetch(`${API}/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "priyam", password: "craton-demo-2026" }) })).json();
const H = { authorization: `Bearer ${login.token}` };
const commits = await (await fetch(`${API}/repos/hydrolab/chalakudy-basin/commits?limit=2`, { headers: H })).json();
const pulls = await (await fetch(`${API}/repos/hydrolab/chalakudy-basin/pulls`, { headers: H })).json();
const issues = await (await fetch(`${API}/repos/hydrolab/chalakudy-basin/issues`, { headers: H })).json();

const routes = [
  "/", "/explore", "/trending", "/dashboard", "/pulls", "/issues", "/stars", "/search?q=dem",
  "/settings", "/settings/security", "/settings/notifications", "/settings/preferences", "/settings/billing", "/settings/tokens", "/settings/developer", "/new", "/orgs/new",
  "/hydrolab", R, `${R}/issues`, `${R}/pulls`, `${R}/checks`, `${R}/branches`, `${R}/commits`, `${R}/releases`, `${R}/storage`, `${R}/insights`,
  `${R}/settings`, `${R}/settings/webhooks`, `${R}/settings/sharing`, `${R}/settings/collaborators`, `${R}/milestones`, `${R}/reviews`, `${R}/compare`, `${R}/releases/new`, `${R}/issues/new`, `${R}/pulls/new`, `${R}/tags`,
  `${R}/blob/terrain/basin_dem.tif`, `${R}/blob/gauges.csv`, `${R}/blob/README.md`, `${R}/blob/vectors/catchment.shp`, `${R}/tree/main/terrain`,
  `${R}/commit/${commits[0].sha}`, `${R}/pull/${pulls[0].number}`, `${R}/issues/${issues[0].number}`,
  "/docs", "/api-reference", "/cli", "/pricing", "/about", "/help", "/security", "/changelog", "/contact", "/terms", "/privacy",
];

const browser = await chromium.launch({ executablePath: browserPath(), headless: true });
const page = await (await browser.newContext({ viewport: { width: Number(process.env.CRATON_WIDTH ?? 1280), height: 900 } })).newPage();
let problems = 0;
let current = "";
const titles = [];
const note = (kind, text) => { problems++; console.log(`  ${kind} on ${current}: ${text.slice(0, 190)}`); };
page.on("pageerror", (e) => note("PAGE ERROR", e.message));
page.on("console", (m) => { if (m.type() === "error") note("console.error", m.text()); });
page.on("response", (r) => {
  const u = new URL(r.url());
  if (u.origin !== WEB || r.status() < 400) return;
  if (u.pathname.includes("favicon")) return;
  note(`HTTP ${r.status()}`, `${u.pathname}${u.search}`);
});

await page.goto(`${WEB}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="login"]', "priyam");
await page.fill('input[name="password"]', "craton-demo-2026");
await page.click('button[type="submit"]');
await page.waitForURL(/dashboard/, { timeout: 20000 });

for (const route of routes) {
  current = route;
  const before = problems;
  const t = Date.now();
  let status = 0;
  try {
    const res = await page.goto(`${WEB}${route}`, { waitUntil: "networkidle", timeout: 30000 });
    status = res?.status() ?? 0;
  } catch (e) {
    note("NAVIGATION", String(e));
  }
  const h1 = await page.locator("h1").first().innerText().catch(() => "(no h1)");
  titles.push({
    route,
    title: await page.title(),
    finalPath: new URL(page.url()).pathname,
    ...(await page.evaluate(() => ({
      description: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
      robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
    }))),
  });
  const bad404 = /off the map|couldn’t be found|page not found/i.test(await page.locator("main").innerText().catch(() => ""));
  console.log(`${problems === before && !bad404 ? "ok  " : "FAIL"} ${String(status).padEnd(3)} ${String(Date.now() - t).padStart(5)}ms ${route.padEnd(52)} ${h1.slice(0, 40)}${bad404 ? "  <- shows the not-found page" : ""}`);
  if (bad404) problems++;
  // A page wider than the window means something on it doesn't fit (set CRATON_WIDTH=390 to check a phone).
  const wide = await page.evaluate(() => {
    const limit = window.innerWidth;
    if (document.documentElement.scrollWidth <= limit + 1) return null;
    let worst = null;
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      // Inside a scroller or clipped box it is fine for content to run past the window.
      let clipped = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") { clipped = true; break; }
      }
      if (!clipped && r.right > limit + 1 && r.width > 0 && (!worst || r.right > worst.right)) worst = { right: Math.round(r.right), tag: el.tagName.toLowerCase(), cls: String(el.className).slice(0, 70), text: (el.textContent || "").trim().slice(0, 30) };
    }
    return { scroll: document.documentElement.scrollWidth, limit, worst };
  }).catch(() => null);
  if (wide) note("OVERFLOW", `${wide.scroll}px wide in a ${wide.limit}px window; widest: <${wide.worst?.tag}> .${wide.worst?.cls} "${wide.worst?.text}" to ${wide.worst?.right}px`);
}
// Each page says what it is in the tab and in history: no two routes share a title, and none falls back to the
// site's default one (which is the home page's).
{
  const generic = "Craton — Version control for hydro & GIS engineers";
  const seen = new Map();
  const visited = new Set();
  for (const t of titles) {
    if (visited.has(t.finalPath)) continue; // a route that redirected to a page already checked
    visited.add(t.finalPath);
    if (t.title === generic) { problems++; console.log(`  TITLE on ${t.route}: falls back to the site's default title`); }
    if (seen.has(t.title)) { problems++; console.log(`  TITLE on ${t.route}: same as ${seen.get(t.title)} ("${t.title}")`); }
    else seen.set(t.title, t.route);
  }
}
// What search engines and link previews see. Public pages say what they are; screens that only make sense signed in
// are kept out of the index (robots.txt or a robots meta tag).
{
  const robotsTxt = await (await fetch(`${WEB}/robots.txt`)).text();
  const disallowed = robotsTxt.split(String.fromCharCode(10)).map((l) => l.trim()).filter((l) => /^disallow:/i.test(l)).map((l) => l.split(":")[1].trim()).filter(Boolean);
  const needsDescription = ["/", "/pricing", "/about", "/docs", "/help", "/terms", "/privacy", "/security", "/changelog", "/contact", "/cli", "/api-reference", "/explore", "/trending"];
  const signedInOnly = ["/dashboard", "/issues", "/pulls", "/stars", "/settings", "/settings/security", "/settings/notifications", "/settings/preferences", "/settings/billing", "/settings/tokens", "/settings/developer", "/new", "/orgs/new"];
  const byRoute = new Map(titles.map((t) => [t.route, t]));
  for (const r of needsDescription) {
    const t = byRoute.get(r);
    // "/" shows the dashboard to a signed-in visitor; its description is checked on the public pages instead.
    if (t && r !== "/" && t.description.trim().length < 20) { problems++; console.log(`  META on ${r}: no description for search results and link previews`); }
  }
  for (const r of signedInOnly) {
    const t = byRoute.get(r);
    const covered = disallowed.some((d) => r === d || r.startsWith(d + "/")) || /noindex/i.test(t?.robots ?? "");
    if (t && !covered) { problems++; console.log(`  META on ${r}: a signed-in screen that search engines may index (add it to robots.ts or set robots: noindex)`); }
  }
}
await browser.close();
console.log(problems === 0 ? `\nSweep clean: ${routes.length} routes, no errors.` : `\n${problems} problem(s) across ${routes.length} routes.`);

function browserPath() {
  const candidates = [
    process.env.CRATON_BROWSER,
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  const found = candidates.find((p) => p && fs.existsSync(p));
  if (!found) throw new Error("No Chrome or Edge found. Set CRATON_BROWSER to the path of one.");
  return found;
}

if (process.exitCode === undefined && typeof problems === "number" && problems > 0) process.exitCode = 1;
