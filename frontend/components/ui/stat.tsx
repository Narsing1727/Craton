import type * as React from "react";

import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

import { Separator } from "@/components/ui/separator";

function Stat({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat"
      className={cn(
        "grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg border bg-card p-4 text-card-foreground shadow-sm",
        "**:data-[slot=stat-label]:col-span-1 **:data-[slot=stat-value]:col-span-1",
        "**:data-[slot=stat-indicator]:col-start-2 **:data-[slot=stat-indicator]:row-span-2 **:data-[slot=stat-indicator]:row-start-1 **:data-[slot=stat-indicator]:self-start",
        "**:data-[slot=stat-description]:col-span-2 **:data-[slot=stat-separator]:col-span-2 **:data-[slot=stat-trend]:col-span-2",
        className,
      )}
      {...props}
    />
  );
}

function StatLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-label"
      className={cn("text-sm font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

const statIndicatorVariants = cva(
  "flex shrink-0 items-center justify-center [&_svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "text-muted-foreground [&_svg:not([class*='size-'])]:size-5",
        icon: "size-8 rounded-md border [&_svg:not([class*='size-'])]:size-3.5",
        badge:
          "h-6 min-w-6 rounded-sm border px-1.5 text-xs font-medium [&_svg:not([class*='size-'])]:size-3",
        action:
          "size-8 cursor-pointer rounded-md transition-colors hover:bg-muted/50 [&_svg:not([class*='size-'])]:size-4",
      },
      color: {
        default: "bg-muted text-muted-foreground",
        success:
          "border-success/20 bg-success/10 text-success dark:text-success",
        info: "border-info/20 bg-info/10 text-info dark:text-info",
        warning:
          "border-warning/20 bg-warning/10 text-warning dark:text-warning",
        error: "border-destructive/20 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
      color: "default",
    },
  },
);

interface StatIndicatorProps
  extends
    Omit<React.ComponentProps<"div">, "color">,
    VariantProps<typeof statIndicatorVariants> {}

function StatIndicator({
  className,
  variant = "default",
  color = "default",
  ...props
}: StatIndicatorProps) {
  return (
    <div
      data-slot="stat-indicator"
      data-variant={variant}
      data-color={color}
      className={cn(statIndicatorVariants({ variant, color, className }))}
      {...props}
    />
  );
}

function StatValue({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-value"
      className={cn("text-2xl font-semibold tracking-tight", className)}
      {...props}
    />
  );
}

function StatTrend({
  className,
  trend,
  ...props
}: React.ComponentProps<"div"> & { trend?: "up" | "down" | "neutral" }) {
  return (
    <div
      data-slot="stat-trend"
      data-trend={trend}
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3",
        {
          "text-success dark:text-success": trend === "up",
          "text-destructive dark:text-destructive": trend === "down",
          "text-muted-foreground": trend === "neutral" || !trend,
        },
        className,
      )}
      {...props}
    />
  );
}

function StatSeparator({ ...props }: React.ComponentProps<typeof Separator>) {
  return <Separator data-slot="stat-separator" className="my-2" {...props} />;
}

function StatDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="stat-description"
      className={cn("text-xs text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Stat,
  StatDescription,
  StatIndicator,
  StatLabel,
  StatSeparator,
  StatTrend,
  StatValue,
};
