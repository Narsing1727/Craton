import * as React from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

export interface UseVirtualRowsOptions {
  enabled: boolean
  count: number
  /** The row's id at an index, so a measured height follows the row when it moves. */
  getRowId: (index: number) => string
  scrollRef: React.RefObject<HTMLElement | null>
  estimateRowHeight: number
}

/**
 * Renders only the rows in view, plus a few either side. The rows around them
 * become two spacers, so the scrollbar still reflects the whole list. `null`
 * when off.
 */
export function useVirtualRows({
  enabled,
  count,
  getRowId,
  scrollRef,
  estimateRowHeight,
}: UseVirtualRowsOptions) {
  // React Compiler skips this hook, and what it returns is rebuilt every render.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: enabled ? count : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => estimateRowHeight,
    getItemKey: getRowId,
    overscan: 10,
  })
  if (!enabled) return null
  const items = virtualizer.getVirtualItems()
  return {
    items,
    before: items[0]?.start ?? 0,
    after: virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0),
    /** The row's ref; the row needs `data-index`. */
    measureRow: virtualizer.measureElement,
  }
}

export type VirtualRows = NonNullable<ReturnType<typeof useVirtualRows>>
