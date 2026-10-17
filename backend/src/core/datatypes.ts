// File extension → the data-type labels the UI shows (DEM, Shapefile, LiDAR…).

export type DataType = "DEM" | "Shapefile" | "LiDAR" | "NetCDF" | "HEC-RAS" | "HEC-HMS" | "SWMM" | "EPANET" | "GeoTIFF" | "Zarr";

const byExt: Record<string, DataType> = {
  tif: "DEM", tiff: "DEM", vrt: "DEM", img: "DEM", asc: "DEM",
  shp: "Shapefile", gpkg: "Shapefile", geojson: "Shapefile", kml: "Shapefile",
  las: "LiDAR", laz: "LiDAR", copc: "LiDAR",
  nc: "NetCDF", grib: "NetCDF",
  zarr: "Zarr", zattrs: "Zarr", zarray: "Zarr",
  hdf: "HEC-RAS", prj: "HEC-RAS",
  inp: "SWMM",
  hms: "HEC-HMS",
  net: "EPANET",
};

export function dataTypeOf(path: string): DataType | undefined {
  const name = path.toLowerCase();
  if (/\.(p|g|u|f)\d\d$/.test(name)) return "HEC-RAS"; // plan, geometry, unsteady and steady flow files
  const ext = name.split(".").pop() ?? "";
  // .prj next to a .shp is a projection file, not a HEC-RAS project; callers pass the full path list when it matters.
  return byExt[ext];
}

/** Data types present in a set of paths, in a stable order. */
export function dataTypesOf(paths: string[]): DataType[] {
  const shp = new Set(paths.filter((p) => p.toLowerCase().endsWith(".shp")).map((p) => p.slice(0, -4).toLowerCase()));
  const found = new Set<DataType>();
  for (const p of paths) {
    const lower = p.toLowerCase();
    if (lower.endsWith(".prj") && shp.has(lower.slice(0, -4))) continue;
    const t = dataTypeOf(p);
    if (t) found.add(t);
  }
  const order: DataType[] = ["HEC-RAS", "HEC-HMS", "SWMM", "EPANET", "DEM", "GeoTIFF", "Shapefile", "LiDAR", "NetCDF", "Zarr"];
  return order.filter((t) => found.has(t));
}
