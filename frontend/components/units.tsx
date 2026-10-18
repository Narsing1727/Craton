"use client";

// The viewer's display units, from the cookie read once in app/layout.tsx. Anything that shows a length or a
// volume goes through here so the whole site changes together.

import { createContext, useContext } from "react";
import { formatLength, formatVolume, type UnitSystem } from "@/lib/units";
import type { RenderMeta } from "@/lib/api";

const UnitsContext = createContext<UnitSystem>("metric");

export function UnitsProvider({ units, children }: { units: UnitSystem; children: React.ReactNode }) {
  return <UnitsContext.Provider value={units}>{children}</UnitsContext.Provider>;
}

export const useUnits = () => useContext(UnitsContext);

/** A length given in metres, shown in the viewer's unit. */
export function Length({ metres, digits, signed }: { metres: number; digits?: number; signed?: boolean }) {
  return <>{formatLength(metres, useUnits(), { digits, signed })}</>;
}

/** A volume given in cubic metres, shown in the viewer's unit. */
export function Volume({ cubicMetres }: { cubicMetres: number }) {
  return <>{formatVolume(cubicMetres, useUnits())}</>;
}

/** "3.2 m – 842.6 m · 724 × 724 px" for a raster, "9 features" for a vector; null when there is nothing to say. */
export function PreviewCaption({ meta, fallback = null }: { meta: RenderMeta | null; fallback?: string | null }) {
  const units = useUnits();
  if (!meta) return <>{fallback}</>;
  if (meta.features !== undefined) return <>{`${meta.features} feature${meta.features === 1 ? "" : "s"}`}</>;
  if (meta.min !== undefined && meta.max !== undefined) {
    return <>{`${formatLength(meta.min, units, { digits: 1 })} – ${formatLength(meta.max, units, { digits: 1 })} · ${meta.sourceWidth} × ${meta.sourceHeight} px`}</>;
  }
  return <>{fallback}</>;
}
