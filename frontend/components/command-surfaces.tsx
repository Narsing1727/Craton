"use client";

// ⌘K command palette and the keyboard-shortcuts dialog (DESIGN.md §2 "Keyboard first").
// Opens instantly, no animation: it is used many times a day.

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bell,
  BookOpen,
  CircleDot,
  Compass,
  Copy,
  CreditCard,
  FolderGit2,
  GitBranch,
  GitCommit,
  GitCompare,
  GitPullRequest,
  Keyboard,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Star,
  Tag,
  Terminal,
  Upload,
  User,
  Users,
} from "lucide-react";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useSession } from "@/components/session";
import { paletteReposAction, paletteRepoWorkAction } from "@/app/actions";
import { logoutAction } from "@/app/auth-actions";
import { goShortcuts, INBOX_HREF, OPEN_INBOX } from "@/lib/shortcuts";
import { notify } from "@/components/button-status";

/** First path segments that are pages of their own, never an owner's name. */
const RESERVED = new Set(["dashboard", "explore", "trending", "pulls", "issues", "stars", "settings", "new", "orgs", "login", "signup", "docs", "cli", "pricing", "about", "help", "security", "changelog", "contact", "terms", "privacy", "search", "api-reference", "invite", "shared", "verify-email", "reset-password", "forgot-password"]);

/** The repository a path belongs to, when it is one of its pages. */
function repoOfPath(pathname: string | null): { owner: string; repo: string } | null {
  const parts = (pathname ?? "").split("/").filter(Boolean);
  if (parts.length < 2 || RESERVED.has(parts[0])) return null;
  return { owner: decodeURIComponent(parts[0]), repo: decodeURIComponent(parts[1]) };
}

const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, keys: "g d" },
  { label: "Explore public data", href: "/explore", icon: Compass, keys: "g e" },
  { label: "Trending", href: "/trending", icon: BarChart3, keys: "g t" },
  { label: "Your pull requests", href: "/pulls", icon: GitPullRequest, keys: "g p" },
  { label: "Your issues", href: "/issues", icon: CircleDot, keys: "g i" },
  { label: "Notifications", href: INBOX_HREF, icon: Bell, keys: "g n" },
  { label: "Stars", href: "/stars", icon: Star },
  { label: "Settings", href: "/settings", icon: Settings, keys: "g s" },
];

const create = [
  { label: "New repository", href: "/new", icon: Plus },
  { label: "Import repository", href: "/new?import=true", icon: Upload },
  { label: "New organization", href: "/orgs/new", icon: Users },
];

const account = [
  { label: "Billing and plan", href: "/settings/billing", icon: CreditCard },
  { label: "Personal access tokens", href: "/settings/tokens", icon: KeyRound },
];

const help = [
  { label: "Documentation", href: "/docs", icon: BookOpen },
  { label: "Install the CLI", href: "/cli", icon: Terminal },
  { label: "Changelog", href: "/changelog", icon: FolderGit2 },
];

