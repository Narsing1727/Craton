import type { DataTableInstance } from "@querycn/table-react"

/** Selected rows on the page; a selected row pushed to another page doesn't count. */
export function getSelectedPageRows<TData extends object>(
  table: DataTableInstance<TData>
) {
  return table.getRowModel().rows.filter((row) => row.getIsSelected())
}

/** What the pagination bar shows, read from the table. */
export function getPaginationState<TData extends object>(
  table: DataTableInstance<TData>
) {
  const { pageIndex, pageSize } = table.store.state.pagination
  const pageRows = table.getRowModel().rows
  // Server mode before the backend's first total.
  const isTotalUnknown =
    table.options.manualPagination && table.options.rowCount === undefined
  // A first page that isn't full is every row there is.
  const rowCount =
    !isTotalUnknown || (pageIndex === 0 && pageRows.length < pageSize)
      ? table.getRowCount()
      : undefined
  const pageCount = rowCount === undefined ? undefined : table.getPageCount()
  // The URL only accepts these; the current size is there even if it's another.
  const pageSizes = [
    ...new Set([...(table.options.meta?.pageSizes ?? []), pageSize]),
  ].sort((a, b) => a - b)
  // Without a total, a full page is the only hint that another one follows.
  const hasNext =
    pageCount === undefined
      ? pageRows.length >= pageSize
      : pageIndex + 1 < pageCount

  return {
    page: pageIndex + 1,
    pageCount,
    pageSize,
    pageSizes,
    rowCount,
    pageRowCount: pageRows.length,
    selectedCount: getSelectedPageRows(table).length,
    isEmpty: rowCount === 0,
    // Every size would show every row: nothing to pick.
    showPageSizes: rowCount === undefined || rowCount > pageSizes[0]!,
    showPages: pageIndex > 0 || hasNext,
    hasPrevious: pageIndex > 0,
    hasNext,
  }
}
