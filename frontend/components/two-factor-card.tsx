"use client";

// Settings → Security → Two-step verification. Turning it on is three steps in one dialog:
// confirm the password, scan the QR code and type the first code, then save the recovery codes.
// Turning it off and making new recovery codes both ask for the password and a current code.

import * as React from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { notify } from "@/components/button-status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { CopyButton, DownloadButton } from "@/components/craton-actions";
import { twoFactorDisableAction, twoFactorEnableAction, twoFactorRecoveryAction, twoFactorSetupAction } from "@/app/auth-actions";
import type { ApiTwoFactor } from "@/lib/api";
import { timeAgo } from "@/lib/format";

type Mode = "enable" | "disable" | "recovery";

export function TwoFactorCard({ status, live }: { status: ApiTwoFactor | null; live: boolean }) {
  const [mode, setMode] = React.useState<Mode | null>(null);
  const enabled = Boolean(status?.enabled);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Two-step verification
          <Badge variant={enabled ? "default" : "outline"}>{enabled ? "On" : "Off"}</Badge>
        </CardTitle>
        <CardDescription>
          {enabled
            ? `Signing in needs a code from your authenticator app as well as your password. Turned on ${status?.enabledAt ? timeAgo(status.enabledAt) : ""}.`
            : "Ask for a code from an authenticator app (Google Authenticator, 1Password, Authy…) after the password, so a stolen password alone can’t get into your data."}
        </CardDescription>
      </CardHeader>
      {enabled && (
        <CardContent className="pt-0 text-sm">
          <p className={status!.recoveryCodesLeft <= 2 ? "text-destructive" : "text-muted-foreground"}>
            {status!.recoveryCodesLeft} of 10 recovery codes left
            {status!.recoveryCodesLeft <= 2 ? ". Make new ones before you run out." : "."}
          </p>
        </CardContent>
      )}
      <CardFooter className="gap-2 border-t border-border">
        {enabled ? (
          <>
            <Button variant="outline" size="sm" disabled={!live} onClick={() => setMode("recovery")}>
              New recovery codes
            </Button>
            <Button variant="outline" size="sm" disabled={!live} onClick={() => setMode("disable")}>
              <ShieldOff data-icon="inline-start" />
              Turn off
            </Button>
          </>
        ) : (
          <Button size="sm" disabled={!live} onClick={() => setMode("enable")}>
            <ShieldCheck data-icon="inline-start" />
            Turn on
          </Button>
        )}
      </CardFooter>
      {mode && <TwoFactorDialog mode={mode} onClose={() => setMode(null)} />}
    </Card>
  );
}

