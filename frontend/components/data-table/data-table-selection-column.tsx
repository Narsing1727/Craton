"use client"

import * as React from "react"
import {
  createDataTableColumnHelper,
  enTableMessages,
  type DataTableColumnDef,
  type TableMessages,
} from "@querycn/table-react"

import { Checkbox } from "@/components/ui/checkbox"

// shadcn's checkbox draws "some selected" with its check icon; show a dash instead.
const MIXED =
  "aria-[checked=mixed]:border-primary aria-[checked=mixed]:bg-primary aria-[checked=mixed]:text-primary-foreground aria-[checked=mixed]:before:h-0.5 aria-[checked=mixed]:before:w-2 aria-[checked=mixed]:before:rounded-full aria-[checked=mixed]:before:bg-current aria-[checked=mixed]:[&_svg]:hidden"

/**
 * A checkbox column for row selection: the header one selects the page.
 * Pinned to the start and can't be hidden, sorted or resized.
 */
export function createSelectionColumn<TData extends object>(
  messages: Pick<TableMessages, "selection"> = enTableMessages
): DataTableColumnDef<TData> {
  return createDataTableColumnHelper<TData>().display({
    id: "select",
    size: 40,
    enableSorting: false,
    enableHiding: false,
    enablePinning: false,
    enableResizing: false,
    meta: { defaultPinned: "start", enableOrdering: false },
    header: ({ table }) => (
      <Checkbox
        aria-label={messages.selection.selectAll}
        className={MIXED}
        checked={table.getIsAllPageRowsSelected()}
        indeterminate={
          table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
        }
        onCheckedChange={(checked) =>
          table.toggleAllPageRowsSelected(!!checked)
        }
      />
    ),
    cell: ({ row }) => (
      <Checkbox
        aria-label={messages.selection.selectRow}
        checked={row.getIsSelected()}
        disabled={!row.getCanSelect()}
        onCheckedChange={(checked) => row.toggleSelected(!!checked)}
      />
    ),
  })
}
