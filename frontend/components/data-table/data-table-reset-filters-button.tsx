"use client"

import * as React from "react"
import { useAppliedFilter, useFilterActions } from "@querycn/filter-react"
import {
  enTableMessages,
  type DataTableInstance,
  type TableMessages,
} from "@querycn/table-react"
import { XIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useFocusToolbarOnUnmount } from "@/components/data-table/use-focus-toolbar-on-unmount"

export interface DataTableResetFiltersButtonProps<TData extends object> {
  table: DataTableInstance<TData>
  messages?: TableMessages
  className?: string
}

/**
 * Clears the applied filter and the search. Shown only while one of them
 * applies; without a `FilterProvider`, only the search counts. The page goes
 * back to 1 through the provider's `onApply={() => resetPagePatch()}`, like
 * any other filter change.
 */
export function DataTableResetFiltersButton<TData extends object>(
  props: DataTableResetFiltersButtonProps<TData>
) {
  const { activeCount } = useAppliedFilter()
  const meta = props.table.options.meta
  const clearSearch = () => meta?.setSearch("")
  if (activeCount > 0) {
    return <ResetFilterAndSearch {...props} clearSearch={clearSearch} />
  }
  if (!meta?.search) return null
  return <ResetButton {...props} onReset={clearSearch} />
}

// Only under a provider: `useFilterActions` needs one.
function ResetFilterAndSearch<TData extends object>({
  clearSearch,
  ...props
}: DataTableResetFiltersButtonProps<TData> & { clearSearch: () => void }) {
  const { reset } = useFilterActions()
  return (
    <ResetButton
      {...props}
      onReset={() => {
        reset()
        clearSearch()
      }}
    />
  )
}

function ResetButton<TData extends object>({
  messages = enTableMessages,
  className,
  onReset,
}: DataTableResetFiltersButtonProps<TData> & { onReset: () => void }) {
  const ref = useFocusToolbarOnUnmount<HTMLButtonElement>()
  return (
    <Button
      ref={ref}
      variant="ghost"
      size="sm"
      className={className}
      onClick={onReset}
    >
      <XIcon />
      {messages.actions.clearFilters}
    </Button>
  )
}
