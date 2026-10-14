interface LabelledColumn {
  id: string
  columnDef: { header?: unknown; meta?: { label?: string } }
}

/** `meta.label`, else a string `header`, else the column id. */
export function getColumnLabel(column: LabelledColumn): string {
  return (
    column.columnDef.meta?.label ??
    (typeof column.columnDef.header === "string"
      ? column.columnDef.header
      : column.id)
  )
}
