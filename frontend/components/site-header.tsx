"use client";

import { UserAvatar } from "@/components/user-avatar";
import Link from "next/link";
import { InboxBell } from "@/components/inbox-bell";
import { usePathname, useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  ChevronDown,
  Compass,
  CreditCard,
  FolderGit2,
  HelpCircle,
  Keyboard,
  KeyRound,
  LogOut,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Megaphone,
  Star,
  Upload,
  User,
  Users,
  X,
} from "lucide-react";
import { CratonLogo } from "@/components/craton-logo";
import { CommandMenu, OPEN_COMMAND_MENU, OPEN_SHORTCUTS } from "@/components/command-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useSession } from "@/components/session";
import { logoutAction } from "@/app/auth-actions";

const appLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/explore", label: "Explore" },
  { href: "/trending", label: "Trending" },
  { href: "/pulls", label: "Pull requests" },
  { href: "/issues", label: "Issues" },
];
// Signed-out visitors see the public product, not an empty app.
const publicLinks = [
  { href: "/explore", label: "Explore" },
  { href: "/trending", label: "Trending" },
  { href: "/docs", label: "Docs" },
  { href: "/pricing", label: "Pricing" },
];

// Keep the header's original grey highlight instead of the accent color used elsewhere.
const menuItem = "gap-2.5 px-2.5 py-1.5 text-xs font-medium focus:bg-muted focus:text-foreground not-data-[variant=destructive]:focus:**:text-foreground";
const menuIcon = "size-4 text-muted-foreground";

const openCommandMenu = () => window.dispatchEvent(new Event(OPEN_COMMAND_MENU));

