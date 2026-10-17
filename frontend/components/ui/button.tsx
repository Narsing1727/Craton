"use client"

import * as React from "react"
import Link from "next/link"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,translate] duration-100 outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/15 dark:hover:bg-destructive/25 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
  render?: React.ReactElement<any>
  nativeButton?: boolean
  href?: string
  /** Shows three blinking dots in place of the label and ignores clicks until it is false again. */
  loading?: boolean
}

/** The label stays in the layout (invisible) so the button keeps its size while the dots show. */
function LoadingContent({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-flex items-center justify-center gap-[inherit]">
      <span className="invisible inline-flex items-center justify-center gap-[inherit]">{children}</span>
      <span className="status-dots absolute inset-0 flex items-center justify-center gap-1" role="status" aria-label="Working">
        <i />
        <i />
        <i />
      </span>
    </span>
  )
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", asChild = false, render, href, children, onClick, nativeButton: _nativeButton, loading = false, ...props }, ref) => {
    // A click handler that returns a promise (an async function) puts the button in its loading state until it settles.
    const [running, setRunning] = React.useState(false)
    const isLoading = loading || running
    const classes = cn(buttonVariants({ variant, size }), className)
    // Button-only attributes that must not land on an <a>.
    const { type: _type, disabled, ...linkSafeProps } = props

    // Direct href: render a Next.js Link that keeps aria-label, title, target, etc.
    if (href && !disabled) {
      return (
        <Link
          {...(linkSafeProps as Record<string, unknown>)}
          ref={ref as React.Ref<HTMLAnchorElement>}
          href={href}
          data-slot="button"
          aria-disabled={disabled || undefined}
          className={classes}
          onClick={onClick as unknown as React.MouseEventHandler<HTMLAnchorElement>}
        >
          {children}
        </Link>
      )
    }

    // render={<Link href=… />}: keep the Link's own props (prefetch, target…) plus the Button's.
    if (render && React.isValidElement(render)) {
      const renderProps = (render as React.ReactElement<any>).props || {}
      // A download link stays a plain anchor. As a Next <Link> it would be prefetched in the
      // background, and for a ZIP or an account export that means generating the whole file just
      // because the button scrolled into view.
      if (renderProps.href && renderProps.download === undefined) {
        const { children: renderChildren, className: renderClassName, onClick: renderOnClick, ...restRenderProps } = renderProps
        return (
          <Link
            {...restRenderProps}
            {...(linkSafeProps as Record<string, unknown>)}
            ref={ref as React.Ref<HTMLAnchorElement>}
            href={renderProps.href}
            data-slot="button"
            className={cn(buttonVariants({ variant, size }), renderClassName, className)}
            onClick={(e) => {
              renderOnClick?.(e)
              onClick?.(e as any)
            }}
          >
            {children ?? renderChildren}
          </Link>
        )
      }
      return React.cloneElement(render as React.ReactElement<any>, {
        ...props,
        className: cn(buttonVariants({ variant, size }), renderProps.className, className),
        children: children ?? renderProps.children,
        onClick: (e: any) => {
          renderProps.onClick?.(e)
          onClick?.(e)
        },
      })
    }

    // If asChild is specified and children is a valid React element
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children as React.ReactElement<any>, {
        className: cn(buttonVariants({ variant, size }), (children as any).props?.className, className),
        onClick: (e: any) => {
          (children as any).props?.onClick?.(e)
          onClick?.(e)
        },
      })
    }

    const { disabled: nativeDisabled, ...buttonProps } = props
    return (
      <button
        ref={ref}
        data-slot="button"
        data-loading={isLoading || undefined}
        aria-busy={isLoading || undefined}
        className={cn(classes, isLoading && "disabled:opacity-100")}
        disabled={nativeDisabled || isLoading}
        onClick={(e) => {
          const result = (onClick as unknown as ((e: React.MouseEvent<HTMLButtonElement>) => unknown) | undefined)?.(e)
          if (result && typeof (result as Promise<unknown>).then === "function") {
            setRunning(true)
            ;(result as Promise<unknown>).finally(() => setRunning(false))
          }
        }}
        {...buttonProps}
      >
        {isLoading ? <LoadingContent>{children}</LoadingContent> : children}
      </button>
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
