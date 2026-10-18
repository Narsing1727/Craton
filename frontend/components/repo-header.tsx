"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition } from "react";
import { notify } from "@/components/button-status";
import {
  Book,
  CircleCheck,
  CircleDot,
  ClipboardCheck,
  GitBranch,
  GitPullRequest,
  HardDrive,
  LineChart,
  Lock,
  Settings,
  Star,
  Tag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DataTypeBadge } from "@/components/data-type-badge";
import { cn } from "@/lib/utils";
import { getRepo } from "@/lib/data";
import { useRepoSummary } from "@/components/repo-context";
import { useSession } from "@/components/session";
import { starAction } from "@/app/actions";

export function RepoHeader({ owner, repo }: { owner: string; repo: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const user = useSession();
  const base = `/${owner}/${repo}`;
  const summary = useRepoSummary();
  const data = summary?.repo ?? getRepo(owner, repo);
  const [star, setStar] = useState({ on: summary?.starred ?? false, count: data.stars });
  const [pending, startTransition] = useTransition();

  const tabs = [
    { href: base, label: "Files", icon: Book, exact: true },
    { href: `${base}/issues`, label: "Issues", icon: CircleDot, badge: summary?.openIssues ?? 3 },
    { href: `${base}/pulls`, label: "Pull requests", icon: GitPullRequest, badge: summary?.openPulls ?? 2 },
    { href: `${base}/checks`, label: "Checks", icon: CircleCheck },
    { href: `${base}/reviews`, label: "Model review", icon: ClipboardCheck },
    { href: `${base}/branches`, label: "Branches", icon: GitBranch },
    { href: `${base}/releases`, label: "Releases", icon: Tag },
    { href: `${base}/storage`, label: "Storage", icon: HardDrive },
    { href: `${base}/insights`, label: "Insights", icon: LineChart },
    { href: `${base}/settings`, label: "Settings", icon: Settings },
  ];

  // The underline under the active tab slides to the next one. It is one bar moved with a CSS
  // transform (no animation library): measured from the active link, and re-measured when the tab,
  // the counts or the width change. Until it has been measured (the server-rendered page, before
  // hydration) the active link draws its own underline in the same place, so nothing jumps.
  const navRef = useRef<HTMLElement>(null);
  const [bar, setBar] = useState<{ left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return setBar(null);
    const measure = () => setBar((b) => (b && b.left === active.offsetLeft && b.width === active.offsetWidth ? b : { left: active.offsetLeft, width: active.offsetWidth }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    observer.observe(active);
    return () => observer.disconnect();
  }, [pathname, summary?.openIssues, summary?.openPulls]);

  function toggleStar() {
    if (!user) {
      router.push(`/login?next=${encodeURIComponent(pathname)}`);
      return;
    }
    const next = !star.on;
    setStar((s) => ({ on: next, count: s.count + (next ? 1 : -1) })); // optimistic
    startTransition(async () => {
      const result = await starAction(owner, repo, next);
      if (result.ok) setStar({ on: result.data.starred, count: result.data.stars });
      else {
        setStar((s) => ({ on: !next, count: s.count + (next ? -1 : 1) }));
        notify.error("Couldn't update the star", { description: result.error });
      }
    });
  }

  return (
    <div className="w-full border-b border-border bg-card/40">
      <div className="w-full px-4 sm:px-6 lg:px-8 xl:px-10 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-lg">
              <Link href={`/${owner}`} className="text-muted-foreground hover:text-foreground hover:underline">
                {owner}
              </Link>
              <span className="text-muted-foreground">/</span>
              <Link href={base} className="font-semibold hover:underline text-blue-500 hover:text-blue-400">
                {repo}
              </Link>
              <Badge variant="outline" className="ml-1 gap-1 capitalize font-mono">
                {data.visibility === "private" && <Lock className="size-3" />}
                {data.visibility}
              </Badge>
            </div>
            <p className="max-w-2xl text-sm text-muted-foreground">{data.description}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {data.tags.map((t) => (
                <DataTypeBadge key={t} type={t} />
              ))}
              {data.license && (
                <span className="text-xs text-muted-foreground" title="Licence">
                  {data.license}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={toggleStar} aria-pressed={star.on} loading={pending} disabled={pending} title={user ? undefined : "Sign in to star"}>
              <Star data-icon="inline-start" className={star.on ? "fill-current" : undefined} />
              {star.on ? "Starred" : "Star"}
              <Badge variant="secondary" className="ml-1 tabular-nums">{star.count}</Badge>
            </Button>
          </div>
        </div>

        <nav ref={navRef} aria-label="Repository" className="scroll-fade-x relative -mb-px mt-4 flex gap-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 border-transparent px-3 py-2.5 text-sm transition-colors",
                  active ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
                  active && !bar && "border-foreground",
                )}
              >
                <TabIcon icon={tab.icon} count={tab.badge} />
                {tab.label}
              </Link>
            );
          })}
          {bar && (
            <span
              aria-hidden
              className="pointer-events-none absolute bottom-0 left-0 h-0.5 bg-foreground transition-[transform,width] duration-200 ease-out motion-reduce:transition-none"
              style={{ width: bar.width, transform: `translateX(${bar.left}px)` }}
            />
          )}
        </nav>
      </div>
    </div>
  );
}

/** A tab's icon with its open count on top. Plain markup, rendered on the server with the right number. */
function TabIcon({ icon: Icon, count }: { icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>; count?: number }) {
  const shown = count && count > 0 ? (count > 99 ? "99+" : String(count)) : null;
  return (
    <span className="relative inline-flex">
      <Icon className="size-4" aria-hidden />
      {shown && (
        <span
          className={cn(
            "absolute -top-1 -right-1 flex h-5 items-center justify-center bg-brand text-xs font-medium leading-none text-white",
            shown.length === 1 ? "w-5" : shown.length === 2 ? "min-w-5 px-1" : "min-w-6 px-1",
          )}
        >
          <span className="sr-only">{count} open </span>
          <span aria-hidden>{shown}</span>
        </span>
      )}
    </span>
  );
}
