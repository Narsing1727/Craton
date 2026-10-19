import * as React from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Download, History, Pencil, Ruler, ShieldCheck } from "lucide-react";
import { CliDialog, CommandLine, CopyButton, DownloadButton, DownloadLink } from "@/components/craton-actions";
import { Initials } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator } from "@/components/ui/breadcrumb";
import { MapPreview } from "@/components/map-preview";
import { DataTypeBadge } from "@/components/data-type-badge";
import { api, renderMeta, type ApiFile } from "@/lib/api";
import { FileLockControl } from "@/components/file-lock";
import { LockBadge } from "@/components/lock-badge";
import { RestoreButton } from "@/components/restore-button";
import { TableDiffView } from "@/components/table-diff";
import { parseCsv, sniffDelimiter } from "@/lib/csv";
import { describeBBox, isBBox, osmLink } from "@/lib/geo";
import { DataPreview, ElevationLegend, PreviewDiffLegend, frameStyle, previewCaption, previewSrc } from "@/components/data-preview";
import { FileText } from "@/components/file-text";
import { ImageViewer } from "@/components/image-viewer";
import { StructureViewer } from "@/components/structure-viewer";
import { TableViewer } from "@/components/table-viewer";
import { RasterViewer } from "@/components/raster-viewer";
import { VectorViewer } from "@/components/vector-viewer";
import { getUnits } from "@/lib/units-server";
import { EmbedDialog } from "@/components/embed-dialog";
import { DataDictionary } from "@/components/data-dictionary";
import { FitCard } from "@/components/fit-card";
import { BlameCard } from "@/components/blame-card";
import { TextDiffView } from "@/components/text-diff";
import { SeriesCard } from "@/components/series-card";
import { buildSeries, detectTimeColumn, type Series } from "@/lib/timeseries";
import { fitByGroup, fitStatistics, numericColumn } from "@/lib/fit";
import { DICTIONARY_FILE, parseDictionary } from "@/lib/dictionary";
import { matchesAny } from "@/lib/globs";
import { CompareSlider, CompareSliderAfter, CompareSliderBefore, CompareSliderHandle } from "@/components/ui/compare-slider";
import { TransitionPanel } from "@/components/ui/transition-panel";
import type { DataType } from "@/lib/data";
import { codecLabels, formatBytes, timeAgo } from "@/lib/format";
import { dataTypeOf, loadFile, loadRepo } from "@/lib/source";

// Shown when the API isn't running.
const demoMetadata = [
  { label: "Format", value: "Cloud-Optimized GeoTIFF" },
  { label: "CRS", value: "EPSG:32643 (UTM 43N)" },
  { label: "Resolution", value: "2 m × 2 m" },
  { label: "Dimensions", value: "18,240 × 12,880" },
  { label: "Bands", value: "1 (elevation, Float32)" },
  { label: "Nodata", value: "-9999" },
  { label: "Size", value: "2.8 GB" },
];

const RAW_LIMIT = 16 * 1024 * 1024;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

function isGeographic(epsg: number | null) {
  return epsg !== null && epsg >= 4000 && epsg < 5000;
}

