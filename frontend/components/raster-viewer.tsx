"use client";

// The viewer for a GeoTIFF: the hillshaded image fills its frame, zooms and pans down to single pixels (the API draws 256-pixel tiles in the
// image's own pixel space; zoom 0 is the whole image, the deepest zoom is one tile pixel per image pixel), and reads out what is under the
// cursor. Beside it, an inspector with the colour legend over the file's own histogram, the cursor's value and map position, and the view's scale.
// The drawn preview underneath is what shows first, and for a file that cannot give tiles it is all there is.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiPixel, ApiTileInfo } from "@/lib/api";
import { formatLength, type UnitSystem } from "@/lib/units";
import { terrainGradient } from "@/lib/ramps";

type Props = {
  owner: string;
  repo: string;
  reference: string;
  path: string;
  /** The drawn preview, which fills the frame until a tile is needed. */
  base: string;
  alt: string;
  /** Width over height of the image, so the frame is the image's shape before anything has loaded. */
  aspect: number;
  units: UnitSystem;
  /** The numbers the preview came with, shown until the file's own layout arrives. */
  range?: { min: number; max: number; width: number; height: number } | null;
};

const MAX_SCALE = 8; // screen pixels per image pixel at most
const THUMB_SIDE = 1024; // the longest side of the drawn preview, in pixels
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const tileUrl = (owner: string, repo: string, ref: string, path: string, z: number, x: number, y: number) => `/${owner}/${repo}/tile/${z}/${x}/${y}?${new URLSearchParams({ ref, path })}`;

type View = { scale: number; cx: number; cy: number }; // screen px per image px, and the image point at the centre

/** 1, 2 or 5 times a power of ten, the largest that is no more than `v`. */
function niceFloor(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  const m = v / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}

function distanceLabel(metres: number, units: UnitSystem) {
  if (units === "imperial") {
    const ft = metres * 3.280839895;
    return ft >= 5280 ? `${Math.round((ft / 5280) * 100) / 100} mi` : `${Math.round(ft)} ft`;
  }
  return metres >= 1000 ? `${Math.round(metres) / 1000} km` : `${Math.round(metres * 100) / 100} m`;
}

