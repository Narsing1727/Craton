# Storing big geospatial files exactly, in less space (research, 2026-10-18)

**Rule we keep:** a person always gets back 100% the bytes they uploaded. Nothing lossy, ever. Any stored form is checked
by rebuilding the original and comparing SHA-256 before it is accepted; if the check fails, the bytes are stored as they are.

## 1. What Craton does today (stated explicitly)

Craton already never alters a file. It splits files into content-defined chunks (FastCDC, 128 KB average), keeps one copy of
each distinct chunk, and stores each chunk in one of these **lossless** forms (first byte of the stored chunk says which).
Every stored chunk is decompressed and re-hashed before it is accepted (`backend/src/core/compress.ts`).

| File type | Stored as today | Why |
|---|---|---|
| Uncompressed rasters (`.tif` without compression, `.flt`, `.hgt`, `.f32`) | delta + byte shuffle + zstd | Smooth numbers compress well once regrouped (measured 2.7x to 6.7x on real grids) |
| LAS point clouds | records shuffle + zstd | 1.93x became 3.21x on a real 110,000-point file |
| CSV, HEC-RAS text (`.p01`, `.g01`, `.u01`), SWMM `.inp`, JSON, `.prj` | zstd level 9 | Text |
| **DEFLATE/LZW GeoTIFF, LAZ, JPEG, PNG, ZIP, Parquet, PMTiles, MP4** | **as they are (no compression)** | Already compressed: trying again gains nothing |

So "compression" in Craton today only ever means a lossless re-arrangement that is verified chunk by chunk.

## 2. The real problem: already-compressed big files do not deduplicate

Measured with Craton's own chunker and codecs (`today.mjs`) on a real **Copernicus GLO-30 DEM tile** (N12 E077, 3600 x 3600
float32, DEFLATE, 1024 x 1024 tiles, 40.45 MB), saved again by GDAL after three typical edits:

| Version | What changed | Chunks shared with v0 | Craton stores today |
|---|---|---|---|
| v0 | the DEM | n/a | **40.45 MB** (stored as is: already DEFLATE) |
| v1 | a 50 x 200 cell levee raised 3 m | 274 / 281 | 1.09 MB |
| v2 | vertical datum shift +0.25 m everywhere | **0 / 276** | **40.45 MB** |
| v3 | smooth recalibration over part of the tile | 2 / 279 | **40.22 MB** |
| | **4 versions** | | **122.2 MB** |

DEFLATE scrambles every byte when any value changes, so a datum shift or a recalibration costs a whole new copy.

## 3. Findings

### 3.1 DEFLATE tiles can be rebuilt bit for bit (`match_only.py`, `pako_test.mjs`)

Decode a tile to its pixels, compress them again with the same zlib settings, compare with the original bytes:

| File (who wrote it) | Tiles / strips | Reproduced by zlib level 6 | By Node's bundled zlib | By **pako 2.1.0** (pure JS zlib port) |
|---|---|---|---|---|
| Copernicus N12 E077 (ESA/Airbus pipeline) | 16 | **16 / 16** | 0 / 16 | **16 / 16** |
| Copernicus N30 E079 | 16 | **16 / 16** | | |
| PROJ geoid grid au_ga_AUSGeoid2020 | 247 | **247 / 247** | 177 / 247 | **247 / 247** |
| PROJ grid ca_nrc_CGG2013n83 | 190 | **190 / 190** | | **190 / 190** |
| Same DEM re-saved by GDAL 3.10 (rasterio) | 16 | **16 / 16** | 0 / 16 | **16 / 16** |
| Nerolith's own `filled_dem.tif` (C++ GDAL with libdeflate) | 4 | 0 / 4 | | libdeflate level 6: **4 / 4** |

- Most GeoTIFFs in the wild are written with standard zlib at level 6, and that is exactly reproducible.
- **Node's own zlib cannot be used** (it is Chromium's optimised fork; its output differs). **pako** reproduces standard zlib
  exactly and, being pure JavaScript at a pinned version, will produce the same bytes forever on every machine.
