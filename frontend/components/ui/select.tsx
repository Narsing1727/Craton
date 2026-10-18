"use client";

// Craton's select. Same API and look as before; now with full keyboard support
// (arrows, Home/End, type-ahead, Enter/Space, Esc/Tab), focus returned to the trigger,
// labels that resolve while closed, and no open animation (DESIGN.md §3, §8).

import * as React from "react";
import { cn } from "@/lib/utils";
import { ChevronDown, Check } from "lucide-react";

interface SelectContextValue {
  value: string;
  onValueChange: (val: string) => void;
  open: boolean;
  setOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  labels: Record<string, React.ReactNode>;
  registerLabel: (val: string, label: React.ReactNode) => void;
  triggerId: string;
  listboxId: string;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  listboxRef: React.RefObject<HTMLDivElement | null>;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelect(component: string) {
  const ctx = React.useContext(SelectContext);
  if (!ctx) throw new Error(`${component} must be used within <Select>`);
  return ctx;
}

function options(listbox: HTMLElement | null) {
  return listbox ? Array.from(listbox.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)')) : [];
}

export interface SelectProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
  disabled?: boolean;
  name?: string;
}

export function Select({
  value: controlledValue,
  defaultValue = "",
  onValueChange: controlledOnValueChange,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange: controlledOnOpenChange,
  children,
  disabled = false,
  name,
}: SelectProps) {
  const [internalValue, setInternalValue] = React.useState(defaultValue);
  const isControlledValue = controlledValue !== undefined;
  const value = isControlledValue ? (controlledValue ?? "") : internalValue;

  const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
  const isControlledOpen = controlledOpen !== undefined;
  const open = isControlledOpen ? (controlledOpen ?? false) : internalOpen;

  const [labels, setLabels] = React.useState<Record<string, React.ReactNode>>({});
  const triggerId = React.useId();
  const listboxId = React.useId();
  const selectRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const listboxRef = React.useRef<HTMLDivElement>(null);

  const registerLabel = React.useCallback((val: string, label: React.ReactNode) => {
    setLabels((prev) => {
      if (prev[val] === label) return prev;
      // JSX labels are new objects every render; keep the first one to avoid a render loop.
      if (val in prev && React.isValidElement(label)) return prev;
      return { ...prev, [val]: label };
    });
  }, []);

  const setOpen = React.useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const nextOpen = typeof next === "function" ? next(open) : next;
      if (!isControlledOpen) setInternalOpen(nextOpen);
      controlledOnOpenChange?.(nextOpen);
    },
    [isControlledOpen, open, controlledOnOpenChange]
  );

  const onValueChange = React.useCallback(
    (val: string) => {
      if (!isControlledValue) setInternalValue(val);
      controlledOnValueChange?.(val);
    },
    [isControlledValue, controlledOnValueChange]
  );

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (selectRef.current && !selectRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, setOpen]);

  return (
    <SelectContext.Provider
      value={{
        value,
        onValueChange,
        open: disabled ? false : open,
        setOpen: disabled ? () => {} : setOpen,
        labels,
        registerLabel,
        triggerId,
        listboxId,
        triggerRef,
        listboxRef,
      }}
    >
      <div ref={selectRef} className="relative inline-block text-left" data-slot="select">
        {children}
        {name && <input type="hidden" name={name} value={value} />}
      </div>
    </SelectContext.Provider>
  );
}

export interface SelectTriggerProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "default";
}

