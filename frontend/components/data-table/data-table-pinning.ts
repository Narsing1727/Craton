import type { CSSProperties } from "react"

import { columnColorStyle } from "@/components/data-table/column-color-palette"

interface PinnableColumn {
  id: string
  getIsPinned: () => false | "start" | "end"
  getStart: (position?: "start" | "end" | "center") => number
  getAfter: (position?: "start" | "end" | "center") => number
  getSize: () => number
  getColor: () => string | undefined
}

interface PinnableTable {
  getStartVisibleLeafColumns: () => { id: string }[]
  getEndVisibleLeafColumns: () => { id: string }[]
}

/** The pinned columns next to the scrolling ones, which cast the scroll shadow. */
export interface PinnedEdges {
  start?: string
  end?: string
}

export function getPinnedEdges(table: PinnableTable): PinnedEdges {
  return {
    start: table.getStartVisibleLeafColumns().at(-1)?.id,
    end: table.getEndVisibleLeafColumns()[0]?.id,
  }
}

/**
 * Width and color, plus `position: sticky` at TanStack's offsets for pinned
 * columns. Logical insets, so pinning follows the reading direction.
 */
export function getColumnCellProps(column: PinnableColumn, edges: PinnedEdges) {
  const pinned = column.getIsPinned()
  const style: CSSProperties = {
    width: column.getSize(),
    ...columnColorStyle(column.getColor()),
  }
  if (pinned === "start") {
    style.position = "sticky"
    style.insetInlineStart = column.getStart("start")
  } else if (pinned === "end") {
    style.position = "sticky"
    style.insetInlineEnd = column.getAfter("end")
  }
  return {
    "data-column-id": column.id,
    "data-pinned": pinned || undefined,
    "data-pinned-edge":
      column.id === edges.start
        ? "start"
        : column.id === edges.end
          ? "end"
          : undefined,
    style,
  }
}

interface PinnableHeader {
  isPlaceholder: boolean
  subHeaders: unknown[]
  column: PinnableColumn
  getSize: () => number
  getLeafHeaders: () => { column: PinnableColumn; subHeaders: unknown[] }[]
}

/**
 * Like `getColumnCellProps`, for header cells: a placeholder follows its leaf
 * column, and a group sticks when all its columns are pinned to one side.
 */
export function getHeaderCellProps(header: PinnableHeader, edges: PinnedEdges) {
  if (header.isPlaceholder || header.subHeaders.length === 0) {
    return getColumnCellProps(header.column, edges)
  }
  const leaves = header
    .getLeafHeaders()
    .filter((leaf) => leaf.subHeaders.length === 0)
    .map((leaf) => leaf.column)
  const sides = new Set(leaves.map((column) => column.getIsPinned()))
  const pinned = sides.size === 1 ? [...sides][0]! : false
  const first = leaves[0]
  const last = leaves.at(-1)
  const style: CSSProperties = { width: header.getSize() }
  if (pinned === "start" && first) {
    style.position = "sticky"
    style.insetInlineStart = first.getStart("start")
  } else if (pinned === "end" && last) {
    style.position = "sticky"
    style.insetInlineEnd = last.getAfter("end")
  }
  return {
    "data-pinned": pinned || undefined,
    "data-pinned-edge":
      pinned === "start" && last?.id === edges.start
        ? "start"
        : pinned === "end" && first?.id === edges.end
          ? "end"
          : undefined,
    style,
  }
}