- Files written through libdeflate (newer GDAL builds, including ours) need a pinned libdeflate (for example compiled to
  WebAssembly). libdeflate's own documentation warns its output can change between versions, so the version must be pinned.
- Re-making DEFLATE costs CPU: pako re-compresses 4 to 18 MB of pixels per second.

### 3.2 Stored as pixels, a DEFLATE GeoTIFF is smaller and versions become tiny (`tiles.py`, `roundtrip.py`)

The prototype stores the file's "skeleton" (header, directory: 2 KB) plus each tile's pixels (byte shuffle + zstd), records
the zlib settings, and an edited version stores each tile **against the same tile of its parent** (XOR or subtraction of the
32-bit patterns, whichever is smaller, then shuffle + zstd). On read it rebuilds the pixels and the DEFLATE streams.
**Every rebuilt file was identical to the upload (SHA-256).**

| Version | As uploaded | Stored today | Stored as pixels + parent delta | Rebuilt identical |
|---|---|---|---|---|
| v0 DEM | 40.45 MB | 40.45 MB | **28.96 MB** (-28%) | yes |
| v1 levee | 40.45 MB | 1.09 MB | **4 KB** | yes |
| v2 datum shift | 40.45 MB | 40.45 MB | **86 KB** (470x less) | yes |
| v3 recalibration | 40.50 MB | 40.22 MB | **1.51 MB** (27x less) | yes |
| **4 versions** | 161.9 MB | **122.2 MB** | **30.6 MB (4x less)** | |

### 3.3 The same parent delta helps uncompressed rasters, with no DEFLATE at all

