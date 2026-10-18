"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BadgeCheck, Building2, FolderGit2, Settings, Users } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

export function OrgHeader({ org, domains = [] }: { org: string; domains?: string[] }) {
  const pathname = usePathname();
  const base = `/orgs/${org}`;

  const tabs = [
    { href: base, label: "Repositories", icon: FolderGit2, exact: true },
    { href: `${base}/people`, label: "People", icon: Users },
    { href: `${base}/settings`, label: "Settings", icon: Settings },
  ];

  return (
    <div className="w-full border-b border-border bg-card/40">
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-14 rounded-lg border border-border">
              <AvatarFallback className="rounded-lg bg-accent/15 text-accent text-lg font-bold">
                <Building2 className="size-6" />
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold">{org}</h1>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                Organization · /orgs/{org}
              </p>
              {domains.length > 0 && (
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {domains.map((d) => (
                    <span key={d} className="inline-flex items-center gap-1" title={`${org} has proved it controls ${d}`}>
                      <BadgeCheck className="size-3.5 text-accent" aria-hidden />
                      <span className="font-mono">{d}</span>
                      <span className="sr-only">(verified domain)</span>
                    </span>
                  ))}
                </p>
              )}
            </div>
          </div>
        </div>

        <nav aria-label="Organization" className="scroll-fade-x -mb-px mt-6 flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
                  active
                    ? "border-foreground text-foreground font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                <tab.icon className="size-4" aria-hidden />
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
