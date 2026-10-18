import * as React from "react"

/**
 * Moving to the first or last page disables the button that did it, and the
 * browser drops its focus to `<body>`. This keeps keyboard users in the
 * pagination: focus goes to the current page's button, else the nav itself.
 */
export function useKeepFocusInPagination(page: number) {
  const navRef = React.useRef<HTMLElement>(null)
  // Some browsers blur the disabled button before effects run.
  const hadFocus = React.useRef(false)

  React.useEffect(() => {
    const nav = navRef.current
    if (!nav || !hadFocus.current) return
    const active = document.activeElement
    const lost =
      active === null ||
      active === document.body ||
      (nav.contains(active) && active.matches(":disabled"))
    if (!lost) return
    nav.querySelector<HTMLElement>('[aria-current="page"]')?.focus()
    if (!nav.contains(document.activeElement)) nav.focus()
  }, [page])

  return {
    ref: navRef,
    tabIndex: -1,
    onFocus: () => {
      hadFocus.current = true
    },
    onBlur: (event: React.FocusEvent) => {
      if (
        event.relatedTarget &&
        !event.currentTarget.contains(event.relatedTarget)
      ) {
        hadFocus.current = false
      }
    },
  }
}
