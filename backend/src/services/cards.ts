// Dataset card starters: a README.md for the kinds of data people put in Craton, with the sections a reader
// needs (what it is, where it came from, how it may be used, coordinate system and datum, limits, how to
// cite). Prompts are written as blanks to fill in, never as invented facts; only what the repository itself
// knows (its name, CRS, datum, nodata, licence) is filled in.

import type { RepoRow } from "./repos.ts";

export type CardTemplate = { id: string; name: string; about: string };

type Kind = CardTemplate & { sections: { heading: string; hint: string }[] };

const COMMON_TAIL = [
  { heading: "Known limits", hint: "What this data does not capture, and where it should not be trusted." },
  { heading: "How to cite", hint: "Authors, year and the release you used; Cite this repository gives APA, BibTeX and CITATION.cff." },
];

const KINDS: Kind[] = [
  {
    id: "hec-ras-model",
    name: "HEC-RAS model",
    about: "A calibrated hydraulic model: geometry, flows, plans and the data behind them.",
    sections: [
      { heading: "Study area", hint: "River, reach and the extent modelled, with upstream and downstream limits." },
      { heading: "Model setup", hint: "HEC-RAS version, 1D or 2D, geometry and unsteady flow files, plan used for results." },
      { heading: "Boundary conditions", hint: "Upstream hydrograph source, downstream condition (normal depth slope, rating curve, stage)." },
      { heading: "Calibration", hint: "Gauges used, events, roughness values and the fit (for example Nash-Sutcliffe or RMSE)." },
      ...COMMON_TAIL,
    ],
  },
  {
    id: "dem-survey",
    name: "DEM or terrain survey",
    about: "An elevation model from a survey, LiDAR or a satellite product.",
    sections: [
      { heading: "Source", hint: "Sensor or survey method, provider, acquisition date and product name." },
      { heading: "Processing", hint: "Ground classification, filling, resampling, mosaicking, and the software used." },
      { heading: "Accuracy", hint: "Vertical and horizontal accuracy, how it was checked, and against what." },
      { heading: "Files", hint: "Tiles, resolution, data type and the nodata value." },
      ...COMMON_TAIL,
    ],
  },
  {
    id: "rainfall-grids",
    name: "Rainfall or climate grids",
    about: "Gridded or gauge rainfall used to drive models.",
    sections: [
      { heading: "Source", hint: "Product or gauge network, provider, version and licence terms." },
      { heading: "Coverage", hint: "Period, time step, area and units (mm per hour, mm per day)." },
      { heading: "Processing", hint: "Bias correction, regridding, gap filling and accumulation windows." },
      { heading: "Files", hint: "Layout of files, naming, data type and the nodata value." },
      ...COMMON_TAIL,
    ],
  },
  {
    id: "gis-layers",
    name: "GIS layers",
    about: "Vector layers such as catchments, assets, land use or roads.",
    sections: [
      { heading: "Source", hint: "Where each layer came from, who produced it and when." },
      { heading: "Attributes", hint: "What the important fields mean, their units and allowed values." },
      { heading: "Topology and quality", hint: "Checks done (overlaps, gaps, validity) and known problems." },
      ...COMMON_TAIL,
    ],
  },
];

export const listCards = (): CardTemplate[] => KINDS.map(({ id, name, about }) => ({ id, name, about }));

export function findCard(id: unknown): Kind | null {
  return KINDS.find((k) => k.id === id) ?? null;
}

/** The README text for a template, with what the repository already declares filled in. */
export function cardReadme(kind: Kind, repo: Pick<RepoRow, "name" | "owner" | "crs" | "nodata" | "vertical_datum" | "license" | "description">): string {
  const lines: string[] = [];
  lines.push(`# ${repo.name}`, "");
  lines.push(repo.description.trim() ? repo.description.trim() : `_One or two sentences: what this ${kind.name.toLowerCase()} is and what it is for._`, "");
  lines.push("## At a glance", "");
  lines.push("| | |", "|---|---|");
  lines.push(`| Coordinate system | ${repo.crs} |`);
  lines.push(`| Vertical datum | ${repo.vertical_datum !== null ? `EPSG:${repo.vertical_datum}` : "_not declared yet; set it in Settings_"} |`);
  lines.push(`| Nodata value | ${repo.nodata !== null ? String(repo.nodata) : "_not declared yet; set it in Settings_"} |`);
  lines.push(`| Licence | ${repo.license ? repo.license : "_not chosen yet; set it in Settings_"} |`, "");
  for (const s of kind.sections) {
    lines.push(`## ${s.heading}`, "", `_${s.hint}_`, "");
  }
  return lines.join("\n");
}
