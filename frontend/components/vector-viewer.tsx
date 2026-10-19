"use client";

// The viewer for a shapefile: the geometry drawn on a pan-and-zoom canvas, and the attribute table beside it. Pointing at a feature (or a row)
// lights up the other; clicking selects it, and its attributes are listed. The drawn SVG underneath is what shows until the features arrive.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Maximize2, Minus, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ApiVectorFeatures } from "@/lib/api";
import { cn } from "@/lib/utils";

type Props = {
  /** Where the features come from: the API (owner, repo, reference and path), or already in hand (`source`). */
  owner?: string;
  repo?: string;
  reference?: string;
  path?: string;
  source?: ApiVectorFeatures;
  /** The drawn SVG, shown until the features are loaded. */
  base?: string;
  alt: string;
  geometry: string;
  epsg: number | null;
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
type View = { scale: number; cx: number; cy: number }; // screen px per data unit (before the x stretch), and the data point at the centre

const shown = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 6 }) : String(v));

export function VectorViewer({ owner, repo, reference, path, source, base, alt, geometry, epsg }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<ApiVectorFeatures | null>(source ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View | null>(null);
  const [hot, setHot] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<{ field: string; down: boolean } | null>(null);
  const [rowsShown, setRowsShown] = useState(25);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ view: View; dist: number } | null>(null);

  useEffect(() => {
    if (source || owner === undefined || repo === undefined || reference === undefined || path === undefined) return;
    let live = true;
    fetch(`/${owner}/${repo}/features?${new URLSearchParams({ ref: reference, path })}`)
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!live) return;
        if (!r.ok) return void setProblem(body?.error?.message ?? "This shapefile can't be shown interactively.");
        setData(body as ApiVectorFeatures);
      })
      .catch(() => live && setProblem("The viewer couldn't reach the server."));
    return () => {
      live = false;
    };
  }, [owner, repo, reference, path, source]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const geographic = epsg !== null && epsg >= 4000 && epsg < 5000;
  const [minX, minY, maxX, maxY] = data?.bbox ?? [0, 0, 1, 1];
  // Degrees of longitude are shorter than degrees of latitude away from the equator; stretch x so the shapes are not squashed.
  const kx = geographic ? Math.cos((((minY + maxY) / 2) * Math.PI) / 180) : 1;
  const spanX = Math.max(maxX - minX, 1e-9) * kx, spanY = Math.max(maxY - minY, 1e-9);
  const fit = size.w ? Math.min((size.w * 0.92) / spanX, (size.h * 0.92) / spanY) : 1;
  const current = useMemo<View | null>(() => (data && size.w ? (view ?? { scale: fit, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }) : null), [data, size, view, fit, minX, maxX, minY, maxY]);

  const place = useCallback((v: View): View => ({ scale: clamp(v.scale, fit * 0.5, fit * 4000), cx: clamp(v.cx, minX - (maxX - minX), maxX + (maxX - minX)), cy: clamp(v.cy, minY - (maxY - minY), maxY + (maxY - minY)) }), [fit, minX, maxX, minY, maxY]);

  const zoomAt = useCallback(
    (factor: number, px: number, py: number) => {
      if (!current) return;
      const scale = clamp(current.scale * factor, fit * 0.5, fit * 4000);
      const ix = current.cx + (px - size.w / 2) / (current.scale * kx), iy = current.cy - (py - size.h / 2) / current.scale;
      setView(place({ scale, cx: ix - (px - size.w / 2) / (scale * kx), cy: iy + (py - size.h / 2) / scale }));
    },
    [current, fit, size, kx, place],
  );

  useEffect(() => {
    const el = box.current;
    if (!el || !data) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [data, zoomAt]);

  const zoomTo = useCallback(
    (i: number) => {
      const f = data?.features[i];
      if (!f || !size.w) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const part of f.parts) for (let k = 0; k < part.length; k += 2) (x0 = Math.min(x0, part[k])), (x1 = Math.max(x1, part[k])), (y0 = Math.min(y0, part[k + 1])), (y1 = Math.max(y1, part[k + 1]));
      const w = Math.max((x1 - x0) * kx, 1e-9), h = Math.max(y1 - y0, 1e-9);
      const scale = f.kind === "point" ? fit * 40 : Math.min((size.w * 0.6) / w, (size.h * 0.6) / h);
      setView(place({ scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }));
    },
    [data, size, kx, fit, place],
  );

  const paths = useMemo(
    () =>
      (data?.features ?? []).map((f) => {
        let d = "";
        for (const part of f.parts) {
          if (!part.length) continue;
          if (f.kind === "point") d += `M${part[0]} ${part[1]}h0`;
          else {
            d += `M${part[0]} ${part[1]}`;
            for (let k = 2; k < part.length; k += 2) d += `L${part[k]} ${part[k + 1]}`;
            if (f.kind === "polygon") d += "Z";
          }
        }
        return d;
      }),
    [data],
  );

  const fields = useMemo(() => (data?.fields ?? []).map((f) => f.name), [data]);
  const rows = useMemo(() => {
    if (!data) return [];
    const q = filter.trim().toLowerCase();
    let list = data.features.map((_, n) => n);
    if (q) list = list.filter((idx) => fields.some((n) => shown(data.features[idx].props[n]).toLowerCase().includes(q)));
    if (sort) {
      const dir = sort.down ? -1 : 1;
      list = [...list].sort((a, b) => {
        const x = data.features[a].props[sort.field], y = data.features[b].props[sort.field];
        if (x === y) return 0;
        if (x === null || x === undefined) return 1;
        if (y === null || y === undefined) return -1;
        return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir;
      });
    }
    return list;
  }, [data, filter, sort, fields]);

  const rel = (e: { clientX: number; clientY: number }) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const stroke = current ? 1.4 : 1;
  const selected = picked !== null && data ? data.features[picked] : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_220px]">
        <div className="flex min-w-0 flex-col gap-2">
          <div
            ref={box}
            role="application"
            aria-label={`${alt}. Drag to pan, scroll to zoom, arrow keys to move, plus and minus to zoom.`}
            tabIndex={0}
            className={cn("relative aspect-16/10 w-full touch-none select-none overflow-hidden border border-border bg-muted/30 outline-none focus-visible:ring-2 focus-visible:ring-ring", data && "cursor-grab active:cursor-grabbing")}
            onPointerDown={(e) => {
              if (!current) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              pointers.current.set(e.pointerId, rel(e));
              if (pointers.current.size === 2) {
                const [a, b] = [...pointers.current.values()];
                pinch.current = { view: current, dist: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
                drag.current = null;
              } else drag.current = { x: e.clientX, y: e.clientY, view: current, moved: false };
            }}
            onPointerMove={(e) => {
              if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, rel(e));
              if (pinch.current && pointers.current.size === 2) {
                const [a, b] = [...pointers.current.values()];
                setView(place({ ...pinch.current.view, scale: pinch.current.view.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist) }));
                return;
              }
              const d = drag.current;
              if (!d) return;
              const dx = e.clientX - d.x, dy = e.clientY - d.y;
              if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
              if (d.moved) setView(place({ scale: d.view.scale, cx: d.view.cx - dx / (d.view.scale * kx), cy: d.view.cy + dy / d.view.scale }));
            }}
            onPointerUp={(e) => {
              pointers.current.delete(e.pointerId);
              pinch.current = null;
              // A press that did not move is a click: it selects the feature under it, or clears the selection on empty canvas. (The pointer is
              // captured by the canvas, so the click never reaches a feature itself.)
              if (drag.current && !drag.current.moved) {
                const hit = document.elementsFromPoint(e.clientX, e.clientY).find((el) => el instanceof SVGPathElement && el.dataset.feature !== undefined) as SVGPathElement | undefined;
                setPicked(hit ? Number(hit.dataset.feature) : null);
              }
              drag.current = null;
            }}
            onPointerCancel={(e) => {
              pointers.current.delete(e.pointerId);
              pinch.current = null;
              drag.current = null;
            }}
            onDoubleClick={(e) => {
              const p = rel(e);
              zoomAt(2, p.x, p.y);
            }}
            onKeyDown={(e) => {
              if (!current) return;
              const step = 60 / (current.scale * kx);
              if (e.key === "+" || e.key === "=") zoomAt(1.5, size.w / 2, size.h / 2);
              else if (e.key === "-" || e.key === "_") zoomAt(1 / 1.5, size.w / 2, size.h / 2);
              else if (e.key === "0") setView(null);
              else if (e.key === "ArrowLeft") setView(place({ ...current, cx: current.cx - step }));
              else if (e.key === "ArrowRight") setView(place({ ...current, cx: current.cx + step }));
              else if (e.key === "ArrowUp") setView(place({ ...current, cy: current.cy + step }));
              else if (e.key === "ArrowDown") setView(place({ ...current, cy: current.cy - step }));
              else if (e.key === "Escape") setPicked(null);
              else return;
              e.preventDefault();
            }}
          >
            {data && current ? (
              <svg width={size.w} height={size.h} className="absolute inset-0" role="img" aria-label={alt}>
                <g transform={`translate(${size.w / 2} ${size.h / 2}) scale(${current.scale * kx} ${-current.scale}) translate(${-current.cx} ${-current.cy})`}>
                  {data.features.map((f, n) => {
                    const on = picked === f.i, lit = hot === f.i;
                    const isPoint = f.kind === "point";
                    return (
                      <path
                        key={f.i}
                        d={paths[n]}
                        data-feature={f.i}
                        vectorEffect="non-scaling-stroke"
                        strokeLinejoin="round"
                        strokeLinecap="round"
                        fillRule="evenodd"
                        fill={f.kind === "polygon" ? (on ? "color-mix(in oklab, var(--chart-2) 45%, transparent)" : lit ? "color-mix(in oklab, var(--chart-2) 32%, transparent)" : "color-mix(in oklab, var(--chart-2) 18%, transparent)") : "none"}
                        stroke={on ? "var(--foreground)" : isPoint ? "var(--chart-2)" : lit ? "var(--foreground)" : "var(--chart-2)"}
                        strokeWidth={isPoint ? (on || lit ? 11 : 8) : on ? stroke + 1.4 : lit ? stroke + 0.8 : stroke}
                        className="cursor-pointer"
                        onPointerEnter={() => setHot(f.i)}
                        onPointerLeave={() => setHot((h) => (h === f.i ? null : h))}
                      />
                    );
                  })}
                </g>
              </svg>
            ) : (
              base ? (
                // eslint-disable-next-line @next/next/no-img-element -- drawn by the API
                <img src={base} alt={alt} draggable={false} className="size-full object-contain" />
              ) : null
            )}
            {data && (
              <div className="absolute right-2 top-2 flex flex-col gap-1">
                <Button type="button" size="icon" variant="secondary" aria-label="Zoom in" onClick={() => zoomAt(1.5, size.w / 2, size.h / 2)}>
                  <Plus className="size-4" aria-hidden />
                </Button>
                <Button type="button" size="icon" variant="secondary" aria-label="Zoom out" onClick={() => zoomAt(1 / 1.5, size.w / 2, size.h / 2)}>
                  <Minus className="size-4" aria-hidden />
                </Button>
                <Button type="button" size="icon" variant="secondary" aria-label="Fit all features" onClick={() => setView(null)}>
                  <Maximize2 className="size-4" aria-hidden />
                </Button>
              </div>
            )}
          </div>
          <p className="text-xs text-muted-foreground text-pretty">
            {problem ? `${problem} The picture above is the drawn geometry.` : data ? "Drag to pan · scroll or +/− to zoom · click a feature to select it · 0 to fit" : "Loading the features…"}
          </p>
        </div>

        <aside className="flex flex-col gap-4 text-xs" aria-label="Vector inspector">
          <section className="flex flex-col gap-1.5">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Layer</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Geometry</dt>
              <dd className="text-right font-mono">{geometry}</dd>
              <dt className="text-muted-foreground">Features</dt>
              <dd className="text-right font-mono tabular-nums">{data ? data.count.toLocaleString("en-US") : "—"}</dd>
              <dt className="text-muted-foreground">Fields</dt>
              <dd className="text-right font-mono tabular-nums">{data ? fields.length : "—"}</dd>
              <dt className="text-muted-foreground">CRS</dt>
              <dd className="text-right font-mono">{epsg ? `EPSG:${epsg}` : "not set"}</dd>
            </dl>
            {data && data.shown < data.count && <p className="text-muted-foreground text-pretty">Showing the first {data.shown.toLocaleString("en-US")} features.</p>}
            {data?.thinned && <p className="text-muted-foreground text-pretty">Long outlines are drawn with fewer points; the file keeps every one.</p>}
          </section>
          <section className="flex flex-col gap-1.5" aria-live="polite">
            <h3 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{selected ? `Feature ${selected.i + 1}` : "Selected feature"}</h3>
            {selected ? (
              fields.length ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  {fields.map((n) => (
                    <div key={n} className="contents">
                      <dt className="max-w-24 truncate text-muted-foreground" title={n}>{n}</dt>
                      <dd className="break-words text-right font-mono tabular-nums">{shown(selected.props[n]) || "—"}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <span className="text-muted-foreground">This file has no attribute table.</span>
              )
            ) : (
              <span className="text-muted-foreground">Click a feature, or a row below.</span>
            )}
            {selected && (
              <div>
                <Button type="button" size="sm" variant="outline" onClick={() => zoomTo(data!.features.indexOf(selected))}>
                  Zoom to feature
                </Button>
              </div>
            )}
          </section>
        </aside>
      </div>

      {data && fields.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Attribute table</h3>
            <label className="relative">
              <span className="sr-only">Filter the rows</span>
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={filter} onChange={(e) => (setFilter(e.target.value), setRowsShown(25))} placeholder="Filter rows" className="h-8 w-48 pl-7 text-xs" />
            </label>
          </div>
          <div className="max-h-96 overflow-auto border border-border" tabIndex={0} role="region" aria-label="Attribute table">
            <table className="w-full text-left font-mono text-xs">
              <thead className="sticky top-0 border-b border-border bg-card text-muted-foreground">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2 font-medium">#</th>
                  {fields.map((n) => {
                    const on = sort?.field === n;
                    return (
                      <th key={n} scope="col" aria-sort={on ? (sort!.down ? "descending" : "ascending") : "none"} className="px-3 py-2 font-medium">
                        <button type="button" className="flex items-center gap-1 hover:text-foreground" onClick={() => setSort(on && sort!.down ? null : { field: n, down: on })}>
                          {n}
                          {on && (sort!.down ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, rowsShown).map((idx) => {
                  const f = data.features[idx];
                  return (
                    <tr
                      key={f.i}
                      className={cn("cursor-pointer", picked === f.i ? "bg-primary/15" : hot === f.i ? "bg-muted/60" : "hover:bg-muted/40")}
                      onPointerEnter={() => setHot(f.i)}
                      onPointerLeave={() => setHot((h) => (h === f.i ? null : h))}
                      onClick={() => setPicked(f.i)}
                      onDoubleClick={() => zoomTo(idx)}
                      aria-selected={picked === f.i}
                    >
                      <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{f.i + 1}</td>
                      {fields.map((n) => (
                        <td key={n} className={cn("px-3 py-1.5", typeof f.props[n] === "number" && "text-right tabular-nums")}>
                          {shown(f.props[n])}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {Math.min(rowsShown, rows.length).toLocaleString("en-US")} of {rows.length.toLocaleString("en-US")} {filter ? "matching " : ""}rows
            </span>
            {rows.length > rowsShown && (
              <Button type="button" size="sm" variant="outline" onClick={() => setRowsShown((n) => n + 100)}>
                Show more rows
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
