"use client";

// Create an organization: one centred panel, outlined fields whose labels float up when there is something to say (the way
// Google's account forms work), the address filling itself from the name until you change it, and a live "available" line.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Building2, Check, CircleAlert, ShieldCheck } from "lucide-react";
import { addressTakenAction, createOrgAction } from "@/app/actions";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { notify } from "@/components/button-status";
import { cn } from "@/lib/utils";

const slugOf = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 39)
    .replace(/-$/, "");
const VALID = /^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/;

type Status = { kind: "idle" } | { kind: "checking" } | { kind: "free" } | { kind: "taken" } | { kind: "invalid"; why: string };

export default function NewOrgPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [edited, setEdited] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const shown = edited ? address : slugOf(name);

  // Is the address free? Asked once the person stops typing.
  useEffect(() => {
    if (!shown) return void setStatus({ kind: "idle" });
    if (!VALID.test(shown)) return void setStatus({ kind: "invalid", why: "Use lowercase letters, numbers and dashes, starting and ending with a letter or number." });
    setStatus({ kind: "checking" });
    let stale = false;
    const t = setTimeout(async () => {
      const r = await addressTakenAction(shown).catch(() => null);
      if (!stale) setStatus(r ? (r.taken ? { kind: "taken" } : { kind: "free" }) : { kind: "idle" });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [shown]);

  const canCreate = name.trim().length > 0 && Boolean(shown) && status.kind !== "taken" && status.kind !== "invalid" && !submitting;

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!canCreate) return;
    setSubmitting(true);
    setProblem(null);
    const result = await createOrgAction(shown, name.trim());
    if (!result.ok) {
      setSubmitting(false);
      if (result.code === "handle_taken") setStatus({ kind: "taken" });
      setProblem(result.error);
      return;
    }
    notify.success(`Created ${name.trim()}`, { description: `/orgs/${shown}` });
    router.push(`/orgs/${shown}`);
  }

  return (
    <AppShell>
      <div className="mx-auto w-full max-w-[520px] px-4 pb-20 pt-8 sm:pt-10">
        <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground">
          <ArrowLeft className="size-3.5" aria-hidden />
          Back to dashboard
        </Link>

        <form onSubmit={create} className="border border-border px-6 pb-7 pt-9 sm:px-10 sm:pb-9 sm:pt-11" noValidate>
          <div className="flex flex-col items-center text-center">
            <span className="flex size-12 items-center justify-center border border-border bg-muted/40" aria-hidden>
              <Building2 className="size-5 text-foreground" />
            </span>
            <h1 className="mt-5 text-[26px] font-medium leading-tight tracking-[-0.02em]">Create an organization</h1>
            <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-muted-foreground text-pretty">One place for your team’s repositories, with shared access and one plan.</p>
          </div>

          <div className="mt-9 flex flex-col gap-5">
            <Floating id="org-name" label="Organization name" value={name} onChange={setName} autoFocus maxLength={80} autoComplete="organization" />
            <div>
              <Floating
                id="org-address"
                label="Address"
                value={shown}
                onChange={(v) => {
                  setEdited(true);
                  setAddress(v.toLowerCase().replace(/[^a-z0-9-]/g, ""));
                }}
                prefix="/orgs/"
                maxLength={39}
                invalid={status.kind === "taken" || status.kind === "invalid"}
                mono
              />
              <p className="mt-2 min-h-5 pl-0.5 text-[13px] leading-snug" aria-live="polite">
                {status.kind === "free" && (
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <Check className="size-3.5" aria-hidden /> <span className="font-mono">{shown}</span> is available
                  </span>
                )}
                {status.kind === "checking" && <span className="text-muted-foreground">Checking…</span>}
                {status.kind === "taken" && (
                  <span className="inline-flex items-center gap-1.5 text-destructive">
                    <CircleAlert className="size-3.5" aria-hidden /> That address is taken. Try another.
                  </span>
                )}
                {status.kind === "invalid" && (
                  <span className="inline-flex items-start gap-1.5 text-destructive">
                    <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {status.why}
                  </span>
                )}
                {status.kind === "idle" && <span className="text-muted-foreground">Repositories will be at {shown || "your-org"}/&lt;name&gt;.</span>}
              </p>
            </div>
          </div>

          {problem && (
            <p role="alert" className="mt-4 border-l-2 border-destructive/70 bg-destructive/[0.07] px-3 py-2.5 text-[13px] leading-relaxed text-destructive">
              {problem}
            </p>
          )}

          <div className="mt-6 flex gap-3 text-[13px] leading-relaxed text-muted-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-foreground/70" aria-hidden />
            <p className="text-pretty">
              You’ll be the owner, and can invite people once it exists. New organizations start on the Free plan; limits are on the{" "}
              <Link href="/pricing" className="text-foreground underline underline-offset-2">
                pricing page
              </Link>
              .
            </p>
          </div>

          <div className="mt-9 flex items-center justify-between gap-3">
            <Link href="/dashboard" className="inline-flex h-10 items-center rounded-[4px] px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Cancel
            </Link>
            <Button type="submit" className="h-10 min-w-36 rounded-[4px] px-5" loading={submitting} disabled={!canCreate}>
              Create organization
            </Button>
          </div>
        </form>
      </div>
    </AppShell>
  );
}

/** An outlined field whose label sits inside until the field is focused or filled, then moves up onto the border. */
function Floating({
  id,
  label,
  value,
  onChange,
  prefix,
  invalid,
  mono,
  ...rest
}: { id: string; label: string; value: string; onChange: (v: string) => void; prefix?: string; invalid?: boolean; mono?: boolean } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange" | "value" | "id">) {
  return (
    <div className="group relative">
      {prefix && (
        <span className="pointer-events-none absolute left-3.5 top-1/2 hidden -translate-y-1/2 font-mono text-[13px] text-muted-foreground group-focus-within:block group-has-[input:not(:placeholder-shown)]:block" aria-hidden>
          {prefix}
        </span>
      )}
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder=" "
        spellCheck={false}
        aria-invalid={invalid || undefined}
        className={cn(
          "peer h-14 w-full rounded-[4px] border bg-transparent px-3.5 pt-1 text-[15px] text-foreground outline-none transition-colors",
          "border-foreground/20 hover:border-foreground/40 focus:border-foreground focus:ring-1 focus:ring-foreground",
          invalid && "border-destructive hover:border-destructive focus:border-destructive focus:ring-destructive",
          mono && "font-mono text-[14px]",
          prefix && "focus:pl-[4.6rem] [&:not(:placeholder-shown)]:pl-[4.6rem]",
        )}
        {...rest}
      />
      <label
        htmlFor={id}
        className={cn(
          "pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 bg-background px-1 text-[15px] text-muted-foreground transition-all duration-150",
          "peer-focus:top-0 peer-focus:text-[12px] peer-focus:text-foreground",
          "peer-[:not(:placeholder-shown)]:top-0 peer-[:not(:placeholder-shown)]:text-[12px]",
          invalid && "peer-focus:text-destructive",
        )}
      >
        {label}
      </label>
    </div>
  );
}
