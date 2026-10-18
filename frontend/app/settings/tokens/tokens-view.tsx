"use client";

import { useState, useTransition } from "react";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { ConfirmAction } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/components/button-status";
import { Checkbox } from "@/components/ui/checkbox";
import { Fieldset, FieldsetLegend } from "@/components/ui/fieldset";
import { Form } from "@/components/ui/form";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// The API's scopes (backend/src/api/app.ts SCOPES). A token can't change account security:
// sessions, passwords, other tokens and deletion need a signed-in browser.
const scopeOptions = [
  { id: "repo", label: "repo · read and write repositories you can access (push, pull, branches)" },
  { id: "read:repo", label: "read:repo · read repositories, including private ones (CI checkouts)" },
  { id: "read:org", label: "read:org · read organization membership" },
  { id: "admin:org", label: "admin:org · invite, remove and change roles of organization members" },
];
import { createTokenAction, revokeTokenAction, tokenRequestsAction } from "@/app/actions";
import type { ApiTokenRequest } from "@/lib/api";
import { timeAgo } from "@/lib/format";

export type TokenRow = { id: number; name: string; created: string; lastUsed: string; scope: string; expires?: string; current?: boolean; /** Repositories the token is limited to; absent means all. */ repos?: string[] };

export function TokensView({ initial, live }: { initial: TokenRow[]; live: boolean }) {
  const [tokenList, setTokenList] = useState(initial);
  const [pending, setPending] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [generatedToken, setGeneratedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [scopes, setScopes] = useState<string[]>(["repo"]);
  const [expiry, setExpiry] = useState("90");
  const [repoText, setRepoText] = useState("");

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim() || scopes.length === 0) {
      notify.error(scopes.length === 0 ? "Pick at least one scope" : "Add a note so you know what the token is for");
      return;
    }
    if (pending) return;
    const limitedRepos = repoText.split(/[\s,]+/).map((r) => r.trim().toLowerCase()).filter(Boolean);

    let token: string;
    let id = Date.now();
    if (live) {
      setPending(true);
      const result = await createTokenAction(tokenName.trim(), scopes, expiry === "never" ? null : Number(expiry), limitedRepos);
      setPending(false);
      if (!result.ok) {
        notify.error("Couldn’t generate the token", { description: result.error });
        return;
      }
      token = result.data.token;
      id = result.data.id;
    } else {
      token = `crt_pat_${Math.random().toString(36).substring(2, 12)}_${Math.random().toString(36).substring(2, 10)}`;
    }
    setGeneratedToken(token);

    setTokenList([
      {
        id,
        name: tokenName.trim(),
        created: "Just now",
        lastUsed: "Never",
        scope: scopes.join(", ") || "none",
        repos: limitedRepos.length ? limitedRepos : undefined,
      },
      ...tokenList,
    ]);
    notify.success("Token generated", { description: "Copy it now. You won’t see it again." });
  }

  async function handleRevoke(t: TokenRow) {
    if (live) {
      const result = await revokeTokenAction(t.id);
      if (!result.ok) {
        notify.error("Couldn’t revoke the token", { description: result.error });
        return;
      }
    }
    setTokenList((list) => list.filter((x) => x.id !== t.id));
    notify.info(`Revoked token "${t.name}"`);
  }

  function copyToken() {
    if (generatedToken) {
      navigator.clipboard.writeText(generatedToken);
      setCopied(true);
      
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
        <div className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4 pb-2">
            <div>
              <h2 className="text-3xl font-semibold tracking-tight">Personal access tokens</h2>
              <p className="mt-2 text-base text-muted-foreground">
                Tokens you have generated that can be used to access the Craton API, CLI, and Git over HTTPS.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowGenerate(!showGenerate)} className="gap-1.5">
              <Plus className="size-3.5" /> Generate new token
            </Button>
          </div>

          {/* Newly Generated Token Alert */}
          {generatedToken && (
            <div className="rounded-lg border border-border bg-muted/40 p-4 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">
                  Copy this token now. For security, you won’t be able to see it again.
                </span>
                <Button size="sm" variant="outline" onClick={copyToken} className="h-7 text-xs gap-1.5">
                  {copied ? <Check className="size-3.5 text-foreground" /> : <Copy className="size-3.5" />}
                  {copied ? "Copied" : "Copy token"}
                </Button>
              </div>
              <code className="rounded bg-background/80 p-2 font-mono text-xs text-foreground select-all border border-border">
                {generatedToken}
              </code>
            </div>
          )}

          {/* Generate Form */}
          {showGenerate && (
            <Card className="p-5 border-primary/40 bg-muted/20">
              <Form onSubmit={handleGenerate} className="flex flex-col gap-4">
                <h3 className="text-sm font-semibold">New personal access token</h3>
                <div>
                  <label htmlFor="token-note" className="block text-xs font-medium text-muted-foreground mb-1">
                    Note
                  </label>
                  <Input
                    id="token-note"
                    placeholder="e.g. CLI on field laptop, QGIS plugin…"
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                    required
                  />
                </div>
                <Fieldset className="flex flex-col gap-2">
                  <FieldsetLegend className="mb-1.5 text-xs font-medium text-muted-foreground">Scopes</FieldsetLegend>
                  {scopeOptions.map((opt) => (
                    <label key={opt.id} htmlFor={`scope-${opt.id}`} className="flex cursor-pointer items-start gap-2.5 text-xs">
                      <Checkbox
                        id={`scope-${opt.id}`}
                        checked={scopes.includes(opt.id)}
                        onCheckedChange={(v) => setScopes((cur) => (v ? [...cur, opt.id] : cur.filter((x) => x !== opt.id)))}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-mono font-semibold text-foreground">{opt.id}</span>
                        <span className="text-muted-foreground"> · {opt.label}</span>
                      </span>
                    </label>
                  ))}
                </Fieldset>
                <div>
                  <label htmlFor="token-repos" className="block text-xs font-medium text-muted-foreground mb-1">
                    Only these repositories <span className="font-normal">(optional)</span>
                  </label>
                  <Input id="token-repos" placeholder="hydrolab/chalakudy-basin, hydrolab/rainfall" value={repoText} onChange={(e) => setRepoText(e.target.value)} className="font-mono text-xs" spellCheck={false} autoComplete="off" />
                  <p className="mt-1 text-xs text-muted-foreground">Leave empty for every repository you can reach. A limited token sees nothing else of yours, only public data.</p>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Expires</span>
                  <Select value={expiry} onValueChange={setExpiry}>
                    <SelectTrigger className="w-44" aria-label="Expiration">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="30">In 30 days</SelectItem>
                        <SelectItem value="90">In 90 days</SelectItem>
                        <SelectItem value="365">In 1 year</SelectItem>
                        <SelectItem value="never">Never (not recommended)</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <Button type="submit" size="sm" loading={pending} disabled={pending}>
                    Generate token
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowGenerate(false);
                      setGeneratedToken(null);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </Form>
            </Card>
          )}

          {/* Tokens List */}
          <Card className="overflow-hidden py-0">
            <ul className="divide-y divide-border text-sm">
              {tokenList.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 p-4 hover:bg-muted/20">
                  <div className="flex items-center justify-between">
                  <div className="flex items-start gap-3">
                    <KeyRound className="size-5 mt-0.5 text-accent shrink-0" />
                    <div>
                      <h3 className="flex items-center gap-2 font-semibold text-sm">
                        {t.name}
                        {t.current && <Badge variant="outline" className="text-[10px] font-normal">Used by this web app</Badge>}
                      </h3>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mt-1">
                        <span>Added {t.created}</span>
                        <span>&middot;</span>
                        <span>Last used {t.lastUsed}</span>
                        {t.expires && (
                          <>
                            <span>&middot;</span>
                            <span>{t.expires}</span>
                          </>
                        )}
                        <span>&middot;</span>
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {t.scope}
                        </Badge>
                        {t.repos && (
                          <>
                            <span>&middot;</span>
                            <span className="font-mono">Only {t.repos.join(", ")}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  {t.current ? (
                    <span className="text-xs text-muted-foreground">Revoke it from the CLI or another session</span>
                  ) : (
                    <ConfirmAction
                      trigger={
                        <Button variant="ghost" size="sm" className="text-xs text-destructive hover:bg-destructive/10">
                          Revoke
                        </Button>
                      }
                      title={`Revoke “${t.name}”?`}
                      description="Scripts, CI jobs and the CLI using this token will stop working immediately."
                      confirmLabel="Revoke token"
                      onConfirm={() => void handleRevoke(t)}
                    />
                  )}
                  </div>
                  {!t.current && <TokenRequests id={t.id} />}
                </li>
              ))}
            </ul>
          </Card>
        </div>
  );
}

