"use client"

import * as React from "react"
import type { DataTableInstance } from "@querycn/table-react"

import { cn } from "cn"
import { ColumnGuideLine } from "@/components/data-table/column-guide-line"
import {
  getColumnWidthBounds,
  measureColumnWidths,
} from "@/components/data-table/column-layout-actions"

type Header<TData extends object> = ReturnType<
  DataTableInstance<TData>["getFlatHeaders"]
>[number]

const STEP = 10
const LARGE_STEP = 50
const RESIZING_PAGE_STYLE =
  "*{cursor:col-resize!important;user-select:none!important}"

/**
 * The drag handle on a header's end edge: drag to resize, double-click to fit
 * the content, or focus it and use ←/→ (Shift for bigger steps).
 */
export function ColumnResizeHandle<TData extends object>({
  header,
  label,
}: {
  header: Header<TData>
  label: string
}) {
  const { column } = header
  const table = header.getContext().table
  const { min, max } = getColumnWidthBounds(column)
  const isResizing = column.getIsResizing()
  // TanStack flips the offset in right-to-left tables; the line follows the pointer.
  const direction = table.options.columnResizeDirection === "rtl" ? -1 : 1
  const size = column.getSize()
  const delta = isResizing
    ? (table.store.state.columnResizing.deltaOffset ?? 0)
    : 0
  // Where the edge will land: the committed width stays within min and max.
  const preview =
    (Math.min(Math.max(size + delta, min), max) - size) * direction

  const setWidth = (width: number) =>
    table.setColumnSizing((sizes) => ({
      ...sizes,
      [column.id]: Math.min(Math.max(Math.round(width), min), max),
    }))

  const onResize = header.getResizeHandler()
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={size}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-slot="data-table-resize-handle"
      data-resizing={isResizing || undefined}
      onMouseDown={onResize}
      onTouchStart={onResize}
      onDoubleClick={(event) => {
        const container = event.currentTarget.closest<HTMLElement>(
          "[data-slot=data-table]"
        )
        if (container) {
          setWidth(measureColumnWidths(container, [column])[column.id]!)
        }
      }}
      onKeyDown={(event) => {
        // The arrow pointing away from the column widens it, whichever the direction.
        const step = (event.shiftKey ? LARGE_STEP : STEP) * direction
        if (event.key === "ArrowRight") setWidth(size + step)
        else if (event.key === "ArrowLeft") setWidth(size - step)
        else return
        event.preventDefault()
      }}
      // With `columnResizeMode: "onEnd"` the size lands on release; the line previews it.
      style={preview ? { transform: `translateX(${preview}px)` } : undefined}
      className={cn(
        "absolute inset-y-0 -end-1 z-10 w-2 cursor-col-resize touch-none outline-none select-none",
        "after:absolute after:inset-y-1.5 after:start-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:opacity-0 after:transition-opacity hover:after:opacity-100 focus-visible:after:w-0.5 focus-visible:after:bg-ring focus-visible:after:opacity-100 rtl:after:translate-x-1/2"
      )}
    >
      {isResizing && (
        <>
          <ColumnGuideLine className="start-1/2 -translate-x-1/2 rtl:translate-x-1/2" />
          {/* The handle stops at the min/max width and lags fast drags, so the pointer leaves it. */}
          <style>{RESIZING_PAGE_STYLE}</style>
        </>
      )}
    </div>
  )
}
