import * as React from "react"

import { cn } from "cn"
import { headerCellClassName } from "@/components/data-table/data-table-cell-classes"

/**
 * Where a row's filler cell goes: before the columns pinned to the end, so
 * they stay against the table's end edge, else last. `-1` means last.
 */
export function getFillerIndex(
  columns: readonly { getIsPinned: () => false | "start" | "end" }[]
) {
  return columns.findIndex((column) => column.getIsPinned() === "end")
}

// Takes the width the columns leave when they add up to less than the table,
// so rows and their hover and selection colors reach the border.
export function DataTableFillerHead() {
  return (
    <th
      aria-hidden
      data-slot="data-table-filler"
      className={cn(headerCellClassName, "p-0")}
    />
  )
}

export function DataTableFillerCell() {
  return <td aria-hidden data-slot="data-table-filler" className="p-0" />
}

/** `cells` with the filler put in at `getFillerIndex`. */
export function withFiller<T>(
  cells: readonly T[],
  index: number,
  render: (cell: T) => React.ReactNode,
  filler: React.ReactNode
) {
  const at = index === -1 ? cells.length : index
  return [
    ...cells.slice(0, at).map(render),
    <React.Fragment key="filler">{filler}</React.Fragment>,
    ...cells.slice(at).map(render),
  ]
}
