"use client";

// The bell in the header, with how many inbox items are unread, and the notifications panel that
// opens right under it. The count comes from the account (so it agrees across devices) and is
// refreshed on focus and every 90 s while the tab is visible; the panel tells it straight away when
// something is marked, so it never lags.

import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { inboxCountAction } from "@/app/actions";
import { NotificationsPanel } from "@/components/notifications-panel";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { OPEN_INBOX } from "@/lib/shortcuts";

export const INBOX_EVENT = "craton:inbox";
export const announceInbox = (unread: number) => window.dispatchEvent(new CustomEvent(INBOX_EVENT, { detail: { unread } }));

export function InboxBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      if (document.visibilityState === "hidden") return;
      const n = await inboxCountAction().catch(() => null);
      if (alive && n !== null) setUnread(n);
    };
    const onMark = (e: Event) => setUnread((e as CustomEvent<{ unread: number }>).detail.unread);
    const onOpen = () => setOpen(true);
    refresh();
    const timer = setInterval(refresh, 90_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener(INBOX_EVENT, onMark);
    window.addEventListener(OPEN_INBOX, onOpen);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener(INBOX_EVENT, onMark);
      window.removeEventListener(OPEN_INBOX, onOpen);
    };
  }, []);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        data-radius="control"
        className="relative inline-flex size-8 cursor-pointer items-center justify-center border border-transparent text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground"
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : "Notifications"}
      >
        <Bell className="size-4" aria-hidden />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center bg-accent px-1 text-[10px] font-medium leading-none text-accent-foreground tabular-nums" aria-hidden>
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} aria-label="Notifications" className="w-[26rem] max-w-[calc(100vw-1rem)] gap-0 p-0">
        {open && <NotificationsPanel onNavigate={() => setOpen(false)} />}
      </PopoverContent>
    </Popover>
  );
}

/** A text link that opens the panel (for places that used to link to the notifications page). */
export function OpenInboxLink({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(OPEN_INBOX))}>
      {children}
    </button>
  );
}
