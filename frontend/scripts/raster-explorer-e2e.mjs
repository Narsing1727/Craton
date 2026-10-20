// The raster map in a real browser: a georeferenced GeoTIFF opens on a MapLibre map over a basemap, its Web Mercator tiles load, the basemap and
// colour map can be changed, and pointing at the map reads out the elevation there. Reads a PUBLIC repository anonymously, so it changes nothing.
//   node scripts/raster-explorer-e2e.mjs [owner/repo] [path] [shots-dir]

import { chromium } from "playwright-core";

const WEB = process.env.CRATON_WEB_URL ?? "http://localhost:3100";
const [repo = "narsing/the-first-repo", file = "terrain/chalakudy_dem_30m.tif", shots] = process.argv.slice(2);
const must = (ok, what) => {
  if (!ok) throw new Error(`FAILED: ${what}`);
  console.log(`ok  ${what}`);
};

// WebGL in a headless browser: SwiftShader draws it in software.
const browser = await chromium.launch({ executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 1000 } })).newPage();
const tiles = [];
const failures = [];
page.on("response", (r) => {
  if (/\/xyz\/\d+\/\d+\/\d+/.test(r.url())) tiles.push(r);
  if (/\/(xyz|pixel|tileinfo)[/?]/.test(r.url()) && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`);
});
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(`${WEB}/${repo}/blob/${file}`, { waitUntil: "networkidle", timeout: 120000 });
const map = page.locator(".maplibregl-map");
await map.waitFor({ timeout: 30000 });
must(await map.isVisible(), "the raster opens on a map");
await page.waitForFunction(() => document.querySelectorAll(".maplibregl-canvas").length > 0, null, { timeout: 30000 });
await page.waitForTimeout(3000);
must(tiles.length > 0 && tiles.every((t) => t.status() === 200 || t.status() === 304), `its map tiles load (${tiles.length})`);
must((await page.locator(".maplibregl-ctrl-attrib").innerText()).length > 0 || (await page.locator(".maplibregl-ctrl-attrib-button").count()) > 0, "the basemap's attribution is shown");
if (shots) await page.screenshot({ path: `${shots}/map-satellite.png` });

// Pointing at the map reads out the elevation and the position.
const box = await map.boundingBox();
await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.5);
await page.waitForFunction(() => /\d+(\.\d+)? (m|ft) · /.test(document.querySelector('[aria-live="polite"]')?.textContent ?? ""), null, { timeout: 45000 });
const readout = await page.locator('[aria-live="polite"]').first().innerText();
must(/° N .*° E/.test(readout), `the cursor reads out a value and a place (${readout})`);

// Another basemap and another colour map: new tiles are asked for.
const before = tiles.length;
await page.getByRole("button", { name: "Streets" }).click();
await page.getByLabel("Colours").selectOption("viridis");
await page.waitForTimeout(2500);
must(tiles.length > before && tiles.slice(before).some((t) => t.url().includes("ramp=viridis")), "changing the colour map redraws the layer");
if (shots) await page.screenshot({ path: `${shots}/map-streets.png` });

// Zooming in asks for deeper tiles.
const zoomOf = (u) => Number(u.match(/\/xyz\/(\d+)\//)[1]);
const deepest = Math.max(...tiles.map((t) => zoomOf(t.url())));
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
for (let i = 0; i < 6; i++) {
  await page.mouse.wheel(0, -500);
  await page.waitForTimeout(200);
}
await page.waitForTimeout(2500);
// Up to the file's own finest level (one tile pixel about one cell); past it the map enlarges those tiles instead.
const finest = (await (await fetch(`${WEB}/${repo}/tileinfo?${new URLSearchParams({ ref: "main", path: file })}`)).json()).map.maxZoom;
const after = Math.max(...tiles.map((t) => zoomOf(t.url())));
must(after > deepest || after === finest, `zooming in asks for finer tiles, up to the file's finest level (${deepest} then ${after}, finest ${finest})`);
must(failures.length === 0, `no map request failed (${failures.slice(0, 2).join("; ") || "none"})`);
must(errors.length === 0, `no page errors (${errors.slice(0, 1).join("") || "none"})`);

await browser.close();
console.log("raster map: all checks passed");
