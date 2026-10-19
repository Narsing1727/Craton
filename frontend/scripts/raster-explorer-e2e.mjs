// The raster viewer in a real browser: open a GeoTIFF's page and check that the picture fills its frame, that the cursor reads out the value
// under it, that scrolling zooms into finer tiles, that dragging pans, and that the keyboard works. Reads a PUBLIC repository anonymously,
// so it changes nothing.
//   node scripts/raster-explorer-e2e.mjs [owner/repo] [path] [shots-dir]

import { chromium } from "playwright-core";

const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const [repo = "hydrolab/chalakudy-basin", file = "terrain/basin_dem.tif", shots] = process.argv.slice(2);
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};

const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const tileRequests = [];
page.on("request", (r) => /\/tile\/\d+\/\d+\/\d+/.test(r.url()) && tileRequests.push(r.url()));
const failures = [];
page.on("response", (r) => /\/(tile|pixel)[/?]/.test(r.url()) && r.status() >= 400 && failures.push(`${r.status()} ${r.url()}`));

await page.goto(`${WEB}/${repo}/blob/${file}`, { waitUntil: "networkidle", timeout: 120000 });
const viewer = page.getByRole("application");
await viewer.waitFor();
const loaded = () => page.evaluate(() => [...document.querySelectorAll('[role="application"] img')].filter((i) => i.naturalWidth > 0).length);
const drawn = (n) => page.waitForFunction((want) => [...document.querySelectorAll('[role="application"] img')].filter((i) => i.naturalWidth > 0).length >= want, n, { timeout: 60000 });
await drawn(1);
must((await loaded()) >= 1, "the drawn picture is in the frame");

const inspector = page.getByRole("complementary", { name: "Raster inspector" });
const field = (label) => inspector.locator("dt", { hasText: label }).first().locator("xpath=following-sibling::dd[1]");
await page.waitForFunction(() => /\d/.test(document.querySelector('aside[aria-label="Raster inspector"]')?.textContent?.match(/Zoom\s*([^\s].*?)Cell|Zoom\s*(\S+)/)?.[0] ?? ""), null, { timeout: 30000 });
const fitZoom = await field("Zoom").innerText();
must(/\d/.test(fitZoom), `the view's scale is shown (${fitZoom})`);
if (shots) await page.screenshot({ path: `${shots}/explorer-fit.png` });

// The frame is the picture's own shape: no empty bands beside the picture.
await viewer.scrollIntoViewIfNeeded();
const box = await viewer.boundingBox();
const picture = await page.locator('[role="application"] img').first().boundingBox();
must(Math.abs(box.width - picture.width) <= 3 && Math.abs(box.height - picture.height) <= 3, `the picture fills its frame (${Math.round(box.width)} x ${Math.round(box.height)})`);

// Hovering reads out the value and the position under the cursor.
await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
await page.waitForFunction(() => /\d/.test(document.querySelector('aside[aria-label="Raster inspector"] section[aria-live] dd')?.textContent ?? ""), null, { timeout: 15000 });
const value = await field("Value").innerText();
must(/^[-\u2212]?[\d,.]+ (m|ft)$/.test(value), `the value under the cursor is read out (${value})`);
must(/\d/.test(await field("Pixel").innerText()), "and its pixel");

// Scroll in on the middle: finer tiles are asked for, and they load.
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(80);
}
await page.waitForTimeout(1500);
await drawn(2);
const deepest = Math.max(0, ...tileRequests.map((u) => Number(u.match(/\/tile\/(\d+)\//)[1])));
must(tileRequests.length > 0, `zooming in asks for tiles (deepest zoom ${deepest})`);
must((await loaded()) >= 2, "the finer tiles are drawn");
const zoomed = await field("Zoom").innerText();
must(/\u00d7$/.test(zoomed) && zoomed !== fitZoom, `the zoom reads past 1:1 (${zoomed})`);
if (shots) await page.screenshot({ path: `${shots}/explorer-zoomed.png` });

// Drag: the tiles move with the pointer, and different tiles may be asked for.
const before = tileRequests.length;
const firstTile = page.locator('[role="application"] img').nth(1);
const left0 = await firstTile.evaluate((i) => i.style.left);
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width / 2 - 200, box.y + box.height / 2 - 120, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(1500);
const left1 = await page.locator('[role="application"] img').nth(1).evaluate((i) => i.style.left);
must(left0 !== left1 || tileRequests.length > before, "dragging pans the view");

// Keyboard: 0 fits the whole raster again, arrows move, plus and minus zoom.
await viewer.focus();
await page.keyboard.press("0");
await page.waitForTimeout(250);
must((await field("Zoom").innerText()) === fitZoom, "0 returns to the whole raster");
await page.keyboard.press("+");
await page.keyboard.press("+");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(250);
must((await field("Zoom").innerText()) !== fitZoom, "the keyboard zooms and moves");
must(failures.length === 0, `no tile or pixel request failed (${failures.slice(0, 2).join("; ") || "none"})`);

await browser.close();
console.log("raster viewer: all checks passed");
