"use client"

import * as React from "react"
import type { DataTableInstance, TableMessages } from "@querycn/table-react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  ChevronsUpDownIcon,
  GripVerticalIcon,
} from "lucide-react"

import { cn } from "cn"
import { TableHead } from "@/components/ui/table"
import {
  headerCellClassName,
  pinnedCellClassName,
} from "@/components/data-table/data-table-cell-classes"
import {
  getHeaderCellProps,
  type PinnedEdges,
} from "@/components/data-table/data-table-pinning"
import { getColumnLabel } from "@/components/data-table/column-label"
import { hasColumnMenu } from "@/components/data-table/column-layout-actions"
import { DataTableColumnMenu } from "@/components/data-table/data-table-column-menu"
import { ColumnGuideLine } from "@/components/data-table/column-guide-line"
import { useColumnDrag } from "@/components/data-table/column-reorder"
import { ColumnResizeHandle } from "@/components/data-table/column-resize-handle"
import { useColumnColorPicker } from "@/components/data-table/use-column-color-picker"

type Header<TData extends object> = ReturnType<
  DataTableInstance<TData>["getFlatHeaders"]
>[number]

const ARIA_SORT = { asc: "ascending", desc: "descending" } as const

/**
 * A leaf column's header cell: click to sort (Shift+click adds the column to
 * the sort), drag it to reorder, drag the end edge to resize. Its ⋯ button, or
 * a right-click, opens a menu to sort, pin, fit, color or hide the column.
 */
export function DataTableColumnHeader<TData extends object>({
  table,
  header,
  edges,
  messages,
  canReorder,
}: {
  table: DataTableInstance<TData>
  header: Header<TData>
  edges: PinnedEdges
  messages: TableMessages
  canReorder: boolean
}) {
  const { column } = header
  const label = getColumnLabel(column)
  const sorted = column.getIsSorted()
  const sortIndex =
    sorted && table.store.state.sorting.length > 1
      ? column.getSortIndex() + 1
      : undefined
  const {
    disabled: isFixed,
    isDragging,
    dropSide,
    setNodeRef,
    pointerProps,
    setHandleRef,
    handleProps,
    style: dragStyle,
  } = useColumnDrag(column, canReorder)
  const cellProps = getHeaderCellProps(header, edges)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const colorPicker = useColumnColorPicker()
  const hasMenu = hasColumnMenu(column)
  const SortIcon =
    sorted === "asc"
      ? ArrowUpIcon
      : sorted === "desc"
        ? ArrowDownIcon
        : ChevronsUpDownIcon

  const title = (
    <>
      <span className="truncate">
        <table.FlexRender header={header} />
      </span>
      {column.columnDef.meta?.required && (
        <span aria-hidden className="text-destructive">
          *
        </span>
      )}
    </>
  )

  return (
    <TableHead
      ref={setNodeRef}
      colSpan={header.colSpan}
      aria-sort={
        column.getCanSort() ? (sorted ? ARIA_SORT[sorted] : "none") : undefined
      }
      data-dragging={isDragging || undefined}
      onContextMenu={(event) => {
        if (!hasMenu) return
        event.preventDefault()
        setMenuOpen(true)
      }}
      {...cellProps}
      style={{ ...cellProps.style, ...dragStyle }}
      className={cn(
        pinnedCellClassName,
        headerCellClassName,
        "group/header data-dragging:z-30"
      )}
    >
      <div
        {...pointerProps}
        className={cn(
          "flex min-w-0 items-center",
          !isFixed && "cursor-grab active:cursor-grabbing"
        )}
      >
        {column.getCanSort() ? (
          <button
            type="button"
            onClick={column.getToggleSortingHandler()}
            className="-mx-1 flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            {title}
            <SortIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0",
                !sorted &&
                  "text-muted-foreground opacity-0 group-hover/header:opacity-100"
              )}
            />
            {sortIndex !== undefined && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {sortIndex}
              </span>
            )}
          </button>
        ) : (
          <span className="flex min-w-0 items-center gap-1">{title}</span>
        )}
      </div>
      {/* After the content: `measureColumnWidth` measures a cell's first child. */}
      {!isFixed && (
        <button
          type="button"
          ref={setHandleRef}
          aria-label={messages.header.move(label)}
          {...handleProps}
          className="pointer-events-none absolute start-0.5 top-1/2 z-10 flex size-5 -translate-y-1/2 items-center justify-center rounded-sm bg-background text-muted-foreground opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <GripVerticalIcon className="size-3.5" />
        </button>
      )}
      {hasMenu && (
        <DataTableColumnMenu
          table={table}
          column={column}
          messages={messages}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onCustomColor={() => colorPicker.open(column)}
          className="absolute end-1.5 top-1/2 z-10 -translate-y-1/2"
        />
      )}
      <input {...colorPicker.inputProps} />
      {dropSide && (
        <ColumnGuideLine
          className={dropSide === "start" ? "-start-px" : "-end-px"}
        />
      )}
      {column.getCanResize() && (
        <ColumnResizeHandle
          header={header}
          label={messages.header.resize(label)}
        />
      )}
    </TableHead>
  )
}
