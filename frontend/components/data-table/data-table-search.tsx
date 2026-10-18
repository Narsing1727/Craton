"use client"

import * as React from "react"
import {
  enTableMessages,
  type DataTableInstance,
  type TableMessages,
} from "@querycn/table-react"
import { SearchIcon, XIcon } from "lucide-react"

import { cn } from "cn"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"
import { useDataTableSearch } from "@/components/data-table/use-data-table-search"

export interface DataTableSearchProps<TData extends object> {
  table: DataTableInstance<TData>
  messages?: TableMessages
  /** Defaults to the messages' "Search…". */
  placeholder?: string
  /** How long typing pauses before the search is written, in ms. */
  delay?: number
  className?: string
}

/**
 * Searches the rows (`?q=` in the URL): the columns in `searchColumns` in
 * client mode, the backend's search in server mode. Escape clears it.
 */
export function DataTableSearch<TData extends object>({
  table,
  messages = enTableMessages,
  placeholder = messages.search.placeholder,
  delay = 300,
  className,
}: DataTableSearchProps<TData>) {
  const search = useDataTableSearch(table, delay)
  const inputRef = React.useRef<HTMLInputElement>(null)
  const clear = () => {
    search.clear()
    // The × goes away with the text; the box keeps focus.
    inputRef.current?.focus()
  }
  return (
    <InputGroup
      data-slot="data-table-search"
      className={cn("h-8 w-full sm:w-64", className)}
    >
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        ref={inputRef}
        type="search"
        maxLength={200}
        aria-label={messages.search.label}
        placeholder={placeholder}
        value={search.value}
        onChange={(event) => search.setValue(event.target.value)}
        onKeyDown={(event) => {
          // Keys that finish an IME composition aren't meant for the box.
          if (event.nativeEvent.isComposing) return
          if (event.key === "Enter") {
            // Searches now, and doesn't submit a form around the box.
            event.preventDefault()
            search.commitNow()
          }
          if (event.key === "Escape" && search.value) {
            // Clears the text, and stops here so an overlay listening on the way up stays open.
            event.preventDefault()
            event.stopPropagation()
            search.clear()
          }
        }}
        className="[&::-webkit-search-cancel-button]:appearance-none"
      />
      {search.value && (
        <InputGroupAddon align="inline-end">
          <InputGroupButton
            size="icon-xs"
            aria-label={messages.search.clear}
            onClick={clear}
          >
            <XIcon />
          </InputGroupButton>
        </InputGroupAddon>
      )}
    </InputGroup>
  )
}
