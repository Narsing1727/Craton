export interface MeasureColumnWidthOptions {
  min?: number
  max?: number
}

/**
 * The width a column needs to show every rendered header and cell in full:
 * the cells marked `data-column-id` inside `container`. A cell's first child
 * element is its content; it is laid out at `max-content` for the reading and
 * put back. Cells holding only text are measured by their text, so keep them
 * on one line (`whitespace-nowrap`).
 */
export function measureColumnWidth(
  container: HTMLElement,
  columnId: string,
  { min = 40, max = 800 }: MeasureColumnWidthOptions = {}
): number {
  const cells = [
    ...container.querySelectorAll<HTMLElement>(
      `[data-column-id="${CSS.escape(columnId)}"]`
    ),
  ]
  const contents = cells.map((cell) =>
    cell.firstElementChild instanceof HTMLElement
      ? cell.firstElementChild
      : null
  )
  // Write all, read all, restore all: one layout for the whole column, not one per cell.
  const previous = contents.map((content) => content?.style.width ?? "")
  for (const content of contents) {
    if (content) content.style.width = "max-content"
  }
  let width = 0
  cells.forEach((cell, i) => {
    const style = getComputedStyle(cell)
    const padding =
      (parseFloat(style.paddingLeft) || 0) +
      (parseFloat(style.paddingRight) || 0)
    width = Math.max(width, contentWidth(cell, contents[i]!) + padding)
  })
  contents.forEach((content, i) => {
    if (content) content.style.width = previous[i]!
  })
  return Math.min(Math.max(Math.ceil(width), min), max)
}

function contentWidth(cell: HTMLElement, content: HTMLElement | null) {
  if (content) return content.getBoundingClientRect().width
  const range = document.createRange()
  range.selectNodeContents(cell)
  return range.getBoundingClientRect().width
}