export function RasterViewer({ owner, repo, reference, path, base, alt, aspect, units, range }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<ApiTileInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [probe, setProbe] = useState<ApiPixel | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);
  const pinch = useRef<{ view: View; dist: number; mid: { x: number; y: number } } | null>(null);
  const probes = useRef(new Map<string, ApiPixel>());

  useEffect(() => {
    let live = true;
    fetch(`/${owner}/${repo}/tileinfo?${new URLSearchParams({ ref: reference, path })}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) return void setProblem(body?.error?.message ?? "This raster can't be zoomed.");
        setInfo(body as ApiTileInfo);
      })
      .catch(() => live && setProblem("The viewer couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [owner, repo, reference, path]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const imageW = info?.width ?? range?.width ?? 0, imageH = info?.height ?? range?.height ?? 0;
  const fit = useMemo(() => (imageW && size.w ? Math.min(size.w / imageW, size.h / imageH) : 1), [imageW, imageH, size]);
  const current = useMemo<View | null>(() => (info && size.w ? (view ?? { scale: fit, cx: info.width / 2, cy: info.height / 2 }) : null), [info, size, view, fit]);

  const place = useCallback(
    (next: View): View => (info ? { scale: clamp(next.scale, fit, Math.max(MAX_SCALE, fit)), cx: clamp(next.cx, 0, info.width), cy: clamp(next.cy, 0, info.height) } : next),
    [info, fit],
  );

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      if (!info || !current) return;
      const scale = clamp(current.scale * factor, fit, Math.max(MAX_SCALE, fit));
      // Keep the image point under (px, py) where it is.
      const ix = current.cx + (px - size.w / 2) / current.scale;
      const iy = current.cy + (py - size.h / 2) / current.scale;
      const next = place({ scale, cx: ix - (px - size.w / 2) / scale, cy: iy - (py - size.h / 2) / scale });
      setView(Math.abs(next.scale - fit) < 1e-6 ? null : next);
    },
    [info, current, fit, size, place],
  );

  // A wheel that scrolls the page everywhere else zooms here; React's own wheel handler is passive, so this one is added by hand.
  useEffect(() => {
    const el = box.current;
    if (!el || !info) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [info, zoomAt]);

  // What is under the cursor: asked for a moment after it stops, and remembered, so sweeping across the image costs few requests.
  const column = hover ? Math.floor(hover.x) : null, row = hover ? Math.floor(hover.y) : null;
  useEffect(() => {
    if (!info || column === null || row === null || column < 0 || row < 0 || column >= info.width || row >= info.height) return void setProbe(null);
    const key = `${column},${row}`;
    const known = probes.current.get(key);
    if (known) return void setProbe(known);
    const ctl = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/${owner}/${repo}/pixel?${new URLSearchParams({ ref: reference, path, column: String(column), row: String(row) })}`, { signal: ctl.signal })
        .then((r) => (r.ok ? (r.json() as Promise<ApiPixel>) : null))
        .then((p) => {
          if (!p) return;
          if (probes.current.size > 500) probes.current.clear();
          probes.current.set(key, p);
          setProbe(p);
        })
        .catch(() => {});
    }, 60);
    return () => {
      clearTimeout(timer);
      ctl.abort();
    };
  }, [info, column, row, owner, repo, reference, path]);

  const rel = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };
  const toImage = (clientX: number, clientY: number, v: View) => {
    const p = rel(clientX, clientY);
    return { x: v.cx + (p.x - size.w / 2) / v.scale, y: v.cy + (p.y - size.h / 2) / v.scale };
  };

  // The tiles in view, at the zoom whose pixels are about one screen pixel each. At the preview's own detail the preview is enough.
  const thumbScale = info ? Math.min(1, THUMB_SIDE / Math.max(info.width, info.height)) : 1;
  const tiles: { key: string; z: number; x: number; y: number; left: number; top: number; w: number; h: number }[] = [];
  if (info && current && current.scale > thumbScale * 1.05) {
    const z = clamp(Math.round(info.maxZoom + Math.log2(current.scale)), 0, info.maxZoom);
    const f = 2 ** (info.maxZoom - z); // image pixels per tile pixel
    const span = info.tileSize * f; // image pixels per tile
    const x0 = current.cx - size.w / 2 / current.scale, x1 = current.cx + size.w / 2 / current.scale;
    const y0 = current.cy - size.h / 2 / current.scale, y1 = current.cy + size.h / 2 / current.scale;
    for (let ty = Math.max(0, Math.floor(y0 / span)); ty <= Math.min(Math.ceil(info.height / span) - 1, Math.floor(y1 / span)); ty++) {
      for (let tx = Math.max(0, Math.floor(x0 / span)); tx <= Math.min(Math.ceil(info.width / span) - 1, Math.floor(x1 / span)); tx++) {
        const imgX = tx * span, imgY = ty * span;
        const wPx = Math.min(info.tileSize, Math.ceil((info.width - imgX) / f));
        const hPx = Math.min(info.tileSize, Math.ceil((info.height - imgY) / f));
        tiles.push({
          key: `${z}/${tx}/${ty}`,
          z,
          x: tx,
          y: ty,
          left: (imgX - current.cx) * current.scale + size.w / 2,
          top: (imgY - current.cy) * current.scale + size.h / 2,
          w: wPx * f * current.scale,
          h: hPx * f * current.scale,
        });
      }
    }
  }
  const crisp = current ? current.scale >= 2 : false;

  // Metres on the ground per screen pixel, for the scale bar (a degree is about 111 km, less towards the poles).
  const metresPerScreenPx = (() => {
    if (!info || !current) return null;
    if (!info.geographic) return info.cellSize[0] / current.scale;
    const lat = info.origin ? info.origin[1] - (current.cy * info.cellSize[1]) : 0;
    return (info.cellSize[0] * 111_320 * Math.cos((lat * Math.PI) / 180)) / current.scale;
  })();
  const bar = (() => {
    if (!metresPerScreenPx || !Number.isFinite(metresPerScreenPx) || metresPerScreenPx <= 0) return null;
    const metres = niceFloor(metresPerScreenPx * 110);
    return { px: metres / metresPerScreenPx, label: distanceLabel(metres, units) };
  })();

  const min = info?.min ?? range?.min, max = info?.max ?? range?.max;
  const hist = info?.histogram ?? [];
  const tallest = Math.max(1, ...hist);
  const markAt = probe?.value != null && min !== undefined && max !== undefined && max > min ? clamp(((probe.value - min) / (max - min)) * 100, 0, 100) : null;
  const coordinate = (v: number, degrees: boolean) => (degrees ? `${v.toFixed(5)}°` : v.toLocaleString("en-US", { maximumFractionDigits: 1, minimumFractionDigits: 1 }));

  const frame = { aspectRatio: String(aspect), width: `min(100%, calc(72vh * ${aspect}))` };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
      <div className="flex min-w-0 flex-col gap-2">
        <div
          ref={box}
          role="application"
          aria-label={`${alt}. Drag to pan, scroll to zoom, arrow keys to move, plus and minus to zoom.`}
          tabIndex={0}
          className={`relative mx-auto touch-none select-none overflow-hidden border border-border bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring ${info ? "cursor-crosshair active:cursor-grabbing" : ""}`}
          style={frame}
          onPointerDown={(e) => {
            if (!current) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, rel(e.clientX, e.clientY));
            if (pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              pinch.current = { view: current, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
              drag.current = null;
            } else {
              drag.current = { x: e.clientX, y: e.clientY, view: current };
              setHover(toImage(e.clientX, e.clientY, current));
            }
          }}
          onPointerMove={(e) => {
            if (!current) return;
            if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, rel(e.clientX, e.clientY));
            if (pinch.current && pointers.current.size === 2) {
              const [a, b] = [...pointers.current.values()];
              const g = pinch.current;
              const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
              const scale = clamp(g.view.scale * (Math.hypot(a.x - b.x, a.y - b.y) / g.dist), fit, Math.max(MAX_SCALE, fit));
              const ix = g.view.cx + (g.mid.x - size.w / 2) / g.view.scale, iy = g.view.cy + (g.mid.y - size.h / 2) / g.view.scale;
              setView(place({ scale, cx: ix - (mid.x - size.w / 2) / scale, cy: iy - (mid.y - size.h / 2) / scale }));
              return;
            }
            const d = drag.current;
            if (d) {
              const moved = place({ scale: d.view.scale, cx: d.view.cx - (e.clientX - d.x) / d.view.scale, cy: d.view.cy - (e.clientY - d.y) / d.view.scale });
              setView(moved);
              setHover(toImage(e.clientX, e.clientY, moved));
            } else setHover(toImage(e.clientX, e.clientY, current));
          }}
          onPointerUp={(e) => {
            pointers.current.delete(e.pointerId);
            pinch.current = null;
            drag.current = null;
            const left = [...pointers.current.entries()][0];
            if (left && current) drag.current = { x: e.clientX, y: e.clientY, view: current };
          }}
          onPointerCancel={(e) => {
            pointers.current.delete(e.pointerId);
            pinch.current = null;
            drag.current = null;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") setHover(null);
          }}
          onDoubleClick={(e) => {
            const p = rel(e.clientX, e.clientY);
            zoomAt(2, p.x, p.y);
          }}
          onKeyDown={(e) => {
            if (!current) return;
            const step = 60 / current.scale;
            if (e.key === "+" || e.key === "=") zoomAt(1.5, size.w / 2, size.h / 2);
            else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.5, size.w / 2, size.h / 2);
            else if (e.key === "0") setView(null);
            else if (e.key === "ArrowLeft") setView(place({ ...current, cx: current.cx - step }));
            else if (e.key === "ArrowRight") setView(place({ ...current, cx: current.cx + step }));
            else if (e.key === "ArrowUp") setView(place({ ...current, cy: current.cy - step }));
            else if (e.key === "ArrowDown") setView(place({ ...current, cy: current.cy + step }));
            else return;
            e.preventDefault();
          }}
        >
          {/* The drawn preview, spread over the whole image: what shows first, at the file's own detail up to 1024 pixels, and where no tile can be drawn. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- drawn by the API */}
          <img
            src={base}
            alt={alt}
            draggable={false}
            className="pointer-events-none absolute max-w-none"
            style={
              info && current
                ? { left: (0 - current.cx) * current.scale + size.w / 2, top: (0 - current.cy) * current.scale + size.h / 2, width: info.width * current.scale, height: info.height * current.scale, imageRendering: crisp ? "pixelated" : "auto" }
                : { left: 0, top: 0, width: "100%", height: "100%" }
            }
          />
          {tiles.map((t) =>
            failed.has(t.key) ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- tiles are drawn by the API
              <img
                key={t.key}
                src={tileUrl(owner, repo, reference, path, t.z, t.x, t.y)}
                alt=""
                draggable={false}
                onError={() => setFailed((s) => new Set(s).add(t.key))}
                className="pointer-events-none absolute max-w-none"
                // A hair of overlap hides the seam that rounding would otherwise show between neighbours.
                style={{ left: t.left, top: t.top, width: t.w + 0.5, height: t.h + 0.5, imageRendering: crisp ? "pixelated" : "auto" }}
              />
            ),
          )}
          {/* The pixel under the cursor, outlined, once it is big enough to see. */}
          {info && current && hover && current.scale >= 4 && hover.x >= 0 && hover.y >= 0 && hover.x < info.width && hover.y < info.height && (
            <span
              aria-hidden
              className="pointer-events-none absolute border border-foreground/80"
              style={{ left: (Math.floor(hover.x) - current.cx) * current.scale + size.w / 2, top: (Math.floor(hover.y) - current.cy) * current.scale + size.h / 2, width: current.scale, height: current.scale }}
            />
          )}
          {info && (
            <div className="absolute right-2 top-2 flex flex-col gap-1">
              <Button type="button" size="icon" variant="secondary" aria-label="Zoom in" onClick={() => zoomAt(1.5, size.w / 2, size.h / 2)}>
                <Plus className="size-4" aria-hidden />
              </Button>
              <Button type="button" size="icon" variant="secondary" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5, size.w / 2, size.h / 2)}>
                <Minus className="size-4" aria-hidden />
              </Button>
              <Button type="button" size="icon" variant="secondary" aria-label="Fit the whole raster" onClick={() => setView(null)}>
                <Maximize2 className="size-4" aria-hidden />
              </Button>
            </div>
          )}
          {bar && (
            <div className="pointer-events-none absolute bottom-2 left-2 flex flex-col gap-0.5 text-[11px] font-medium text-foreground [text-shadow:0_0_3px_var(--background),0_0_3px_var(--background)]" aria-hidden>
              <span className="tabular-nums">{bar.label}</span>
              <span className="block h-1.5 border border-t-0 border-foreground" style={{ width: bar.px }} />
            </div>
          )}
        </div>
        <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <ScanSearch className="size-3.5" aria-hidden />
          {problem ? <span className="text-pretty">{problem} The picture above is the drawn preview.</span> : <span>Drag to pan · scroll or +/− to zoom · double-click to zoom in · 0 to fit</span>}
        </p>
      </div>

      <aside className="flex flex-col gap-4 text-xs" aria-label="Raster inspector">
        <section className="flex flex-col gap-2">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Elevation</h3>
          {min !== undefined && max !== undefined ? (
            <>
              <div className="relative">
                <div className="flex h-10 items-end gap-px" aria-hidden>
                  {hist.length > 0 ? (
                    hist.map((n, i) => <span key={i} className="flex-1 bg-foreground/35" style={{ height: `${Math.max(n > 0 ? 6 : 0, (n / tallest) * 100)}%` }} />)
                  ) : (
                    <span className="h-full flex-1" />
                  )}
                </div>
                <div className="h-2.5 border border-border" style={{ background: terrainGradient }} aria-hidden />
                {markAt !== null && <span aria-hidden className="pointer-events-none absolute -top-0.5 bottom-0 w-px bg-foreground" style={{ left: `${markAt}%` }} />}
              </div>
              <div className="flex justify-between tabular-nums text-muted-foreground">
                <span>{formatLength(min, units, { digits: 1 })}</span>
                <span>{formatLength(max, units, { digits: 1 })}</span>
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </section>

        <section className="flex flex-col gap-1.5" aria-live="polite">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Under the cursor</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="text-muted-foreground">Value</dt>
            <dd className="text-right font-mono tabular-nums">{hover && probe ? (probe.value === null ? "no data" : formatLength(probe.value, units, { digits: 2 })) : "—"}</dd>
            <dt className="text-muted-foreground">Pixel</dt>
            <dd className="text-right font-mono tabular-nums">{hover && info && hover.x >= 0 && hover.y >= 0 && hover.x < info.width && hover.y < info.height ? `${Math.floor(hover.x).toLocaleString("en-US")}, ${Math.floor(hover.y).toLocaleString("en-US")}` : "—"}</dd>
            <dt className="text-muted-foreground">{info?.geographic ? "Longitude" : "Easting"}</dt>
            <dd className="text-right font-mono tabular-nums">{hover && probe && probe.x !== null ? coordinate(probe.x, info?.geographic ?? false) : "—"}</dd>
            <dt className="text-muted-foreground">{info?.geographic ? "Latitude" : "Northing"}</dt>
            <dd className="text-right font-mono tabular-nums">{hover && probe && probe.y !== null ? coordinate(probe.y, info?.geographic ?? false) : "—"}</dd>
          </dl>
        </section>

        <section className="flex flex-col gap-1.5">
          <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">View</h3>
          {info && current ? (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Image</dt>
              <dd className="text-right font-mono tabular-nums">{info.width.toLocaleString("en-US")} × {info.height.toLocaleString("en-US")}</dd>
              <dt className="text-muted-foreground">Zoom</dt>
              <dd className="text-right font-mono tabular-nums">{current.scale >= 1 ? `${Math.round(current.scale * 10) / 10}×` : `1 : ${Math.round((1 / current.scale) * 10) / 10}`}</dd>
              {!info.geographic && (
                <>
                  <dt className="text-muted-foreground">Cell</dt>
                  <dd className="text-right font-mono tabular-nums">{Math.round(info.cellSize[0] * 100) / 100} m</dd>
                </>
              )}
            </dl>
          ) : (
            <span className="text-muted-foreground">{problem ? "Not zoomable" : "Reading the file’s layout…"}</span>
          )}
        </section>
      </aside>
    </div>
  );
}
