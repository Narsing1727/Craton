// Preferences that belong to a browser rather than an account, like the theme: less motion, and whether single-key
// shortcuts are on. (What follows a person to every device, like the visibility a new repository starts with, is saved on
// their account instead.) Each is a flag in localStorage; the reduced-motion one is also applied before first paint.

export const REDUCE_MOTION_KEY = "craton:reduce-motion";
export const SHORTCUTS_OFF_KEY = "craton:shortcuts-off";

/** Runs in <head> with the theme script: the page starts with less motion if this browser asked for it. */
export const PREFS_SCRIPT = `try{if(localStorage.getItem("${REDUCE_MOTION_KEY}")==="1")document.documentElement.classList.add("reduce-motion")}catch(e){}`;

function read(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function write(key: string, on: boolean) {
  try {
    if (on) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {}
}

export const readReduceMotion = () => read(REDUCE_MOTION_KEY);
export function setReduceMotion(on: boolean) {
  write(REDUCE_MOTION_KEY, on);
  document.documentElement.classList.toggle("reduce-motion", on);
}

/** Single-key shortcuts (g d, j / k, t, ?, /). The command palette on Ctrl/⌘ K always works. */
export const shortcutsOn = () => !read(SHORTCUTS_OFF_KEY);
export const setShortcutsOn = (on: boolean) => write(SHORTCUTS_OFF_KEY, !on);
