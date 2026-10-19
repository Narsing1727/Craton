"use client";

// A GeoTIFF on a real map, with MapLibre GL: a street, satellite or topographic basemap underneath, and the file drawn over it by the Craton
// server as standard Web Mercator tiles, reprojected from its own coordinate system and coloured with a published colour map over a hillshade.
// With `base`, the layer is the elevation change since that version, as a heat map. Pointing at the map reads out the value there.

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import type { Map as MlMap, RasterTileSource } from "maplibre-gl";
import type { ApiTileInfo } from "@/lib/api";
import { BASEMAPS, MAPLIBRE_WORKER, type Basemap } from "@/lib/basemaps";
import { formatLength, type UnitSystem } from "@/lib/units";
import { cn } from "@/lib/utils";

type Props = {
  owner: string;
  repo: string;
  reference: string;
  path: string;
  units: UnitSystem;
  /** Show the change since this version instead of the elevation. */
  base?: string;
  /** The largest change, for the heat map's legend (it is also the colour range the server uses). */
  span?: number;
  alt: string;
};

type Readout = { value: number | null; lon: number; lat: number; x: number | null; y: number | null } | null;
type RampId = "terrain" | "viridis" | "magma" | "greys";
const RAMPS: { id: RampId; label: string }[] = [
  { id: "terrain", label: "Terrain" },
  { id: "viridis", label: "Viridis" },
  { id: "magma", label: "Magma" },
  { id: "greys", label: "Grey" },
];

