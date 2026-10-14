import * as React from "react"

interface ColorableColumn {
  getColor: () => string | undefined
  setColor: (color: string | undefined) => void
}

/**
 * A hidden `<input type="color">` for custom column colors. Render
 * `inputProps` outside any popover or menu (the pick must land after they
 * close) and call `open(column)` from a menu item. Commits once the picker
 * closes, not on every move.
 */
export function useColumnColorPicker() {
  const ref = React.useRef<HTMLInputElement>(null)
  const target = React.useRef<ColorableColumn | null>(null)
  React.useEffect(() => {
    const input = ref.current
    if (!input) return
    // React's onChange fires on every move of the picker; "change" on commit.
    const onChange = () => target.current?.setColor(input.value)
    input.addEventListener("change", onChange)
    return () => input.removeEventListener("change", onChange)
  }, [])

  return {
    inputProps: {
      ref,
      type: "color",
      tabIndex: -1,
      "aria-hidden": true,
      className: "sr-only",
    } as const,
    open: (column: ColorableColumn) => {
      const input = ref.current
      if (!input) return
      target.current = column
      // The picker starts from the current color when it's one it can show.
      const color = column.getColor()
      if (color && /^#[\da-f]{6}$/i.test(color)) input.value = color
      input.click()
    },
  }
}
