// The looks of the app: "darker" (the default) is one near-black surface for the whole app; "light" is the white one.
// The choice lives in this browser (localStorage). A browser that saved the old "standard" look gets "darker".
//
// How each is drawn: the page is always `dark` unless the look is light. "darker" adds a class on top of dark that
// flattens the surfaces; "light" removes dark, so the light tokens apply (see `.light` in globals.css).

export type Theme = "darker" | "light";
export const THEME_KEY = "craton:theme";

/** The page background of each look, for the browser's own chrome (the address bar on a phone): `theme-color`. */
export const THEME_COLORS: Record<Theme, string> = { darker: "#0a0a0a", light: "#fafafa" };

/**
 * Runs in <head> before first paint: the look, and once the document has its <meta name="theme-color"> the browser bar
 * is told the matching colour (the default in the page is the "darker" one).
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}"),h=document.documentElement;if(t==="light"){h.classList.remove("dark");h.classList.add("light");h.style.colorScheme="light";document.addEventListener("DOMContentLoaded",function(){var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content","${THEME_COLORS.light}");var s=document.querySelector('meta[name="color-scheme"]');if(s)s.setAttribute("content","light")})}else{h.classList.add("darker")}}catch(e){document.documentElement.classList.add("darker")}`;

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "light" ? "light" : "darker";
  } catch {
    return "darker";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme !== "light");
  root.classList.toggle("light", theme === "light");
  root.classList.toggle("darker", theme === "darker");
  root.style.colorScheme = theme === "light" ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", theme === "light" ? "light" : "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}
