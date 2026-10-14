export type PageRangeItem = number | "ellipsis-start" | "ellipsis-end"

/**
 * Page buttons to show, 1-based: at most `slots` (7 by default), always with
 * the first and last page, e.g. `1 … 4 5 6 … 20`. Each ellipsis has its own
 * key so it can be a React key.
 */
export function pageRange(
  page: number,
  pageCount: number,
  slots = 7
): PageRangeItem[] {
  // First, last, two ellipses and the current page need five.
  slots = Math.max(slots, 5)
  if (pageCount <= slots) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const current = Math.min(
    Math.max(Number.isFinite(page) ? page : 1, 1),
    pageCount
  )
  const middle = slots - 4
  const edge = slots - 2
  let range: PageRangeItem[]
  if (current <= edge - 1) {
    range = [
      ...Array.from({ length: edge }, (_, i) => i + 1),
      "ellipsis-end",
      pageCount,
    ]
  } else if (current >= pageCount - edge + 2) {
    range = [
      1,
      "ellipsis-start",
      ...Array.from({ length: edge }, (_, i) => pageCount - edge + 1 + i),
    ]
  } else {
    const start = current - Math.floor((middle - 1) / 2)
    range = [
      1,
      "ellipsis-start",
      ...Array.from({ length: middle }, (_, i) => start + i),
      "ellipsis-end",
      pageCount,
    ]
  }
  // An ellipsis standing for a single page shows that page instead.
  return range.map((item, i) =>
    item === "ellipsis-start" && range[i + 1] === 3
      ? 2
      : item === "ellipsis-end" && range[i - 1] === pageCount - 2
        ? pageCount - 1
        : item
  )
}
