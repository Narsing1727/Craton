import type { Metadata } from "next";
import Link from "next/link";
import { HardDrive, Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { api } from "@/lib/api";
import { noData } from "@/lib/source";
import { formatBytes } from "@/lib/format";
import { CircularProgressCombined } from "@/components/ui/circular-progress";
import { Stat, StatDescription, StatLabel, StatValue } from "@/components/ui/stat";
import { NumberTicker } from "@/components/ui/number-ticker";

export const metadata: Metadata = {
  title: "Plan and usage",
  description: "Your Craton plan and storage use after deduplication, for you and your organizations.",
};

const MAX_REPOS = 30; // per page render; storage stats are one request each

export default async function BillingSettingsPage() {
  const user = await requireUser("/settings/billing");
  const owners = user?.writableOwners ?? [];
  const [usages, repos] = await Promise.all([Promise.all(owners.map((o) => api.ownerUsage(o))), api.repos()]);
  if (!repos) await noData();
  const mine = (repos ?? []).filter((r) => owners.includes(r.owner)).slice(0, MAX_REPOS);
  const storage = await Promise.all(mine.map((r) => api.storage(r.owner, r.name)));
  const totalHistoryBytes = storage.reduce((sum, s) => sum + (s?.historyBytes ?? 0), 0);
  const totalStoredBytes = storage.reduce((sum, s) => sum + (s?.storedBytes ?? 0), 0);
  const dedupPct = totalHistoryBytes > 0 ? Math.round((1 - totalStoredBytes / totalHistoryBytes) * 100) : 0;

  return (
        <div className="flex min-w-0 flex-col gap-8">
          <div className="pb-2">
            <h2 className="text-3xl font-semibold tracking-tight text-balance">Plan and usage</h2>
            <p className="mt-2 text-base text-muted-foreground text-pretty">
              Storage counts the unique chunks you keep, after compression. Public data someone else also stores is free to reference. Craton is free during early access; there’s nothing to pay and no invoices.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {owners.map((owner, i) => {
              const u = usages[i];
              if (!u) return null;
              const pct = u.limitBytes ? Math.min(100, Math.round((u.storedBytes / u.limitBytes) * 100)) : 0;
              return (
                <Card key={owner}>
                  <CardHeader className="flex flex-row items-start justify-between">
                    <div className="flex flex-col gap-1.5">
                      <CardTitle className="font-mono text-base">{owner}</CardTitle>
                      <CardDescription>{owner === user?.handle ? "Personal account" : "Organization"}</CardDescription>
                    </div>
                    <Badge variant="secondary" className="capitalize">{u.plan}</Badge>
                  </CardHeader>
                  <CardContent className="flex items-center gap-5">
                    <CircularProgressCombined value={pct} size={64} thickness={5} aria-label={`${pct}% of storage used`} className="shrink-0" />
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium">Stored</span>
                        <span className="font-mono text-xs tabular-nums text-muted-foreground">
                          {formatBytes(u.storedBytes)} / {formatBytes(u.limitBytes)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {u.repositories.total} {u.repositories.total === 1 ? "repository" : "repositories"} ({u.repositories.private} private)
                      </p>
                    </div>
                  </CardContent>
                  {u.sharedFreeBytes > 0 && (
                    <CardFooter className="gap-2 border-t border-border text-xs text-muted-foreground">
                      <Layers className="size-3.5" aria-hidden />
                      {formatBytes(u.sharedFreeBytes)} of shared public data referenced for free
                    </CardFooter>
                  )}
                </Card>
              );
            })}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="size-4 text-muted-foreground" aria-hidden />
                Storage by repository
              </CardTitle>
              <CardDescription>Logical is every version of every file added up; stored is what Craton keeps after deduplication and compression.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {mine.length > 0 && totalHistoryBytes > 0 && (
                <Stat>
                  <StatLabel>Saved by deduplication</StatLabel>
                  <StatValue>
                    <NumberTicker value={dedupPct} />%
                  </StatValue>
                  <StatDescription>
                    {formatBytes(totalStoredBytes)} stored vs {formatBytes(totalHistoryBytes)} for every version, across {mine.length} {mine.length === 1 ? "repository" : "repositories"}
                  </StatDescription>
                </Stat>
              )}
              {mine.length === 0 ? (
                <p className="text-sm text-muted-foreground">No repositories yet.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Repository</TableHead>
                      <TableHead className="text-right">Logical</TableHead>
                      <TableHead className="text-right">Stored</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mine.map((r, i) => (
                      <TableRow key={`${r.owner}/${r.name}`}>
                        <TableCell>
                          <Link href={`/${r.owner}/${r.name}/storage`} className="font-mono text-xs hover:underline">
                            {r.owner}/{r.name}
                          </Link>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums text-muted-foreground">{storage[i] ? formatBytes(storage[i]!.historyBytes) : "—"}</TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">{storage[i] ? formatBytes(storage[i]!.storedBytes) : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
  );
}
