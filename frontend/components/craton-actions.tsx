"use client";

// Small client-side building blocks shared by pages that are otherwise server components.
// See DESIGN.md §7 (interaction and feedback).

import * as React from "react";
import { Check, Copy, Download, Terminal } from "lucide-react";
import { notify } from "@/components/button-status";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogTrigger,
} from "@/components/ui/responsive-dialog";
import { cn } from "@/lib/utils";
import { downloadFile } from "@/lib/download";

/** A destructive or irreversible action behind a confirmation dialog. */
export function ConfirmAction({
  trigger,
  title,
  description,
  confirmLabel,
  onConfirm,
  destructive = true,
}: {
  trigger: React.ReactElement;
  title: string;
  description: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  destructive?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            onClick={() => {
              setOpen(false);
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Irreversible action that needs the exact name typed first (GitHub's delete pattern). */
export function TypeToConfirm({
  trigger,
  title,
  description,
  expected,
  confirmLabel,
  onConfirm,
  children,
}: {
  trigger: React.ReactElement;
  title: string;
  description: React.ReactNode;
  expected: string;
  confirmLabel: string;
  onConfirm: () => void;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const id = React.useId();
  const matches = typed.trim() === expected;
  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setTyped("");
      }}
    >
      <AlertDialogTrigger render={trigger} />
      <AlertDialogContent>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!matches) return;
            setOpen(false);
            setTyped("");
            onConfirm();
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{description}</AlertDialogDescription>
          </AlertDialogHeader>
          {children}
          <div className="flex flex-col gap-1.5">
            <label htmlFor={id} className="text-xs text-muted-foreground">
              Type <span className="font-mono text-foreground">{expected}</span> to confirm
            </label>
            <input
              id={id}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              autoFocus
              className="h-8 w-full border border-input bg-background px-2.5 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={!matches}>
              {confirmLabel}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Copies a value; the icon turns into a check for 2 s and screen readers hear "Copied". */
export function CopyButton({
  value,
  label = "Copy",
  className,
  variant = "ghost",
  size = "icon-xs",
  children,
}: {
  value: string;
  label?: string;
  className?: string;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  children?: React.ReactNode;
}) {
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      notify.error("Couldn’t copy", { description: "Select the text and copy it with Ctrl+C." });
    }
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-label={children ? undefined : copied ? "Copied" : label}
      onClick={copy}
    >
      {copied ? <Check data-icon={children ? "inline-start" : undefined} /> : <Copy data-icon={children ? "inline-start" : undefined} />}
      {children && (copied ? "Copied" : children)}
      <span className="sr-only" aria-live="polite">
        {copied ? "Copied" : ""}
      </span>
    </Button>
  );
}

/** One shell command with a copy button. */
export function CommandLine({ command, className }: { command: string; className?: string }) {
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2 border border-border bg-muted/40 py-1 pl-3 pr-1 font-mono text-xs",
        className,
      )}
    >
      <span className="select-none py-1 text-muted-foreground" aria-hidden>
        $
      </span>
      {/* The whole command is shown, wrapped: a command that is cut off with "…" cannot be checked before it is run. */}
      <code className="min-w-0 flex-1 whitespace-pre-wrap break-all py-1" translate="no">
        {command}
      </code>
      <CopyButton value={command} label="Copy command" />
    </div>
  );
}

/** Generates a small text file in the browser and saves it. */
export function DownloadButton({
  filename,
  content,
  type,
  children,
  variant = "outline",
  size = "sm",
  className,
  label,
}: {
  filename: string;
  content: string | (() => string);
  type?: string;
  children?: React.ReactNode;
  variant?: React.ComponentProps<typeof Button>["variant"];
  size?: React.ComponentProps<typeof Button>["size"];
  className?: string;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      aria-label={label}
      onClick={() => {
        downloadFile(filename, typeof content === "function" ? content() : content, type);
        notify.success(`Downloaded ${filename}`);
      }}
    >
      {children ?? <Download />}
    </Button>
  );
}

/**
 * Large datasets are fetched with the CLI, not the browser: this dialog shows the exact
 * commands (and an optional small browser download such as a manifest).
 */
export function CliDialog({
  trigger,
  title,
  description,
  commands,
  footer,
}: {
  trigger: React.ReactElement;
  title: string;
  description: React.ReactNode;
  commands: { label?: string; command: string }[];
  footer?: React.ReactNode;
}) {
  // A bottom drawer on a phone (easier to reach than a small centered dialog), a plain dialog on
  // desktop — same content either way.
  return (
    <ResponsiveDialog>
      <ResponsiveDialogTrigger render={trigger} />
      <ResponsiveDialogContent className="sm:max-w-lg">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <Terminal className="size-4 text-muted-foreground" aria-hidden />
            {title}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>{description}</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="flex min-w-0 flex-col gap-3">
          {commands.map((c) => (
            <div key={c.command} className="flex min-w-0 flex-col gap-1.5">
              {c.label && <span className="text-xs text-muted-foreground">{c.label}</span>}
              <CommandLine command={c.command} />
            </div>
          ))}
        </div>
        {footer && <ResponsiveDialogFooter>{footer}</ResponsiveDialogFooter>}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/** Button-styled <a download> for a file response (a route handler), not a page to navigate to. */
export function DownloadLink({
  href,
  filename,
  children,
  variant = "default",
  size = "sm",
  className,
}: {
  href: string;
  filename: string;
  children: React.ReactNode;
  variant?: "default" | "outline" | "ghost";
  size?: "sm" | "default";
  className?: string;
}) {
  return (
    <a href={href} download={filename} data-slot="button" className={cn(buttonVariants({ variant, size }), className)}>
      {children}
    </a>
  );
}