function TwoFactorDialog({ mode, onClose }: { mode: Mode; onClose: () => void }) {
  const router = useRouter();
  type Step = "password" | "scan" | "codes";
  const [step, setStep] = React.useState<Step>(mode === "enable" ? "password" : "password");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [pending, setPending] = React.useState(false);
  const [setup, setSetup] = React.useState<{ secret: string; qr: string; account: string } | null>(null);
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [saved, setSaved] = React.useState(false);

  const title = mode === "enable" ? "Turn on two-step verification" : mode === "disable" ? "Turn off two-step verification" : "New recovery codes";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      if (mode === "enable" && step === "password") {
        const r = await twoFactorSetupAction(password);
        if (!r.ok) return setError(r.error);
        setSetup(r.data);
        setStep("scan");
      } else if (mode === "enable" && step === "scan") {
        const r = await twoFactorEnableAction(code);
        if (!r.ok) return setError(r.error);
        setCodes(r.data.recoveryCodes);
        setStep("codes");
        router.refresh();
      } else if (mode === "disable") {
        const r = await twoFactorDisableAction(password, code);
        if (!r.ok) return setError(r.error);
        notify.success("Two-step verification is off", { description: "Signing in needs only your password now." });
        router.refresh();
        onClose();
      } else if (mode === "recovery") {
        const r = await twoFactorRecoveryAction(password, code);
        if (!r.ok) return setError(r.error);
        setCodes(r.data.recoveryCodes);
        setStep("codes");
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  const askPasswordAndCode = mode !== "enable";

  return (
    <Dialog open onOpenChange={(open) => !open && (step !== "codes" || saved) && onClose()}>
      <DialogContent className="sm:max-w-md" showCloseButton={step !== "codes" || saved}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>{step === "codes" ? "Save your recovery codes" : title}</DialogTitle>
            <DialogDescription>
              {step === "codes"
                ? "If you lose your phone, each of these signs you in once. They’re shown only now, so keep them somewhere safe, like a password manager."
                : step === "scan"
                  ? "Scan the QR code with your authenticator app, then enter the 6-digit code it shows."
                  : mode === "enable"
                    ? "Confirm your password to start."
                    : mode === "disable"
                      ? "Confirm your password and enter a current code (or a recovery code)."
                      : "This replaces your old recovery codes. Confirm your password and enter a current code."}
            </DialogDescription>
          </DialogHeader>

          {step === "scan" && setup && (
            <div className="flex flex-col items-center gap-3">
              {/* Drawn on the server from the otpauth link by the qrcode package: our own markup, not user input. */}
              <div className="size-48 border border-border bg-white p-1 [&>svg]:size-full" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qr }} />
              <details className="w-full text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Can’t scan? Enter the key by hand</summary>
                <div className="mt-2 flex items-center gap-2 border border-border bg-muted/30 p-2">
                  <code className="min-w-0 flex-1 select-all break-all font-mono text-xs tracking-wider">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</code>
                  <CopyButton value={setup.secret} label="Copy key" />
                </div>
                <p className="mt-1.5 text-muted-foreground">Account: {setup.account}. Time-based, 6 digits.</p>
              </details>
            </div>
          )}

          {step === "codes" && codes && (
            <div className="flex flex-col gap-3">
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 border border-border bg-muted/30 p-3 font-mono text-sm" aria-label="Recovery codes">
                {codes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              <div className="flex gap-2">
                <CopyButton value={codes.join("\n")} label="Copy codes" variant="outline" size="sm">
                  Copy
                </CopyButton>
                <DownloadButton filename="craton-recovery-codes.txt" content={`Craton recovery codes\nEach works once.\n\n${codes.join("\n")}\n`} type="text/plain">
                  Download
                </DownloadButton>
              </div>
              <label htmlFor="saved-codes" className="flex cursor-pointer items-center gap-2.5 text-sm">
                <Checkbox id="saved-codes" checked={saved} onCheckedChange={(v) => setSaved(Boolean(v))} />I’ve saved these somewhere safe
              </label>
            </div>
          )}

          {step !== "codes" && (
            <FieldGroup>
              {(step === "password" || askPasswordAndCode) && (
                <Field data-invalid={error && !code ? true : undefined}>
                  <FieldLabel htmlFor="mfa-password">Password</FieldLabel>
                  <Input id="mfa-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
                </Field>
              )}
              {(step === "scan" || askPasswordAndCode) && (
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor="mfa-code">{askPasswordAndCode ? "Code or recovery code" : "6-digit code"}</FieldLabel>
                  <Input
                    id="mfa-code"
                    value={code}
                    onChange={(e) => setCode(askPasswordAndCode ? e.target.value : e.target.value.replace(/\D/g, "").slice(0, 6))}
                    inputMode={askPasswordAndCode ? "text" : "numeric"}
                    autoComplete="one-time-code"
                    spellCheck={false}
                    placeholder="123456"
                    className="font-mono tracking-widest"
                    autoFocus={step === "scan"}
                    required
                  />
                  {step === "scan" && <FieldDescription>If it keeps failing, check your phone’s clock is set automatically.</FieldDescription>}
                </Field>
              )}
              {error && <FieldError>{error}</FieldError>}
            </FieldGroup>
          )}

          <DialogFooter>
            {step === "codes" ? (
              <Button type="button" disabled={!saved} onClick={() => { notify.success(mode === "enable" ? "Two-step verification is on" : "New recovery codes saved"); onClose(); }}>
                Done
              </Button>
            ) : (
              <>
                <Button type="button" variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant={mode === "disable" ? "destructive" : "default"} loading={pending} disabled={pending || !password && step === "password" || (step === "scan" && code.length !== 6) || (askPasswordAndCode && (!password || !code))}>
                  {step === "scan" ? "Verify and turn on" : mode === "disable" ? "Turn off" : mode === "recovery" ? "Make new codes" : "Continue"}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
