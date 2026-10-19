// The parts the public pages are made of, so that they look and read alike: a title block, titled sections, a "where next" strip.

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SITE_GROUPS } from "@/lib/site-pages";

export function PageHero({ title, lead, children }: { title: string; lead: string; children?: React.ReactNode }) {
  return (
    <section className="w-full border-b border-border">
      <div className="flex w-full max-w-3xl flex-col gap-5 px-4 py-14 sm:px-6 sm:py-16 lg:px-8 xl:px-10">
        <h1 className="text-4xl font-semibold tracking-tight text-balance">{title}</h1>
        <p className="text-lg text-muted-foreground text-pretty">{lead}</p>
        {children && <div className="flex flex-wrap gap-3">{children}</div>}
      </div>
    </section>
  );
}

export function PageSection({ id, title, lead, children, tone }: { id?: string; title: string; lead?: string; children: React.ReactNode; tone?: "card" }) {
  return (
    <section id={id} className={`w-full scroll-mt-20 border-b border-border ${tone === "card" ? "bg-card/40" : ""}`}>
      <div className="flex w-full flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8 xl:px-10">
        <div className="max-w-3xl">
          <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
          {lead && <p className="mt-1.5 text-sm text-muted-foreground text-pretty">{lead}</p>}
        </div>
        {children}
      </div>
    </section>
  );
}

/** Links to the other pages worth reading from this one. */
export function WhereNext({ hrefs }: { hrefs: string[] }) {
  const all = SITE_GROUPS.flatMap((g) => g.links);
  const links = hrefs.map((h) => all.find((l) => l.href === h)).filter((l): l is NonNullable<typeof l> => Boolean(l));
  return (
    <section className="w-full">
      <div className="flex w-full flex-col gap-4 px-4 py-12 sm:px-6 lg:px-8 xl:px-10">
        <h2 className="text-sm font-medium text-muted-foreground">Where to next</h2>
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {links.map((l) => (
            <li key={l.href}>
              <Link href={l.href} className="group flex h-full flex-col gap-1 border border-border p-4 transition-colors hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring">
                <span className="flex items-center justify-between text-sm font-medium">
                  {l.label}
                  <ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
                </span>
                <span className="text-xs text-muted-foreground text-pretty">{l.summary}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
