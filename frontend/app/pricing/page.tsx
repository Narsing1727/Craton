import type { Metadata } from "next";
import { formatBytes } from "@/lib/format";
import { api } from "@/lib/api";
import Link from "next/link";
import { Check } from "lucide-react";
import { BlurFade } from "@/components/ui/blur-fade";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

export const metadata: Metadata = {
  alternates: { types: { "text/markdown": "/pricing.md" } },
  title: "Pricing",
  description: "Craton's free plan, its limits, and what paid plans will add.",
};

type Plans = Record<"free" | "team", { storageBytes: number; privateRepos: number | null }>;

function tiersFor(plans: Plans | null) {
  const free = plans?.free;
  const team = plans?.team;
  const storage = (b?: number) => (b ? formatBytes(b) : "—");
  return [
    {
      name: "Free",
      price: "$0",
      cadence: "forever",
      description: "For individuals and open datasets.",
      available: true,
      features: [
        `${storage(free?.storageBytes)} of your own data, measured after deduplication and compression`,
        "Public base data other people also store doesn’t count against you",
        "Unlimited public repositories",
        free === undefined ? "Private repositories" : free.privateRepos === null ? "Unlimited private repositories" : `${free.privateRepos} private repositories`,
        "Branches, pull requests, reviews and checks",
        "Map previews and diffs",
      ],
      cta: { label: "Get started", href: "/signup" },
    },
    {
      name: "Team",
      price: "Not yet",
      cadence: "coming later",
      description: "For hydro teams collaborating on private models.",
      available: false,
      features: [
        "Everything in Free",
        `${storage(team?.storageBytes)} of your own data`,
        team === undefined ? "More private repositories" : team.privateRepos === null ? "Unlimited private repositories" : `${team.privateRepos} private repositories`,
        "Invoices and billing by organization",
      ],
      cta: { label: "Ask about Team", href: "/contact" },
    },
  ];
}

const faqs = [
  {
    q: "Why does the free quota go further than I expect?",
    a: "Craton stores files as chunks and keeps each chunk once. A new version of a DEM only adds the chunks that changed, and base data that someone else already published publicly (elevation, rainfall grids) isn’t counted against you at all. You spend quota on data only you have.",
  },
  {
    q: "What happens when I reach my storage limit?",
    a: "Everything you have stays readable and downloadable. Pushes that would add new data are refused with a clear message until you free up space; nothing is deleted.",
  },
  {
    q: "Is my private data ever shared with other people?",
    a: "No. Chunks in a private repository are only matched against your own repositories and public data, never against anyone else’s private data, and nobody outside the repository can read them.",
  },
  {
    q: "When will paid plans be available?",
    a: "Not yet: there’s no way to pay today, and no one is charged. The Team limits above are what the service is configured for once billing exists.",
  },
];

export default async function PricingPage() {
  const plans = await api.plans();
  const tiers = tiersFor(plans);
  return (
    <AppShell>
      <div className="w-full px-4 py-16 sm:px-6 lg:px-8 xl:px-10">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="font-serif text-4xl font-semibold md:text-5xl">Pricing</h1>
          <p className="mt-3 text-muted-foreground text-pretty">
            Craton is free while it’s in early access. Storage is measured after deduplication, so the quota goes further than a raw number suggests.
          </p>
        </div>

        <div className="mx-auto mt-12 grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2">
          {tiers.map((tier, i) => (
            <BlurFade key={tier.name} delay={i * 0.08}>
            <Card className={tier.available ? "ring-foreground/40" : "opacity-90"}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  {tier.name}
                  {!tier.available && <Badge variant="outline">Not available yet</Badge>}
                </CardTitle>
                <CardDescription>{tier.description}</CardDescription>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="font-serif text-4xl font-semibold">{tier.price}</span>
                  <span className="text-sm text-muted-foreground">/ {tier.cadence}</span>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-3">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-sm">
                      <Check className="mt-0.5 size-4 shrink-0 text-chart-2" aria-hidden />
                      {f}
                    </li>
                  ))}
                </ul>
              </CardContent>
              <CardFooter>
                <Button variant={tier.available ? "default" : "outline"} className="w-full" render={<Link href={tier.cta.href} />}>
                  {tier.cta.label}
                </Button>
              </CardFooter>
            </Card>
            </BlurFade>
          ))}
        </div>

        <div className="mx-auto mt-16 max-w-3xl">
          <h2 className="mb-4 text-center font-serif text-2xl font-semibold">Frequently asked questions</h2>
          <Accordion>
            {faqs.map((f) => (
              <AccordionItem key={f.q} value={f.q}>
                <AccordionTrigger>{f.q}</AccordionTrigger>
                <AccordionContent>{f.a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </AppShell>
  );
}
