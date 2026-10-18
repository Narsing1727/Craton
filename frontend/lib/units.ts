// Display units. The data is stored and computed in metres; this only changes how numbers are shown. Rasters
// are assumed to carry elevations in metres, which is what the rest of the site already says.

export type UnitSystem = "metric" | "imperial";

/** Cookie holding the choice, so server-rendered pages already show the right unit. */
export const UNITS_COOKIE = "craton_units";

export function parseUnits(value: string | null | undefined): UnitSystem {
  return value === "imperial" ? "imperial" : "metric";
}

const FEET_PER_METRE = 3.280839895013123;
const CUBIC_FEET_PER_CUBIC_METRE = 35.31466672148859;
const ACRE_FEET_PER_CUBIC_METRE = 1 / 1233.4818375475;

export const lengthUnit = (units: UnitSystem) => (units === "imperial" ? "ft" : "m");

/** A length in metres, in the chosen system. Differences convert the same way (no offset). */
export const toLength = (metres: number, units: UnitSystem) => (units === "imperial" ? metres * FEET_PER_METRE : metres);

/** "12.34 ft", with a sign when asked (a change). Uses a real minus sign. */
export function formatLength(metres: number, units: UnitSystem, opts: { digits?: number; signed?: boolean } = {}): string {
  const { digits = 2, signed = false } = opts;
  const v = toLength(metres, units);
  const body = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = v < 0 && Number(body.replace(/,/g, "")) !== 0 ? "−" : signed && v > 0 && Number(body.replace(/,/g, "")) !== 0 ? "+" : "";
  return `${sign}${body} ${lengthUnit(units)}`;
}

/** A volume change in cubic metres: m3 (million m3 when large), or acre-feet, the usual unit in US hydrology. */
export function formatVolume(cubicMetres: number, units: UnitSystem): string {
  const sign = cubicMetres > 0 ? "+" : cubicMetres < 0 ? "−" : "";
  const a = Math.abs(cubicMetres);
  if (units === "metric") {
    if (a >= 1e6) return `${sign}${(a / 1e6).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} million m³`;
    return `${sign}${Math.round(a).toLocaleString("en-US")} m³`;
  }
  const af = a * ACRE_FEET_PER_CUBIC_METRE;
  if (af >= 1000) return `${sign}${Math.round(af).toLocaleString("en-US")} acre-ft`;
  if (af >= 1) return `${sign}${af.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} acre-ft`;
  return `${sign}${Math.round(a * CUBIC_FEET_PER_CUBIC_METRE).toLocaleString("en-US")} ft³`;
}
