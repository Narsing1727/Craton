// Generators for small but valid GIS files, used by the seed script and the tests.
// They produce real formats (GeoTIFF with GeoKeys, shapefile sets, HEC-RAS text files) so the
// checks runner is exercised against actual bytes, not mocks.

export type GeoTiffOptions = {
  width: number;
  height: number;
  epsg: number; // 326xx projected, or 4326 geographic
  verticalEpsg?: number | null;
  nodata?: number | null;
  seed?: number;
  /** Re-survey: rows in [from, to) get different elevations (a realistic partial update). */
  resurvey?: { from: number; to: number; offset: number };
  origin?: [number, number];
  pixelSize?: number;
};

/** Deterministic PRNG (mulberry32). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Synthetic valley terrain: a sloping plane, a river channel and some roughness. */
function elevation(x: number, y: number, w: number, h: number, noise: () => number) {
  const slope = 840 * (1 - y / h) + 3;
  const channel = -60 * Math.exp(-(((x - w * (0.45 + 0.1 * Math.sin(y / 40))) / (w * 0.06)) ** 2));
  return slope + channel + noise() * 1.5;
}

export function geotiff(opts: GeoTiffOptions): Buffer {
  const { width: w, height: h } = opts;
  const noise = rng(opts.seed ?? 7);
  const pixels = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let z = elevation(x, y, w, h, noise);
      if (opts.resurvey && y >= opts.resurvey.from && y < opts.resurvey.to) z += opts.resurvey.offset;
      if (opts.nodata !== undefined && opts.nodata !== null && x < 3 && y < 3) z = opts.nodata; // a nodata corner
      pixels.writeFloatLE(z, (y * w + x) * 4);
    }
  }

  const geographic = opts.epsg === 4326 || (opts.epsg >= 4000 && opts.epsg < 5000);
  const keys: [number, number, number, number][] = [
    [1024, 0, 1, geographic ? 2 : 1], // GTModelTypeGeoKey
    [1025, 0, 1, 1], // GTRasterTypeGeoKey: PixelIsArea
    geographic ? [2048, 0, 1, opts.epsg] : [3072, 0, 1, opts.epsg],
  ];
  if (opts.verticalEpsg) keys.push([4096, 0, 1, opts.verticalEpsg]);
  keys.sort((a, b) => a[0] - b[0]);
  const geoKeys = [1, 1, 0, keys.length, ...keys.flat()];

  const pixelSize = opts.pixelSize ?? 2;
  const origin = opts.origin ?? [632_000, 1_130_000];
  const scale = [pixelSize, pixelSize, 0];
  const tie = [0, 0, 0, origin[0], origin[1], 0];
  const nodataText = opts.nodata !== undefined && opts.nodata !== null ? `${opts.nodata}\0` : null;

  type Field = { tag: number; type: number; count: number; data: Buffer };
  const short = (v: number[]) => {
    const b = Buffer.alloc(v.length * 2);
    v.forEach((n, i) => b.writeUInt16LE(n, i * 2));
    return b;
  };
  const long = (v: number[]) => {
    const b = Buffer.alloc(v.length * 4);
    v.forEach((n, i) => b.writeUInt32LE(n, i * 4));
    return b;
  };
  const double = (v: number[]) => {
    const b = Buffer.alloc(v.length * 8);
    v.forEach((n, i) => b.writeDoubleLE(n, i * 8));
    return b;
  };
  const fields: Field[] = [
    { tag: 256, type: 4, count: 1, data: long([w]) },
    { tag: 257, type: 4, count: 1, data: long([h]) },
    { tag: 258, type: 3, count: 1, data: short([32]) },
    { tag: 259, type: 3, count: 1, data: short([1]) },
    { tag: 262, type: 3, count: 1, data: short([1]) },
    { tag: 273, type: 4, count: 1, data: long([0]) }, // strip offset, patched below
    { tag: 277, type: 3, count: 1, data: short([1]) },
    { tag: 278, type: 4, count: 1, data: long([h]) },
    { tag: 279, type: 4, count: 1, data: long([pixels.length]) },
    { tag: 284, type: 3, count: 1, data: short([1]) },
    { tag: 339, type: 3, count: 1, data: short([3]) },
    { tag: 33550, type: 12, count: 3, data: double(scale) },
    { tag: 33922, type: 12, count: 6, data: double(tie) },
    { tag: 34735, type: 3, count: geoKeys.length, data: short(geoKeys) },
  ];
  if (nodataText) fields.push({ tag: 42113, type: 2, count: nodataText.length, data: Buffer.from(nodataText, "latin1") });

  const ifdSize = 2 + fields.length * 12 + 4;
  let extraOffset = 8 + ifdSize;
  const extras: Buffer[] = [];
  const offsets = new Map<number, number>();
  for (const f of fields) {
    if (f.data.length > 4) {
      offsets.set(f.tag, extraOffset);
      const padded = f.data.length % 2 ? Buffer.concat([f.data, Buffer.alloc(1)]) : f.data;
      extras.push(padded);
      extraOffset += padded.length;
    }
  }
  const dataOffset = extraOffset;
  fields.find((f) => f.tag === 273)!.data = long([dataOffset]);

  const header = Buffer.alloc(8);
  header.write("II", 0, "latin1");
  header.writeUInt16LE(42, 2);
  header.writeUInt32LE(8, 4);
  const ifd = Buffer.alloc(ifdSize);
  ifd.writeUInt16LE(fields.length, 0);
  fields.forEach((f, i) => {
    const o = 2 + i * 12;
    ifd.writeUInt16LE(f.tag, o);
    ifd.writeUInt16LE(f.type, o + 2);
    ifd.writeUInt32LE(f.count, o + 4);
    if (f.data.length <= 4) f.data.copy(ifd, o + 8);
    else ifd.writeUInt32LE(offsets.get(f.tag)!, o + 8);
  });
  ifd.writeUInt32LE(0, ifdSize - 4); // no next IFD
  return Buffer.concat([header, ifd, ...extras, pixels]);
}

