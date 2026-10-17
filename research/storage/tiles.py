# Inside the GeoTIFFs: can each DEFLATE tile be re-made bit for bit from its decoded pixels with zlib, what would the decoded
# tiles cost with Craton's own codecs, and what would an edited version cost stored against its parent tile?
import struct, zlib, sys, time, numpy as np, zstandard as zs

def tiles(path):
    b = open(path, "rb").read()
    assert b[:2] == b"II" and struct.unpack_from("<H", b, 2)[0] == 42, "classic little-endian TIFF only"
    ifd = struct.unpack_from("<I", b, 4)[0]
    n = struct.unpack_from("<H", b, ifd)[0]
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack_from("<HHII", b, ifd + 2 + 12 * i)
        size = {3: 2, 4: 4, 16: 8}.get(typ, 1) * cnt
        off = ifd + 2 + 12 * i + 8 if size <= 4 else val
        fmt = {3: "H", 4: "I"}.get(typ)
        tags[tag] = list(struct.unpack_from("<%d%s" % (cnt, fmt), b, off)) if fmt else val
    offs, counts = tags[324], tags[325]
    return b, [(o, c) for o, c in zip(offs, counts)]

Z3, Z9 = zs.ZstdCompressor(level=3), zs.ZstdCompressor(level=9)
def craton_numeric(raw, level=Z3):
    """Craton's delta4+shuffle4+zstd on little-endian 4-byte elements."""
    u = np.frombuffer(raw, dtype="<u4")
    d = np.empty_like(u); d[0] = u[0]; d[1:] = u[1:] - u[:-1]          # wrapping difference
    sh = d.view(np.uint8).reshape(-1, 4).T.copy().tobytes()            # byte shuffle
    return len(level.compress(sh))
def craton_shuffle(raw, level=Z3):
    u = np.frombuffer(raw, dtype=np.uint8).reshape(-1, 4).T.copy().tobytes()
    return len(level.compress(u))

def try_zlib(stream, raw):
    """The zlib settings that reproduce this exact stream, or None."""
    for level in (6, 9, 1, 2, 3, 4, 5, 7, 8):
        for mem in (8, 9):
            for strat in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED):
                c = zlib.compressobj(level, zlib.DEFLATED, 15, mem, strat)
                if c.compress(raw) + c.flush() == stream:
                    return (level, mem, strat)
    return None

files = sys.argv[1:]
base_b, base_t = tiles(files[0])
base_raw = [zlib.decompress(base_b[o:o + c]) for o, c in base_t]
deflate_total = sum(c for _, c in base_t)
t0 = time.time()
matched = sum(1 for (o, c), r in zip(base_t, base_raw) if try_zlib(base_b[o:o + c], r))
t_match = time.time() - t0
print(f"{files[0]}: {len(base_t)} tiles, deflate {deflate_total/1048576:.2f} MB; zlib reproduces {matched}/{len(base_t)} tiles bit for bit ({t_match:.1f} s to search)")
raw_total = sum(len(r) for r in base_raw)
print(f"  decoded {raw_total/1048576:.2f} MB -> shuffle4+zstd3 {sum(craton_shuffle(r) for r in base_raw)/1048576:.2f} MB, delta4+shuffle4+zstd3 {sum(craton_numeric(r) for r in base_raw)/1048576:.2f} MB, zstd9 {sum(craton_numeric(r, Z9) for r in base_raw)/1048576:.2f} MB")
for f in files[1:]:
    b, t = tiles(f)
    raws = [zlib.decompress(b[o:o + c]) for o, c in t]
    same = sum(1 for r, p in zip(raws, base_raw) if r == p)
    alone = against = 0
    for r, p in zip(raws, base_raw):
        if r == p: continue
        alone += craton_numeric(r)
        x = (np.frombuffer(r, "<u4") ^ np.frombuffer(p, "<u4")).view(np.uint8).reshape(-1, 4).T.copy().tobytes()
        s = (np.frombuffer(r, "<u4") - np.frombuffer(p, "<u4")).view(np.uint8).reshape(-1, 4).T.copy().tobytes()
        against += min(len(Z3.compress(x)), len(Z3.compress(s)), craton_numeric(r))
    print(f"{f}: {same}/{len(t)} decoded tiles identical to the parent; changed tiles alone {alone/1048576:.2f} MB, against the parent tile {against/1048576:.2f} MB")
