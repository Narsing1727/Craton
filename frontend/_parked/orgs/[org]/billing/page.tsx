import Link from "next/link";
import { CreditCard, HardDrive, Download, ArrowUpRight, Check } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { OrgHeader } from "@/components/org-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DownloadButton } from "@/components/craton-actions";
import { CancelSubscriptionButton, UpdatePaymentButton } from "@/components/billing-actions";

const usage = [
  { label: "Storage", used: 34, total: 100, unit: "GB" },
  { label: "Data transfer", used: 210, total: 500, unit: "GB / mo" },
  { label: "Compute minutes", used: 1240, total: 5000, unit: "min" },
];

const invoices = [
  { id: "INV-2026-03", date: "Mar 1, 2026", amount: "$240.00", status: "Paid" },
  { id: "INV-2026-02", date: "Feb 1, 2026", amount: "$240.00", status: "Paid" },
  { id: "INV-2026-01", date: "Jan 1, 2026", amount: "$210.00", status: "Paid" },
];

export default async function OrgBillingPage({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;

  return (
    <AppShell>
      <OrgHeader org={org} />
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 py-6">
        <div className="border-b border-border pb-3">
          <h2 className="text-xl font-semibold">Billing and usage</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">The {org} subscription, storage after deduplication, and invoices.</p>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex flex-col gap-1.5">
                <CardTitle>Current plan</CardTitle>
                <CardDescription>Billed monthly</CardDescription>
              </div>
              <Badge>Team</Badge>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-semibold tabular-nums">$240</span>
                <span className="text-muted-foreground">/ month</span>
              </div>
              <ul className="flex flex-col gap-2 text-sm text-muted-foreground">
                {["100 GB dataset storage", "Unlimited private repos", "12 seats included", "Priority pipeline compute"].map((f) => (
                  <li key={f} className="flex items-center gap-2">
                    <Check className="size-4 text-chart-2" aria-hidden />
                    {f}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter className="gap-2 border-t border-border">
              <Button render={<Link href="/pricing" />}>
                <ArrowUpRight data-icon="inline-start" />
                Change plan
              </Button>
              <CancelSubscriptionButton org={org} plan="Team" periodEnd="Apr 1, 2026" />
            </CardFooter>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Payment method</CardTitle>
              <CardDescription>Charged on the 1st of each month.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center gap-3 rounded-lg border border-border p-3">
                <div className="flex size-9 items-center justify-center rounded-md bg-muted">
                  <CreditCard className="size-5" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">Visa ending 4242</p>
                  <p className="text-xs text-muted-foreground">Expires 08 / 2028</p>
                </div>
                <UpdatePaymentButton />
              </div>
              <p className="text-xs text-muted-foreground">
                Billing contact: finance@hydrolab.org
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-4" /> Usage this cycle
            </CardTitle>
            <CardDescription>Resets Apr 1, 2026</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {usage.map((u) => (
              <div key={u.label} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{u.label}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {u.used} / {u.total} {u.unit}
                  </span>
                </div>
                <Progress value={(u.used / u.total) * 100} aria-label={`${u.label}: ${Math.round((u.used / u.total) * 100)}% used`} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="mt-4">
          <CardHeader>
            <CardTitle>Invoices</CardTitle>
            <CardDescription>Download past invoices for your records.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Download</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-medium font-mono text-xs">{inv.id}</TableCell>
                    <TableCell className="text-muted-foreground">{inv.date}</TableCell>
                    <TableCell className="tabular-nums">{inv.amount}</TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="gap-1">
                        <Check className="size-3" />
                        {inv.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DownloadButton
                        filename={`${inv.id}.txt`}
                        content={[`Craton invoice ${inv.id}`, `Organization: ${org}`, `Date: ${inv.date}`, "Plan: Team", `Amount: ${inv.amount}`, `Status: ${inv.status}`].join("\n")}
                        variant="ghost"
                        size="icon-sm"
                        label={`Download invoice ${inv.id}`}
                      >
                        <Download />
                      </DownloadButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