export const WKT_UTM43N =
  'PROJCS["WGS_1984_UTM_Zone_43N",GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",500000.0],PARAMETER["False_Northing",0.0],PARAMETER["Central_Meridian",75.0],PARAMETER["Scale_Factor",0.9996],PARAMETER["Latitude_Of_Origin",0.0],UNIT["Meter",1.0]]';
export const WKT_WGS84 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

type Ring = [number, number][];

/** A polygon shapefile set: .shp, .shx, .dbf and .prj. */
export function shapefile(polygons: { name: string; ring: Ring }[], prj = WKT_UTM43N) {
  const all = polygons.flatMap((p) => p.ring);
  const bbox = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
  const header = (lengthBytes: number) => {
    const b = Buffer.alloc(100);
    b.writeInt32BE(9994, 0);
    b.writeInt32BE(lengthBytes / 2, 24);
    b.writeInt32LE(1000, 28);
    b.writeInt32LE(5, 32); // polygon
    bbox.forEach((v, i) => b.writeDoubleLE(v, 36 + i * 8));
    return b;
  };
  const records: Buffer[] = [];
  const index: Buffer[] = [];
  let offset = 100;
  polygons.forEach((p, i) => {
    const contentLen = 4 + 32 + 4 + 4 + 4 + p.ring.length * 16;
    const rec = Buffer.alloc(8 + contentLen);
    rec.writeInt32BE(i + 1, 0);
    rec.writeInt32BE(contentLen / 2, 4);
    rec.writeInt32LE(5, 8);
    const xs = p.ring.map((q) => q[0]), ys = p.ring.map((q) => q[1]);
    [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)].forEach((v, k) => rec.writeDoubleLE(v, 12 + k * 8));
    rec.writeInt32LE(1, 44); // parts
    rec.writeInt32LE(p.ring.length, 48);
    rec.writeInt32LE(0, 52);
    p.ring.forEach((q, k) => {
      rec.writeDoubleLE(q[0], 56 + k * 16);
      rec.writeDoubleLE(q[1], 64 + k * 16);
    });
    records.push(rec);
    const idx = Buffer.alloc(8);
    idx.writeInt32BE(offset / 2, 0);
    idx.writeInt32BE(contentLen / 2, 4);
    index.push(idx);
    offset += rec.length;
  });
  const shp = Buffer.concat([header(offset), ...records]);
  const shx = Buffer.concat([header(100 + index.length * 8), ...index]);

  // dBase III table with one text field NAME (C, 32).
  const fieldLen = 32;
  const recLen = 1 + fieldLen;
  const dbfHeader = Buffer.alloc(32 + 32 + 1);
  dbfHeader[0] = 3;
  dbfHeader[1] = 126; dbfHeader[2] = 9; dbfHeader[3] = 30; // 2026-09-30
  dbfHeader.writeUInt32LE(polygons.length, 4);
  dbfHeader.writeUInt16LE(dbfHeader.length, 8);
  dbfHeader.writeUInt16LE(recLen, 10);
  dbfHeader.write("NAME", 32, "latin1");
  dbfHeader[32 + 11] = "C".charCodeAt(0);
  dbfHeader[32 + 16] = fieldLen;
  dbfHeader[64] = 0x0d;
  const rows = polygons.map((p) => Buffer.from(" " + p.name.slice(0, fieldLen).padEnd(fieldLen, " "), "latin1"));
  const dbf = Buffer.concat([dbfHeader, ...rows, Buffer.from([0x1a])]);
  return { shp, shx, dbf, prj: Buffer.from(prj) };
}

