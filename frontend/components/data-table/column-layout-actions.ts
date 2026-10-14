import * as React from "react"
import type { DataTableInstance } from "@querycn/table-react"

import { measureColumnWidth } from "@/components/data-table/measure-column-width"

type Column<TData extends object> = ReturnType<
  DataTableInstance<TData>["getAllLeafColumns"]
>[number]

const FIT_MAX = 800

/** The width a column may take: its `minSize` and `maxSize`. */
export function getColumnWidthBounds(column: {
  columnDef: { minSize?: number; maxSize?: number }
}) {
  return {
    min: column.columnDef.minSize ?? 20,
    max: column.columnDef.maxSize ?? Number.MAX_SAFE_INTEGER,
  }
}

/** Widths that show each column's rendered cells in full, within its bounds. */
export function measureColumnWidths<TData extends object>(
  container: HTMLElement,
  columns: Column<TData>[]
) {
  return Object.fromEntries(
    columns.map((column) => {
      const { min, max } = getColumnWidthBounds(column)
      return [
        column.id,
        measureColumnWidth(container, column.id, {
          min,
          max: Math.min(max, FIT_MAX),
        }),
      ]
    })
  )
}

// Each table's scroll container, for menus rendered outside it.
const containers = new WeakMap<object, HTMLElement>()

/** `DataTable` registers its scroll container, so menus outside it can measure cells. */
export function useTableContainer(
  table: object,
  ref: React.RefObject<HTMLElement | null>
) {
  React.useEffect(() => {
    const node = ref.current
    if (!node) return
    containers.set(table, node)
    return () => {
      if (containers.get(table) === node) containers.delete(table)
    }
  }, [table, ref])
}

/** Fits the columns (every visible resizable one by default) to their content. */
export function fitColumns<TData extends object>(
  table: DataTableInstance<TData>,
  columns = table.getVisibleLeafColumns().filter((c) => c.getCanResize())
) {
  const container = containers.get(table)
  if (!container || columns.length === 0) return
  const widths = measureColumnWidths(container, columns)
  table.setColumnSizing((sizes) => ({ ...sizes, ...widths }))
}

/**
 * Pins next to the scrolling columns, so columns pinned for good (a selection
 * column) keep the outer edge. `false` unpins.
 */
export function pinColumn<TData extends object>(
  table: DataTableInstance<TData>,
  column: Column<TData>,
  position: "start" | "end" | false
) {
  table.setColumnPinning(({ start = [], end = [] }) => {
    const pinning = {
      start: start.filter((id) => id !== column.id),
      end: end.filter((id) => id !== column.id),
    }
    if (position === "start") pinning.start.push(column.id)
    if (position === "end") pinning.end.unshift(column.id)
    return pinning
  })
}

/**
 * Back to the columns' defaults (order, visibility, pinning, widths, colors),
 * forgetting the saved layout so later column changes apply.
 */
export function resetLayout<TData extends object>(
  table: DataTableInstance<TData>
) {
  table.options.meta?.resetLayout()
}

/**
 * Whether a header gets the ⋯ menu: it has something to sort, pin, fit or
 * hide. A selection column doesn't, and in its narrow cell the ⋯ button
 * would cover the select-all checkbox.
 */
export function hasColumnMenu(column: {
  getCanSort: () => boolean
  getCanPin: () => boolean
  getCanResize: () => boolean
  getCanHide: () => boolean
}) {
  return (
    column.getCanSort() ||
    column.getCanPin() ||
    column.getCanResize() ||
    column.getCanHide()
  )
}

/**
 * The columns a column list shows: every leaf, hidden ones too, in the order
 * the table shows them. Leaves out columns nothing can be done with, such as
 * a selection column.
 */
export function getListedColumns<TData extends object>(
  table: DataTableInstance<TData>
) {
  return [
    ...table.getStartLeafColumns(),
    ...table.getCenterLeafColumns(),
    ...table.getEndLeafColumns(),
  ].filter(
    (column) =>
      column.getCanHide() ||
      column.getCanPin() ||
      (table.options.meta?.enableColumnOrdering !== false &&
        column.columnDef.meta?.enableOrdering !== false)
  )
}
