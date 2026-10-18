"use client";

// "Go to file": press t on any repository page, type a few letters of a path, Enter. This part is
// tiny and always present: it only listens for the key (or the button). The dialog, with its
// search UI, is fetched the first time it is asked for.

import * as React from "react";
import dynamic from "next/dynamic";
import { shortcutsOn } from "@/lib/prefs";
import { OPEN_GO_TO_FILE } from "@/lib/shortcuts";

const loadDialog = () => import("@/components/go-to-file-dialog");
const GoToFileDialog = dynamic(loadDialog, { ssr: false });

export function GoToFile({ owner, repo }: { owner: string; repo: string }) {
  const [open, setOpen] = React.useState(false);
  const [wanted, setWanted] = React.useState(false);

  // Fetch the dialog's code once the browser is idle, so the first press of t is instant.
  React.useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => void loadDialog(), { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(() => void loadDialog(), 2500);
    return () => clearTimeout(t);
  }, []);

  React.useEffect(() => {
    const show = () => {
      setWanted(true);
      setOpen(true);
    };
    function onKeyDown(e: KeyboardEvent) {
      if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey || !shortcutsOn()) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      show();
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_GO_TO_FILE, show);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_GO_TO_FILE, show);
    };
  }, []);

  return wanted ? <GoToFileDialog owner={owner} repo={repo} open={open} onOpenChange={setOpen} /> : null;
}
