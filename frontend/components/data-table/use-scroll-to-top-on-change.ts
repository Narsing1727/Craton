import * as React from "react"

/** Back to the first row when `key` (sort, page, filter…) changes. */
export function useScrollToTopOnChange(
  ref: React.RefObject<HTMLElement | null>,
  key: string
) {
  const last = React.useRef(key)
  // Before paint, so the new rows never show at the old position.
  React.useLayoutEffect(() => {
    if (last.current === key) return
    last.current = key
    if (ref.current) ref.current.scrollTop = 0
  }, [ref, key])
}
