// Craton page kit: the building blocks every page uses (DESIGN.md §5–§7).
// Server-safe: no hooks here, so pages can stay server components.

import * as React from "react";
import Link from "next/link";
import {
  CircleCheck,
  CircleDashed,
  CircleDot,
  CircleSlash,
  CircleX,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MessageSquareWarning,
  ThumbsUp,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** Page title block: where am I, what is this, what can I do here. */
export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  meta,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  eyebrow?: React.ReactNode;
  meta?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {eyebrow && <div className="text-xs font-medium text-muted-foreground">{eyebrow}</div>}
        <h1 className="text-xl font-semibold text-balance sm:text-2xl">{title}</h1>
        {description && <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p>}
        {meta && <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** A section inside a page: small heading, optional description and action on the right. */
export function Section({
  title,
  description,
  action,
  children,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground text-pretty">{description}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Number tile for dashboards: label, mono value, one line of context. */
export function StatTile({
  label,
  value,
  hint,
  delta,
  progress,
  icon: Icon,
  href,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  delta?: { value: string; positive?: boolean };
  progress?: number;
  icon?: LucideIcon;
  href?: string;
}) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {Icon && <Icon className="size-3.5 text-muted-foreground" aria-hidden />}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-xl font-bold tabular-nums">{value}</span>
        {delta && (
          <span className={cn("font-mono text-[11px] tabular-nums", delta.positive === false ? "text-destructive" : "text-chart-1")}>
            {delta.value}
          </span>
        )}
      </div>
      {progress !== undefined && <Progress value={progress} aria-label={`${label}: ${progress}%`} className="mt-1" />}
      {hint && <span className="text-[11px] text-muted-foreground text-pretty">{hint}</span>}
    </>
  );
  const cls = "flex flex-col gap-1.5 border border-border bg-card p-4";
  return href ? (
    <Link href={href} className={cn(cls, "transition-colors hover:border-foreground/30 hover:bg-muted/20")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export function StatGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 lg:grid-cols-4", className)}>{children}</div>;
}

type Status =
  | "open"
  | "closed"
  | "merged"
  | "draft"
  | "approved"
  | "changes-requested"
  | "passed"
  | "failed"
  | "running"
  | "skipped"
  | "warning";

const statusMap: Record<Status, { label: string; icon: LucideIcon; className: string }> = {
  open: { label: "Open", icon: CircleDot, className: "text-chart-2 border-chart-2/40" },
  closed: { label: "Closed", icon: CircleSlash, className: "text-muted-foreground border-border" },
  merged: { label: "Merged", icon: GitMerge, className: "text-foreground border-foreground/30" },
  draft: { label: "Draft", icon: GitPullRequest, className: "text-muted-foreground border-border" },
  approved: { label: "Approved", icon: ThumbsUp, className: "text-chart-1 border-chart-1/40" },
  "changes-requested": { label: "Changes requested", icon: GitPullRequestClosed, className: "text-destructive border-destructive/40" },
  passed: { label: "Passed", icon: CircleCheck, className: "text-chart-1 border-chart-1/40" },
  failed: { label: "Failed", icon: CircleX, className: "text-destructive border-destructive/40" },
  running: { label: "Running", icon: CircleDashed, className: "text-muted-foreground border-border" },
  skipped: { label: "Skipped", icon: CircleSlash, className: "text-muted-foreground border-border" },
  warning: { label: "Warning", icon: MessageSquareWarning, className: "text-foreground border-chart-3/60" },
};

/** Status with icon and text, never color alone (DESIGN.md §8). */
export function StatusBadge({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const s = statusMap[status];
  return (
    <Badge variant="outline" className={cn("gap-1 font-medium", s.className, className)}>
      <s.icon className="size-3" aria-hidden />
      {label ?? s.label}
    </Badge>
  );
}

export function StatusIcon({ status, className }: { status: Status; className?: string }) {
  const s = statusMap[status];
  return <s.icon className={cn("size-4 shrink-0", s.className.split(" ")[0], className)} aria-label={s.label} />;
}

/** Dense list container with hairline dividers (Linear style). */
export function DataList({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <ul aria-label={label} className={cn("flex flex-col divide-y divide-border border border-border bg-card", className)}>
      {children}
    </ul>
  );
}

/** One row; when `href` is set the whole row is the link. */
export function DataRow({
  href,
  leading,
  title,
  subtitle,
  meta,
  trailing,
  className,
}: {
  href?: string;
  leading?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  meta?: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  const inner = (
    <>
      {leading && <div className="mt-0.5 shrink-0">{leading}</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-medium">{title}</div>
        {subtitle && <div className="text-xs text-muted-foreground text-pretty">{subtitle}</div>}
        {meta && <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">{meta}</div>}
      </div>
      {trailing && <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">{trailing}</div>}
    </>
  );
  const cls = cn("flex items-start gap-3 px-4 py-3", className);
  return (
    <li>
      {href ? (
        <Link href={href} className={cn(cls, "transition-colors hover:bg-muted/30 focus-visible:bg-muted/30 outline-none")}>
          {inner}
        </Link>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}

/** Empty state with exactly one next action (baseline-ui). */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Empty className={cn("border border-dashed border-border", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

/** Label/value pairs for metadata panels. */
export function KeyValueList({
  items,
  className,
}: {
  items: { label: string; value: React.ReactNode; mono?: boolean }[];
  className?: string;
}) {
  return (
    <dl className={cn("flex flex-col gap-2.5 text-sm", className)}>
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline justify-between gap-3">
          <dt className="shrink-0 text-muted-foreground">{item.label}</dt>
          <dd className={cn("min-w-0 truncate text-right", item.mono && "font-mono text-xs tabular-nums")}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Small initials avatar used in rows. */
export function Initials({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-6 shrink-0 items-center justify-center border border-border bg-muted font-mono text-[9px] font-semibold uppercase",
        className,
      )}
    >
      {name.slice(0, 2)}
    </span>
  );
}
