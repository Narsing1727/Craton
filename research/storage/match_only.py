# Bit-exact re-deflate on files written by other software: how many tiles or strips zlib reproduces, and with which settings.
import sys, struct, zlib, collections
def try_zlib(stream, raw):
    for level in (6, 9, 1, 2, 3, 4, 5, 7, 8):
        for mem in (8, 9):
            for strat in (zlib.Z_DEFAULT_STRATEGY, zlib.Z_FILTERED):
                c = zlib.compressobj(level, zlib.DEFLATED, 15, mem, strat)
                if c.compress(raw) + c.flush() == stream:
                    return (level, mem, strat)
    return None
def segments(path):
    b = open(path, "rb").read()
    le = b[:2] == b"II"
    E = "<" if le else ">"
    if struct.unpack_from(E + "H", b, 2)[0] != 42: return b, None, "BigTIFF (not parsed here)"
    ifd = struct.unpack_from(E + "I", b, 4)[0]
    n = struct.unpack_from(E + "H", b, ifd)[0]
    tags = {}
    for i in range(n):
        tag, typ, cnt, val = struct.unpack_from(E + "HHII", b, ifd + 2 + 12 * i)
        size = {3: 2, 4: 4}.get(typ, 1) * cnt
        off = ifd + 2 + 12 * i + 8 if size <= 4 else val
        fmt = {3: "H", 4: "I"}.get(typ)
        tags[tag] = list(struct.unpack_from(E + "%d%s" % (cnt, fmt), b, off)) if fmt else val
    comp = tags.get(259, [1])[0]
    offs, counts = (tags.get(324), tags.get(325)) if 324 in tags else (tags.get(273), tags.get(279))
    return b, list(zip(offs, counts)), {1: "none", 5: "LZW", 8: "DEFLATE", 32946: "DEFLATE(old)", 34887: "LERC", 50000: "ZSTD"}.get(comp, comp)
for p in sys.argv[1:]:
    b, segs, comp = segments(p)
    if segs is None or comp not in ("DEFLATE", "DEFLATE(old)"):
        print(f"{p.split(chr(92))[-1]}: {comp}, skipped"); continue
    hits, params = 0, collections.Counter()
    for o, c in segs:
        s = b[o:o + c]
        r = try_zlib(s, zlib.decompress(s))
        if r: hits += 1; params[r] += 1
    print(f"{p.split(chr(92))[-1]}: {comp}, {len(segs)} segments, zlib reproduces {hits}/{len(segs)} {dict(params)}")
