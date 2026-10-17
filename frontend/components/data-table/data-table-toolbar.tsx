"use client"

import * as React from "react"
import {
  enTableMessages,
  type DataTableInstance,
  type DataTableRow,
  type TableMessages,
} from "@querycn/table-react"
import { RefreshCwIcon } from "lucide-react"

import { cn } from "cn"
import { Button } from "@/components/ui/button"
import { DataTableResetFiltersButton } from "@/components/data-table/data-table-reset-filters-button"
import { DataTableSelectionBar } from "@/components/data-table/data-table-selection-bar"
import { DataTableViewOptions } from "@/components/data-table/data-table-view-options"

export interface DataTableToolbarProps<TData extends object> extends Omit<
  React.ComponentProps<"div">,
  "children"
> {
  table: DataTableInstance<TData>
  messages?: TableMessages
  /** The app's own controls: a search box, `FilterBuilder`, `FilterChips`… */
  children?: React.ReactNode
  /** Shows a reload button. */
  onRefresh?: () => void
  isRefreshing?: boolean
  /** Actions for the selected rows, shown in a bar while some are. Without them, no bar. */
  selectionActions?: (rows: DataTableRow<TData>[]) => React.ReactNode
}

/**
 * Above a `DataTable`: the app's controls, then clear filters, reload and the
 * column menu; under them, with `selectionActions`, the selection bar while
 * rows are selected.
 */
export function DataTableToolbar<TData extends object>({
  table,
  messages = enTableMessages,
  children,
  onRefresh,
  isRefreshing = false,
  selectionActions,
  className,
  ...props
}: DataTableToolbarProps<TData>) {
  return (
    <div
      data-slot="data-table-toolbar"
      // Takes focus from a control that goes away, like clear filters.
      tabIndex={-1}
      className={cn("flex flex-col gap-2 outline-none", className)}
      {...props}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {children}
        </div>
        <div className="flex items-center gap-2">
          <DataTableResetFiltersButton table={table} messages={messages} />
          {onRefresh && (
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={messages.actions.reload}
              // Pending, not disabled: it keeps focus.
              aria-disabled={isRefreshing || undefined}
              onClick={() => {
                if (!isRefreshing) onRefresh()
              }}
            >
              <RefreshCwIcon
                className={cn(
                  isRefreshing && "animate-spin motion-reduce:animate-none"
                )}
              />
            </Button>
          )}
          <DataTableViewOptions table={table} messages={messages} />
        </div>
      </div>
      {/* Without actions the bar adds nothing: the pagination already counts
          the selection, and the header checkbox clears it. */}
      {selectionActions && (
        <DataTableSelectionBar
          table={table}
          messages={messages}
          actions={selectionActions}
        />
      )}
    </div>
  )
}
