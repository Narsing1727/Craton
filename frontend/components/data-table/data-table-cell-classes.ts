export const pinnedCellClassName = [
  // shadcn's cells are physical (`text-left`, and `pr-0` beside a checkbox): follow the reading direction.
  "text-start rtl:[&:has([role=checkbox])]:pr-2 rtl:[&:has([role=checkbox])]:pl-0",
  // A column being moved stands out from the ones it passes.
  "data-dragging:bg-muted!",
  "bg-[linear-gradient(color-mix(in_oklab,var(--column-color)_14%,transparent),color-mix(in_oklab,var(--column-color)_14%,transparent))]",
  "data-pinned:z-10 data-pinned:bg-background group-hover/row:data-pinned:bg-[color-mix(in_oklab,var(--color-muted)_50%,var(--color-background))] group-data-[state=selected]/row:data-pinned:bg-muted",
  "before:pointer-events-none before:absolute before:inset-y-0 before:w-3 before:from-foreground/10 before:to-transparent before:opacity-0 before:transition-opacity",
  "data-[pinned-edge=start]:before:-end-3 data-[pinned-edge=start]:before:bg-linear-to-r group-data-[scroll-start]/data-table:data-[pinned-edge=start]:before:opacity-100 rtl:data-[pinned-edge=start]:before:bg-linear-to-l",
  "data-[pinned-edge=end]:before:-start-3 data-[pinned-edge=end]:before:bg-linear-to-l group-data-[scroll-end]/data-table:data-[pinned-edge=end]:before:opacity-100 rtl:data-[pinned-edge=end]:before:bg-linear-to-r",
].join(" ")

// A sticky header loses its row border to border-collapse, so each cell draws one.
export const headerCellClassName =
  "relative bg-background after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-border"
