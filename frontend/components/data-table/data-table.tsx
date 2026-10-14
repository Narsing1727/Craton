"use client"

import * as React from "react"
import { useAppliedFilter } from "@querycn/filter-react"
import {
  enTableMessages,
  type DataTableInstance,
  type TableMessages,
} from "@querycn/table-react"

import { cn } from "cn"
import { TableHead, TableHeader, TableRow } from "@/components/ui/table"
import {
  headerCellClassName,
  pinnedCellClassName,
} from "@/components/data-table/data-table-cell-classes"
import {
  getHeaderCellProps,
  getPinnedEdges,
} from "@/components/data-table/data-table-pinning"
import {
  canReorderColumns,
  ColumnReorder,
} from "@/components/data-table/column-reorder"
import { useTableContainer } from "@/components/data-table/column-layout-actions"
import { useScrollEdges } from "@/components/data-table/use-scroll-edges"
import { useScrollToTopOnChange } from "@/components/data-table/use-scroll-to-top-on-change"
import { useVirtualRows } from "@/components/data-table/use-virtual-rows"
import {
  DataTableFillerHead,
  getFillerIndex,
  withFiller,
} from "@/components/data-table/data-table-filler"
import {
  DataTableBody,
  type DataTableBodyOptions,
} from "@/components/data-table/data-table-body"
import { DataTableColumnHeader } from "@/components/data-table/data-table-column-header"

export interface DataTableProps<TData extends object>
  extends
    Omit<React.ComponentProps<"div">, "children">,
    DataTableBodyOptions<TData> {
  table: DataTableInstance<TData>
  messages?: TableMessages
  /**
   * Renders only the rows in view, for long pages (thousands of rows). Needs
   * a height on the table, e.g. `className="h-[600px]"`. Fitting a column to
   * its content then measures the rendered rows only.
   */
  virtualize?: boolean
  /** A row's height before it's measured, in pixels. */
  estimateRowHeight?: number
}

/**
 * Renders a `useDataTable` table: sticky header, pinned columns, loading,
 * empty and error states. The container scrolls, so give it a height (e.g.
 * `className="max-h-[600px]"`) for the header to stay in view. Scrolls back
 * to the top when the sort, page, search or filter changes.
 */
export function DataTable<TData extends object>({
  table,
  messages = enTableMessages,
  virtualize = false,
  estimateRowHeight = 37,
  isLoading,
  isError,
  onRetry,
  onRowClick,
  onRowDoubleClick,
  rowClassName,
  emptyState,
  errorState,
  skeletonRows,
  cellEditors,
  className,
  ...props
}: DataTableProps<TData>) {
  const [scrollRef, scrolled] = useScrollEdges<HTMLDivElement>()
  useTableContainer(table, scrollRef)
  const columns = [
    ...table.getStartVisibleLeafColumns(),
    ...table.getCenterVisibleLeafColumns(),
    ...table.getEndVisibleLeafColumns(),
  ]
  const edges = getPinnedEdges(table)
  const headerGroups = table.getHeaderGroups()
  const canReorder = canReorderColumns(table)
  const rows = table.getRowModel().rows
  const rowCount = rows.length
  const { sorting, pagination } = table.store.state
  const { queryKey } = useAppliedFilter()
  useScrollToTopOnChange(
    scrollRef,
    JSON.stringify([sorting, pagination, queryKey, table.options.meta?.search])
  )
  const virtual = useVirtualRows({
    enabled: virtualize && !isError,
    count: rowCount,
    getRowId: React.useCallback((index: number) => rows[index]!.id, [rows]),
    scrollRef,
    estimateRowHeight,
  })

  return (
    <div
      ref={scrollRef}
      data-slot="data-table"
      data-scroll-start={scrolled.start || undefined}
      data-scroll-end={scrolled.end || undefined}
      className={cn(
        "group/data-table relative w-full overflow-auto rounded-md border",
        className
      )}
      {...props}
    >
      <ColumnReorder table={table} messages={messages}>
        <table
          data-slot="table"
          aria-busy={isLoading || undefined}
          // Screen readers count every row, not only those rendered.
          aria-rowcount={
            virtual && rowCount > 0 ? headerGroups.length + rowCount : undefined
          }
          className="table-fixed caption-bottom text-sm"
          // Fills the container; a filler cell takes what the columns leave.
          style={{ width: "100%", minWidth: table.getTotalSize() }}
        >
          <TableHeader className="sticky top-0 z-20 bg-background [&_tr]:border-b-0">
            {headerGroups.map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {withFiller(
                  headerGroup.headers,
                  getFillerIndex(
                    headerGroup.headers.map((header) => header.column)
                  ),
                  (header) =>
                    header.subHeaders.length === 0 ? (
                      <DataTableColumnHeader
                        key={header.id}
                        table={table}
                        header={header}
                        edges={edges}
                        messages={messages}
                        canReorder={canReorder}
                      />
                    ) : (
                      <TableHead
                        key={header.id}
                        colSpan={header.colSpan}
                        {...getHeaderCellProps(header, edges)}
                        className={cn(pinnedCellClassName, headerCellClassName)}
                      >
                        {header.isPlaceholder ? null : (
                          <div className="truncate">
                            <table.FlexRender header={header} />
                          </div>
                        )}
                      </TableHead>
                    ),
                  <DataTableFillerHead />
                )}
              </TableRow>
            ))}
          </TableHeader>
          <DataTableBody
            table={table}
            columns={columns}
            edges={edges}
            messages={messages}
            virtual={virtual}
            headerRowCount={headerGroups.length}
            isLoading={isLoading}
            isError={isError}
            onRetry={onRetry}
            onRowClick={onRowClick}
            onRowDoubleClick={onRowDoubleClick}
            rowClassName={rowClassName}
            emptyState={emptyState}
            errorState={errorState}
            skeletonRows={skeletonRows}
            cellEditors={cellEditors}
          />
        </table>
      </ColumnReorder>
    </div>
  )
}
