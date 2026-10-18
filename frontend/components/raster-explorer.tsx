"use client";

// Zoom and pan a GeoTIFF at its real resolution. The API draws 256-pixel tiles in the image's own pixel space (zoom 0 is the
// whole image, the deepest zoom is one tile pixel per image pixel); this places the ones in view, and keeps the small preview
// underneath so something is always showing while tiles arrive, or where a file without overviews cannot give a tile.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApiTileInfo } from "@/lib/api";

type Props = { owner: string; repo: string; reference: string; path: string; base: string; alt: string };

const MAX_SCALE = 8; // screen pixels per image pixel at most
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const tileUrl = (owner: string, repo: string, ref: string, path: string, z: number, x: number, y: number) =>
  `/${owner}/${repo}/tile/${z}/${x}/${y}?${new URLSearchParams({ ref, path })}`;

type View = { scale: number; cx: number; cy: number }; // screen px per image px, and the image point at the centre

export function RasterExplorer({ owner, repo, reference, path, base, alt }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<ApiTileInfo | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

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

  const fit = useMemo(() => (info && size.w ? Math.min(size.w / info.width, size.h / info.height) : 1), [info, size]);
  const current = useMemo<View | null>(() => (info && size.w ? (view ?? { scale: fit, cx: info.width / 2, cy: info.height / 2 }) : null), [info, size, view, fit]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      if (!info || !current) return;
      const scale = clamp(current.scale * factor, fit * 0.5, Math.max(MAX_SCALE, fit));
      // Keep the image point under (px, py) where it is.
      const ix = current.cx + (px - size.w / 2) / current.scale;
      const iy = current.cy + (py - size.h / 2) / current.scale;
      setView({ scale, cx: ix - (px - size.w / 2) / scale, cy: iy - (py - size.h / 2) / scale });
    },
    [info, current, fit, size],
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

  if (problem) return <p className="border border-border bg-muted/30 p-4 text-xs text-muted-foreground text-pretty">{problem}</p>;

  const toImage = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return { x: current!.cx + (clientX - r.left - size.w / 2) / current!.scale, y: current!.cy + (clientY - r.top - size.h / 2) / current!.scale };
  };

  // Which zoom level has about one tile pixel per screen pixel, and which of its tiles are in view.
  const tiles: { key: string; z: number; x: number; y: number; left: number; top: number; w: number; h: number }[] = [];
  if (info && current) {
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
  const metres = info && !info.geographic && current ? info.cellSize[0] : null;

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={box}
        role="application"
        aria-label={`${alt}. Drag to pan, scroll to zoom, arrow keys to move, plus and minus to zoom.`}
        tabIndex={0}
        className="relative aspect-16/10 w-full touch-none select-none overflow-hidden border border-border bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        style={{ cursor: drag.current ? "grabbing" : "grab" }}
        onPointerDown={(e) => {
          if (!current) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view: current };
        }}
        onPointerMove={(e) => {
          if (!current) return;
          setHover(toImage(e.clientX, e.clientY));
          const d = drag.current;
          if (d) setView({ scale: d.view.scale, cx: d.view.cx - (e.clientX - d.x) / d.view.scale, cy: d.view.cy - (e.clientY - d.y) / d.view.scale });
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          zoomAt(2, e.clientX - r.left, e.clientY - r.top);
        }}
        onKeyDown={(e) => {
          if (!current) return;
          const step = 60 / current.scale;
          if (e.key === "+" || e.key === "=") zoomAt(1.5, size.w / 2, size.h / 2);
          else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.5, size.w / 2, size.h / 2);
          else if (e.key === "0") setView(null);
          else if (e.key === "ArrowLeft") setView({ ...current, cx: current.cx - step });
          else if (e.key === "ArrowRight") setView({ ...current, cx: current.cx + step });
          else if (e.key === "ArrowUp") setView({ ...current, cy: current.cy - step });
          else if (e.key === "ArrowDown") setView({ ...current, cy: current.cy + step });
          else return;
          e.preventDefault();
        }}
      >
        {info && current ? (
          <>
            {/* The small preview, spread over the whole image, is what shows before a tile arrives. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- drawn by the API */}
            <img
              src={base}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{ left: (0 - current.cx) * current.scale + size.w / 2, top: (0 - current.cy) * current.scale + size.h / 2, width: info.width * current.scale, height: info.height * current.scale, imageRendering: crisp ? "pixelated" : "auto" }}
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
          </>
        ) : (
          <div className="absolute inset-0 grid place-items-center text-xs text-muted-foreground">Loading…</div>
        )}
      </div>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <ScanSearch className="size-3.5" aria-hidden />
        {info && current ? (
          <>
            <span>{info.width.toLocaleString("en-US")} × {info.height.toLocaleString("en-US")} px</span>
            <span>{current.scale >= 1 ? `${Math.round(current.scale * 10) / 10} screen px per pixel` : `1 screen px = ${Math.round((1 / current.scale) * 10) / 10} pixels`}</span>
            {metres && <span>{Math.round(metres * 100) / 100} m per pixel</span>}
            {hover && hover.x >= 0 && hover.y >= 0 && hover.x < info.width && hover.y < info.height && <span>column {Math.floor(hover.x)}, row {Math.floor(hover.y)}</span>}
            <span className="ml-auto">Drag to pan · scroll or +/− to zoom · 0 to fit</span>
          </>
        ) : (
          <span>Reading the file’s layout…</span>
        )}
      </p>
    </div>
  );
}

/** The static preview's companion: a button that opens the viewer underneath it. */
export function RasterExplorerToggle(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 flex flex-col gap-3">
      <div>
        <Button type="button" size="sm" variant={open ? "default" : "outline"} onClick={() => setOpen(!open)} aria-expanded={open}>
          <ScanSearch className="size-4" aria-hidden /> {open ? "Close the zoomable view" : "Zoom and pan at full resolution"}
        </Button>
      </div>
      {open && <RasterExplorer {...props} />}
    </div>
  );
}
