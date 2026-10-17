"use client";

// What the bell opens: the signed-in person's inbox, with read / done kept on their account. It
// replaces a separate notifications page, so checking in never costs a navigation. Every change is
// shown at once, sent to the server, and put back (with the reason) if the server refuses.

import * as React from "react";
import Link from "next/link";
import { AtSign, Check, CheckCheck, CircleDot, Eye, GitBranch, GitCommit, GitPullRequest, Inbox, Lock, MessageSquare, Tag, Undo2 } from "lucide-react";
import { inboxListAction, inboxMarkAction, inboxReadAllAction } from "@/app/actions";
import { announceInbox } from "@/components/inbox-bell";
import { notify } from "@/components/button-status";
import { Initials } from "@/components/craton-ui";
import { Button } from "@/components/ui/button";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type Type = "commit" | "branch" | "pr" | "comment" | "review" | "issue" | "release" | "mention" | "lock";
type Item = { key: string; type: Type; actor: string; text: string; repo: string; href: string; detail: string; at: string; read: boolean; reason: "mention" | "reply" | "activity" | "lock" | "review" };
type Filter = "all" | "unread" | "mentions" | "done";

const iconFor: Record<Type, typeof GitCommit> = { commit: GitCommit, pr: GitPullRequest, comment: MessageSquare, mention: AtSign, branch: GitBranch, release: Tag, issue: CircleDot, review: Eye, lock: Lock };
const FILTERS: [Filter, string][] = [
  ["all", "All"],
  ["unread", "Unread"],
  ["mentions", "Mentions"],
  ["done", "Done"],
];
const WHY = { mention: "Mentioned you", reply: "Reply to yours", activity: null, lock: "Reminder", review: "Review requested" } as const;

export function NotificationsPanel({ onNavigate }: { onNavigate: () => void }) {
  const [items, setItems] = React.useState<Item[] | null>(null);
  const [done, setDone] = React.useState<Item[] | null>(null);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [failed, setFailed] = React.useState(false);

  const load = React.useCallback(async (view: "inbox" | "done") => {
    const res = await inboxListAction(view);
    if (!res.ok) return void setFailed(true);
    setFailed(false);
    const list = res.items.map((i): Item => ({ key: i.key, type: i.reason === "mention" ? "mention" : i.type, actor: i.actor, text: i.text, repo: i.repo, href: i.href, detail: i.detail, at: i.at, read: view === "done" ? true : i.read, reason: i.reason }));
    if (view === "inbox") {
      setItems(list);
      announceInbox(res.unread);
    } else setDone(list);
  }, []);

  React.useEffect(() => void load("inbox"), [load]);
  React.useEffect(() => {
    if (filter === "done" && done === null) void load("done");
  }, [filter, done, load]);

  const unread = (items ?? []).filter((n) => !n.read).length;

  async function mark(op: "read" | "done" | "restore", item: Item, apply: (all: Item[]) => Item[]) {
    const before = items ?? [];
    setItems(apply(before));
    const res = await inboxMarkAction(op, [item.key]);
    if (res.ok) announceInbox(res.data.unread);
    else {
      setItems(before);
      notify.error(res.error);
    }
  }
  const read = (n: Item) => mark("read", n, (all) => all.map((x) => (x.key === n.key ? { ...x, read: true } : x)));
  const finish = (n: Item) => {
    void mark("done", n, (all) => all.filter((x) => x.key !== n.key));
    setDone(null); // reload next time the Done tab opens
  };
  async function moveBack(n: Item) {
    setDone((all) => (all ?? []).filter((x) => x.key !== n.key));
    const res = await inboxMarkAction("restore", [n.key]);
    if (res.ok) {
      announceInbox(res.data.unread);
      void load("inbox");
    }
  }
  async function readAll() {
    const before = items ?? [];
    setItems(before.map((n) => ({ ...n, read: true })));
    const res = await inboxReadAllAction();
    if (res.ok) {
      announceInbox(res.data.unread);
      notify.success("All marked as read");
    } else {
      setItems(before);
      notify.error(res.error);
    }
  }

  const inDone = filter === "done";
  const pool = inDone ? done : items;
  const visible = (pool ?? []).filter((n) => (filter === "unread" ? !n.read : filter === "mentions" ? n.reason === "mention" : true));

  return (
    <div className="flex max-h-[min(34rem,calc(100vh-5rem))] flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Notifications</h2>
        <Button variant="ghost" size="xs" disabled={unread === 0} onClick={readAll}>
          <CheckCheck data-icon="inline-start" />
          Mark all as read
        </Button>
      </div>
      <div className="flex gap-1 border-b border-border px-2 py-1.5" role="tablist" aria-label="Filter notifications">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={filter === value}
            onClick={() => setFilter(value)}
            className={cn("cursor-pointer px-2 py-1 text-xs transition-colors", filter === value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {label}
            {value === "unread" && items && <span className="ml-1 tabular-nums text-muted-foreground">{unread}</span>}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {failed ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Couldn’t load your notifications. Try again in a moment.</p>
        ) : pool === null ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <Inbox className="size-6 text-muted-foreground" aria-hidden />
            <p className="text-sm font-medium">{inDone ? "Nothing marked as done" : filter === "all" ? "You’re all caught up" : "Nothing here"}</p>
            <p className="text-xs text-muted-foreground">{inDone ? "Items you finish are kept here." : "Reviews, mentions and replies will show up here."}</p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((n) => {
              const Icon = iconFor[n.type];
              const why = WHY[n.reason];
              return (
                <li key={n.key} className={cn("group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/40", !n.read && "bg-accent/5")}>
                  <span className={cn("mt-1.5 size-1.5 shrink-0", n.read ? "bg-transparent" : "bg-accent")} aria-hidden />
                  {!n.read && <span className="sr-only">Unread: </span>}
                  <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <Link
                      href={n.href}
                      onClick={() => {
                        if (!n.read && !inDone) void read(n);
                        onNavigate();
                      }}
                      className={cn("block text-sm hover:underline after:absolute after:inset-0", n.read ? "text-muted-foreground" : "text-foreground")}
                    >
                      <span className="font-medium text-foreground">{n.actor}</span> {n.text.replace(/ (to|on|in|of)$/, "")}
                    </Link>
                    {n.detail && <p className="mt-0.5 truncate text-xs text-muted-foreground">{n.detail}</p>}
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <Initials name={n.actor} className="size-4 text-[7px]" />
                      <span className="truncate font-mono">{n.repo}</span>
                      <span aria-hidden>·</span>
                      <span className="shrink-0">{timeAgo(n.at)}</span>
                      {why && <span className="shrink-0 border border-border px-1 text-[10px] uppercase tracking-wide">{why}</span>}
                    </p>
                  </div>
                  <div className="relative z-10 flex shrink-0 items-center">
                    {inDone ? (
                      <Button variant="ghost" size="xs" onClick={() => void moveBack(n)}>
                        <Undo2 data-icon="inline-start" />
                        Move back
                      </Button>
                    ) : (
                      <>
                        {!n.read && (
                          <Button variant="ghost" size="icon-sm" aria-label="Mark as read" title="Mark as read" onClick={() => void read(n)}>
                            <Check />
                          </Button>
                        )}
                        <Button variant="ghost" size="xs" onClick={() => finish(n)} aria-label={`Done: ${n.actor} ${n.text}`}>
                          Done
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
