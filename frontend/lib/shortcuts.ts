// Global keyboard shortcuts, shared by the key listener and the shortcuts dialog.

export const OPEN_COMMAND_MENU = "craton:open-command-menu";
export const OPEN_SHORTCUTS = "craton:open-shortcuts";
export const OPEN_GO_TO_FILE = "craton:open-go-to-file";
/** The notifications panel under the bell (there is no notifications page). */
export const OPEN_INBOX = "craton:open-inbox";

/** Keys pressed after "g" jump to a page, like Linear and GitHub. */
/** An href of INBOX_HREF opens the panel instead of navigating. */
export const INBOX_HREF = "#inbox";
export const goShortcuts: Record<string, { href: string; label: string }> = {
  d: { href: "/dashboard", label: "Dashboard" },
  e: { href: "/explore", label: "Explore" },
  t: { href: "/trending", label: "Trending" },
  p: { href: "/pulls", label: "Pull requests" },
  i: { href: "/issues", label: "Issues" },
  n: { href: INBOX_HREF, label: "Notifications" },
  s: { href: "/settings", label: "Settings" },
};
