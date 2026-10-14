import * as React from "react"
import type { DataTableInstance } from "@querycn/table-react"

/**
 * The search box's text, written to the URL once typing pauses for `delay`
 * ms, or right away on Enter and clear. A search changed elsewhere (back and
 * forward, Clear filters) shows up in the box.
 */
export function useDataTableSearch<TData extends object>(
  table: DataTableInstance<TData>,
  delay: number
) {
  const meta = table.options.meta
  const search = meta?.search ?? ""
  // `meta` is rebuilt every render; the setter keeps its identity, so typing
  // isn't pushed back by unrelated renders.
  const setSearch = meta?.setSearch
  const [value, setValue] = React.useState(search)
  const [shown, setShown] = React.useState(search)
  if (search !== shown) {
    setShown(search)
    // Keeps what's being typed, trailing space included, when it's the same search.
    if (value.trim() !== search) setValue(search)
  }

  const commit = React.useCallback(
    (text: string) => setSearch?.(text),
    [setSearch]
  )
  React.useEffect(() => {
    if (value.trim() === search) return
    const timer = setTimeout(() => commit(value), delay)
    return () => clearTimeout(timer)
  }, [value, search, delay, commit])

  return {
    value,
    setValue,
    clear: () => {
      setValue("")
      commit("")
    },
    commitNow: () => commit(value),
  }
}
