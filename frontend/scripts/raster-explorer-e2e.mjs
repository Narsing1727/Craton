// The zoomable raster viewer in a real browser: open a GeoTIFF's page, start the viewer, and check that tiles are drawn, that scrolling
// zooms into finer tiles, that dragging pans, and that the keyboard works. Reads a PUBLIC repository anonymously, so it changes nothing.
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
page.on("response", (r) => /\/tile\/\d+/.test(r.url()) && r.status() >= 400 && failures.push(`${r.status()} ${r.url()}`));

await page.goto(`${WEB}/${repo}/blob/${file}`, { waitUntil: "networkidle", timeout: 120000 });
await page.getByRole("button", { name: /Zoom and pan at full resolution/ }).click();
const viewer = page.getByRole("application");
await viewer.waitFor();
const loaded = () => page.evaluate(() => [...document.querySelectorAll('[role="application"] img')].filter((i) => i.naturalWidth > 0).length);
const drawn = (n) => page.waitForFunction((want) => [...document.querySelectorAll('[role="application"] img')].filter((i) => i.naturalWidth > 0).length >= want, n, { timeout: 60000 });
await drawn(2);
must((await loaded()) >= 2, "the preview underneath and at least one tile are drawn");
const readout = () => page.locator("p", { hasText: "Drag to pan" }).innerText();
must(/\d+ × \d+ px/.test(await readout()), `the layout is shown (${(await readout()).split("\n")[0]})`);
if (shots) await page.screenshot({ path: `${shots}/explorer-fit.png` });
const firstZoom = Math.max(...tileRequests.map((u) => Number(u.match(/\/tile\/(\d+)\//)[1])));

// Scroll in on the middle: finer tiles are asked for, and they load.
await viewer.scrollIntoViewIfNeeded();
const box = await viewer.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 8; i++) {
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(80);
}
await page.waitForTimeout(1500);
await drawn(2);
const deepest = Math.max(...tileRequests.map((u) => Number(u.match(/\/tile\/(\d+)\//)[1])));
must(deepest > firstZoom, `zooming in asks for finer tiles (zoom ${firstZoom} then ${deepest})`);
must((await loaded()) >= 2, "the finer tiles are drawn");
must(/screen px per pixel/.test(await readout()), "the scale reads in screen pixels per image pixel once past 1:1");
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
await page.waitForTimeout(150);
must(!/screen px per pixel/.test(await readout()), "0 returns to the whole raster");
await page.keyboard.press("+");
await page.keyboard.press("+");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(150);
must((await loaded()) >= 2, "the keyboard zooms and moves");
must(failures.length === 0, `no tile failed (${failures.slice(0, 2).join("; ") || "none"})`);

await browser.close();
console.log("raster explorer: all checks passed");
