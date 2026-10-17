import { test } from "node:test";
import assert from "node:assert/strict";
import { sitemapXml } from "../lib/sitemap.ts";

test("the sitemap lists public pages and public repositories only, escaped and with dates", () => {
  const xml = sitemapXml("https://craton.example/", [
    { owner: "hydrolab", name: "chalakudy-basin", visibility: "public", updatedAt: "2026-10-10T08:00:00Z" },
    { owner: "hydrolab", name: "internal-model", visibility: "private" },
    { owner: "a&b", name: "x", visibility: "public" },
  ]);
  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.ok(xml.includes("<loc>https://craton.example/</loc>"));
  assert.ok(xml.includes("<loc>https://craton.example/docs</loc>"));
  assert.ok(xml.includes("<loc>https://craton.example/hydrolab/chalakudy-basin</loc><lastmod>2026-10-10</lastmod>"));
  assert.ok(!xml.includes("internal-model"), "a private repository is never listed");
  assert.ok(xml.includes("/a%26b/x"), "the name is URL-encoded");
  assert.ok(!xml.includes("/dashboard") && !xml.includes("/settings"), "signed-in screens are not listed");
});
