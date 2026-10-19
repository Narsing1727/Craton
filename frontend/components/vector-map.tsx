"use client";

// A shapefile or GeoJSON on a real map, with MapLibre GL: the features in their true place over a street, satellite or topographic basemap,
// and the attribute table under it. Pointing at a feature lights it; clicking a feature or a row selects it and lists its attributes.

import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExpressionSpecification, Map as MlMap } from "maplibre-gl";
import type { ApiVectorFeatures } from "@/lib/api";
import { BASEMAPS, MAPLIBRE_WORKER, type Basemap } from "@/lib/basemaps";
import { cn } from "@/lib/utils";

type Props = {
  alt: string;
  /** Read from the API (owner, repo, reference, path) in longitude and latitude, or given already in degrees. */
  owner?: string;
  repo?: string;
  reference?: string;
  path?: string;
  source?: ApiVectorFeatures;
};

type Ring = [number, number][];
const ring = (flat: number[]): Ring => {
  const out: Ring = [];
  for (let k = 0; k + 1 < flat.length; k += 2) out.push([flat[k], flat[k + 1]]);
  return out;
};
function inside([x, y]: [number, number], r: Ring) {
  let hit = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) if (r[i][1] > y !== r[j][1] > y && x < ((r[j][0] - r[i][0]) * (y - r[i][1])) / (r[j][1] - r[i][1]) + r[i][0]) hit = !hit;
  return hit;
}
/** Rings as polygons with holes: a ring that lies inside another is that one's hole, whatever order or winding the file used. */
function polygons(parts: number[][]): Ring[][] {
  const rings = parts.map(ring).filter((r) => r.length >= 3);
  const holeOf = rings.map((r, i) => rings.findIndex((o, j) => j !== i && inside(r[0], o)));
  const out: Ring[][] = [];
  const index = new Map<number, number>();
  rings.forEach((r, i) => {
    if (holeOf[i] === -1) (index.set(i, out.length), out.push([r]));
  });
  rings.forEach((r, i) => {
    if (holeOf[i] !== -1 && index.has(holeOf[i])) out[index.get(holeOf[i])!].push(r);
  });
  return out;
}

const shown = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 6 }) : String(v));

