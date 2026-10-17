import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { ArrowRight, BookOpen, KeyRound } from "lucide-react";
import { CommandLine } from "@/components/craton-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { api, PUBLIC_API_URL } from "@/lib/api";
import { noData } from "@/lib/source";

export const metadata: Metadata = {
  title: "CLI and API",
  description: "Sign the Craton CLI in, and reach the REST API from scripts and CI.",
};

export default async function DeveloperSettingsPage() {
  const user = await requireUser("/settings/developer");
  const tokens = await api.tokens();
  if (!tokens) await noData();
  const handle = user?.handle ?? "you";
  return (
        <div className="flex min-w-0 flex-col gap-8">
          <div className="pb-2">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">CLI and API</h2>
            <p className="mt-2 text-base text-muted-foreground text-pretty">Push and pull from a terminal, a script or a CI job.</p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Craton CLI</CardTitle>
              <CardDescription>Large files move through the CLI: it resumes, deduplicates and verifies every chunk.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <ol className="flex flex-col gap-4 text-sm">
                <li className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">1. Install it from the Craton source (Node.js 23.6 or later)</span>
                  <CommandLine command="cd backend && npm install && npm link" />
                </li>
                <li className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">2. Create a token with the repo scope, then sign in with it</span>
                  <CommandLine command={`craton auth login --token <token> --server ${PUBLIC_API_URL}`} />
                </li>
                <li className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">3. Clone a repository. Every chunk is checked against its hash as it arrives.</span>
                  <CommandLine command={`craton clone ${handle}/<repository>`} />
                </li>
              </ol>
              <div>
                <Button variant="outline" size="sm" href="/cli">
                  Full CLI guide
                  <ArrowRight data-icon="inline-end" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Credentials and API</CardTitle>
              <CardDescription>Tokens prove who a script is. They can read and write data, never change your password or sessions.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col">
              <Row icon={KeyRound} name="Personal access tokens" detail={tokens ? `${tokens.length} active · scoped, with optional expiry` : "Scoped, with optional expiry"} href="/settings/tokens" cta="Manage" />
              <Separator />
              <Row icon={BookOpen} name="REST API" detail={`${PUBLIC_API_URL}/v1 · send the token as Authorization: Bearer <token>`} href="/api-reference" cta="Reference" />
            </CardContent>
          </Card>
        </div>
  );
}

function Row({ icon: Icon, name, detail, href, cta }: { icon: typeof KeyRound; name: string; detail: string; href: string; cta: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="break-all font-mono text-xs text-muted-foreground tabular-nums">{detail}</p>
      </div>
      <Button variant="outline" size="sm" href={href}>
        {cta}
      </Button>
    </div>
  );
}
