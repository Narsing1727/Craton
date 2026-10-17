"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollText, Settings, Share2, ShieldCheck, Users, Webhook } from "lucide-react";
import { cn } from "@/lib/utils";

/** Lives in the settings layout, so it stays mounted while the page beside it changes. */
export function RepoSettingsNav({ base }: { base: string }) {
  const pathname = usePathname();
  const items = [
    { href: `${base}/settings`, label: "General", icon: Settings },
    { href: `${base}/settings/collaborators`, label: "Collaborators", icon: Users },
    { href: `${base}/settings/sharing`, label: "Sharing", icon: Share2 },
    { href: `${base}/settings/webhooks`, label: "Webhooks", icon: Webhook },
    { href: `${base}/settings/audit`, label: "Audit log", icon: ScrollText },
  ];
  return (
    <nav aria-label="Repository settings" className="flex flex-col">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn("flex items-center gap-3 py-2.5 text-[15px] transition-colors", active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            <item.icon className="size-[18px]" aria-hidden />
            {item.label}
          </Link>
        );
      })}
      <Link href={`${base}/checks`} className="flex items-center gap-3 py-2.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground">
        <ShieldCheck className="size-[18px]" aria-hidden />
        Checks
      </Link>
    </nav>
  );
}