function metadataFor(f: ApiFile) {
  const rows: { label: string; value: string }[] = [];
  const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
  if (f.raster) {
    const r = f.raster;
    const unit = isGeographic(r.epsg) ? "°" : " m";
    rows.push({ label: "Format", value: "GeoTIFF" });
    rows.push({ label: "CRS", value: r.epsg ? `EPSG:${r.epsg}` : "Not set" });
    rows.push({ label: "Vertical datum", value: r.verticalEpsg ? `EPSG:${r.verticalEpsg}` : "Not set" });
    if (r.pixelScale) rows.push({ label: "Resolution", value: `${n(r.pixelScale[0])}${unit} × ${n(r.pixelScale[1])}${unit}` });
    rows.push({ label: "Dimensions", value: `${n(r.width)} × ${n(r.height)}` });
    const kind = r.sampleFormat === "float" ? "Float" : r.sampleFormat === "int" ? "Int" : "UInt";
    rows.push({ label: "Sample type", value: `${kind}${r.bitsPerSample}` });
    rows.push({ label: "Nodata", value: r.nodata === null ? "Not set" : String(r.nodata) });
    // Whether it reads well from the web: tiled, with overviews, directories first.
    if (f.cog) rows.push({ label: "Cloud optimized", value: f.cog.length === 0 ? "Yes" : `No: ${f.cog.join("; ")}` });
  } else if (f.netcdf) {
    const c = f.netcdf;
    rows.push({ label: "Format", value: `NetCDF classic (${c.format})` });
    rows.push({ label: "Conventions", value: c.conventions ?? "Not declared" });
    rows.push({ label: "Dimensions", value: c.dimensions.map((d) => `${d.name} ${d.length === null ? `(unlimited, ${n(c.records)})` : n(d.length)}`).join(" · ") || "None" });
    rows.push({ label: "Variables", value: c.variables.map((v) => `${v.name}${v.units ? ` [${v.units}]` : ""}`).slice(0, 12).join(", ") + (c.variables.length > 12 ? `, and ${c.variables.length - 12} more` : "") });
    if (c.problems.length) rows.push({ label: "Header", value: c.problems.join("; ") });
  } else if (f.hdf5) {
    const h = f.hdf5;
    rows.push({ label: "Format", value: `HDF5${h.results && h.top.includes("Plan Data") ? " (HEC-RAS results)" : ""}, superblock ${h.version}` });
    rows.push({ label: "Contents", value: `${n(h.groups)} ${h.groups === 1 ? "group" : "groups"}, ${n(h.datasets)} ${h.datasets === 1 ? "dataset" : "datasets"}${h.limited ? " (listing stopped at the limit)" : ""}` });
    if (h.top.length) rows.push({ label: "Top level", value: h.top.slice(0, 12).join(", ") + (h.top.length > 12 ? `, and ${h.top.length - 12} more` : "") });
    if (h.biggest.length) {
      rows.push({ label: "Largest datasets", value: h.biggest.map((d) => `${d.path.split("/").pop()} ${d.shape === null ? "(empty)" : d.shape.length === 0 ? "scalar" : `[${d.shape.map((x) => n(x)).join(" × ")}]`}${d.type ? ` ${d.type}` : ""}`).join(" · ") });
    }
    // The run's own account of itself (HEC-RAS results): status first, because "went unstable" changes how to read the rest.
    if (h.run) {
      rows.push({ label: "Run status", value: h.run.solution ?? "Not recorded" });
      if (h.run.maxWselError !== null) rows.push({ label: "Max WSEL error", value: String(h.run.maxWselError) });
      if (h.run.computeTotal) rows.push({ label: "Computation time", value: h.run.computeTotal });
      if (h.run.runWindow) rows.push({ label: "Run window", value: h.run.runWindow });
      if (h.run.cores !== null) rows.push({ label: "Cores used", value: String(h.run.cores) });
      if (h.run.unstableAt) rows.push({ label: "Went unstable", value: h.run.unstableAt });
      for (const v of h.run.volume.slice(0, 6)) rows.push({ label: v.name, value: Array.isArray(v.value) ? v.value.join(", ") : String(v.value) });
    }
    // The file's own attributes (HEC-RAS: file version, units, plan title, time window), at most eight rows.
    for (const a of h.properties.slice(0, 8)) rows.push({ label: a.name, value: a.value });
    if (h.properties.length > 8) rows.push({ label: "More attributes", value: `${h.properties.length - 8}+ in the file; see the line diff for all` });
    if (h.problems.length) rows.push({ label: "Structure", value: h.problems.join("; ") });
    if (h.notes.length) rows.push({ label: "Not read", value: h.notes.join("; ") });
  } else if (f.geodata) {
    if (f.geodata.kind === "geopackage") {
      rows.push({ label: "Format", value: "GeoPackage" });
      rows.push({ label: "Layers", value: n(f.geodata.layers.length) });
      const epsgs = [...new Set(f.geodata.layers.map((l) => l.epsg).filter((e): e is number => e !== null))];
      rows.push({ label: "CRS", value: epsgs.length ? epsgs.map((e) => `EPSG:${e}`).join(", ") : "Not declared" });
    } else {
      const g = f.geodata;
      rows.push({ label: "Format", value: `GeoParquet ${g.version}` });
      rows.push({ label: "Geometry columns", value: n(g.columns.length) });
      const main = g.columns.find((c) => c.name === g.primary) ?? g.columns[0];
      rows.push({ label: "CRS", value: main?.epsg ? `EPSG:${main.epsg}` : "Not declared" });
    }
  } else if (f.pointCloud) {
    const p = f.pointCloud;
    rows.push({ label: "Format", value: `${p.compressed ? "LAZ" : "LAS"} ${p.version}, point format ${p.pointFormat}` });
    rows.push({ label: "Points", value: n(p.pointCount) });
    rows.push({ label: "CRS", value: p.epsg ? `EPSG:${p.epsg}` : "Not declared" });
    rows.push({ label: "Elevation range", value: `${n(p.min[2])} – ${n(p.max[2])}` });
    rows.push({ label: "Extent", value: `${n(p.min[0])} – ${n(p.max[0])} E · ${n(p.min[1])} – ${n(p.max[1])} N` });
    if (p.generatingSoftware) rows.push({ label: "Made with", value: p.generatingSoftware });
    if (p.problems.length) rows.push({ label: "Header", value: p.problems.join("; ") });
  } else if (f.vector) {
    const v = f.vector;
    rows.push({ label: "Format", value: "ESRI Shapefile" });
    rows.push({ label: "Geometry", value: v.shapeType });
    if (v.features !== null) rows.push({ label: "Features", value: n(v.features) });
    rows.push({ label: "CRS", value: v.epsg ? `EPSG:${v.epsg}` : "No .prj" });
    rows.push({ label: "Sidecar files", value: v.sidecars.join(" ") || "None" });
    rows.push({ label: "Header", value: v.valid ? "Valid" : "Invalid" });
  } else if (f.table) {
    rows.push({ label: "Format", value: "CSV" });
    rows.push({ label: "Columns", value: n(f.table.columns.length) });
    rows.push({ label: "Rows", value: n(f.table.rows) });
  } else {
    rows.push({ label: "Format", value: ext ? `.${ext}` : "File" });
  }
  rows.push({ label: "Size", value: formatBytes(f.size) });
  rows.push({ label: "Stored", value: `${formatBytes(f.storedBytes)} · ${codecLabels(f.codecs) || "kept as uploaded"}` });
  rows.push({ label: "Chunks", value: f.uniqueChunks === f.chunkCount ? n(f.chunkCount) : `${n(f.chunkCount)} (${n(f.uniqueChunks)} unique)` });
  return rows;
}

