"use client"

import * as React from "react"
import type {
  CellEditor,
  DataTableInstance,
  TableMessages,
} from "@querycn/table-react"
import { Loader2Icon } from "lucide-react"

import { getColumnLabel } from "@/components/data-table/column-label"
import { useCellEditing } from "@/components/data-table/use-cell-editing"
import {
  TextCellEditor,
  type CellEditors,
} from "@/components/data-table/data-table-cell-editors"

type Cell<TData extends object> = ReturnType<
  ReturnType<DataTableInstance<TData>["getRow"]>["getAllCells"]
>[number]

interface CellProps<TData extends object> {
  table: DataTableInstance<TData>
  cell: Cell<TData>
  editors: CellEditors
  messages: TableMessages
}

/** The cell's editor, if the table saves edits and the row allows this one. */
function getCellEditor<TData extends object>(
  table: DataTableInstance<TData>,
  cell: Cell<TData>
): CellEditor | undefined {
  const meta = table.options.meta
  const editor = cell.column.columnDef.meta?.edit
  if (!editor || !meta?.onCellEdit) return undefined
  const allowed = meta.canEditCell?.(cell.row.original, cell.column.id) ?? true
  return allowed ? editor : undefined
}

/** A body cell's content: its editable version when it has an editor. */
export function DataTableCellContent<TData extends object>(
  props: CellProps<TData>
) {
  const editor = getCellEditor(props.table, props.cell)
  if (editor) return <DataTableEditableCell {...props} editor={editor} />
  return (
    <div className="truncate">
      <props.table.FlexRender cell={props.cell} />
    </div>
  )
}

/**
 * A cell users can edit: Enter, F2 or a double click opens its editor, and a
 * `boolean` cell flips instead. A failed save shows its error under the cell.
 */
export function DataTableEditableCell<TData extends object>({
  table,
  cell,
  editor,
  editors,
  messages,
}: CellProps<TData> & { editor: CellEditor }) {
  const value = cell.getValue()
  const label = getColumnLabel(cell.column)
  // Destructured: one object holding the ref reads as a ref to the React Compiler's lint.
  const { cellRef, editing, saving, error, setError, start, cancel, save } =
    useCellEditing({
      saveFailed: messages.editing.saveFailed,
      onSave: (next, option) =>
        table.options.meta!.onCellEdit!({
          row: cell.row.original,
          rowId: cell.row.id,
          columnId: cell.column.id,
          value: next,
          previous: value,
          option,
        }),
    })
  const open = () => {
    if (saving) return
    if (editor.type === "boolean") void save(!value)
    else start()
  }
  const Editor = Object.hasOwn(editors, editor.type)
    ? editors[editor.type]!
    : TextCellEditor

  return (
    <div data-slot="data-table-editable-cell" className="relative">
      {editing ? (
        <Editor
          value={value}
          editor={editor}
          label={label}
          display={<table.FlexRender cell={cell} />}
          messages={messages}
          saving={saving}
          invalid={error !== undefined}
          onSave={(next, options) => void save(next, options)}
          onCancel={cancel}
          onError={setError}
        />
      ) : (
        <div
          ref={cellRef}
          tabIndex={0}
          aria-description={messages.editing.edit(label)}
          aria-busy={saving || undefined}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== "F2") return
            event.preventDefault()
            open()
          }}
          onDoubleClick={(event) => {
            event.stopPropagation()
            open()
          }}
          className="-mx-1 truncate rounded-sm px-1 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-busy:opacity-60"
        >
          <table.FlexRender cell={cell} />
        </div>
      )}
      {saving && (
        <Loader2Icon
          role="status"
          aria-label={messages.editing.saving}
          className="absolute end-0 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      )}
      {error && (
        <p
          role="alert"
          className="absolute start-0 top-full z-30 mt-1.5 rounded-md border bg-popover px-2 py-1 text-xs whitespace-nowrap text-destructive shadow-md"
        >
          {error}
        </p>
      )}
    </div>
  )
}
