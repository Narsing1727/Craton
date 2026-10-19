// The contents of a NetCDF or HDF5 file, read from its header: dimensions, variables and their units, the file's own attributes, and for a HEC-RAS
// results file how the run went. Nothing here reads the data arrays; the header is what the server reads, and it is enough to know what is inside.

import type { ApiFile } from "@/lib/api";
import { cn } from "@/lib/utils";

const n = (v: number) => v.toLocaleString("en-US");

function Table({ head, children, label }: { head: { text: string; right?: boolean }[]; children: React.ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto border border-border" tabIndex={0} role="region" aria-label={label}>
      <table className="w-full text-left text-xs">
        <thead className="border-b border-border bg-muted/20 text-muted-foreground">
          <tr>
            {head.map((h) => (
              <th key={h.text} scope="col" className={cn("px-3 py-2 font-medium", h.right && "text-right")}>{h.text}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border font-mono">{children}</tbody>
      </table>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-medium">{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

const value = (v: string | number | number[]) => (Array.isArray(v) ? v.join(", ") : String(v));

export function StructureViewer({ file }: { file: ApiFile }) {
  if (file.netcdf) {
    const c = file.netcdf;
    return (
      <div className="flex flex-col gap-6 p-4">
        <Section title="Dimensions" hint={`${c.format}${c.conventions ? ` · ${c.conventions}` : ""}`}>
          <ul className="flex flex-wrap gap-2 font-mono text-xs">
            {c.dimensions.map((d) => (
              <li key={d.name} className="border border-border px-2 py-1">
                {d.name} <span className="tabular-nums text-muted-foreground">{d.length === null ? `unlimited (${n(c.records)})` : n(d.length)}</span>
              </li>
            ))}
            {c.dimensions.length === 0 && <li className="text-muted-foreground">None</li>}
          </ul>
        </Section>
        <Section title="Variables" hint={`${n(c.variables.length)}`}>
          <Table label="Variables" head={[{ text: "Name" }, { text: "Type" }, { text: "Shape" }, { text: "Units" }, { text: "Description" }]}>
            {c.variables.map((v) => (
              <tr key={v.name}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">{v.name}</th>
                <td className="px-3 py-1.5 text-muted-foreground">{v.type}</td>
                <td className="px-3 py-1.5">{v.dimensions.length ? `(${v.dimensions.join(", ")})` : "scalar"}</td>
                <td className="px-3 py-1.5">{v.units ?? <span className="text-muted-foreground">—</span>}</td>
                <td className="px-3 py-1.5 font-sans text-muted-foreground">{v.longName ?? ""}</td>
              </tr>
            ))}
          </Table>
        </Section>
        {c.globals.length > 0 && (
          <Section title="Global attributes">
            <Table label="Global attributes" head={[{ text: "Attribute" }, { text: "Value" }]}>
              {c.globals.map((g) => (
                <tr key={g.name}>
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">{g.name}</th>
                  <td className="break-words px-3 py-1.5">{value(g.value)}</td>
                </tr>
              ))}
            </Table>
          </Section>
        )}
        {c.problems.length > 0 && <p className="text-xs text-muted-foreground text-pretty">Header notes: {c.problems.join("; ")}</p>}
      </div>
    );
  }

  if (file.hdf5) {
    const h = file.hdf5;
    return (
      <div className="flex flex-col gap-6 p-4">
        <Section title="Contents" hint={`HDF5${h.results ? " · HEC-RAS results" : ""}`}>
          <p className="text-xs text-muted-foreground">
            {n(h.groups)} {h.groups === 1 ? "group" : "groups"} and {n(h.datasets)} {h.datasets === 1 ? "dataset" : "datasets"}
            {h.limited ? " (the listing stopped at its limit)" : ""}.
          </p>
          {h.top.length > 0 && (
            <ul className="flex flex-wrap gap-2 font-mono text-xs">
              {h.top.slice(0, 30).map((t) => (
                <li key={t} className="border border-border px-2 py-1">{t}</li>
              ))}
              {h.top.length > 30 && <li className="px-1 py-1 text-muted-foreground">and {n(h.top.length - 30)} more</li>}
            </ul>
          )}
        </Section>
        {h.run && (
          <Section title="The run" hint={h.run.unstable ? "went unstable" : undefined}>
            <Table label="Run summary" head={[{ text: "Item" }, { text: "Value" }]}>
              {[
                ["Status", h.run.solution ?? "Not recorded"],
                ...(h.run.maxWselError !== null ? [["Max WSEL error", String(h.run.maxWselError)]] : []),
                ...(h.run.computeTotal ? [["Computation time", h.run.computeTotal]] : []),
                ...(h.run.runWindow ? [["Run window", h.run.runWindow]] : []),
                ...(h.run.cores !== null ? [["Cores", String(h.run.cores)]] : []),
                ...(h.run.unstableAt ? [["Went unstable", h.run.unstableAt]] : []),
                ...h.run.volume.map((v) => [v.name, value(v.value)]),
              ].map(([k, v]) => (
                <tr key={k}>
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">{k}</th>
                  <td className="px-3 py-1.5">{v}</td>
                </tr>
              ))}
            </Table>
          </Section>
        )}
        {h.biggest.length > 0 && (
          <Section title="Largest datasets">
            <Table label="Largest datasets" head={[{ text: "Path" }, { text: "Shape" }, { text: "Type" }]}>
              {h.biggest.map((d) => (
                <tr key={d.path}>
                  <th scope="row" className="break-all px-3 py-1.5 text-left font-medium">{d.path}</th>
                  <td className="px-3 py-1.5 tabular-nums">{d.shape === null ? "empty" : d.shape.length === 0 ? "scalar" : d.shape.map(n).join(" × ")}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{d.type ?? ""}</td>
                </tr>
              ))}
            </Table>
          </Section>
        )}
        {h.properties.length > 0 && (
          <Section title="File attributes" hint={h.properties.length > 40 ? `first 40 of ${n(h.properties.length)}` : undefined}>
            <Table label="File attributes" head={[{ text: "Attribute" }, { text: "Value" }]}>
              {h.properties.slice(0, 40).map((p, i) => (
                <tr key={`${p.path}:${p.name}:${i}`}>
                  <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted-foreground">{p.name}</th>
                  <td className="break-words px-3 py-1.5">{p.value}</td>
                </tr>
              ))}
            </Table>
          </Section>
        )}
        {(h.problems.length > 0 || h.notes.length > 0) && <p className="text-xs text-muted-foreground text-pretty">{[...h.problems, ...h.notes].join("; ")}</p>}
      </div>
    );
  }
  if (file.geodata?.kind === "geopackage") {
    const layers = file.geodata.layers;
    return (
      <div className="flex flex-col gap-6 p-4">
        <Section title="Layers" hint={`GeoPackage · ${n(layers.length)}`}>
          <Table label="GeoPackage layers" head={[{ text: "Table" }, { text: "Kind" }, { text: "Rows", right: true }, { text: "CRS" }, { text: "Extent" }]}>
            {layers.map((l) => (
              <tr key={l.table}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">{l.table}</th>
                <td className="px-3 py-1.5 text-muted-foreground">{l.type}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{l.features === null ? "—" : n(l.features)}</td>
                <td className="px-3 py-1.5">{l.epsg ? `EPSG:${l.epsg}` : <span className="text-muted-foreground">{l.srsId === null ? "none" : `srs ${l.srsId}`}</span>}</td>
                <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{l.extent ? l.extent.map((v) => Number(v.toFixed(l.epsg && l.epsg < 5000 ? 5 : 1)).toLocaleString("en-US")).join(", ") : "—"}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
    );
  }

  if (file.geodata?.kind === "geoparquet") {
    const g = file.geodata;
    return (
      <div className="flex flex-col gap-6 p-4">
        <Section title="Geometry columns" hint={`GeoParquet ${g.version} · main column ${g.primary}`}>
          <Table label="GeoParquet geometry columns" head={[{ text: "Column" }, { text: "Encoding" }, { text: "Geometry" }, { text: "CRS" }, { text: "Bounds" }]}>
            {g.columns.map((c) => (
              <tr key={c.name}>
                <th scope="row" className="px-3 py-1.5 text-left font-medium">{c.name}{c.name === g.primary && <span className="ml-1.5 font-normal text-muted-foreground">main</span>}</th>
                <td className="px-3 py-1.5 text-muted-foreground">{c.encoding}</td>
                <td className="px-3 py-1.5">{c.geometryTypes.length ? c.geometryTypes.join(", ") : <span className="text-muted-foreground">any</span>}</td>
                <td className="px-3 py-1.5">{c.epsg ? `EPSG:${c.epsg}` : <span className="text-muted-foreground">{c.crsState === "default" ? "default (OGC:CRS84)" : "not declared"}</span>}</td>
                <td className="px-3 py-1.5 tabular-nums text-muted-foreground">{c.bbox ? c.bbox.map((v) => Number(v.toFixed(5)).toLocaleString("en-US")).join(", ") : "—"}</td>
              </tr>
            ))}
          </Table>
        </Section>
      </div>
    );
  }
  return null;
}
