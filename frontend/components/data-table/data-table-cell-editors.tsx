"use client"

import * as React from "react"
import {
  formatCellText,
  parseCellText,
  type CellEditor,
  type CellEditorOption,
  type TableMessages,
} from "@querycn/table-react"

import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/base-select"
import { SearchSelectCellEditor } from "@/components/data-table/data-table-search-select-editor"

export interface CellEditorProps {
  value: unknown
  editor: CellEditor
  /** The column's name, for the editor's accessible name. */
  label: string
  /** The cell's content as the table shows it, e.g. for a trigger. */
  display: React.ReactNode
  messages: TableMessages
  saving: boolean
  invalid: boolean
  /**
   * `focusCell: false` after a blur, so the focus stays where it went. A
   * select passes the picked `option`, for `onCellEdit`.
   */
  onSave: (
    value: unknown,
    options?: { focusCell?: boolean; option?: CellEditorOption }
  ) => void
  onCancel: (focusCell?: boolean) => void
  /** Shows an error without saving, e.g. for text that isn't a number. */
  onError: (message: string) => void
}

export type CellEditors = Record<string, React.ComponentType<CellEditorProps>>

/** Text and numbers: Enter or leaving the input saves, Escape cancels. */
export function TextCellEditor({
  value,
  editor,
  label,
  messages,
  saving,
  invalid,
  onSave,
  onCancel,
  onError,
}: CellEditorProps) {
  const initial = formatCellText(value)
  const [text, setText] = React.useState(initial)
  const commit = (focusCell: boolean) => {
    if (text === initial) return onCancel(focusCell)
    const parsed = parseCellText(text, editor.type)
    if (parsed.error) return onError(messages.editing[parsed.error])
    onSave(parsed.value, { focusCell })
  }

  return (
    <Input
      autoFocus
      value={text}
      readOnly={saving}
      aria-label={label}
      aria-invalid={invalid || undefined}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault()
          commit(true)
        } else if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          onCancel()
        }
      }}
      onBlur={() => commit(false)}
      className="-my-1 h-7 px-1.5"
    />
  )
}

/**
 * A `select`: the option list opens right away, picking an option saves and
 * closing without one cancels. With `loadOptions`, a search box asks your API.
 */
export function SelectCellEditor(props: CellEditorProps) {
  return props.editor.loadOptions ? (
    <SearchSelectCellEditor {...props} />
  ) : (
    <StaticSelectCellEditor {...props} />
  )
}

function StaticSelectCellEditor({
  value,
  editor,
  label,
  onSave,
  onCancel,
}: CellEditorProps) {
  const current = formatCellText(value)
  const options = editor.options ?? []
  const picked = React.useRef(false)
  return (
    <Select
      defaultOpen
      items={options}
      value={current}
      onValueChange={(next) => {
        // Base UI calls this for the selected item too.
        if (next === null || next === current) return
        picked.current = true
        onSave(next, { option: options.find((o) => o.value === next) })
      }}
      onOpenChange={(open) => {
        if (!open && !picked.current) onCancel()
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="-my-1 w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Editor per `meta.edit.type`; `boolean` cells flip without one. */
export const cellEditors: CellEditors = {
  text: TextCellEditor,
  number: TextCellEditor,
  select: SelectCellEditor,
}
