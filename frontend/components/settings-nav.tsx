"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CreditCard, KeyRound, Shield, Terminal, User } from "lucide-react";
import { cn } from "@/lib/utils";

const groups: { heading: string; items: { label: string; href: string; icon: typeof User }[] }[] = [
  {
    heading: "Account",
    items: [
      { label: "Profile", href: "/settings", icon: User },
      { label: "Security", href: "/settings/security", icon: Shield },
    ],
  },
  { heading: "Billing", items: [{ label: "Plan and usage", href: "/settings/billing", icon: CreditCard }] },
  {
    heading: "Developer",
    items: [
      { label: "Personal access tokens", href: "/settings/tokens", icon: KeyRound },
      { label: "CLI and API", href: "/settings/developer", icon: Terminal },
    ],
  },
];

/**
 * The settings sidebar. It lives in app/settings/layout.tsx, so moving between settings pages
 * swaps only the pane on the right; this stays mounted and just moves its highlight.
 */
export function SettingsNav() {
  const pathname = usePathname();
  return (
    <aside>
      <h1 className="mb-6 text-lg font-semibold">Settings</h1>
      <nav aria-label="Settings" className="flex flex-col gap-7">
        {groups.map((group) => (
          <div key={group.heading} className="flex flex-col">
            <h2 className="pb-2 text-[15px] font-medium text-foreground">{group.heading}</h2>
            {group.items.map((item) => {
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
          </div>
        ))}
      </nav>
    </aside>
  );
}
