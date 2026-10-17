# A prototype of "store the pixels, re-make the DEFLATE on read" for a whole GeoTIFF, with an edited version stored against
# its parent tile by tile. Checks that the rebuilt file is the original byte for byte (SHA-256), and what each part costs.
import struct, zlib, hashlib, sys, numpy as np, zstandard as zs
Z = zs.ZstdCompressor(level=9); D = zs.ZstdDecompressor()

def parse(b):
    ifd = struct.unpack_from("<I", b, 4)[0]; n = struct.unpack_from("<H", b, ifd)[0]; tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack_from("<HHII", b, ifd + 2 + 12 * i)
        size = {3: 2, 4: 4}.get(typ, 1) * cnt; off = ifd + 2 + 12 * i + 8 if size <= 4 else val
        fmt = {3: "H", 4: "I"}.get(typ)
        tags[tag] = list(struct.unpack_from("<%d%s" % (cnt, fmt), b, off)) if fmt else val
    return list(zip(tags[324], tags[325]))

def shuf(raw):   return np.frombuffer(raw, np.uint8).reshape(-1, 4).T.copy().tobytes()
def unshuf(sh):  return np.frombuffer(sh, np.uint8).reshape(4, -1).T.copy().tobytes()

def encode(b, parent_tiles=None):
    """-> (skeleton, [tile records]); a tile is ('pixels', zstd(shuffle(raw))) or ('xor', zstd(shuffle(raw ^ parent)))."""
    segs = parse(b); skeleton = bytearray(b); recs = []; tiles_raw = []
    for i, (o, c) in enumerate(segs):
        stream = b[o:o + c]; raw = zlib.decompress(stream)
        params = next(((l, m) for l in (6, 9, 1, 2, 3, 4, 5, 7, 8) for m in (8, 9) if (lambda co: co.compress(raw) + co.flush())(zlib.compressobj(l, zlib.DEFLATED, 15, m)) == stream), None)
        assert params, "not reproducible: this file would be stored as it is"
        skeleton[o:o + c] = b"\0" * c                     # the tile's bytes are rebuilt, so the skeleton keeps zeros there
        if parent_tiles is not None and parent_tiles[i] is not None and len(parent_tiles[i]) == len(raw):
            a, p = np.frombuffer(raw, "<u4"), np.frombuffer(parent_tiles[i], "<u4")
            options = [("xor", params, Z.compress(shuf((a ^ p).tobytes()))), ("sub", params, Z.compress(shuf((a - p).tobytes()))), ("pixels", params, Z.compress(shuf(raw)))]
            recs.append(min(options, key=lambda r: len(r[2])))
        else:
            recs.append(("pixels", params, Z.compress(shuf(raw))))
        tiles_raw.append(raw)
    return Z.compress(bytes(skeleton)), segs, recs, tiles_raw

def decode(skel, segs, recs, parent_tiles=None):
    out = bytearray(D.decompress(skel)); tiles_raw = []
    for i, ((o, c), (kind, (l, m), data)) in enumerate(zip(segs, recs)):
        raw = unshuf(D.decompress(data))
        if kind == "xor": raw = (np.frombuffer(raw, "<u4") ^ np.frombuffer(parent_tiles[i], "<u4")).tobytes()
        if kind == "sub": raw = (np.frombuffer(raw, "<u4") + np.frombuffer(parent_tiles[i], "<u4")).tobytes()
        co = zlib.compressobj(l, zlib.DEFLATED, 15, m); stream = co.compress(raw) + co.flush()
        assert len(stream) == c; out[o:o + c] = stream; tiles_raw.append(raw)
    return bytes(out), tiles_raw

kb = lambda n: f"{n / 1024:,.0f} KB"
base = open(sys.argv[1], "rb").read()
skel, segs, recs, base_tiles = encode(base)
rebuilt, _ = decode(skel, segs, recs)
size = len(skel) + sum(len(r[2]) for r in recs)
print(f"{sys.argv[1]}: {kb(len(base))} as uploaded -> {kb(size)} stored (skeleton {kb(len(skel))}); rebuilt identical: {hashlib.sha256(rebuilt).hexdigest() == hashlib.sha256(base).hexdigest()}")
for f in sys.argv[2:]:
    b = open(f, "rb").read()
    skel2, segs2, recs2, _ = encode(b, base_tiles)
    rebuilt2, _ = decode(skel2, segs2, recs2, base_tiles)
    size2 = len(skel2) + sum(len(r[2]) for r in recs2)
    print(f"{f}: {kb(len(b))} as uploaded -> {kb(size2)} stored against its parent ({dict((k, sum(1 for r in recs2 if r[0] == k)) for k in ('xor', 'sub', 'pixels'))}); rebuilt identical: {hashlib.sha256(rebuilt2).digest() == hashlib.sha256(b).digest()}")
