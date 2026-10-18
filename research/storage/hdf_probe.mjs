import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import pako from "pako";
const cases = JSON.parse(readFileSync("hdf_streams.json", "utf8"));
for (const c of cases) {
  let same = 0, total = 0;
  const params = new Set();
  for (const hex of c.streams) {
    const stream = Buffer.from(hex, "hex"); total++;
    let raw; try { raw = zlib.inflateSync(stream); } catch { continue; }
    let hit = null;
    for (const level of [c.level, 1, 6, 9]) {
      for (const memLevel of [8, 9]) {
        if (!hit && Buffer.from(pako.deflate(raw, { level, memLevel, windowBits: 15 })).equals(stream)) hit = `l${level}m${memLevel}`;
      }
    }
    if (hit) { same++; params.add(hit); }
  }
  console.log(`${c.file}: level ${c.level} shuffle ${c.shuffle}: pako reproduces ${same}/${total} chunk streams ${[...params].join(",")}`);
}
