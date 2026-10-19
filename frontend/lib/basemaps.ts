// The maps drawn under a file: free tile services, each with the attribution its terms ask for. They can be pointed elsewhere (a commercial
// provider, or your own tile server for heavy use, which the OpenStreetMap tile policy asks of busy sites) with NEXT_PUBLIC_CRATON_BASEMAP_*.

export type Basemap = { id: "streets" | "satellite" | "topo"; label: string; tiles: string; attribution: string; maxzoom: number };

export const BASEMAPS: Basemap[] = [
  {
    id: "streets",
    label: "Streets",
    tiles: process.env.NEXT_PUBLIC_CRATON_BASEMAP_STREETS || "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    maxzoom: 19,
  },
  {
    id: "satellite",
    label: "Satellite",
    tiles: process.env.NEXT_PUBLIC_CRATON_BASEMAP_SATELLITE || "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    maxzoom: 19,
  },
  {
    id: "topo",
    label: "Topographic",
    tiles: process.env.NEXT_PUBLIC_CRATON_BASEMAP_TOPO || "https://tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: 'Map data © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, SRTM · Style © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)',
    maxzoom: 17,
  },
];

/** The hosts the basemaps load from, for the Content-Security-Policy. */
export const BASEMAP_HOSTS = ["https://tile.openstreetmap.org", "https://server.arcgisonline.com", "https://tile.opentopomap.org"];

/** Where MapLibre's worker is served (copied there by scripts/copy-maplibre.mjs). */
export const MAPLIBRE_WORKER = "/maplibre/maplibre-gl-worker.mjs";
