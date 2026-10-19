// The colour maps every picture of a raster is drawn with (map tiles, previews, thumbnails, the pixel viewer), from the colormap package
// (matplotlib's and cmocean's published ramps), so one file looks the same wherever it is opened.

import colormap from "colormap";

/** The colour maps a viewer may ask for, as 256 RGB steps each. */
const RAMP_NAMES = { terrain: "earth", viridis: "viridis", magma: "magma", greys: "greys", change: "RdBu" } as const;
export type RampName = keyof typeof RAMP_NAMES;
export const isRamp = (v: string): v is RampName => v in RAMP_NAMES;

const ramps = new Map<RampName, [number, number, number][]>();
export function ramp(name: RampName): [number, number, number][] {
  let r = ramps.get(name);
  if (!r) {
    // The earth map's first seventh is sea (dark blue); land starts at its green, so the terrain ramp begins there and dry ground never reads as water.
    const sea = name === "terrain" ? 43 : 0;
    const steps = colormap({ colormap: RAMP_NAMES[name], nshades: 256 + sea, format: "rgba" }) as [number, number, number, number][];
    r = steps.slice(sea).map(([a, b, c]) => [a, b, c]);
    // The change map runs red (ground that fell) to blue (ground that rose), as everywhere else in Craton; RdBu itself runs the other way here.
    if (name === "change" && r[0][2] > r[0][0]) r.reverse();
    ramps.set(name, r);
  }
  return r;
}

/** Each ramp as a few hex stops, for a legend drawn by the page. */
export function rampStops(name: RampName, n = 9) {
  const r = ramp(name);
  return Array.from({ length: n }, (_, i) => r[Math.round((i / (n - 1)) * 255)]).map(([a, b, c]) => `#${[a, b, c].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
}

/** How much the hillshade darkens the colour: lit slopes keep it, slopes facing away fall to 45%. The same for every picture. */
export const lit = (shade: number) => (Number.isNaN(shade) ? 1 : 0.45 + 0.55 * shade);
