// Mock wiki for hydrolab/chalakudy-basin. Bodies use a tiny markdown subset:
// blank-line separated blocks, "## " headings, "- " lists, and "[map]" for a terrain figure.

export type WikiPage = { slug: string; title: string; author: string; updated: string; body: string };

export const wikiPages: WikiPage[] = [
  {
    slug: "home",
    title: "Home",
    author: "priyam",
    updated: "2 weeks ago",
    body: `This wiki documents how the Chalakudy basin model is built, calibrated and maintained. Start with the terrain pipeline if you are new to the repository.

## Pages
- Calibration methodology: how Manning's n was fitted to the 2018 flood
- Terrain processing pipeline: from raw LiDAR to the 2 m DEM
- Gauge network: stations, rating curves and data gaps
- Boundary conditions: dam releases upstream, tides downstream
- Datum & projections: CRS and vertical datum rules for every layer

## Conventions
Every file uses EPSG:32643. Elevations are metres above the 2024 survey datum. Open an issue before changing either.`,
  },
  {
    slug: "calibration-methodology",
    title: "Calibration methodology",
    author: "priyam",
    updated: "1 week ago",
    body: `The 2D HEC-RAS model of the Chalakudy basin was calibrated against the 2018 monsoon flood, the largest event with reliable high-water marks. Roughness coefficients were adjusted per land-cover class until modelled stage matched observed marks within ±0.15 m.

## Terrain
The bare-earth DEM is a 2 m grid derived from the 2024 LiDAR survey. The figure below shows the modelled inundation extent for the calibration event over the terrain mesh.

[map]

## Roughness values
Manning's n ranges from 0.028 in the main channel to 0.12 for dense riparian vegetation. Final values and the Nash–Sutcliffe efficiency for each gauge are recorded in the model's plan file.`,
  },
  {
    slug: "terrain-processing-pipeline",
    title: "Terrain processing pipeline",
    author: "sarat",
    updated: "5 days ago",
    body: `Raw LiDAR swaths are ingested as LAZ, classified, and gridded into the 2 m bare-earth DEM stored in terrain/.

## Steps
- Ground classification of the point cloud (class 2 only)
- Gridding to 2 m with TIN interpolation
- Hydro-conditioning: bridges and culverts are breached so water can pass
- Tiling into 256 × 256 Cloud-Optimized GeoTIFF overviews

## Re-running
Commit the new LAZ files to a branch and open a pull request. Unchanged tiles are deduplicated, so a partial resurvey only stores the tiles that changed.`,
  },
  {
    slug: "gauge-network",
    title: "Gauge network",
    author: "sarat",
    updated: "4 days ago",
    body: `Stage and rainfall observations used for calibration and forecasting live in gauges.csv, one row per station per hour.

## Stations
- 5 river stage gauges between Peringalkuthu and the estuary
- 2 tipping-bucket rain gauges in the upper catchment
- Rating curves for each stage gauge in model/calibration/

## Known gaps
Readings from 14–16 August 2018 are missing at two downstream gauges because the stations were submerged. They are marked with the nodata value, never interpolated.`,
  },
  {
    slug: "boundary-conditions",
    title: "Boundary conditions",
    author: "arunn",
    updated: "4 days ago",
    body: `The model has one upstream inflow, one downstream stage boundary and lateral inflows from the sub-catchments.

## Upstream
Hourly release hydrograph from Peringalkuthu dam, taken from the operator's release records.

## Downstream
Tidal stage at the estuary outlet. A normal-depth option is tracked in issue #80.

## Lateral inflows
Sub-catchment runoff from the HEC-HMS model, one hydrograph per polygon in vectors/boundaries/.`,
  },
  {
    slug: "datum-and-projections",
    title: "Datum & projections",
    author: "priyam",
    updated: "5 hours ago",
    body: `All layers use WGS 84 / UTM zone 43N (EPSG:32643). Craton's validation check rejects commits with any other CRS.

## Vertical datum
Elevations are metres above the 2024 survey datum. The 2023 DEM sits about 0.3 m lower; see issue #88 before mixing the two.

## Checklist for new layers
- Reproject to EPSG:32643 before committing
- Record the vertical datum in the file's metadata
- Keep the nodata value at -9999 for rasters`,
  },
  {
    slug: "changelog",
    title: "Changelog",
    author: "arunn",
    updated: "3 days ago",
    body: `Notable changes to the model and its data, newest first.

## v1.2.0
- Rebuilt the DEM from the 2024 LiDAR survey
- Recalibrated Manning's n for the main channel
- Added levee centerlines

## v1.1.0
- Fixed sub-catchment topology near the confluence
- Added 2024 gauge readings`,
  },
];

