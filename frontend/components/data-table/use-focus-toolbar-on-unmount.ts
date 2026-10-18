import * as React from "react"

/**
 * For toolbar controls that go away (clear filters, the selection bar): if
 * focus was inside, it moves to the toolbar instead of falling to the page.
 */
export function useFocusToolbarOnUnmount<T extends HTMLElement>() {
  const ref = React.useRef<T>(null)
  React.useLayoutEffect(() => {
    const node = ref.current
    return () => {
      if (!node?.contains(document.activeElement)) return
      node.closest<HTMLElement>("[data-slot=data-table-toolbar]")?.focus()
    }
  }, [])
  return ref
}