export function SiteHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const user = useSession();
  const [signingOut, startSignOut] = useTransition();
  const navLinks = user ? appLinks : publicLinks;
  const loginHref = `/login${pathname && pathname !== "/" ? `?next=${encodeURIComponent(pathname)}` : ""}`;
  const [searchQuery, setSearchQuery] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Close the mobile panel when the route changes (derived during render, no effect).
  const [menuPath, setMenuPath] = useState(pathname);
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMobileMenuOpen(false);
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQuery.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50 focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:ring-2 focus:ring-ring"
      >
        Skip to content
      </a>
      <div className="flex h-14 w-full items-center justify-between gap-3 px-4 sm:px-6 lg:px-8 xl:px-10">
        {/* Left: brand + primary navigation */}
        <div className="flex min-w-0 items-center gap-6">
          <Link href={user ? "/dashboard" : "/"} className="hit-area flex items-center gap-2 hover:opacity-90" aria-label={user ? "Craton dashboard" : "Craton home"}>
            <CratonLogo />
          </Link>

          <nav aria-label="Primary" className="hidden md:flex items-center gap-1 text-sm font-medium">
            {navLinks.map((link) => {
              const active =
                pathname === link.href || (link.href !== "/dashboard" && pathname.startsWith(link.href));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "px-3 py-1.5 transition-colors",
                    active
                      ? "text-foreground font-semibold bg-muted/60"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/40",
                  )}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Right: search, create, notifications, account */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={openCommandMenu}
            data-radius="control" className="hidden lg:flex h-8 w-44 xl:w-60 items-center gap-2 border border-input bg-muted/30 px-2.5 text-xs text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search or jump to (Ctrl K)"
          >
            <Search className="size-3.5" aria-hidden />
            <span className="flex-1 truncate text-left">Search or jump to…</span>
            <Kbd>/</Kbd>
          </button>
          <button
            type="button"
            onClick={openCommandMenu}
            data-radius="control" className="lg:hidden inline-flex size-8 items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Search or jump to"
          >
            <Search className="size-4" aria-hidden />
          </button>

          {!user && (
            <>
              <Link href={loginHref} className="hidden sm:inline-flex h-8 items-center px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                Sign in
              </Link>
              <Link data-radius="control" href="/signup" className="inline-flex h-8 items-center bg-foreground px-3 text-xs font-semibold text-background transition-colors hover:bg-foreground/90">
                Sign up
              </Link>
            </>
          )}

          {user && (
          <>
          {/* Create menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              data-radius="control" className="group inline-flex h-8 items-center gap-1.5 border border-border bg-background px-2.5 text-xs font-semibold shadow-xs transition-colors hover:bg-muted hover:text-foreground cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Create new"
            >
              <Plus className="size-3.5" aria-hidden />
              <span>New</span>
              <ChevronDown className="size-3 text-muted-foreground group-data-[popup-open]:rotate-180" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuGroup>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/new" />}>
                  <Plus className={menuIcon} /> New repository
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/new?import=true" />}>
                  <Upload className={menuIcon} /> Import repository
                </DropdownMenuLinkItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/orgs/new" />}>
                  <Users className={menuIcon} /> New organization
                </DropdownMenuLinkItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <InboxBell />

          {/* Account menu */}
          <DropdownMenu>
            <DropdownMenuTrigger
              data-radius="control" className="group flex items-center gap-1 p-0.5 border border-border/70 hover:border-foreground/40 hover:bg-muted/50 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Account menu"
            >
              <UserAvatar handle={user.handle} name={user.name} className="size-7" fallbackClassName="text-[11px] font-semibold bg-muted text-foreground" />
              <ChevronDown
                className="size-3.5 text-muted-foreground mr-1 group-data-[popup-open]:rotate-180 group-data-[popup-open]:text-foreground"
                aria-hidden
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel className="px-2.5 py-2">
                  <span className="block text-[10px] uppercase font-semibold tracking-wider">Signed in as</span>
                  <span className="mt-0.5 block text-xs font-bold text-foreground">{user.name}</span>
                  <span className="block text-[11px] font-mono font-normal">@{user.handle}</span>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLinkItem className={menuItem} render={<Link href={`/${user.handle}`} />}>
                  <User className={menuIcon} /> Your profile
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/dashboard" />}>
                  <FolderGit2 className={menuIcon} /> Your repositories
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/stars" />}>
                  <Star className={menuIcon} /> Your stars
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/trending" />}>
                  <Sparkles className={menuIcon} /> Trending repositories
                </DropdownMenuLinkItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/settings" />}>
                  <Settings className={menuIcon} /> Settings
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/settings/billing" />}>
                  <CreditCard className={menuIcon} /> Billing and plan
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/settings/tokens" />}>
                  <KeyRound className={menuIcon} /> Personal access tokens
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/changelog" />}>
                  <Megaphone className={menuIcon} /> What’s new
                </DropdownMenuLinkItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className={menuItem}
                  onClick={() => window.dispatchEvent(new Event(OPEN_SHORTCUTS))}
                >
                  <Keyboard className={menuIcon} /> Keyboard shortcuts
                  <DropdownMenuShortcut>?</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/help" />}>
                  <HelpCircle className={menuIcon} /> Help &amp; support
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/changelog" />}>
                  <Compass className={menuIcon} /> Changelog
                </DropdownMenuLinkItem>
                <DropdownMenuLinkItem className={menuItem} render={<Link href="/security" />}>
                  <ShieldCheck className={menuIcon} /> Security policy
                </DropdownMenuLinkItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem
                  className={cn(menuItem, "text-destructive focus:bg-destructive/10 focus:text-destructive")}
                  disabled={signingOut}
                  onClick={() => startSignOut(() => logoutAction())}
                >
                  <LogOut className="size-4" /> {signingOut ? "Signing out…" : "Sign out"}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          </>
          )}

          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            className="md:hidden flex size-8 items-center justify-center text-muted-foreground hover:bg-muted cursor-pointer"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav"
          >
            {mobileMenuOpen ? <X className="size-4" aria-hidden /> : <Menu className="size-4" aria-hidden />}
          </button>
        </div>
      </div>

      {mobileMenuOpen && (
        <div id="mobile-nav" className="md:hidden border-t border-border px-4 py-3 flex flex-col gap-2 bg-background">
          <form onSubmit={handleSearch} role="search" className="relative w-full mb-2">
            <Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              name="q"
              aria-label="Search Craton"
              placeholder="Search Craton…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-8 text-base bg-muted/40"
              enterKeyHint="search"
            />
          </form>
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/40 font-medium"
            >
              {link.label}
            </Link>
          ))}
          {!user ? (
            <div className="pt-2 border-t border-border flex flex-col gap-1">
              <Link href={loginHref} className="px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted/40">
                Sign in
              </Link>
              <Link href="/signup" className="px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40">
                Create an account
              </Link>
            </div>
          ) : (
          <div className="pt-2 border-t border-border flex flex-col gap-1">
            <Link href={`/${user.handle}`} className="px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted/40 flex items-center gap-2">
              <User className="size-4" aria-hidden /> Your profile (@{user.handle})
            </Link>
            <Link href="/new" className="px-3 py-2 text-sm font-semibold text-foreground hover:bg-muted/40 flex items-center gap-2">
              <Plus className="size-4" aria-hidden /> New repository
            </Link>
            <Link href="/orgs/new" className="px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40 flex items-center gap-2">
              <Users className="size-4" aria-hidden /> New organization
            </Link>
            <Link href="/settings" className="px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40 flex items-center gap-2">
              <Settings className="size-4" aria-hidden /> Settings
            </Link>
            <Link href="/help" className="px-3 py-2 text-sm text-muted-foreground hover:bg-muted/40 flex items-center gap-2">
              <HelpCircle className="size-4" aria-hidden /> Help &amp; support
            </Link>
            <button
              type="button"
              onClick={() => startSignOut(() => logoutAction())}
              className="px-3 py-2 text-left text-sm text-destructive hover:bg-muted/40 flex items-center gap-2 cursor-pointer"
            >
              <LogOut className="size-4" aria-hidden /> Sign out
            </button>
          </div>
          )}
        </div>
      )}

      <CommandMenu />
    </header>
  );
}
