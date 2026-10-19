// A map preview rendered from the file's real bytes by the Craton API (see the render route):
// hillshade for rasters, geometry for shapefiles, and with `base` the change from that version.
// Pages fetch the preview's numbers first (renderMeta), so a file without a preview gets a clear
// empty state instead of a broken image.

import { ImageOff } from "lucide-react";
import type { ApiRasterStats, ApiTextDiff, RenderMeta } from "@/lib/api";
import { cn } from "@/lib/utils";
import { RasterStats } from "@/components/raster-stats";
import { Length, PreviewCaption } from "@/components/units";
import { TextDiffView } from "@/components/text-diff";
import { formatLength, type UnitSystem } from "@/lib/units";

export function previewSrc(owner: string, repo: string, ref: string, path: string, opts: { base?: string; size?: number } = {}) {
  const q = new URLSearchParams({ ref });
  if (opts.base) q.set("base", opts.base);
  if (opts.size) q.set("size", String(opts.size));
  return `/${owner}/${repo}/render/${path.split("/").map(encodeURIComponent).join("/")}?${q}`;
}

type Props = {
  src: string;
  alt: string;
  error?: string | null;
  className?: string;
  /** Width over height of the picture: the frame takes its shape, so there are no empty bands beside it. */
  aspect?: number;
};

/** The frame of a picture of known shape: as wide as the space allows without running taller than most of a screen. */
export const frameStyle = (aspect: number) => ({ aspectRatio: String(aspect), width: `min(100%, calc(72vh * ${aspect}))` });

export function DataPreview({ src, alt, error, className, aspect }: Props) {
  if (error) {
    return (
      <div className={cn("flex flex-col items-center justify-center gap-2 border border-border bg-muted/30 p-6 text-center text-xs text-muted-foreground", className)}>
        <ImageOff className="size-5" aria-hidden />
        <span>No preview for this file</span>
        <span className="max-w-xs text-muted-foreground/80">{error}</span>
      </div>
    );
  }
  return (
    <div className={cn("relative overflow-hidden border border-border bg-muted/30", aspect && "mx-auto", className)} style={aspect ? frameStyle(aspect) : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element -- rendered per blob by the API, already sized */}
      <img src={src} alt={alt} loading="lazy" decoding="async" className="size-full object-contain" />
    </div>
  );
}

/** The colour ramp the previews are painted with, over the range of elevations they span. */
export function ElevationLegend({ min, max, units }: { min: number; max: number; units: UnitSystem }) {
  return (
    <div className="flex items-center gap-3 text-xs text-muted-foreground tabular-nums">
      <span>{formatLength(min, units, { digits: 1 })}</span>
      <span className="h-2.5 w-40 border border-border" style={{ background: "linear-gradient(to right, rgb(22 34 58), rgb(196 212 236))" }} aria-hidden />
      <span>{formatLength(max, units, { digits: 1 })}</span>
    </div>
  );
}

/** Legend and numbers under a diff preview. Rasters show raised/lowered; vectors show feature counts. */
export function PreviewDiffLegend({ meta }: { meta: RenderMeta | null }) {
  if (!meta) return null;
  const swatch = (color: string, label: string) => (
    <span className="flex items-center gap-1.5">
      <span className="size-3" style={{ background: color }} aria-hidden /> {label}
    </span>
  );
  if (meta.diff) {
    const d = meta.diff;
    return (
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {swatch("var(--chart-2)", `${d.added} added`)}
        {swatch("var(--chart-1)", `${d.changed} changed`)}
        {swatch("var(--destructive)", `${d.removed} removed`)}
        <span>{d.same} unchanged</span>
      </div>
    );
  }
  if (meta.changedPercent !== undefined) {
    if (meta.changedPercent === 0) return <p className="text-xs text-muted-foreground">No elevation change between these versions.</p>;
    const lo = meta.minChange ?? 0, hi = meta.maxChange ?? 0;
    // One digit past the decimal point for big changes, two for small ones, as before.
    const digits = (n: number) => (Math.abs(n) < 10 ? 2 : 1);
    const range = meta.minChange === meta.maxChange || Math.abs(lo - hi) < 0.005 ? (
      <Length metres={hi} digits={digits(hi)} signed />
    ) : (
      <>
        <Length metres={lo} digits={digits(lo)} signed /> to <Length metres={hi} digits={digits(hi)} signed />
      </>
    );
    return (
      <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {swatch("var(--chart-2)", "Raised")}
        {swatch("var(--destructive)", "Lowered")}
        <span className="tabular-nums">
          {meta.changedPercent}% of cells changed · {range}
        </span>
      </div>
    );
  }
  return null;
}

/** "3.2 m – 842.6 m · 724 × 724 px" for a raster, "9 features" for a vector. */
export function previewCaption(meta: RenderMeta | null, units: UnitSystem = "metric") {
  if (!meta) return null;
  if (meta.features !== undefined) return `${meta.features} feature${meta.features === 1 ? "" : "s"}`;
  if (meta.points !== undefined) {
    const read = meta.sampledShare !== undefined && meta.sampledShare < 1 ? ` · drawn from ${Math.round(meta.sampledShare * 100)}% of the file` : "";
    const z = meta.min !== undefined && meta.max !== undefined ? ` · elevation ${Number(meta.min.toFixed(2)).toLocaleString("en-US")} to ${Number(meta.max.toFixed(2)).toLocaleString("en-US")}` : "";
    return `${meta.points.toLocaleString("en-US")} points${z}${read}`;
  }
  if (meta.min !== undefined && meta.max !== undefined) return `${formatLength(meta.min, units, { digits: 1 })} – ${formatLength(meta.max, units, { digits: 1 })} · ${meta.sourceWidth} × ${meta.sourceHeight} px`;
  return null;
}

/** A changed file's preview: the change from the base version, or the file itself when it's new. */
export function ChangePreview({ preview, className }: { preview: { path: string; src: string; meta: RenderMeta | null; error: string | null; isDiff: boolean; stats?: ApiRasterStats | null; text?: ApiTextDiff | null }; className?: string }) {
  const name = preview.path.split("/").pop();
  if (preview.text) return <TextDiffView diff={preview.text} />;
  return (
    <figure className="flex flex-col gap-2">
      <DataPreview src={preview.src} alt={preview.isDiff ? `Change in ${name}` : `Preview of ${name}`} error={preview.error} className={cn("aspect-video max-h-96 w-full", className)} />
      {!preview.error && (
        <figcaption>
          {preview.isDiff ? <PreviewDiffLegend meta={preview.meta} /> : <span className="text-xs text-muted-foreground"><PreviewCaption meta={preview.meta} fallback="New file" /></span>}
        </figcaption>
      )}
      {preview.stats && <RasterStats stats={preview.stats} />}
    </figure>
  );
}
