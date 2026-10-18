import { useEffect, useRef, useState } from "react"

export interface ScrollEdges {
  /** Content is scrolled out of view at the start. */
  start: boolean
  /** More content waits past the end. */
  end: boolean
}

/** Tracks horizontal overflow on both sides of a scroll container. */
export function useScrollEdges<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [edges, setEdges] = useState<ScrollEdges>({ start: false, end: false })

  useEffect(() => {
    const node = ref.current
    if (!node) return
    const update = () => {
      // Negative in right-to-left layouts.
      const scrolled = Math.abs(node.scrollLeft)
      const start = scrolled > 0
      const end = scrolled + node.clientWidth < node.scrollWidth - 1
      setEdges((previous) =>
        previous.start === start && previous.end === end
          ? previous
          : { start, end }
      )
    }
    update()
    node.addEventListener("scroll", update, { passive: true })
    const observer = new ResizeObserver(update)
    observer.observe(node)
    if (node.firstElementChild) observer.observe(node.firstElementChild)
    return () => {
      node.removeEventListener("scroll", update)
      observer.disconnect()
    }
  }, [])

  return [ref, edges] as const
}