export function RasterMap({ owner, repo, reference, path, units, base, span, alt }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [info, setInfo] = useState<(ApiTileInfo & { map: { bounds: [number, number, number, number]; maxZoom: number } | null; ramps: Record<string, string[]> }) | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap["id"] | "none">("satellite");
  const [ramp, setRamp] = useState<RampId>("terrain");
  const [opacity, setOpacity] = useState(base ? 0.9 : 0.85);
  const [readout, setReadout] = useState<Readout>(null);

  const tileUrl = (r: RampId) =>
    `${typeof window === "undefined" ? "" : window.location.origin}/${owner}/${repo}/xyz/{z}/{x}/{y}?${new URLSearchParams({ ref: reference, path, ramp: r, ...(base ? { base } : {}) })}`;

  useEffect(() => {
    let live = true;
    fetch(`/${owner}/${repo}/tileinfo?${new URLSearchParams({ ref: reference, path })}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) return void setProblem(body?.error?.message ?? "This raster can't be shown on a map.");
        if (!body.map) return void setProblem("This raster's coordinate system can't be placed on a map.");
        setInfo(body);
      })
      .catch(() => live && setProblem("The map couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [owner, repo, reference, path]);

  // Build the map once the file's place is known.
  useEffect(() => {
    if (!info?.map || !box.current) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let ask: AbortController | null = null;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      ml.setWorkerUrl(MAPLIBRE_WORKER);
      const map = new ml.Map({
        container: box.current,
        style: {
          version: 8,
          sources: Object.fromEntries(BASEMAPS.map((b) => [b.id, { type: "raster", tiles: [b.tiles], tileSize: 256, attribution: b.attribution, maxzoom: b.maxzoom }])),
          layers: [
            { id: "background", type: "background", paint: { "background-color": "#0b0d12" } },
            ...BASEMAPS.map((b) => ({ id: `basemap-${b.id}`, type: "raster" as const, source: b.id, layout: { visibility: (b.id === basemap ? "visible" : "none") as "visible" | "none" } })),
          ],
        },
        bounds: info.map!.bounds,
        fitBoundsOptions: { padding: 24 },
        maxZoom: Math.min(22, info.map!.maxZoom + 3),
        attributionControl: { compact: true },
        dragRotate: false,
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.FullscreenControl(), "top-right");
      map.addControl(new ml.ScaleControl({ unit: units === "imperial" ? "imperial" : "metric" }), "bottom-left");
      map.on("load", () => {
        map.addSource("data", { type: "raster", tiles: [tileUrl(ramp)], tileSize: 256, bounds: info.map!.bounds, maxzoom: info.map!.maxZoom, attribution: "Data: this repository" });
        map.addLayer({ id: "data", type: "raster", source: "data", paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } });
      });
      map.on("mousemove", (e) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          ask?.abort();
          ask = new AbortController();
          const { lng, lat } = e.lngLat;
          fetch(`/${owner}/${repo}/pixel?${new URLSearchParams({ ref: reference, path, lon: lng.toFixed(8), lat: lat.toFixed(8) })}`, { signal: ask.signal })
            .then((r) => (r.ok ? r.json() : null))
            .then((p) => p && setReadout({ value: base ? null : p.value, lon: lng, lat, x: p.x, y: p.y }))
            .catch(() => {});
        }, 80);
      });
      map.on("mouseout", () => setReadout(null));
    })();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      ask?.abort();
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // The map is built once per file; the controls below change it in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const b of BASEMAPS) map.setLayoutProperty(`basemap-${b.id}`, "visibility", b.id === basemap ? "visible" : "none");
  }, [basemap]);
  useEffect(() => {
    const src = mapRef.current?.getSource("data") as RasterTileSource | undefined;
    src?.setTiles([tileUrl(ramp)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ramp]);
  useEffect(() => {
    const map = mapRef.current;
    if (map?.getLayer("data")) map.setPaintProperty("data", "raster-opacity", opacity);
  }, [opacity]);

  if (problem) return <p className="border border-border bg-muted/30 p-4 text-xs text-muted-foreground text-pretty">{problem}</p>;

  const stops = info?.ramps?.[base ? "change" : ramp] ?? [];
  const gradient = stops.length ? `linear-gradient(to right, ${stops.join(", ")})` : undefined;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <div className="flex items-center gap-1" role="group" aria-label="Basemap">
          {[...BASEMAPS.map((b) => ({ id: b.id, label: b.label })), { id: "none" as const, label: "None" }].map((b) => (
            <button
              key={b.id}
              type="button"
              aria-pressed={basemap === b.id}
              onClick={() => setBasemap(b.id)}
              className={cn("px-2 py-1 transition-colors", basemap === b.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}
            >
              {b.label}
            </button>
          ))}
        </div>
        {!base && (
          <label className="flex items-center gap-2 text-muted-foreground">
            Colours
            <select value={ramp} onChange={(e) => setRamp(e.target.value as RampId)} className="border border-border bg-background px-1.5 py-1 text-foreground">
              {RAMPS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2 text-muted-foreground">
          Opacity
          <input type="range" min={0} max={1} step={0.05} value={opacity} onChange={(e) => setOpacity(Number(e.target.value))} className="w-24 accent-foreground" aria-valuetext={`${Math.round(opacity * 100)}%`} />
        </label>
      </div>

      <div ref={box} role="region" aria-label={alt} className="h-[min(70vh,620px)] w-full border border-border bg-muted/30" />

      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground tabular-nums">
        {info && gradient ? (
          <div className="flex items-center gap-2">
            <span>{base ? `${formatLength(-(span ?? 0), units, { digits: 2 })} lower` : formatLength(info.min, units, { digits: 1 })}</span>
            <span className="h-2.5 w-44 border border-border" style={{ background: gradient }} aria-hidden />
            <span>{base ? `${formatLength(span ?? 0, units, { digits: 2, signed: true })} higher` : formatLength(info.max, units, { digits: 1 })}</span>
          </div>
        ) : (
          <span>Loading the map…</span>
        )}
        <span aria-live="polite" className="font-mono">
          {readout
            ? [
                readout.value !== null ? formatLength(readout.value, units, { digits: 2 }) : base ? null : "no data",
                `${Math.abs(readout.lat).toFixed(5)}° ${readout.lat >= 0 ? "N" : "S"} ${Math.abs(readout.lon).toFixed(5)}° ${readout.lon >= 0 ? "E" : "W"}`,
                readout.x !== null && readout.y !== null && info && !info.geographic ? `E ${readout.x.toLocaleString("en-US", { maximumFractionDigits: 1 })} N ${readout.y.toLocaleString("en-US", { maximumFractionDigits: 1 })}` : null,
              ]
                .filter(Boolean)
                .join(" · ")
            : "Point at the map to read the value there"}
        </span>
      </div>
    </div>
  );
}
