import Link from "next/link";
import { cn } from "@/lib/utils";

/** Link-based tabs for server-filtered views (the URL is the state). */
export function ScopeTabs({
  tabs,
  active,
  label,
}: {
  tabs: { id: string; label: string; href: string; count?: number }[];
  active: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="scroll-fade-x flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => {
        const isActive = t.id === active;
        return (
          <Link
            key={t.id}
            href={t.href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm transition-colors",
              isActive ? "border-foreground font-semibold text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="bg-muted px-1.5 font-mono text-[11px] tabular-nums text-muted-foreground">{t.count}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
