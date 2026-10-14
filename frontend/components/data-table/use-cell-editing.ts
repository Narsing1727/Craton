import * as React from "react"
import type { CellEditorOption } from "@querycn/table-react"

export interface UseCellEditingOptions {
  /** Throws or rejects to keep the editor open with the error's message. */
  onSave: (value: unknown, option?: CellEditorOption) => void | Promise<void>
  /** Shown when the error has no message of its own. */
  saveFailed: string
}

/**
 * One cell's editing: open or not, saving, and the last error. After Enter or
 * Escape the focus goes back to the cell; after a blur it stays where it went.
 */
export function useCellEditing({ onSave, saveFailed }: UseCellEditingOptions) {
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string>()
  const cellRef = React.useRef<HTMLDivElement>(null)
  // A pending save ignores the blur its own Enter causes.
  const busy = React.useRef(false)
  const refocus = React.useRef(false)

  React.useLayoutEffect(() => {
    if (editing || !refocus.current) return
    refocus.current = false
    cellRef.current?.focus()
  })

  const close = (focusCell: boolean) => {
    refocus.current = focusCell
    setEditing(false)
    setError(undefined)
  }

  return {
    cellRef,
    editing,
    saving,
    error,
    setError,
    start: () => {
      setError(undefined)
      setEditing(true)
    },
    cancel: (focusCell = true) => {
      if (!busy.current) close(focusCell)
    },
    save: async (
      value: unknown,
      {
        focusCell = true,
        option,
      }: { focusCell?: boolean; option?: CellEditorOption } = {}
    ) => {
      if (busy.current) return
      busy.current = true
      setSaving(true)
      setError(undefined)
      try {
        await onSave(value, option)
        close(focusCell)
      } catch (caught) {
        setError(
          caught instanceof Error && caught.message
            ? caught.message
            : saveFailed
        )
      } finally {
        busy.current = false
        setSaving(false)
      }
    },
  }
}

export type CellEditing = ReturnType<typeof useCellEditing>
