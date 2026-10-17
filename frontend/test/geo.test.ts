import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxContains, describeBBox, describeCentre, isBBox, osmLink, parseLatLon } from "../lib/geo.ts";

test("places typed as latitude and longitude are understood in the usual ways", () => {
  assert.deepEqual(parseLatLon("10.3, 76.3"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("10.3 76.3"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("10.3N 76.3E"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("10.3° N, 76.3° E"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("33.9S 151.2E"), { lat: -33.9, lon: 151.2 });
  assert.deepEqual(parseLatLon("38.9N, 77.0W"), { lat: 38.9, lon: -77 });
  for (const bad of ["", "Kochi", "10.3", "91, 10", "10, 181", "10.3, 76.3, 5"]) assert.equal(parseLatLon(bad), null, JSON.stringify(bad));
});

test("a box reads naturally, and its centre fits on one line", () => {
  assert.equal(describeBBox([76.113, 10.214, 76.52, 10.553]), "10.21°N–10.55°N, 76.11°E–76.52°E");
  assert.equal(describeBBox([-77.1, -34, -76, -33]), "34.00°S–33.00°S, 77.10°W–76.00°W");
  assert.equal(describeCentre([76, 10, 77, 11]), "10.50°N, 76.50°E");
});

test("boxes are recognised and contain what they should", () => {
  assert.ok(isBBox([1, 2, 3, 4]) && !isBBox(null) && !isBBox([1, 2, 3]) && !isBBox([1, 2, 3, "4"]) && !isBBox([1, 2, NaN, 4]));
  assert.ok(bboxContains([76, 10, 77, 11], 76.5, 10.5) && !bboxContains([76, 10, 77, 11], 75, 10.5));
});

test("the map link is centred on the data at a zoom that fits it, and is a plain OpenStreetMap link", () => {
  const small = osmLink([76.205, 10.211, 76.215, 10.22]);
  assert.match(small, /^https:\/\/www\.openstreetmap\.org\/#map=\d+\/10\.21550\/76\.21000$/);
  const zoom = (url: string) => Number(url.match(/map=(\d+)\//)![1]);
  assert.ok(zoom(small) >= 13, "a kilometre is zoomed in");
  assert.ok(zoom(osmLink([-10, 35, 30, 60])) <= 5, "a continent is zoomed out");
  assert.ok(zoom(osmLink([0, 0, 0.0000001, 0.0000001])) <= 17, "a point never asks for a zoom that doesn't exist");
  assert.ok(zoom(osmLink([-180, -90, 180, 90])) >= 1);
});
