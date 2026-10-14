"use client"

import * as React from "react"
import { useDirection } from "@base-ui/react/direction-provider"
import { useFieldOptions } from "@querycn/filter-react"
import { formatCellText } from "@querycn/table-react"
import { ChevronsUpDownIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { CellEditorProps } from "@/components/data-table/data-table-cell-editors"

/**
 * A `select` with `loadOptions`: a search box over the options your API
 * returns. Picking one saves it with its label; closing the list cancels.
 */
export function SearchSelectCellEditor({
  value,
  editor,
  label,
  display,
  messages,
  onSave,
  onCancel,
}: CellEditorProps) {
  const dir = useDirection()
  const current = formatCellText(value)
  const [open, setOpen] = React.useState(true)
  const field = React.useMemo(
    () => ({
      name: label,
      label,
      type: "select",
      options: editor.options && [...editor.options],
      loadOptions: editor.loadOptions,
    }),
    [label, editor]
  )
  const { options, loading, error, query, search, retry } = useFieldOptions(
    field,
    { enabled: open }
  )

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) onCancel()
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="-my-1 h-7 w-full justify-between font-normal"
          />
        }
      >
        <span className="truncate">{display}</span>
        <ChevronsUpDownIcon className="text-muted-foreground" />
      </PopoverTrigger>
      <PopoverContent dir={dir} className="w-60 p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={messages.editing.search}
            value={query}
            onValueChange={search}
          />
          <CommandList>
            {error !== null ? (
              <div
                role="alert"
                className="flex flex-col items-center gap-2 py-4 text-sm text-muted-foreground"
              >
                {messages.editing.loadFailed}
                <Button variant="outline" size="xs" onClick={retry}>
                  {messages.actions.retry}
                </Button>
              </div>
            ) : loading ? (
              // Also shown over the previous list while the next search loads.
              <div
                role="status"
                className="py-2 text-center text-xs text-muted-foreground"
              >
                {messages.states.loading}
              </div>
            ) : (
              <CommandEmpty>{messages.editing.noOptions}</CommandEmpty>
            )}
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.value}
                  value={option.value}
                  data-checked={option.value === current}
                  onSelect={() => {
                    if (option.value === current) return onCancel()
                    // Closed without `onOpenChange`, which would cancel.
                    setOpen(false)
                    onSave(option.value, { option })
                  }}
                >
                  <span className="truncate">{option.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