/** Regular polygons around a center: simple, valid sub-catchment shapes. */
export function catchments(n: number, cx = 640_000, cy = 1_140_000, seed = 3): { name: string; ring: Ring }[] {
  const r = rng(seed);
  return Array.from({ length: n }, (_, i) => {
    const ox = cx + (i % 4) * 4000, oy = cy + Math.floor(i / 4) * 4000;
    const pts: Ring = [];
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const rad = 1500 + r() * 400;
      pts.push([ox + Math.cos(a) * rad, oy + Math.sin(a) * rad]);
    }
    pts.push(pts[0]);
    return { name: `Sub-catchment ${i + 1}`, ring: pts };
  });
}

/** A levee centerline set as thin polygons (crest height in the name). */
export function levees(crestM: number, count = 6) {
  return Array.from({ length: count }, (_, i) => {
    const x = 641_000 + i * 900, y = 1_137_000;
    return { name: `Levee ${i + 1} crest ${crestM.toFixed(1)} m`, ring: [[x, y], [x + 800, y + 40], [x + 800, y + 60], [x, y + 20], [x, y]] as Ring };
  });
}

export function hecRas(manningMain = 0.032, peak = 3400) {
  return {
    "model/chalakudy.prj": Buffer.from("Proj Title=Chalakudy Basin\nCurrent Plan=p01\nDefault Exp/Contr=0.3,0.1\nEnglish Units\n"),
    "model/chalakudy.p01": Buffer.from(`Plan Title=100-yr event\nProgram Version=6.50\nShort Identifier=100yr\nGeom File=g01\nFlow File=u01\nComputation Interval=10SEC\n`),
    "model/chalakudy.g01": Buffer.from(
      `Geom Title=2D mesh, 2024 terrain\nProgram Version=6.50\nStorage Area=Floodplain\nManning's n Main Channel=${manningMain.toFixed(3)}\nManning's n Floodplain=0.060\nManning's n Dense Riparian=0.120\n` +
        Array.from({ length: 400 }, (_, i) => `Cell ${i},${(632000 + i * 12.5).toFixed(2)},${(1130000 + (i % 37) * 9.1).toFixed(2)}`).join("\n") + "\n",
    ),
    "model/chalakudy.u01": Buffer.from(
      `Flow Title=100-yr hydrograph\nBoundary Location=Peringalkuthu inflow\nFlow Hydrograph=${24}\n` +
        Array.from({ length: 24 }, (_, i) => (peak * Math.exp(-(((i - 10) / 4) ** 2))).toFixed(1)).join(",") + "\nDownstream Boundary=Normal Depth,0.0004\n",
    ),
  };
}

export function gaugesCsv(days: number, seed = 11) {
  const r = rng(seed);
  const lines = ["station,timestamp,stage_m,discharge_m3s"];
  const stations = ["G1-Peringalkuthu", "G2-Athirappilly", "G3-Chalakudy-bridge", "G4-Mala", "G5-Estuary"];
  for (let d = 0; d < days; d++) {
    for (const s of stations) {
      const stage = 2 + r() * 3;
      lines.push(`${s},2024-06-${String((d % 30) + 1).padStart(2, "0")}T00:00Z,${stage.toFixed(2)},${(stage ** 2.3 * 18).toFixed(1)}`);
    }
  }
  return Buffer.from(lines.join("\n") + "\n");
}

/** Pseudo-random bytes (compress like real LAZ/NetCDF payloads: barely at all). */
export function noiseBytes(n: number, seed: number, header = "") {
  const r = rng(seed);
  const b = Buffer.alloc(n);
  b.write(header, 0, "latin1");
  for (let i = header.length; i < n; i++) b[i] = Math.floor(r() * 256);
  return b;
}
