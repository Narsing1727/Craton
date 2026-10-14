"use client"

import * as React from "react"
import type { DataTableInstance, TableMessages } from "@querycn/table-react"
import { PaletteIcon } from "lucide-react"

import { cn } from "cn"
import {
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@/components/ui/dropdown-menu"
import {
  columnColorPresets,
  isColumnColorPreset,
  resolveColumnColor,
} from "@/components/data-table/column-color-palette"

type Column<TData extends object> = ReturnType<
  DataTableInstance<TData>["getAllLeafColumns"]
>[number]

const NONE = "none"

/** A swatch of a stored column color; an empty ring for none. */
export function ColorSwatch({ color }: { color?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-3.5 shrink-0 rounded-full",
        color ? "ring-1 ring-foreground/10" : "ring-1 ring-border ring-inset"
      )}
      style={{ backgroundColor: resolveColumnColor(color) }}
    />
  )
}

/** A "Color" submenu: no color, the presets, a custom color already set, and "Custom color…". */
export function DataTableColumnColorMenu<TData extends object>({
  column,
  messages,
  onCustomColor,
}: {
  column: Column<TData>
  messages: TableMessages
  /** Opens a color picker, e.g. `useCustomColorInput`'s `open`. */
  onCustomColor: () => void
}) {
  const color = column.getColor()
  const custom = color !== undefined && !isColumnColorPreset(color)
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PaletteIcon />
        {messages.columns.color}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup
          value={color ?? NONE}
          onValueChange={(value) =>
            column.setColor(value === NONE ? undefined : value)
          }
        >
          <DropdownMenuRadioItem closeOnClick value={NONE}>
            <ColorSwatch />
            {messages.columns.noColor}
          </DropdownMenuRadioItem>
          {columnColorPresets.map((preset) => (
            <DropdownMenuRadioItem closeOnClick key={preset} value={preset}>
              <ColorSwatch color={preset} />
              {messages.colors[preset]}
            </DropdownMenuRadioItem>
          ))}
          {custom && (
            <DropdownMenuRadioItem closeOnClick value={color}>
              <ColorSwatch color={color} />
              <span className="font-mono text-xs">{color}</span>
            </DropdownMenuRadioItem>
          )}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onCustomColor}>
          {messages.columns.customColor}
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}