export const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, size = "default", children, disabled, type = "button", onKeyDown, ...props }, ref) => {
    const ctx = useSelect("SelectTrigger");
    return (
      <button
        ref={(node) => {
          ctx.triggerRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        type={type}
        id={ctx.triggerId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={ctx.open}
        aria-controls={ctx.listboxId}
        disabled={disabled}
        onClick={(e) => {
          props.onClick?.(e);
          ctx.setOpen((prev) => !prev);
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            ctx.setOpen(true);
          }
        }}
        data-slot="select-trigger"
        className={cn(
          "flex w-fit items-center justify-between gap-2 rounded-lg border border-input bg-background/90 px-2.5 py-1.5 text-sm text-foreground shadow-xs transition-colors outline-none select-none cursor-pointer hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
          size === "sm" ? "h-7 text-xs" : "h-8",
          className
        )}
        {...props}
      >
        <span className="flex items-center gap-1.5 truncate">{children}</span>
        <ChevronDown
          aria-hidden
          className={cn("size-3.5 text-muted-foreground shrink-0", ctx.open && "rotate-180 text-foreground")}
        />
      </button>
    );
  }
);
SelectTrigger.displayName = "SelectTrigger";

export interface SelectValueProps {
  className?: string;
  placeholder?: React.ReactNode;
}

export function SelectValue({ className, placeholder }: SelectValueProps) {
  const ctx = useSelect("SelectValue");
  const display = ctx.value ? (ctx.labels[ctx.value] ?? ctx.value) : placeholder;
  return (
    <span
      data-slot="select-value"
      className={cn(
        "truncate font-medium",
        !ctx.value && placeholder ? "text-muted-foreground font-normal" : "text-foreground",
        className
      )}
    >
      {display ?? placeholder ?? ""}
    </span>
  );
}

export interface SelectContentProps extends React.HTMLAttributes<HTMLDivElement> {
  position?: "popper" | "item-aligned";
  align?: "start" | "center" | "end";
  sideOffset?: number;
}

export function SelectContent({
  className,
  children,
  align = "start",
  position: _position,
  sideOffset: _sideOffset,
  ...props
}: SelectContentProps) {
  const ctx = useSelect("SelectContent");
  const typed = React.useRef({ text: "", at: 0 });

  // On open, move focus to the selected option (or the first one).
  React.useEffect(() => {
    if (!ctx.open) return;
    const opts = options(ctx.listboxRef.current);
    (opts.find((o) => o.getAttribute("aria-selected") === "true") ?? opts[0])?.focus();
  }, [ctx.open, ctx.listboxRef]);

  function close() {
    ctx.setOpen(false);
    ctx.triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const opts = options(ctx.listboxRef.current);
    const i = opts.indexOf(document.activeElement as HTMLButtonElement);
    const move = (to: number) => {
      e.preventDefault();
      opts[Math.max(0, Math.min(opts.length - 1, to))]?.focus();
    };
    switch (e.key) {
      case "ArrowDown":
        return move(i + 1);
      case "ArrowUp":
        return move(i - 1);
      case "Home":
        return move(0);
      case "End":
        return move(opts.length - 1);
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        return close();
      case "Tab":
        return ctx.setOpen(false);
      default:
        if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
          const now = Date.now();
          typed.current.text = now - typed.current.at > 600 ? e.key.toLowerCase() : typed.current.text + e.key.toLowerCase();
          typed.current.at = now;
          const hit = opts.find((o) => o.textContent?.trim().toLowerCase().startsWith(typed.current.text));
          hit?.focus();
        }
    }
  }

  // Always mounted (hidden when closed) so option labels are known before the first open.
  return (
    <div
      ref={ctx.listboxRef}
      id={ctx.listboxId}
      role="listbox"
      aria-labelledby={ctx.triggerId}
      hidden={!ctx.open}
      data-slot="select-content"
      onKeyDown={onKeyDown}
      className={cn(
        "absolute top-full mt-1.5 z-50 min-w-[9rem] max-h-64 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-xl",
        align === "end" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SelectGroup({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div role="group" data-slot="select-group" className={cn("p-0.5", className)} {...props}>
      {children}
    </div>
  );
}

export function SelectLabel({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-slot="select-label"
      className={cn("px-2 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export interface SelectItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export const SelectItem = React.forwardRef<HTMLButtonElement, SelectItemProps>(
  ({ className, value, children, disabled, onClick, type = "button", ...props }, ref) => {
    const ctx = useSelect("SelectItem");
    const isSelected = ctx.value === value;
    const { registerLabel } = ctx;

    // Register the label so SelectValue can show it while the list is closed.
    React.useEffect(() => {
      registerLabel(value, children);
    }, [value, children, registerLabel]);

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      onClick?.(e);
      if (!disabled) {
        ctx.onValueChange(value);
        ctx.setOpen(false);
        ctx.triggerRef.current?.focus();
      }
    };

    return (
      <button
        ref={ref}
        type={type}
        role="option"
        aria-selected={isSelected}
        tabIndex={-1}
        disabled={disabled}
        onClick={handleClick}
        data-slot="select-item"
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs text-foreground transition-colors hover:bg-muted focus:bg-muted focus:text-foreground outline-none disabled:pointer-events-none disabled:opacity-50 text-left",
          isSelected && "bg-muted/80 font-semibold text-foreground",
          className
        )}
        {...props}
      >
        <span className="flex items-center gap-1.5 truncate">{children}</span>
        {isSelected && <Check className="size-3.5 shrink-0 text-foreground" aria-hidden />}
      </button>
    );
  }
);
SelectItem.displayName = "SelectItem";

export function SelectSeparator({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div data-slot="select-separator" className={cn("-mx-1 my-1 h-px bg-border/60", className)} {...props} />;
}

export function SelectScrollUpButton(_props: React.HTMLAttributes<HTMLDivElement>) {
  return null;
}

export function SelectScrollDownButton(_props: React.HTMLAttributes<HTMLDivElement>) {
  return null;
}