function extentOf(f: ApiFile): string | null {
  const r = f.raster;
  if (r?.origin && r.pixelScale) {
    const [x, y] = r.origin;
    const [sx, sy] = r.pixelScale;
    const unit = isGeographic(r.epsg) ? "°" : "";
    return `${n(x)}${unit} – ${n(x + sx * r.width)}${unit} E · ${n(y - sy * r.height)}${unit} – ${n(y)}${unit} N`;
  }
  const b = f.vector?.bbox;
  if (b) return `${n(b[0])} – ${n(b[2])} E · ${n(b[1])} – ${n(b[3])} N`;
  return null;
}

type Params = { owner: string; repo: string; path: string[] };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { owner, repo, path } = await params;
  return { title: `${path.map(decodeURIComponent).join("/")} · ${owner}/${repo}` };
}

export default async function FileViewPage({ params, searchParams }: { params: Promise<Params>; searchParams: Promise<{ ref?: string; view?: string; obs?: string; sim?: string; ts_t?: string; ts_v?: string; ts_by?: string; ts_over?: string; fit_by?: string }> }) {
  const { owner, repo, path: raw } = await params;
  const { view } = await searchParams;
  const path = raw.map(decodeURIComponent);
  const summary = await loadRepo(owner, repo);
  const ref = (await searchParams).ref || summary.repo.defaultBranch;
  const base = `/${owner}/${repo}`;
  const filename = path[path.length - 1];
  const filePath = path.join("/");
  const refQuery = ref === summary.repo.defaultBranch ? "" : `?ref=${encodeURIComponent(ref)}`;

  const [file, lockList] = summary.live ? await Promise.all([loadFile(owner, repo, ref, filePath), api.locks(owner, repo)]) : [null, null];
  const lock = lockList?.find((l) => l.path === filePath) ?? null;
  if (summary.live && !file) notFound();

  const dataType = (file?.dataType ?? dataTypeOf(filePath)) as DataType | undefined;
  const where = file && isBBox(file.extent) ? file.extent : null;
  const metadata = file ? metadataFor(file) : demoMetadata;
  const extent = file ? extentOf(file) : null;
  const sizeLabel = file ? formatBytes(file.size) : "2.8 GB";
  const latest = file?.history[0];
  const downloadable = file ? file.size <= RAW_LIMIT : false;
  const rawHref = `${base}/raw/${path.map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`;

  const kind = file?.raster ? "raster" : file?.vector ? "vector" : file?.table ? "table" : file?.pointCloud && !file.pointCloud.compressed ? "pointcloud" : file && (file.netcdf || file.hdf5 || file.geodata) ? "structure" : file && file.preview === null && /\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(filePath) && file.size <= RAW_LIMIT ? "image" : file?.preview !== null && file ? "text" : file ? "binary" : "raster";

  // The map preview, drawn from this version's bytes; "change" compares it with the version
  // before the last commit that touched the file.
  const previous = file?.history[1]?.sha ?? null;
  const showChange = view === "change" && previous !== null;
  const swipeMode = view === "swipe" && previous !== null;
  const previewBase = showChange ? previous : undefined;
  // Column descriptions for a table, from the repository's own dictionary file.
  const dictionaryText = summary.live && (kind === "table" || (kind === "vector" && (file?.vector?.fields?.length ?? 0) > 0)) ? await api.raw(owner, repo, ref, DICTIONARY_FILE) : null;
  const dictionary = parseDictionary(dictionaryText);
  // Writers can edit it here; the commit goes to the branch being viewed (when that is a branch, not a commit).
  const canEdit = summary.live && (summary.access === "write" || summary.access === "admin") && !/^[0-9a-f]{40,64}$/.test(ref);
  const dictEdit = canEdit ? { owner, repo, currentText: dictionaryText ?? "", branch: ref, head: ref === summary.repo.defaultBranch ? summary.head?.sha : undefined } : undefined;

  // The whole of a text file or table that is small enough to read in the browser, for the viewers that need all of it (a tree, an outline, sorting).
  const wholeLimit = kind === "table" ? 2 * 1024 * 1024 : 1024 * 1024;
  const wholeText = summary.live && file && !(view === "change") && (kind === "text" || kind === "table") && file.size <= wholeLimit ? await api.raw(owner, repo, ref, filePath) : null;

  // A time-series plot of one column, optionally one line per station and the previous version dashed behind it.
  let seriesNow: Series[] = [], seriesBefore: Series[] = [], seriesNote: string | null = null;
  const q2 = await searchParams;
  if (summary.live && kind === "table" && file?.table && file.table.columns.length >= 2 && file.size <= 16 * 1024 * 1024) {
    const cols = file.table.columns;
    const text = (q2.ts_v || q2.ts_t) ? await api.raw(owner, repo, ref, filePath) : null;
    if (text) {
      const rowsNow = parseCsv(text, sniffDelimiter(text)).slice(1);
      const tCol = q2.ts_t ? cols.indexOf(q2.ts_t) : detectTimeColumn(cols, rowsNow);
      const vCol = q2.ts_v ? cols.indexOf(q2.ts_v) : -1;
      const bCol = q2.ts_by ? cols.indexOf(q2.ts_by) : -1;
      if (tCol < 0 || vCol < 0) seriesNote = "Choose a time column and a value column.";
      else {
        seriesNow = buildSeries(rowsNow, tCol, vCol, bCol);
        if (seriesNow.every((s) => s.points.length === 0)) seriesNote = "No readable time and number pairs in those columns.";
        if (q2.ts_over === "1" && previous) {
          const old = await api.raw(owner, repo, previous, filePath);
          if (old) seriesBefore = buildSeries(parseCsv(old, sniffDelimiter(old)).slice(1), tCol, vCol, bCol);
        }
      }
    }
  }

  // Which commit rewrote each part of the file (only worth showing when more than one did).
  const blame = summary.live && file && file.size > 0 ? await api.blame(owner, repo, ref, filePath) : null;

  // Observed against simulated, for tables with at least two numeric columns (?obs=<column>&sim=<column>).
  const wanted = await searchParams;
  const units = await getUnits();
  let fit: ReturnType<typeof fitStatistics> = null;
  let fitNote: string | null = null;
  let fitGroups: ReturnType<typeof fitByGroup> = [];
  const tableColumns = kind === "table" && file?.table ? file.table.columns : [];
  if (summary.live && tableColumns.length >= 2 && wanted.obs && wanted.sim) {
    const oi = tableColumns.indexOf(wanted.obs), si = tableColumns.indexOf(wanted.sim);
    if (oi < 0 || si < 0) fitNote = "Those columns aren't in this file.";
    else if (oi === si) fitNote = "Choose two different columns.";
    else if (file!.size > 16 * 1024 * 1024) fitNote = "This table is too large to compare here.";
    else {
      const text = await api.raw(owner, repo, ref, filePath);
      if (!text) fitNote = "Couldn't read the file.";
      else {
        const rows = parseCsv(text, sniffDelimiter(text));
        const body = rows.slice(1);
        fit = fitStatistics(numericColumn(body, oi), numericColumn(body, si));
        const fi = wanted.fit_by ? tableColumns.indexOf(wanted.fit_by) : -1;
        if (fit && fi >= 0 && fi !== oi && fi !== si) fitGroups = fitByGroup(body, oi, si, fi);
        if (!fit) fitNote = "Not enough numeric pairs in those two columns to compare.";
      }
    }
  }
  // A raster is drawn at up to 1024 pixels on its long side: its own detail for most files, rather than a small picture stretched to fit.
  const drawSize = kind === "raster" || kind === "pointcloud" ? 1024 : undefined;
  const rendered = file && (kind === "raster" || kind === "vector" || kind === "pointcloud") ? await renderMeta(owner, repo, ref, filePath, { base: previewBase, size: drawSize }) : null;
  // The picture's own shape, so its frame has no empty bands beside it.
  const aspect = rendered?.meta?.sourceWidth && rendered.meta.sourceHeight ? rendered.meta.sourceWidth / rendered.meta.sourceHeight : rendered?.meta?.width && rendered.meta.height ? rendered.meta.width / rendered.meta.height : 16 / 10;
  const vectorViewer = kind === "vector" && file && file.vector && rendered && !rendered.error && !showChange && !swipeMode && /\.shp$/i.test(filePath);
  const viewer = kind === "raster" && file && rendered && !rendered.error && !showChange && !swipeMode && /\.tiff?$/i.test(filePath);
  const tableDiff = file && kind === "table" && showChange && previous ? await api.tableDiff(owner, repo, ref, filePath, previous) : null;
  const lineDiff = file && kind === "text" && showChange && previous ? await api.textDiff(owner, repo, ref, filePath, previous) : null;
  const previewHref = (v?: string) => `${base}/blob/${path.map(encodeURIComponent).join("/")}?${new URLSearchParams({ ...(ref !== summary.repo.defaultBranch ? { ref } : {}), ...(v ? { view: v } : {}) })}`;

  return (
    <>
      <h1 className="sr-only">{filePath} · {owner}/{repo}</h1>
      <div className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink render={<Link href={`${base}${refQuery}`} />}>{repo}</BreadcrumbLink>
              </BreadcrumbItem>
              {path.slice(0, -1).map((seg, idx) => {
                const subPath = path.slice(0, idx + 1).join("/");
                return (
                  <React.Fragment key={subPath}>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem>
                      <BreadcrumbLink render={<Link href={`${base}/tree/${encodeURIComponent(ref)}/${subPath}`} />}>{seg}</BreadcrumbLink>
                    </BreadcrumbItem>
                  </React.Fragment>
                );
              })}
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage className="font-mono">{filename}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
          <div className="flex flex-wrap items-center gap-2">
            {summary.live && !lock && matchesAny(summary.repo.lockPatterns ?? [], filePath) && (
              <span className="text-xs text-muted-foreground" title="This repository requires the lock before this file is changed.">Lock required</span>
            )}
            {summary.live && <FileLockControl owner={owner} repo={repo} path={filePath} lock={lock} />}
            <Button variant="outline" size="sm" href={latest ? `${base}/commit/${latest.sha}` : `${base}/commits`}>
              <History data-icon="inline-start" />
              History
            </Button>
            <CliDialog
              trigger={
                <Button variant="outline" size="sm">
                  <Pencil data-icon="inline-start" />
                  Edit locally
                </Button>
              }
              title={`Edit ${filename}`}
              description="Geospatial files are edited in your own tools (QGIS, ArcGIS, HEC-RAS). Craton versions the result."
              commands={[
                { label: "1. Get the file", command: `craton clone ${owner}/${repo}` },
                { label: "2. Edit it, then record the change", command: `craton commit -m "Describe your change"` },
                { label: "3. Share it", command: "craton push" },
              ]}
            />
            {downloadable ? (
              <DownloadLink href={rawHref} filename={filename}>
                <Download data-icon="inline-start" />
                Download
                <span className="font-mono text-xs opacity-70">{sizeLabel}</span>
              </DownloadLink>
            ) : (
              <CliDialog
                trigger={
                  <Button variant="outline" size="sm">
                    <Download data-icon="inline-start" />
                    Download
                  </Button>
                }
                title={`Download ${filename}`}
                description={`${sizeLabel} downloads through the CLI so it can resume and verify every chunk.`}
                commands={[{ command: `craton clone ${owner}/${repo}` }]}
                footer={
                  <DownloadButton
                    filename={`${filename}.metadata.json`}
                    content={JSON.stringify({ file: filePath, ref, ...Object.fromEntries(metadata.map((m) => [m.label, m.value])) }, null, 2)}
                    type="application/json"
                  >
                    <Download data-icon="inline-start" />
                    Metadata only (.json)
                  </DownloadButton>
                }
              />
            )}
          </div>
        </div>

        {lock && (
          <p className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 border border-border bg-muted/30 px-4 py-2.5 text-sm" role="status">
            <LockBadge holder={lock.holder} className="font-medium" announce={false} />
            <span className="text-muted-foreground">
              has had this file locked for editing since {timeAgo(lock.lockedAt)}
              {lock.reason ? `: ${lock.reason.replace(/[.!?]+$/, "")}.` : "."} It can be read, but a push that changes it is refused until it is unlocked.
            </span>
          </p>
        )}

        <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <div className="flex min-w-0 flex-col gap-6">
            <Card className="overflow-hidden py-0">
              <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-4 py-3 text-sm">
                <span className="font-mono">{filename}</span>
                {dataType && <DataTypeBadge type={dataType} />}
                <Badge variant="outline" className="ml-auto">
                  {kind === "raster" ? "Raster" : kind === "vector" ? "Vector" : kind === "pointcloud" ? "Point cloud" : kind === "table" ? "Table" : kind === "structure" ? (file?.netcdf ? "NetCDF" : file?.geodata ? (file.geodata.kind === "geopackage" ? "GeoPackage" : "GeoParquet") : "HDF5") : kind === "image" ? "Image" : kind === "text" ? "Text" : "Binary"}
                </Badge>
              </div>
              {kind === "pointcloud" && file ? (
                <CardContent className="p-4">
                  <DataPreview src={previewSrc(owner, repo, ref, filePath, { size: drawSize })} alt={`${filename} seen from above, coloured by elevation`} error={rendered?.error ?? null} aspect={rendered?.meta?.width && rendered.meta.height ? clamp(rendered.meta.width / rendered.meta.height, 0.4, 2.5) : 16 / 10} className={rendered?.error ? "aspect-16/10" : undefined} />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Ruler className="size-3.5" aria-hidden />
                      {previewCaption(rendered?.meta ?? null, units) ?? "Seen from above, coloured by elevation"}
                    </span>
                    {rendered?.meta?.min !== undefined && rendered.meta.max !== undefined && !rendered.error && <ElevationLegend min={rendered.meta.min} max={rendered.meta.max} units={units} />}
                  </div>
                </CardContent>
              ) : kind === "raster" || kind === "vector" ? (
                <CardContent className="p-4">
                  {file && previous && (
                    <div className="mb-3 flex flex-wrap gap-1 text-xs" role="group" aria-label="Preview mode">
                      <Button asChild size="sm" variant={!showChange && !swipeMode ? "default" : "ghost"}>
                        <Link href={previewHref()} aria-current={!showChange && !swipeMode ? "true" : undefined}>This version</Link>
                      </Button>
                      <Button asChild size="sm" variant={showChange ? "default" : "ghost"}>
                        <Link href={previewHref("change")} aria-current={showChange ? "true" : undefined}>
                          Change since <span className="font-mono">{previous.slice(0, 7)}</span>
                        </Link>
                      </Button>
                      <Button asChild size="sm" variant={swipeMode ? "default" : "ghost"}>
                        <Link href={previewHref("swipe")} aria-current={swipeMode ? "true" : undefined}>Swipe to compare</Link>
                      </Button>
                    </div>
                  )}
                  {file && rendered ? (
                    <TransitionPanel
                      activeIndex={swipeMode ? 1 : 0}
                      transition={{ duration: 0.15 }}
                      variants={{ enter: { opacity: 0 }, center: { opacity: 1 }, exit: { opacity: 0 } }}
                    >
                      {[
                        vectorViewer ? (
                          <VectorViewer key="vector" owner={owner} repo={repo} reference={ref} path={filePath} base={previewSrc(owner, repo, ref, filePath)} alt={`Geometry of ${filename}`} geometry={file!.vector!.shapeType} epsg={file!.vector!.epsg} />
                        ) : viewer ? (
                          <RasterViewer
                            key="viewer"
                            owner={owner}
                            repo={repo}
                            reference={ref}
                            path={filePath}
                            base={previewSrc(owner, repo, ref, filePath, { size: drawSize })}
                            alt={`Hillshade of ${filename}`}
                            aspect={aspect}
                            units={units}
                            range={rendered.meta?.min !== undefined && rendered.meta.max !== undefined ? { min: rendered.meta.min, max: rendered.meta.max, width: rendered.meta.sourceWidth ?? rendered.meta.width ?? 0, height: rendered.meta.sourceHeight ?? rendered.meta.height ?? 0 } : null}
                          />
                        ) : (
                          <DataPreview
                            key="single"
                            src={previewSrc(owner, repo, ref, filePath, { base: previewBase, size: drawSize })}
                            alt={showChange ? `Change in ${filename} since ${previous?.slice(0, 7)}` : kind === "vector" ? `Geometry of ${filename}` : `Hillshade of ${filename}`}
                            error={rendered.error}
                            aspect={kind === "raster" ? aspect : undefined}
                            className={kind === "raster" ? undefined : "aspect-16/10"}
                          />
                        ),
                        previous ? (
                          <CompareSlider key="swipe" defaultValue={50} className="relative mx-auto overflow-hidden border border-border bg-muted/30" style={frameStyle(aspect)}>
                            <CompareSliderBefore>
                              {/* eslint-disable-next-line @next/next/no-img-element -- rendered per blob by the API, already sized */}
                              <img src={previewSrc(owner, repo, previous, filePath, { size: drawSize })} alt={`${filename} at ${previous.slice(0, 7)}`} className="size-full object-contain" />
                            </CompareSliderBefore>
                            <CompareSliderAfter>
                              {/* eslint-disable-next-line @next/next/no-img-element -- rendered per blob by the API, already sized */}
                              <img src={previewSrc(owner, repo, ref, filePath, { size: drawSize })} alt={`${filename} now`} className="size-full object-contain" />
                            </CompareSliderAfter>
                            <CompareSliderHandle />
                          </CompareSlider>
                        ) : (
                          <div key="swipe" />
                        ),
                      ]}
                    </TransitionPanel>
                  ) : (
                    <MapPreview seed={21} variant={kind === "vector" ? "vector" : "terrain"} className="aspect-16/10" />
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-xs text-muted-foreground">
                    {swipeMode ? (
                      <span className="flex items-center gap-1.5">
                        <Ruler className="size-3.5" aria-hidden />
                        Drag to compare <span className="font-mono">{previous?.slice(0, 7)}</span> against this version
                      </span>
                    ) : showChange ? (
                      <PreviewDiffLegend meta={rendered?.meta ?? null} />
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <Ruler className="size-3.5" aria-hidden />
                        {file ? (viewer ? "Hillshade lit from the north-west, tinted by elevation" : (previewCaption(rendered?.meta ?? null, units) ?? (kind === "vector" ? "Geometry" : "Hillshade"))) : "Demo preview"}
                      </span>
                    )}
                    <span className="flex items-center gap-3">
                      <span className="font-mono">{file ? extent : "3.2 m — 842.6 m"}</span>
                      {file && latest && !rendered?.error && (
                        <EmbedDialog owner={owner} repo={repo} commit={latest.sha} path={filePath} isPublic={summary.repo.visibility === "public"} />
                      )}
                    </span>
                  </div>
                </CardContent>
              ) : kind === "table" && file?.preview ? (
                <>
                  {previous && (
                    <div className="flex flex-wrap gap-1 border-b border-border p-3 text-xs" role="group" aria-label="Table view">
                      <Button asChild size="sm" variant={!showChange ? "default" : "ghost"}>
                        <Link href={previewHref()} aria-current={!showChange ? "true" : undefined}>This version</Link>
                      </Button>
                      <Button asChild size="sm" variant={showChange ? "default" : "ghost"}>
                        <Link href={previewHref("change")} aria-current={showChange ? "true" : undefined}>
                          Change since <span className="font-mono">{previous.slice(0, 7)}</span>
                        </Link>
                      </Button>
                    </div>
                  )}
                  {showChange ? (
                    tableDiff ? (
                      <TableDiffView diff={tableDiff} previous={previous!} />
                    ) : (
                      <p className="px-4 py-6 text-sm text-muted-foreground">Couldn’t compare this table with the earlier version. It may be too large, or the API isn’t reachable.</p>
                    )
                  ) : (
                    <TableBody text={wholeText ?? file.preview} rows={file.table?.rows ?? 0} />
                  )}
                </>
              ) : kind === "text" && file?.preview ? (
                <>
                  {previous && (
                    <div className="flex flex-wrap gap-1 border-b border-border p-3 text-xs" role="group" aria-label="Text view">
                      <Button asChild size="sm" variant={!showChange ? "default" : "ghost"}>
                        <Link href={previewHref()} aria-current={!showChange ? "true" : undefined}>This version</Link>
                      </Button>
                      <Button asChild size="sm" variant={showChange ? "default" : "ghost"}>
                        <Link href={previewHref("change")} aria-current={showChange ? "true" : undefined}>
                          Change since <span className="font-mono">{previous.slice(0, 7)}</span>
                        </Link>
                      </Button>
                    </div>
                  )}
                  {showChange ? (
                    lineDiff ? (
                      <div className="p-3">
                        <TextDiffView diff={lineDiff} />
                      </div>
                    ) : (
                      <p className="px-4 py-6 text-sm text-muted-foreground">Couldn’t compare this file with the earlier version. It may be too large, or the API isn’t reachable.</p>
                    )
                  ) : (
                    <FileText name={filename} text={wholeText ?? file.preview} note={wholeText === null && file.truncated ? `Showing the first 8 KB of ${sizeLabel}. Download the file for the rest.` : null} />
                  )}
                </>
              ) : kind === "image" ? (
                <ImageViewer src={`${base}/image/${path.map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`} alt={filename} />
              ) : kind === "structure" && file ? (
                <StructureViewer file={file} />
              ) : (
                <CardContent className="flex flex-col gap-2 p-6 text-sm text-muted-foreground">
                  <p className="text-foreground">No viewer for this kind of file.</p>
                  <p className="text-pretty">
                    It is {sizeLabel}, stored as {file ? `${n(file.chunkCount)} ${file.chunkCount === 1 ? "chunk" : "chunks"}` : "chunks"}, and every byte is kept exactly as it was uploaded. Download it, or open it with <code className="font-mono">craton clone</code> and use the program that made it.
                  </p>
                </CardContent>
              )}
            </Card>

            {kind === "table" && summary.live && tableColumns.length >= 2 && (
              <SeriesCard
                columns={tableColumns}
                timeCol={q2.ts_t ?? ""}
                valueCol={q2.ts_v ?? ""}
                byCol={q2.ts_by ?? ""}
                series={seriesNow}
                overlay={seriesBefore}
                canOverlay={Boolean(previous)}
                overlayOn={q2.ts_over === "1"}
                action={`${base}/blob/${path.map(encodeURIComponent).join("/")}`}
                note={seriesNote}
              />
            )}
            {kind === "table" && summary.live && tableColumns.length >= 2 && (
              <FitCard columns={tableColumns} observed={wanted.obs ?? ""} simulated={wanted.sim ?? ""} by={wanted.fit_by ?? ""} groups={fitGroups} fit={fit} note={fitNote} action={`${base}/blob/${path.map(encodeURIComponent).join("/")}`} />
            )}
            {kind === "table" && file?.table && (
              <DataDictionary dict={dictionary} path={filePath} columns={file.table.columns} exists={dictionaryText !== null} edit={dictEdit} />
            )}
            {kind === "vector" && (file?.vector?.fields?.length ?? 0) > 0 && (
              <DataDictionary dict={dictionary} path={filePath} columns={file!.vector!.fields!.map((f) => f.name)} exists={dictionaryText !== null} noun="fields" edit={dictEdit} />
            )}

            {blame && <BlameCard blame={blame} base={base} />}

            {file && file.history.length > 0 && (
              <section className="flex flex-col gap-2">
                <h2 className="text-sm font-semibold">History</h2>
                <ul className="flex flex-col divide-y divide-border border border-border bg-card">
                  {file.history.map((h, i) => (
                    <li key={h.sha} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                      <Initials name={h.author} />
                      <Link href={`${base}/commit/${h.sha}`} className="min-w-0 flex-1 truncate hover:underline">
                        {h.message}
                      </Link>
                      <span className="hidden text-xs capitalize text-muted-foreground sm:inline">{h.change}</span>
                      <span className="hidden w-24 text-right text-xs text-muted-foreground md:inline">{timeAgo(h.timestamp)}</span>
                      <Link href={`${base}/commit/${h.sha}`} className="font-mono text-xs text-muted-foreground hover:text-foreground hover:underline">
                        {h.sha.slice(0, 7)}
                      </Link>
                      {i > 0 && (
                        <span className="flex shrink-0 items-center">
                          <Button variant="ghost" size="xs" render={<Link href={`${base}/blob/${path.map(encodeURIComponent).join("/")}?ref=${h.sha}`} />}>
                            View
                          </Button>
                          {!/^[0-9a-f]{40,64}$/.test(ref) && <RestoreButton owner={owner} repo={repo} path={filePath} from={h.sha} branch={ref} />}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>

          <div className="flex flex-col gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Metadata</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2.5 text-sm">
                {metadata.map((m) => (
                  <div key={m.label} className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">{m.label}</span>
                    <span className="text-right font-mono text-xs">{m.value}</span>
                  </div>
                ))}
                {where && (
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-muted-foreground">Location</span>
                    <span className="text-right text-xs">
                      <span className="font-mono">{describeBBox(where)}</span>
                      <br />
                      <a href={osmLink(where)} target="_blank" rel="noopener noreferrer" className="text-muted-foreground underline underline-offset-2 hover:text-foreground">
                        Open in a map<span className="sr-only"> (opens OpenStreetMap)</span>
                      </a>
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
            {file && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="size-4 text-chart-1" aria-hidden />
                    Integrity
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2 text-xs text-muted-foreground">
                  SHA-256 of the whole file. Every chunk is verified against its own hash when it’s read.
                  <div className="flex items-center gap-1 border border-border bg-muted/30 py-0.5 pl-2 pr-0.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{file.sha256}</code>
                    <CopyButton value={file.sha256} label="Copy SHA-256" />
                  </div>
                </CardContent>
              </Card>
            )}
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Access from code</CardTitle>
              </CardHeader>
              <CardContent>
                <CommandLine command={`craton clone ${owner}/${repo}`} />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </>
  );
}

function TableBody({ text, rows }: { text: string; rows: number }) {
  // The text may be the first 8 KB only, so its last row may be cut off; drop a final row that is short of columns.
  const parsed = parseCsv(text, sniffDelimiter(text));
  const width = parsed[0]?.length ?? 0;
  const [header, ...body] = parsed.length > 1 && parsed[parsed.length - 1].length < width ? parsed.slice(0, -1) : parsed;
  return <TableViewer columns={header ?? []} rows={body.slice(0, 2000)} totalRows={Math.max(rows, body.length)} />;
}