Raw float32 grid (49.44 MB), +0.25 m datum shift: each 128 KB chunk stored alone (today's best codec) **30.82 MB**; stored
against the parent's chunk at the same place **0.12 MB**.

## 3.4 Built (2026-10-18): recommendation 1

Parent-chunk delta is now in the server (`backend/src/core/refdelta.ts`, `services/repack.ts`, encoding 10, `npm run repack`). Three versions of a
real 49 MB uncompressed Copernicus GeoTIFF (original, +0.25 m, smooth recalibration): **86.2 MB stored today, 35.3 MB with differences
(2.44x)**, every download byte-identical, every chunk decodable by a client (`end_to_end.mjs`). Chunks are cut by content, so after a
global change their boundaries move; the difference is therefore taken against the earlier version's bytes at the same *file offsets*
(slices of up to four of its chunks), not against one chunk. Not yet built: recommendations 2 to 6.

## 3.5 Built (2026-10-18): recommendation 2, as an opt-in cold tier

`backend/src/services/recode.ts` (+ `core/tiff.ts`, `core/rezip.ts`, `core/tilepayload.ts`, `core/pieces.ts`, `services/tiles.ts`,
`services/deflatepool.ts`). Four real versions of the Copernicus DEM (original, levee, datum shift, recalibration; tip left as
uploaded): **122.2 MB stored today, 69.6 MB with the cold tier (1.76x)**, disk bytes equal the database's accounting, every version
byte-identical, 33 stored tiles rebuilt exactly (`end_to_end_tiles.mjs`). Reading a cold 40 MB version takes about 1.8 s (tiles are
compressed again in worker threads, the next few started ahead of the reader), the tip 0.2 s, which is why it is limited to versions that are no longer the tip of a branch or
a tag, and off unless `CRATON_RECODE=1`. Chunks are cut over compressed bytes, so a chunk is a few tiles' worth of ends and middles:
it is stored as pieces (literal bytes plus slices of tiles, encoding 11) and a tile as its pixels; chunks shared with the tip stay whole.

## 4. Recommendations, in order

1. **Parent-chunk delta for numeric data** (new stored form: "difference from base chunk *H*"). Works today for uncompressed
   rasters, LAS, NetCDF classic; no new dependency. The base is the chunk at the same position of the same path in the
   parent commit (no similarity search needed for rasters); for unstructured files, find a base by resemblance features
   (Finesse, FAST 2019). Keep chains one hop deep (a delta's base is always a full chunk) so a read costs one extra chunk,
   and teach garbage collection that a base stays alive while a delta uses it. Verified like every chunk.
2. **DEFLATE GeoTIFF stored as pixels with bit-exact re-deflate** (pako, pinned). 28% smaller first version, and it lets
   recommendation 1 work on compressed rasters (datum shift: 40 MB to 86 KB). Strict rule: at upload, rebuild the whole file
   and compare SHA-256; any tile not reproducible means the file is stored as it is (today's behaviour). Keep the latest
   version of a file also in its uploaded form (hot copy) so downloads stay instant; older versions are rebuilt on demand,
   and a range read rebuilds only the tiles it touches.
3. **Pinned libdeflate (WebAssembly)** as a second re-deflater, for files from newer GDAL builds (our own Nerolith outputs).
4. **Measure next, same method:** NetCDF4 / HDF5 (HEC-RAS results `.hdf`: gzip chunks, usually standard zlib), ZIP'd
   shapefiles and KMZ (DEFLATE members), PNG. LZW TIFF (deterministic encoder in libtiff) is likely reproducible but untested.
5. **JPEG orthophotos:** Lepton / JPEG XL re-encoding saves about 22% with byte-exact reconstruction (vendor figures). Only
   worth it if imagery becomes a large share of storage.
6. **Leave alone:** LAZ (LASzip is already near the limit and compresses in independent chunks, so edits stay local),
   Parquet, PMTiles, ZSTD- or LERC-compressed TIFF, video.

**Never:** lossy or "max error" modes (LERC with a tolerance, lossy ZFP), or any stored form that is not verified by
rebuilding the original.

## 5. Costs and risks

- **CPU on read** for recommendation 2 (pako 4 to 18 MB/s). Mitigated by the hot copy of the latest version and tile-level
  range reads; older versions are read far less often.
- **Pinning:** the re-deflater is part of the stored format. pako 2.1.0 must be vendored and never upgraded silently; a new
  version needs a new codec id.
- **Garbage collection:** deltas create dependencies between chunks; GC must count them.
- **CLI / wire format:** this is a server-side storage change first. Sending deltas on push and pull is a later step.
- Cross-repository deduplication stays scoped by visibility, as now, so a chunk's existence never leaks between private repos.

## 6. Reproduce

Scripts here, run against `test_data/*/dem/Copernicus_DSM_*.tif` and the PROJ grids in `backend/build/proj`:
`make_versions.py` (rasterio/GDAL 3.10 versions), `today.mjs` (Craton's own chunker and codecs), `tiles.py`, `match_only.py`,
`node_zlib.mjs`, `pako_test.mjs`, `roundtrip.py` (needs `numpy`, `zstandard`, `rasterio`; `pako@2.1.0` for the Node test).

## Sources

- preflate-rs (Microsoft): split DEFLATE streams into data plus reconstruction information for exact binary storage. https://docs.rs/preflate-rs
- Puffin, Chromium's deterministic deflate re-compressor. https://chromium.googlesource.com/chromium/src.git/+/main/third_party/puffin/README.md
- libdeflate: output may differ between versions at the same level. https://github.com/00mjk/libdeflate
- GDAL 3.2 added optional libdeflate. https://gitlab.orfeo-toolbox.org/orfeotoolbox/otb/-/issues/2137
- Zhang et al., Finesse, FAST 2019 (resemblance detection for post-deduplication delta compression). https://ranger.uta.edu/~jiang/publication/Conferences/2019/2019-FAST-Finesse.pdf
- Dropbox Lepton, 22% lossless on JPEG. https://dropbox.tech/infrastructure/lepton-image-compression-saving-22-losslessly-from-images-at-15mbs
- JPEG XL, byte-exact JPEG reconstruction. https://arxiv.org/pdf/2506.05987