export function VectorMap({ alt, owner, repo, reference, path, source }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const [data, setData] = useState<ApiVectorFeatures | null>(source ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [basemap, setBasemap] = useState<Basemap["id"] | "none">("streets");
  const [picked, setPicked] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [rowsShown, setRowsShown] = useState(25);

  useEffect(() => {
    if (source || !owner || !repo || !reference || !path) return;
    let live = true;
    fetch(`/${owner}/${repo}/features?${new URLSearchParams({ ref: reference, path, lonlat: "1" })}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) return void setProblem(body?.error?.message ?? "These features can't be shown on a map.");
        setData(body as ApiVectorFeatures);
      })
      .catch(() => live && setProblem("The map couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [owner, repo, reference, path, source]);

  const geojson = useMemo(() => {
    if (!data) return null;
    return {
      type: "FeatureCollection" as const,
      features: data.features.map((f) => ({
        type: "Feature" as const,
        id: f.i,
        properties: { ...f.props, __i: f.i, __kind: f.kind },
        geometry:
          f.kind === "polygon"
            ? { type: "MultiPolygon" as const, coordinates: polygons(f.parts) }
            : f.kind === "line"
              ? { type: "MultiLineString" as const, coordinates: f.parts.map(ring) }
              : { type: "MultiPoint" as const, coordinates: f.parts.flatMap(ring) },
      })),
    };
  }, [data]);

  useEffect(() => {
    if (!data || !geojson || !box.current) return;
    let cancelled = false;
    (async () => {
      const ml = await import("maplibre-gl");
      if (cancelled || !box.current) return;
      ml.setWorkerUrl(MAPLIBRE_WORKER);
      const [w, s, e, n] = data.bbox;
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
        bounds: w === e && s === n ? [w - 0.01, s - 0.01, e + 0.01, n + 0.01] : [w, s, e, n],
        fitBoundsOptions: { padding: 32 },
        attributionControl: { compact: true },
        dragRotate: false,
      });
      mapRef.current = map;
      map.touchZoomRotate.disableRotation();
      map.addControl(new ml.NavigationControl({ showCompass: false }), "top-right");
      map.addControl(new ml.FullscreenControl(), "top-right");
      map.addControl(new ml.ScaleControl(), "bottom-left");
      const ro = new ResizeObserver(() => map.resize());
      ro.observe(box.current);
      map.once("remove", () => ro.disconnect());
      map.on("load", () => {
        map.resize();
        // The credits start folded behind their (i) button, so on a phone they do not cover the map; one tap opens them.
        box.current?.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
        map.fitBounds(w === e && s === n ? [w - 0.01, s - 0.01, e + 0.01, n + 0.01] : [w, s, e, n], { padding: 32, animate: false });
        map.addSource("features", { type: "geojson", data: geojson, promoteId: "__i" });
        const on = (state: string): ExpressionSpecification => ["boolean", ["feature-state", state], false];
        map.addLayer({ id: "fill", type: "fill", source: "features", filter: ["==", ["get", "__kind"], "polygon"], paint: { "fill-color": "#5f88cf", "fill-opacity": ["case", on("picked"), 0.55, on("hover"), 0.4, 0.22] } });
        map.addLayer({ id: "outline", type: "line", source: "features", filter: ["==", ["get", "__kind"], "polygon"], paint: { "line-color": ["case", on("picked"), "#ffffff", "#8fb0e3"], "line-width": ["case", on("picked"), 3, on("hover"), 2.2, 1.4] } });
        map.addLayer({ id: "lines", type: "line", source: "features", filter: ["==", ["get", "__kind"], "line"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ["case", on("picked"), "#ffffff", "#8fb0e3"], "line-width": ["case", on("picked"), 4, on("hover"), 3.2, 2.2] } });
        map.addLayer({ id: "points", type: "circle", source: "features", filter: ["==", ["get", "__kind"], "point"], paint: { "circle-color": "#5f88cf", "circle-radius": ["case", on("picked"), 8, on("hover"), 7, 5], "circle-stroke-color": ["case", on("picked"), "#ffffff", "#c4d4ec"], "circle-stroke-width": 1.5 } });
        let hovered: number | null = null;
        const layers = ["fill", "lines", "points"];
        map.on("mousemove", (ev) => {
          const f = map.queryRenderedFeatures(ev.point, { layers })[0];
          const id = f ? Number(f.properties?.__i) : null;
          if (hovered !== null && hovered !== id) map.setFeatureState({ source: "features", id: hovered }, { hover: false });
          if (id !== null) map.setFeatureState({ source: "features", id }, { hover: true });
          hovered = id;
          map.getCanvas().style.cursor = id !== null ? "pointer" : "";
        });
        map.on("click", (ev) => {
          const f = map.queryRenderedFeatures(ev.point, { layers })[0];
          setPicked(f ? Number(f.properties?.__i) : null);
        });
      });
    })();
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [geojson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    for (const b of BASEMAPS) map.setLayoutProperty(`basemap-${b.id}`, "visibility", b.id === basemap ? "visible" : "none");
  }, [basemap]);

  // The selection drawn on the map, and brought into view when it was chosen from the table.
  const lastPicked = useRef<number | null>(null);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.getSource("features")) return;
    if (lastPicked.current !== null) map.setFeatureState({ source: "features", id: lastPicked.current }, { picked: false });
    if (picked !== null) map.setFeatureState({ source: "features", id: picked }, { picked: true });
    lastPicked.current = picked;
  }, [picked]);
  const zoomTo = (i: number) => {
    const map = mapRef.current;
    const f = data?.features.find((x) => x.i === i);
    if (!map || !f) return;
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (const part of f.parts) for (let k = 0; k + 1 < part.length; k += 2) (w = Math.min(w, part[k])), (e = Math.max(e, part[k])), (s = Math.min(s, part[k + 1])), (n = Math.max(n, part[k + 1]));
    if (w === e && s === n) map.flyTo({ center: [w, s], zoom: Math.max(map.getZoom(), 15) });
    else map.fitBounds([w, s, e, n], { padding: 60, maxZoom: 18 });
  };

  const fields = useMemo(() => (data?.fields ?? []).map((f) => f.name), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    return q ? data.features.filter((f) => fields.some((n) => shown(f.props[n]).toLowerCase().includes(q))) : data.features;
  }, [data, filter, fields]);
  const selected = picked !== null ? data?.features.find((f) => f.i === picked) ?? null : null;

  if (problem) return <p className="border border-border bg-muted/30 p-4 text-xs text-muted-foreground text-pretty">{problem}</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 text-xs">
        <div className="flex items-center gap-1" role="group" aria-label="Basemap">
          {[...BASEMAPS.map((b) => ({ id: b.id, label: b.label })), { id: "none" as const, label: "None" }].map((b) => (
            <button key={b.id} type="button" aria-pressed={basemap === b.id} onClick={() => setBasemap(b.id)} className={cn("px-2 py-1 transition-colors", basemap === b.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground")}>
              {b.label}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground tabular-nums">{data ? `${data.count.toLocaleString("en-US")} features${data.shown < data.count ? `, the first ${data.shown.toLocaleString("en-US")} shown` : ""}` : "Loading the features…"}</span>
      </div>

      <div ref={box} role="region" aria-label={alt} className="aspect-4/3 w-full border border-border bg-muted/30 sm:aspect-auto sm:h-[min(65vh,560px)]" />

      <div className="text-xs" aria-live="polite">
        {selected ? (
          <dl className="flex flex-wrap gap-x-6 gap-y-1">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Feature</dt>
              <dd className="font-mono tabular-nums">{selected.i + 1}</dd>
            </div>
            {fields.map((n) => (
              <div key={n} className="flex gap-2">
                <dt className="text-muted-foreground">{n}</dt>
                <dd className="font-mono tabular-nums">{shown(selected.props[n]) || "—"}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <span className="text-muted-foreground">Click a feature, or a row below, to see its attributes.</span>
        )}
      </div>

      {data && fields.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Attribute table</h3>
            <input value={filter} onChange={(e) => (setFilter(e.target.value), setRowsShown(25))} placeholder="Filter rows" aria-label="Filter the rows" className="h-8 w-48 border border-border bg-background px-2 text-xs" />
          </div>
          <div className="max-h-80 overflow-auto border border-border" tabIndex={0} role="region" aria-label="Attribute table">
            <table className="w-full text-left font-mono text-xs">
              <thead className="sticky top-0 border-b border-border bg-card text-muted-foreground">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 font-medium">#</th>
                  {fields.map((n) => (
                    <th key={n} scope="col" className="px-3 py-2 font-medium">{n}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, rowsShown).map((f) => (
                  <tr key={f.i} aria-selected={picked === f.i} onClick={() => (setPicked(f.i), zoomTo(f.i))} className={cn("cursor-pointer", picked === f.i ? "bg-primary/15" : "hover:bg-muted/40")}>
                    <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{f.i + 1}</td>
                    {fields.map((n) => (
                      <td key={n} className={cn("px-3 py-1.5", typeof f.props[n] === "number" && "text-right tabular-nums")}>{shown(f.props[n])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > rowsShown && (
            <div>
              <button type="button" onClick={() => setRowsShown((n) => n + 100)} className="border border-border px-3 py-1.5 text-xs hover:bg-muted/40">
                Show more rows
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
