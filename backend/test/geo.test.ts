import { test } from "node:test";
import assert from "node:assert/strict";
import { bboxContains, bboxIntersects, bboxToLonLat, describeBBox, parseLatLon, toLonLat, unionBBox, utmToLonLat, utmZoneOf, webMercatorToLonLat } from "../src/core/geo.ts";

// An independent forward projection (Krüger series, built from the published formulas), used only here
// to check the inverse the product uses: project a point forward, bring it back, expect the same point.
function forwardUtm(zone: number, latDeg: number, lonDeg: number): [number, number] {
  const a = 6378137, f = 1 / 298.257222101, k0 = 0.9996, n = f / (2 - f), e = Math.sqrt(f * (2 - f));
  const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
  const A = (a / (1 + n)) * (1 + n2 / 4 + n4 / 64);
  const al = [n / 2 - (2 * n2) / 3 + (5 * n3) / 16 + (41 * n4) / 180, (13 * n2) / 48 - (3 * n3) / 5 + (557 * n4) / 1440, (61 * n3) / 240 - (103 * n4) / 140, (49561 * n4) / 161280];
  const phi = (latDeg * Math.PI) / 180, lam = ((lonDeg - ((zone - 1) * 6 - 180 + 3)) * Math.PI) / 180;
  const t = Math.tan(phi), sig = Math.sinh(e * Math.atanh((e * t) / Math.sqrt(1 + t * t)));
  const tp = t * Math.sqrt(1 + sig * sig) - sig * Math.sqrt(1 + t * t);
  const xp = Math.atan2(tp, Math.cos(lam)), ep = Math.asinh(Math.sin(lam) / Math.sqrt(tp * tp + Math.cos(lam) ** 2));
  let xi = xp, eta = ep;
  for (let j = 1; j <= 4; j++) {
    xi += al[j - 1] * Math.sin(2 * j * xp) * Math.cosh(2 * j * ep);
    eta += al[j - 1] * Math.cos(2 * j * xp) * Math.sinh(2 * j * ep);
  }
  return [500000 + k0 * A * eta, k0 * A * xi];
}

const near = (actual: number, expected: number, tol: number, what: string) => assert.ok(Math.abs(actual - expected) <= tol, `${what}: ${actual} is not within ${tol} of ${expected}`);

test("UTM converts landmark coordinates to their published longitude and latitude", () => {
  // Eiffel Tower, zone 31N: 448252 E, 5411933 N  ->  48.8584 N, 2.2945 E
  const [lon, lat] = utmToLonLat(31, false, 448252, 5411933);
  near(lat, 48.8584, 2e-4, "Eiffel latitude");
  near(lon, 2.2945, 2e-4, "Eiffel longitude");
  // Washington Monument (38.88944 N, 77.03528 W), zone 18N. Its UTM position comes from an independent
  // forward projection (see below); the first guess from memory was 86 m out.
  const [wl, wa] = utmToLonLat(18, false, 323480, 4306477);
  near(wa, 38.88944, 5e-5, "Washington latitude");
  near(wl, -77.03528, 5e-5, "Washington longitude");
});

test("on the central meridian and the equator the answer is exact, and the southern hemisphere counts from 10,000,000", () => {
  const [lon, lat] = utmToLonLat(43, false, 500000, 0);
  near(lon, 75, 1e-9, "zone 43's central meridian");
  near(lat, 0, 1e-9, "equator");
  near(utmToLonLat(56, true, 500000, 10_000_000)[1], 0, 1e-9, "south zone equator");
  const [sl, sa] = utmToLonLat(56, true, 500000, 9_000_000); // 1,000 km south
  near(sa, -9.05, 0.02, "1,000 km south of the equator is about 9.05 degrees");
  near(sl, 153, 1e-6, "zone 56's central meridian is 153 E");
  assert.ok(utmToLonLat(43, false, 600000, 1_100_000)[0] > 75, "east of the meridian is east");
});

test("Web Mercator converts London, the antimeridian and the origin", () => {
  const [lon, lat] = webMercatorToLonLat(-14226.63, 6711542.47);
  near(lon, -0.1278, 1e-4, "London longitude");
  near(lat, 51.5074, 1e-4, "London latitude");
  assert.deepEqual(webMercatorToLonLat(0, 0), [0, 0]);
  near(webMercatorToLonLat(20037508.342789244, 0)[0], 180, 1e-9, "the edge of the map");
});

