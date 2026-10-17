// The two looks of the app. "darker" (the default) is one near-black surface for the whole app;
// "standard" is the dark grey Craton had before. The choice lives in this browser (localStorage).

export type Theme = "standard" | "darker";
export const THEME_KEY = "craton:theme";

/** The page background of each look, for the browser's own chrome (the address bar on a phone): `theme-color`. */
export const THEME_COLORS: Record<Theme, string> = { darker: "#0a0a0a", standard: "#19191b" };

/**
 * Runs in <head> before first paint: the look, and once the document has its <meta name="theme-color"> the browser bar
 * is told the matching colour (the default in the page is the "darker" one).
 */
export const THEME_SCRIPT = `try{var s=localStorage.getItem("${THEME_KEY}")==="standard";if(!s)document.documentElement.classList.add("darker");if(s)document.addEventListener("DOMContentLoaded",function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","${"#19191b"}")})}catch(e){document.documentElement.classList.add("darker")}`;

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "standard" ? "standard" : "darker";
  } catch {
    return "darker";
  }
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("darker", theme === "darker");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}
