import type { Metadata } from "next";
import { FileKey, KeyRound, Lock, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SECURITY_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Security",
  description: "How Craton protects accounts and data, what it doesn't do yet, and how to report a vulnerability.",
};

// Each line describes code in backend/ or frontend/, not an aspiration.
const measures = [
  {
    icon: Lock,
    title: "Accounts",
    points: [
      "Passwords are hashed with scrypt and a per-password salt; the plain password is never stored.",
      "Web sessions live in an httpOnly, SameSite cookie that page scripts can’t read.",
      "Ten failed sign-ins in 15 minutes lock the account for a while, and sign-ins, sign-ups and reset requests are rate limited.",
      "A sign-in from a new device emails you. You can see every signed-in browser and sign any of them out.",
      "Changing or resetting your password signs out every other session.",
    ],
  },
  {
    icon: KeyRound,
    title: "Tokens",
    points: [
      "Personal access tokens are stored only as SHA-256 hashes and shown once.",
      "Each token has scopes (repo, read:repo, read:org, admin:org) and an optional expiry.",
      "No token can change a password, list or end sessions, create other tokens or delete the account; those need a signed-in browser.",
    ],
  },
  {
    icon: FileKey,
    title: "Data integrity",
    points: [
      "Every chunk is addressed by its SHA-256 and checked when it’s uploaded and when it’s read.",
      "Each commit records a Merkle root over its files, so craton fsck --verify can prove a checkout is exact.",
      "History is append-only: reverts are new commits, and nothing rewrites what was pushed.",
      "Chunks in private repositories are never matched against other people’s data.",
    ],
  },
  {
    icon: ShieldCheck,
    title: "The service",
    points: [
      "API responses forbid framing, MIME sniffing and referrers, and set a strict content security policy.",
      "Encryption at rest depends on the storage backend: Cloudflare R2 encrypts every object; a local disk is only as protected as the server.",
      "The database can be backed up with a consistent snapshot and restored (npm run backup, npm run restore).",
    ],
  },
];

const notYet = ["Two-factor authentication", "Single sign-on (SAML or OIDC)", "Audit log of account and organization events", "An independent security audit or certification"];

export default function SecurityPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-4 py-10 sm:px-6">
        <PageHeader title="Security" description="What Craton does to protect accounts and data today, and what it doesn’t do yet." />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {measures.map((m) => (
            <Card key={m.title} className="p-5">
              <m.icon className="mb-2 size-5 text-accent" aria-hidden />
              <h2 className="text-sm font-semibold">{m.title}</h2>
              <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-xs leading-relaxed text-muted-foreground">
                {m.points.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Card>
          ))}
        </div>

        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <TriangleAlert className="size-4 text-chart-3" aria-hidden />
            Not in place yet
          </h2>
          <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-4 text-xs text-muted-foreground">
            {notYet.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">If your organization needs any of these before storing data here, hold off until they ship.</p>
        </Card>

        <Card className="p-6">
          <h2 className="mb-2 text-lg font-semibold">Reporting a vulnerability</h2>
          <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
            Please report it privately rather than in a public issue, with enough detail to reproduce it. Don’t access or change other people’s data while testing; use accounts you created.
          </p>
          {SECURITY_EMAIL ? (
            <div className="mt-4 flex flex-col items-start justify-between gap-4 border border-border bg-muted/30 p-4 sm:flex-row sm:items-center">
              <div>
                <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Report to</span>
                <p className="font-mono text-sm font-semibold text-foreground">{SECURITY_EMAIL}</p>
              </div>
              <Button render={<a href={`mailto:${SECURITY_EMAIL}`} />} size="sm" className="gap-2">
                <Mail className="size-3.5" aria-hidden /> Email a report
              </Button>
            </div>
          ) : (
            <p className="mt-4 border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
              This deployment hasn’t published a security contact yet (CRATON_SECURITY_EMAIL). Contact the people who run it directly.
            </p>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