test("the EPSG codes people actually use map to the right zone, and others are refused rather than guessed", () => {
  assert.deepEqual(utmZoneOf(32643), { zone: 43, south: false });
  assert.deepEqual(utmZoneOf(32756), { zone: 56, south: true });
  assert.deepEqual(utmZoneOf(26914), { zone: 14, south: false }, "NAD83 / UTM 14N");
  assert.deepEqual(utmZoneOf(25832), { zone: 32, south: false }, "ETRS89 / UTM 32N");
  assert.deepEqual(utmZoneOf(28355), { zone: 55, south: true }, "GDA94 / MGA 55");
  assert.deepEqual(utmZoneOf(7855), { zone: 55, south: true }, "GDA2020 / MGA 55");
  assert.equal(utmZoneOf(4326), null);
  assert.equal(utmZoneOf(27700), null);
  assert.deepEqual(toLonLat(4326, 76.3, 10.3), [76.3, 10.3]);
  assert.equal(toLonLat(27700, 530000, 180000), null, "British National Grid isn't supported, so no position is invented");
  assert.equal(toLonLat(32643, 5_000_000_000, 5), null, "nonsense coordinates mean the wrong CRS was declared");
  assert.equal(toLonLat(32643, NaN, 5), null);
});

test("a box in UTM becomes a longitude/latitude box that surrounds it", () => {
  // The sample basin: 632,000-633,024 E, 1,128,976-1,130,000 N in zone 43N, in Kerala.
  const box = bboxToLonLat(32643, 632000, 1128976, 633024, 1130000)!;
  const [w, s, e, n] = box;
  assert.ok(s > 10.1 && n < 10.3 && w > 76.1 && e < 76.3, JSON.stringify(box));
  assert.ok(w < e && s < n);
  assert.ok(e - w < 0.02 && n - s < 0.02, "about a kilometre across");
  assert.equal(bboxToLonLat(27700, 0, 0, 1, 1), null);
  assert.deepEqual(bboxToLonLat(4326, 76.1, 10.2, 76.4, 10.5), [76.1, 10.2, 76.4, 10.5]);
});

test("box helpers: union, containment and intersection", () => {
  const a = [76, 10, 77, 11] as const, b = [76.5, 10.5, 78, 12] as const;
  assert.deepEqual(unionBBox(null, [...a]), [76, 10, 77, 11]);
  assert.deepEqual(unionBBox([...a], [...b]), [76, 10, 78, 12]);
  assert.ok(bboxContains([...a], 76.3, 10.3) && !bboxContains([...a], 75.9, 10.3) && bboxContains([...a], 77, 11), "edges count");
  assert.ok(bboxIntersects([...a], [...b]) && !bboxIntersects([...a], [78.1, 10, 79, 11]));
  assert.ok(bboxIntersects([76, 10, 77, 11], [77, 11, 78, 12]), "touching corners intersect");
});

test("places typed as latitude and longitude are understood in the usual ways", () => {
  assert.deepEqual(parseLatLon("10.3, 76.3"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("10.3 76.3"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("10.3N 76.3E"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("10.3° N, 76.3° E"), { lat: 10.3, lon: 76.3 });
  assert.deepEqual(parseLatLon("33.9S 151.2E"), { lat: -33.9, lon: 151.2 });
  assert.deepEqual(parseLatLon("38.9N, 77.0W"), { lat: 38.9, lon: -77 });
  assert.deepEqual(parseLatLon("-33.9, 151.2"), { lat: -33.9, lon: 151.2 });
  for (const bad of ["", "Kochi", "10.3", "91, 10", "10, 181", "10.3, 76.3, 5"]) assert.equal(parseLatLon(bad), null, JSON.stringify(bad));
});

test("a box reads naturally, with hemispheres", () => {
  assert.equal(describeBBox([76.113, 10.214, 76.52, 10.553]), "10.21°N–10.55°N, 76.11°E–76.52°E");
  assert.equal(describeBBox([-77.1, -34, -76, -33]), "34.00°S–33.00°S, 77.10°W–76.00°W");
});

test("the inverse undoes an independent forward projection everywhere that matters, to a millimetre", () => {
  let worst = 0, checked = 0;
  for (const zone of [1, 18, 31, 43, 56, 60]) {
    const cm = (zone - 1) * 6 - 180 + 3;
    for (const lat of [-79, -45, -10.3, -0.5, 0, 0.5, 10.3, 33.9, 48.86, 60, 79]) {
      for (const off of [-3, -1.5, 0, 0.7, 3]) {
        const lon = cm + off;
        const south = lat < 0;
        const [e, n] = forwardUtm(zone, lat, lon);
        const [lo, la] = utmToLonLat(zone, south, e, south ? n + 10_000_000 : n);
        worst = Math.max(worst, Math.abs(lo - lon), Math.abs(la - lat));
        checked++;
      }
    }
  }
  assert.ok(checked > 300);
  assert.ok(worst < 1e-8, `worst error ${worst} degrees (a millimetre is about 1e-8)`);
});
