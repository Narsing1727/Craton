import type { CSSProperties } from "react"

/** Preset colors: mid-tone, so a light tint reads on light and dark themes. */
export const COLUMN_COLOR_PRESETS = {
  red: "oklch(0.64 0.21 25)",
  orange: "oklch(0.7 0.18 50)",
  amber: "oklch(0.78 0.16 80)",
  green: "oklch(0.7 0.17 150)",
  teal: "oklch(0.7 0.12 185)",
  blue: "oklch(0.62 0.19 255)",
  violet: "oklch(0.6 0.22 295)",
  pink: "oklch(0.68 0.2 350)",
} as const

export type ColumnColorPreset = keyof typeof COLUMN_COLOR_PRESETS

export const columnColorPresets = Object.keys(
  COLUMN_COLOR_PRESETS
) as ColumnColorPreset[]

export const isColumnColorPreset = (
  color: string
): color is ColumnColorPreset => Object.hasOwn(COLUMN_COLOR_PRESETS, color)

// Colors come back from localStorage, so only plain color syntax reaches a style:
// no url(), no way out of the declaration.
const SAFE_COLOR =
  /^(#[\da-f]{3,8}|[a-z]+|(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\([\d\s.,%/+-]+\))$/i

/** The CSS color for a stored column color: a preset name or a CSS color. */
export function resolveColumnColor(color: string | undefined) {
  if (color === undefined) return undefined
  if (isColumnColorPreset(color)) return COLUMN_COLOR_PRESETS[color]
  return SAFE_COLOR.test(color) ? color : undefined
}

/**
 * Sets `--column-color` on a cell; `pinnedCellClassName` layers a light tint
 * of it over the cell's own background, so pinned cells stay opaque and hover
 * or selection still shows.
 */
export function columnColorStyle(
  color: string | undefined
): CSSProperties | undefined {
  const resolved = resolveColumnColor(color)
  return resolved
    ? ({ "--column-color": resolved } as CSSProperties)
    : undefined
}
