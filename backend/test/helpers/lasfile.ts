// A synthetic uncompressed LAS 1.2 file (point format 3) for tests: a flight line of points with plausible fields.

export const W = 34; // point format 3: X Y Z, intensity, flags, class, angle, user data, source id, GPS time, red green blue

/** An uncompressed LAS 1.2 file: a 227-byte header, optionally a VLR, then `points` records along a flight line. */
export function las(points: number, o: { reclassify?: number; shiftZ?: number; vlr?: number; seed?: number } = {}): Buffer {
  const vlr = o.vlr ? Buffer.alloc(54 + o.vlr, 7) : Buffer.alloc(0);
  const start = 227 + vlr.length;
  const buf = Buffer.alloc(start + points * W);
  buf.write("LASF", 0, "latin1");
  buf[24] = 1;
  buf[25] = 2;
  buf.writeUInt16LE(227, 94);
  buf.writeUInt32LE(start, 96);
  buf.writeUInt32LE(vlr.length ? 1 : 0, 100);
  buf[104] = 3;
  buf.writeUInt16LE(W, 105);
  buf.writeUInt32LE(points, 107);
  vlr.copy(buf, 227);
  let s = (o.seed ?? 1) >>> 0;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < points; i++) {
    const at = start + i * W;
    buf.writeInt32LE(50_000_000 + Math.round(i * 37 + rnd() * 400), at);
    buf.writeInt32LE(120_000_000 + Math.round(Math.sin(i / 900) * 90_000 + rnd() * 300), at + 4);
    buf.writeInt32LE(30_000 + Math.round(Math.cos(i / 1500) * 2500 + rnd() * 60) + (o.shiftZ ?? 0), at + 8);
    buf.writeUInt16LE(Math.round(200 + rnd() * 300), at + 12);
    buf[at + 14] = 0x11;
    buf[at + 15] = [1, 2, 2, 2, 3, 5][Math.floor(rnd() * 6)];
    buf[at + 16] = Math.round(rnd() * 20) & 255;
    buf.writeUInt16LE(7, at + 18);
    buf.writeDoubleLE(300_000 + i * 0.0005, at + 20);
    buf.writeUInt16LE(Math.round(rnd() * 65535), at + 28);
    buf.writeUInt16LE(Math.round(rnd() * 65535), at + 30);
    buf.writeUInt16LE(Math.round(rnd() * 65535), at + 32);
  }
  // The header says where the points are: scale, offset and the bounds of each axis (max then min, as LAS stores them).
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points; i++) {
    for (let k = 0; k < 3; k++) {
      const v = buf.readInt32LE(start + i * W + 4 * k);
      if (v < lo[k]) lo[k] = v;
      if (v > hi[k]) hi[k] = v;
    }
  }
  for (let k = 0; k < 3; k++) {
    buf.writeDoubleLE(0.01, 131 + 8 * k);
    buf.writeDoubleLE(0, 155 + 8 * k);
    buf.writeDoubleLE(hi[k] * 0.01, 179 + 16 * k);
    buf.writeDoubleLE(lo[k] * 0.01, 187 + 16 * k);
  }
  // Reclassification touches only the classification byte of every n-th point, as a ground filter run would.
  if (o.reclassify) for (let i = 0; i < points; i += o.reclassify) buf[start + i * W + 15] = 2;
  return buf;
}

