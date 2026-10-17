# Versions of one real DEM (Copernicus GLO-30 N12 E077, 3600 x 3600 float32), each written by GDAL with the source's own
# layout (DEFLATE, 1024 x 1024 tiles), the way a modeller's tool would save an edited DEM.
import rasterio, numpy as np, sys
SRC = r"D:\Desktop\leetcode\test_data\bengaluru_urban_flood_2022\dem\Copernicus_DSM_N12_E077.tif"
with rasterio.open(SRC) as d:
    z = d.read(1)
    prof = d.profile.copy()
prof.update(compress="deflate", tiled=True, blockxsize=1024, blockysize=1024)
def save(name, a):
    with rasterio.open(name, "w", **prof) as o:
        o.write(a.astype(np.float32), 1)
save("v0.tif", z)                                        # the same data, re-saved by GDAL
a = z.copy(); a[1800:1850, 1500:1700] += 3.0; save("v1_levee.tif", a)   # a 50 x 200 cell levee raised 3 m
save("v2_datum.tif", z + np.float32(0.25))                # a vertical datum shift of 0.25 m everywhere
yy, xx = np.mgrid[0:3600, 0:3600]
bump = (0.8 * np.exp(-(((xx - 2400) / 700.0) ** 2 + ((yy - 900) / 700.0) ** 2))).astype(np.float32)
save("v3_recal.tif", z + bump)                            # a smooth recalibration over part of the tile
z.astype("<f4").tofile("v0.f32")                          # the raw grid, for the uncompressed comparison
print("ok", z.shape, float(z.min()), float(z.max()))