/** The palette and shortcuts dialogs. Loaded lazily by CommandMenu (keeps cmdk off every page's critical path). */
export default function CommandSurfaces({
  open,
  setOpen,
  shortcutsOpen,
  setShortcutsOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const here = repoOfPath(pathname);
  const [query, setQuery] = React.useState("");
  const user = useSession();
  // Repositories come from the API the first time the palette opens; demo data if it's down.
  const [repos, setRepos] = React.useState<{ owner: string; name: string; description: string; tags: string[]; size: string }[] | null>(null);
  React.useEffect(() => {
    if (!open || repos) return;
    let cancelled = false;
    paletteReposAction().then((list) => !cancelled && setRepos(list ?? []));
    return () => {
      cancelled = true;
    };
  }, [open, repos, user]);
  // Open issues and pull requests of the repository being viewed, found by title once something is typed.
  const [work, setWork] = React.useState<{ key: string; issues: { number: number; title: string }[]; pulls: { number: number; title: string }[] } | null>(null);
  const hereKey = here ? `${here.owner}/${here.repo}` : "";
  React.useEffect(() => {
    if (!open || !here || work?.key === hereKey) return;
    let cancelled = false;
    paletteRepoWorkAction(here.owner, here.repo)
      .then((w) => !cancelled && setWork({ key: hereKey, ...w }))
      .catch(() => !cancelled && setWork({ key: hereKey, issues: [], pulls: [] }));
    return () => {
      cancelled = true;
    };
  }, [open, here, hereKey, work?.key]);
  // Signed-out visitors only get the public side of the product.
  const nav = user ? navigation : navigation.filter((n) => n.href === "/explore" || n.href === "/trending");

  function go(href: string) {
    setOpen(false);
    setQuery("");
    if (href === INBOX_HREF) window.dispatchEvent(new Event(OPEN_INBOX));
    else router.push(href);
  }

  const trimmed = query.trim();

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setQuery("");
        }}
        title="Command menu"
        description="Search pages, repositories and actions"
        className="top-[12dvh] sm:max-w-xl"
      >
        <Command>
        <CommandInput placeholder="Search or jump to…" value={query} onValueChange={setQuery} />
        <CommandList className="max-h-[min(26rem,calc(100dvh-12dvh-8rem))]">
          <CommandEmpty>No matches. Press Enter to search all of Craton.</CommandEmpty>
          {trimmed && (
            <CommandGroup heading="Search">
              <CommandItem
                value={`search ${trimmed}`}
                keywords={[trimmed]}
                onSelect={() => go(`/search?q=${encodeURIComponent(trimmed)}`)}
              >
                <Search />
                <span className="truncate">
                  Search Craton for “{trimmed}”
                </span>
                <CommandShortcut>↵</CommandShortcut>
              </CommandItem>
            </CommandGroup>
          )}
          <CommandGroup heading="Go to">
            {nav.map((item) => (
              <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                <item.icon />
                {item.label}
                {item.keys && <CommandShortcut>{item.keys}</CommandShortcut>}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          {here && (
            <>
              <CommandGroup heading={`${here.owner}/${here.repo}`}>
                {[
                  { label: "Code", path: "", icon: FolderGit2 },
                  { label: "Commits", path: "/commits", icon: GitCommit },
                  { label: "Branches", path: "/branches", icon: GitBranch },
                  { label: "Compare branches", path: "/compare", icon: GitCompare },
                  { label: "Pull requests", path: "/pulls", icon: GitPullRequest },
                  { label: "Issues", path: "/issues", icon: CircleDot },
                  { label: "Checks", path: "/checks", icon: ShieldCheck },
                  { label: "Releases", path: "/releases", icon: Tag },
                  { label: "Repository settings", path: "/settings", icon: Settings },
                  ...(user
                    ? [
                        { label: "New pull request", path: "/pulls/new", icon: Plus },
                        { label: "New issue", path: "/issues/new", icon: Plus },
                        { label: "New release", path: "/releases/new", icon: Plus },
                      ]
                    : []),
                ].map((item) => (
                  <CommandItem key={item.path + item.label} value={`${here.repo} ${item.label}`} keywords={[here.owner, here.repo]} onSelect={() => go(`/${here.owner}/${here.repo}${item.path}`)}>
                    <item.icon />
                    {item.label}
                  </CommandItem>
                ))}
                <CommandItem
                  value={`${here.repo} copy clone command`}
                  keywords={["craton clone", "cli"]}
                  onSelect={() => {
                    setOpen(false);
                    setQuery("");
                    void navigator.clipboard?.writeText(`craton clone ${here.owner}/${here.repo}`).then(
                      () => notify.success("Copied", { description: `craton clone ${here.owner}/${here.repo}` }),
                      () => notify.error("Couldn’t copy", { description: "Select the command on the repository page instead." }),
                    );
                  }}
                >
                  <Copy />
                  Copy clone command
                </CommandItem>
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          {here && work?.key === hereKey && trimmed.length >= 2 && (
            <>
              {work.pulls.length > 0 && (
                <CommandGroup heading="Open pull requests here">
                  {work.pulls.map((p) => (
                    <CommandItem key={`pr-${p.number}`} value={`pull request ${p.number} ${p.title}`} onSelect={() => go(`/${here.owner}/${here.repo}/pull/${p.number}`)}>
                      <GitPullRequest />
                      <span className="truncate">{p.title}</span>
                      <CommandShortcut className="tabular-nums tracking-normal">#{p.number}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {work.issues.length > 0 && (
                <CommandGroup heading="Open issues here">
                  {work.issues.map((i) => (
                    <CommandItem key={`issue-${i.number}`} value={`issue ${i.number} ${i.title}`} onSelect={() => go(`/${here.owner}/${here.repo}/issues/${i.number}`)}>
                      <CircleDot />
                      <span className="truncate">{i.title}</span>
                      <CommandShortcut className="tabular-nums tracking-normal">#{i.number}</CommandShortcut>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading="Repositories">
            {(repos ?? []).map((r) => (
              <CommandItem
                key={`${r.owner}/${r.name}`}
                value={`${r.owner}/${r.name}`}
                keywords={[r.description, ...r.tags]}
                onSelect={() => go(`/${r.owner}/${r.name}`)}
              >
                <FolderGit2 />
                <span className="truncate font-mono text-xs">
                  {r.owner}/{r.name}
                </span>
                <CommandShortcut className="font-mono tracking-normal tabular-nums">{r.size}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          {user && (
            <>
              <CommandGroup heading="Create">
                {create.map((item) => (
                  <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                    <item.icon />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandSeparator />
            </>
          )}
          <CommandGroup heading="Account">
            {user ? (
              <>
                <CommandItem value="Your profile" onSelect={() => go(`/${user.handle}`)}>
                  <User />
                  Your profile
                </CommandItem>
                {account.map((item) => (
                  <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                    <item.icon />
                    {item.label}
                  </CommandItem>
                ))}
                <CommandItem
                  value="Sign out"
                  onSelect={() => {
                    setOpen(false);
                    setQuery("");
                    void logoutAction();
                  }}
                >
                  <LogOut />
                  Sign out
                </CommandItem>
              </>
            ) : (
              <>
                <CommandItem value="Sign in" onSelect={() => go("/login")}>
                  <User />
                  Sign in
                </CommandItem>
                <CommandItem value="Create an account" onSelect={() => go("/signup")}>
                  <Plus />
                  Create an account
                </CommandItem>
              </>
            )}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Help">
            {help.map((item) => (
              <CommandItem key={item.href} value={item.label} onSelect={() => go(item.href)}>
                <item.icon />
                {item.label}
              </CommandItem>
            ))}
            <CommandItem
              value="Keyboard shortcuts"
              onSelect={() => {
                setOpen(false);
                setShortcutsOpen(true);
              }}
            >
              <Keyboard />
              Keyboard shortcuts
              <CommandShortcut>?</CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
        <div className="flex items-center gap-3 border-t border-border px-3 py-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> to move
          </span>
          <span className="flex items-center gap-1">
            <Kbd>↵</Kbd> to open
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Kbd>Esc</Kbd> to close
          </span>
        </div>
        </Command>
      </CommandDialog>

      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}

const shortcutRows: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "K"], label: "Open the command menu (⌘K on Mac)" },
  { keys: ["/"], label: "Search" },
  { keys: ["?"], label: "Show keyboard shortcuts" },
  { keys: ["t"], label: "Go to a file (on a repository page)" },
  { keys: ["j"], label: "Next item in a list" },
  { keys: ["k"], label: "Previous item in a list" },
  { keys: ["Enter"], label: "Open the selected item" },
  ...Object.entries(goShortcuts).map(([key, v]) => ({ keys: ["g", key], label: `Go to ${v.label.toLowerCase()}` })),
  { keys: ["Esc"], label: "Close a dialog or menu" },
];

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts work anywhere except while typing in a field.</DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col divide-y divide-border text-sm">
          {shortcutRows.map((row) => (
            <li key={row.label} className="flex items-center justify-between gap-4 py-2">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {row.keys.map((k, i) => (
                  <React.Fragment key={k + i}>
                    {i > 0 && row.keys[0] === "g" && <span className="text-xs text-muted-foreground">then</span>}
                    <Kbd>{k}</Kbd>
                  </React.Fragment>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
