// What Craton does with each kind of file. Every row is something the server and the file page actually do; a format that is only stored says so.

export type FormatRow = {
  name: string;
  extensions: string;
  /** What opens on the file's page. */
  viewer: string;
  /** What is read and judged when it is pushed. */
  checks: string;
  /** How two versions are compared. */
  compare: string;
};

export const FORMATS: FormatRow[] = [
  {
    name: "GeoTIFF and Cloud Optimized GeoTIFF",
    extensions: ".tif .tiff",
    viewer: "A hillshaded map that zooms to single pixels, an elevation legend over the file's histogram, the value and map position under the cursor, a scale bar",
    checks: "Coordinate system, vertical datum, nodata, whether it is laid out as a Cloud Optimized GeoTIFF",
    compare: "An elevation-change heat map against the last commit, with cell statistics (area raised and lowered, volume)",
  },
  {
    name: "Shapefile",
    extensions: ".shp .shx .dbf .prj",
    viewer: "A map you can pan and zoom, with the attribute table beside it; click a feature or a row and the other lights up",
    checks: "That the sidecar files are present, the header is valid, the coordinate system is declared",
    compare: "Features added, changed and removed, drawn on the map; a change only in the attribute table counts",
  },
  {
    name: "GeoJSON",
    extensions: ".geojson .json",
    viewer: "The same map, with each feature's properties as a table; a tree and the source as tabs",
    checks: "A scan for credentials",
    compare: "A line diff",
  },
  {
    name: "GeoPackage",
    extensions: ".gpkg",
    viewer: "Its layers with kind, row count, coordinate system and extent",
    checks: "The layers' coordinate systems and contents tables",
    compare: "Stored and hashed exactly; compared as a whole file",
  },
  {
    name: "GeoParquet",
    extensions: ".parquet .geoparquet",
    viewer: "Its geometry columns with encoding, geometry types, coordinate system and bounds",
    checks: "The declared coordinate system of every geometry column",
    compare: "Stored and hashed exactly; compared as a whole file",
  },
  {
    name: "LAS point clouds",
    extensions: ".las .laz",
    viewer: "The cloud seen from above, coloured by elevation and faded where points are few. LAZ is stored compressed, so it has no picture",
    checks: "Header, point count, coordinate system, whether the file is complete",
    compare: "Point records are compared as a whole; a change is stored as the points that moved",
  },
  {
    name: "NetCDF",
    extensions: ".nc .cdf",
    viewer: "Dimensions, variables with their units and descriptions, and the file's own attributes",
    checks: "The header is complete and consistent with the file's size",
    compare: "Stored and hashed exactly",
  },
  {
    name: "HDF5 and HEC-RAS results",
    extensions: ".hdf .h5 .hdf5 .nc4",
    viewer: "Groups and datasets, the largest arrays, and for a HEC-RAS results file how the run went: status, errors, time, volume",
    checks: "Structure; for HEC-RAS, whether the run was stable and its maximum water-surface error",
    compare: "Stored and hashed exactly; the run summary is shown for each version",
  },
  {
    name: "HEC-RAS project files",
    extensions: ".prj .g01 .p01 .u01 .f01",
    viewer: "The settings as a table, then the text with line numbers and find",
    checks: "That a plan's geometry and flow files exist",
    compare: "A line diff",
  },
  {
    name: "SWMM input",
    extensions: ".inp",
    viewer: "Its sections with how many rows each holds, then the text",
    checks: "The engine's own error conditions, read without running it: links between nodes that do not exist, zero or negative lengths, an elevation drop larger than the pipe, names used twice",
    compare: "A line diff",
  },
  {
    name: "Tables",
    extensions: ".csv .tsv",
    viewer: "Sort, filter and page; each column's type, range and a small histogram; a time-series plot and an observed-against-simulated fit",
    checks: "Rules you write: required columns, no empties, numeric ranges, unique keys, sorted time",
    compare: "Rows matched by key: added, removed, changed",
  },
  {
    name: "Documents",
    extensions: ".md .txt .json and other text",
    viewer: "Markdown formatted, JSON as a tree, anything else as numbered lines with find and wrap",
    checks: "A scan for credentials, on every file",
    compare: "A line diff",
  },
  {
    name: "Pictures",
    extensions: ".png .jpg .gif .webp .svg .avif .bmp",
    viewer: "Shown in place on a chequerboard, fitted or at actual size",
    checks: "A scan for credentials",
    compare: "Stored and hashed exactly",
  },
  {
    name: "Everything else",
    extensions: "any",
    viewer: "No viewer; the page says what the file is, how big, and how it is stored",
    checks: "A scan for credentials",
    compare: "Which chunks changed",
  },
];