/** The last requests one token made, loaded on demand: for working out why a script or CI job is failing. */
function TokenRequests({ id }: { id: number }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ApiTokenRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && rows === null) {
      start(async () => {
        const r = await tokenRequestsAction(id);
        if (r.ok) setRows(r.requests);
        else setError(r.error);
      });
    }
  }

  return (
    <div className="pl-8">
      <button type="button" onClick={toggle} aria-expanded={open} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
        {open ? "Hide recent requests" : "Recent requests"}
      </button>
      {open && (
        <div className="mt-2 text-xs">
          {pending && <p className="text-muted-foreground">Loading…</p>}
          {error && <p className="text-destructive">{error}</p>}
          {rows && rows.length === 0 && <p className="text-muted-foreground">This token hasn’t made a request yet. Its last 100 show here.</p>}
          {rows && rows.length > 0 && (
            <table className="w-full max-w-2xl border-collapse font-mono">
              <caption className="sr-only">The last requests made with this token</caption>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.at}-${i}`} className="border-t border-border">
                    <td className="py-1 pr-3 text-muted-foreground tabular-nums">{timeAgo(r.at)}</td>
                    <td className="py-1 pr-3">{r.method}</td>
                    <td className="py-1 pr-3 break-all">{r.route}</td>
                    <td className={`py-1 pr-3 tabular-nums ${r.status >= 400 ? "text-destructive" : ""}`}>{r.status}</td>
                    <td className="py-1 text-right text-muted-foreground tabular-nums">{r.ms} ms</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
