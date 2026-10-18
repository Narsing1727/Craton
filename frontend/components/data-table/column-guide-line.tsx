"use client"

import * as React from "react"

import { cn } from "cn"

/**
 * A vertical line from a header cell down through the rows in view: where a
 * resized column's edge or a moved column will land. Place it in a positioned
 * header cell and set its inline position with `className`.
 */
export function ColumnGuideLine({ className }: { className?: string }) {
  const ref = React.useRef<HTMLSpanElement>(null)
  React.useLayoutEffect(() => {
    const line = ref.current
    const table = line?.closest("table")
    const container = line?.closest("[data-slot=data-table]")
    if (!line || !table || !container) return
    // Down to the last row, or the bottom of the scroll area when it's taller.
    const bottom = Math.min(
      table.getBoundingClientRect().bottom,
      container.getBoundingClientRect().bottom
    )
    line.style.height = `${bottom - line.getBoundingClientRect().top}px`
  }, [])
  return (
    <span
      ref={ref}
      aria-hidden
      data-slot="data-table-guide-line"
      className={cn(
        "pointer-events-none absolute top-0 z-10 h-full w-0.5 bg-primary",
        className
      )}
    />
  )
}
