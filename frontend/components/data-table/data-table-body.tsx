"use client"

import * as React from "react"
import type {
  DataTableInstance,
  DataTableRow,
  TableMessages,
} from "@querycn/table-react"

import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TableBody, TableCell, TableRow } from "@/components/ui/table"
import { pinnedCellClassName } from "@/components/data-table/data-table-cell-classes"
import { useColumnDragCell } from "@/components/data-table/column-reorder"
import {
  getColumnCellProps,
  type getPinnedEdges,
} from "@/components/data-table/data-table-pinning"
import {
  isFromControl,
  isRowClick,
} from "@/components/data-table/data-table-row-clicks"
import type { VirtualRows } from "@/components/data-table/use-virtual-rows"
import {
  DataTableFillerCell,
  getFillerIndex,
  withFiller,
} from "@/components/data-table/data-table-filler"
import {
  cellEditors as defaultCellEditors,
  type CellEditors,
} from "@/components/data-table/data-table-cell-editors"
import { DataTableCellContent } from "@/components/data-table/data-table-editable-cell"

export interface DataTableBodyOptions<TData extends object> {
  /** Skeleton rows on the first load; dims the rows while they reload. */
  isLoading?: boolean
  isError?: boolean
  onRetry?: () => void
  onRowClick?: (row: DataTableRow<TData>, event: React.MouseEvent) => void
  onRowDoubleClick?: (row: DataTableRow<TData>, event: React.MouseEvent) => void
  rowClassName?: (row: DataTableRow<TData>) => string | undefined
  emptyState?: React.ReactNode
  errorState?: React.ReactNode
  skeletonRows?: number
  /**
   * Editors by `meta.edit.type` for editable cells, e.g.
   * `{ ...cellEditors, rating: RatingEditor }`.
   */
  cellEditors?: CellEditors
}

type Column<TData extends object> = ReturnType<
  DataTableInstance<TData>["getAllLeafColumns"]
>[number]

/** The rows of a `DataTable`, or its loading, empty or error state. */
export function DataTableBody<TData extends object>({
  table,
  columns,
  edges,
  messages,
  virtual,
  headerRowCount,
  isLoading = false,
  isError = false,
  onRetry,
  onRowClick,
  onRowDoubleClick,
  rowClassName,
  emptyState,
  errorState,
  skeletonRows = 5,
  cellEditors = defaultCellEditors,
}: DataTableBodyOptions<TData> & {
  table: DataTableInstance<TData>
  /** Visible leaf columns, in the order shown. */
  columns: Column<TData>[]
  edges: ReturnType<typeof getPinnedEdges>
  messages: TableMessages
  virtual: VirtualRows | null
  headerRowCount: number
}) {
  const rows = table.getRowModel().rows
  const dragCell = useColumnDragCell()
  const fillerIndex = getFillerIndex(columns)
  // Every column and the filler cell.
  const span = columns.length + 1

  let body: React.ReactNode
  if (isError) {
    body = (
      <StateRow colSpan={span}>
        {errorState ?? (
          <div className="flex flex-col items-center gap-2">
            <p>{messages.states.error}</p>
            {onRetry && (
              <Button variant="outline" size="sm" onClick={onRetry}>
                {messages.actions.retry}
              </Button>
            )}
          </div>
        )}
      </StateRow>
    )
  } else if (isLoading && rows.length === 0) {
    body = Array.from({ length: skeletonRows }, (_, index) => (
      <TableRow key={index} className="group/row hover:bg-transparent">
        {withFiller(
          columns,
          fillerIndex,
          (column) => (
            <TableCell
              key={column.id}
              {...getColumnCellProps(column, edges)}
              className={pinnedCellClassName}
            >
              <Skeleton className="h-4 w-full" />
            </TableCell>
          ),
          <DataTableFillerCell />
        )}
      </TableRow>
    ))
  } else if (rows.length === 0) {
    body = (
      <StateRow colSpan={span}>{emptyState ?? messages.states.empty}</StateRow>
    )
  } else {
    const shown = virtual
      ? virtual.items.map((item) => ({
          row: rows[item.index]!,
          index: item.index,
        }))
      : rows.map((row, index) => ({ row, index }))
    body = shown.map(({ row, index }) => (
      <TableRow
        key={row.id}
        ref={virtual?.measureRow}
        data-index={index}
        aria-rowindex={virtual ? headerRowCount + index + 1 : undefined}
        data-state={row.getIsSelected() ? "selected" : undefined}
        onClick={
          onRowClick &&
          ((event) => {
            if (isRowClick(event)) onRowClick(row, event)
          })
        }
        onDoubleClick={
          onRowDoubleClick &&
          ((event) => {
            if (!isFromControl(event)) onRowDoubleClick(row, event)
          })
        }
        className={cn(
          "group/row",
          onRowClick && "cursor-pointer",
          rowClassName?.(row)
        )}
      >
        {withFiller(
          [
            ...row.getStartVisibleCells(),
            ...row.getCenterVisibleCells(),
            ...row.getEndVisibleCells(),
          ],
          fillerIndex,
          (cell) => (
            <TableCell
              key={cell.id}
              {...dragCell(
                cell.column.id,
                getColumnCellProps(cell.column, edges)
              )}
              className={pinnedCellClassName}
            >
              <DataTableCellContent
                table={table}
                cell={cell}
                editors={cellEditors}
                messages={messages}
              />
            </TableCell>
          ),
          <DataTableFillerCell />
        )}
      </TableRow>
    ))
  }

  return (
    <TableBody
      className={cn(
        "transition-opacity",
        isLoading && rows.length > 0 && "pointer-events-none opacity-60"
      )}
    >
      {virtual && <SpacerRow height={virtual.before} colSpan={span} />}
      {body}
      {virtual && <SpacerRow height={virtual.after} colSpan={span} />}
    </TableBody>
  )
}

function StateRow({
  colSpan,
  children,
}: {
  colSpan: number
  children: React.ReactNode
}) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell
        colSpan={colSpan}
        className="h-24 text-center text-muted-foreground"
      >
        {children}
      </TableCell>
    </TableRow>
  )
}

// Stands in for the rows scrolled out of view.
function SpacerRow({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null
  return (
    <tr aria-hidden>
      <td colSpan={colSpan} className="p-0" style={{ height }} />
    </tr>
  )
}
