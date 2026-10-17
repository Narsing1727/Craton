"use client";

// Global keyboard shortcuts: ⌘K / "/" open the palette, "?" lists shortcuts, "g" + key jumps.
// The palette itself (cmdk) loads lazily: after the page is idle, or on first use.

import * as React from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { goShortcuts, INBOX_HREF, OPEN_COMMAND_MENU, OPEN_INBOX, OPEN_SHORTCUTS } from "@/lib/shortcuts";
import { nextListItem } from "@/lib/list-nav";

export { OPEN_COMMAND_MENU, OPEN_SHORTCUTS };

const loadSurfaces = () => import("@/components/command-surfaces");
const CommandSurfaces = dynamic(loadSurfaces, { ssr: false });

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

export function CommandMenu() {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);

  // Warm the palette code once the browser is idle so the first ⌘K is instant.
  React.useEffect(() => {
    const warm = () => {
      loadSurfaces().then(() => setMounted(true));
    };
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(warm, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 1500);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    let pendingG: number | null = null;

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setMounted(true);
        setOpen((v) => !v);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;

      if (pendingG !== null) {
        window.clearTimeout(pendingG);
        pendingG = null;
        const target = goShortcuts[e.key.toLowerCase()];
        if (target) {
          e.preventDefault();
          if (target.href === INBOX_HREF) window.dispatchEvent(new Event(OPEN_INBOX));
          else router.push(target.href);
        }
        return;
      }
      if (e.key === "/") {
        e.preventDefault();
        setMounted(true);
        setOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setMounted(true);
        setShortcutsOpen(true);
      } else if (e.key === "g") {
        pendingG = window.setTimeout(() => (pendingG = null), 1000);
      } else if (e.key === "j" || e.key === "k") {
        const next = nextListItem(e.key === "j" ? 1 : -1);
        if (next) {
          e.preventDefault();
          next.focus();
          next.scrollIntoView({ block: "nearest" });
        }
      }
    }

    const openMenu = () => {
      setMounted(true);
      setOpen(true);
    };
    const openShortcuts = () => {
      setMounted(true);
      setShortcutsOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_MENU, openMenu);
    window.addEventListener(OPEN_SHORTCUTS, openShortcuts);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_MENU, openMenu);
      window.removeEventListener(OPEN_SHORTCUTS, openShortcuts);
      if (pendingG !== null) window.clearTimeout(pendingG);
    };
  }, [router]);

  if (!mounted) return null;
  return <CommandSurfaces open={open} setOpen={setOpen} shortcutsOpen={shortcutsOpen} setShortcutsOpen={setShortcutsOpen} />;
}
