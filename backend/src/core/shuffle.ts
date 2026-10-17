// The byte shuffle: gather the 1st byte of every element, then the 2nd, and so on. In smooth numbers, or in records of one kind of field,
// the bytes that barely change then lie together and compress far better. It is its own bookkeeping only: the same bytes come back.

/** Gather byte k of every `width`-byte element together. A trailing partial element is copied unchanged. */
export function shuffle(data: Uint8Array, width: number): Buffer {
  const count = Math.floor(data.length / width);
  const out = Buffer.allocUnsafe(data.length);
  for (let k = 0; k < width; k++) {
    let o = k * count;
    for (let i = k; i < count * width; i += width) out[o++] = data[i];
  }
  out.set(data.subarray(count * width), count * width);
  return out;
}

export function unshuffle(data: Uint8Array, width: number): Buffer {
  const count = Math.floor(data.length / width);
  const out = Buffer.allocUnsafe(data.length);
  for (let k = 0; k < width; k++) {
    let s = k * count;
    for (let i = k; i < count * width; i += width) out[i] = data[s++];
  }
  out.set(data.subarray(count * width), count * width);
  return out;
}

