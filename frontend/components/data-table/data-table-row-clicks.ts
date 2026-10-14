import type * as React from "react"

// Controls inside a row (checkbox, link, menu) don't count as a click on it.
const CONTROLS =
  "a, button, input, label, select, textarea, [role=button], [role=checkbox], [role=menuitem]"

export function isFromControl(event: React.MouseEvent) {
  const target = event.target as Element
  // Portalled menus and popovers bubble through React but sit outside the row.
  if (!event.currentTarget.contains(target)) return true
  const control = target.closest(CONTROLS)
  return control !== null && event.currentTarget.contains(control)
}

// The clicks of a double click, or selecting text, aren't a row click.
export const isRowClick = (event: React.MouseEvent) =>
  !isFromControl(event) &&
  event.detail <= 1 &&
  (window.getSelection()?.isCollapsed ?? true)
