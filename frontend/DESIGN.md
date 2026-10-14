# Craton design system

How Craton's interface is built. The goal is the feel of Linear and the YC-era SaaS
tools engineers already trust (Vercel, Resend, Raycast, Supabase): dense, quiet,
keyboard-first, fast. Premium comes from craft in the details, not from decoration.

Distilled from the design skills installed in `~/.claude/skills`; the skill each rule comes
from is in brackets. Where two sources disagree, this file records the decision.

## 1. Fixed foundations (never change)

The theme in `app/globals.css` is frozen. New work adds components on top of it.

| Token | Value |
| --- | --- |
| Mode | Dark first: `dark` class is hard-coded on `<html>` |
| Surfaces | `background`, `card`, `popover` (dark: oklch 0.2138); `muted` (0.2686) |
| Text | `foreground` (0.9851); `muted-foreground` (0.7090) for secondary text |
| Lines | `border` (0.2768); `input` (0.3250); `ring` (0.5555) |
| Accent | `accent` (blue, oklch 0.623 0.214 259.8), `sidebar-primary` (blue) |
| Data | `chart-1` to `chart-5`: one blue ramp, hue 250–269 |
| Danger | `destructive` |
| Radius | 90/10: structure is `0` (layout, panels, cards, tables, previews, avatars, tabs). Controls `4px` (button, input, select, badge, kbd, toggle, tooltip), floating layers `6px` (menus, popovers, dialogs, toasts), items inside a float `2px` (concentric: 6 − 4px padding). Never above 8px. Opted in by `data-slot` in `app/globals.css` over a `0 !important` reset |
| Fonts | DM Sans (UI), Space Mono (code, SHAs, paths, sizes), Playfair Display (rare display) |
| Components | shadcn `base-nova` on Base UI, lucide icons, sonner, recharts, cmdk |

Rules: use semantic tokens only (`bg-muted`, `text-muted-foreground`); no raw palette
colors, no new tokens, no gradients, glows, glass or blur surfaces, no `rounded-*` (radius comes
only from the `data-slot` rules, so a new rounded thing means adding its slot there)
[shadcn, baseline-ui]. One accent per view [baseline-ui].

## 2. Principles

1. **Speed is the feature.** Every interaction responds on the same frame. No artificial
   delays, no fake loading timers, no third-party calls at runtime [apple-design §1,
   performance, vercel-react-best-practices].
2. **Keyboard first.** Everything reachable with Tab; ⌘K opens the command palette,
   `/` focuses search, `?` lists shortcuts, Esc closes any overlay. Keyboard-driven
   actions never animate [emil-design-eng, web-design-guidelines].
3. **Simplicity, not minimalism.** Show the common path first and advanced options one
   level deeper. Adding context (sizes, dates, counts) can make a screen simpler
   [apple-design §16].
4. **Familiar.** Git and GitHub vocabulary and placement. Things that look the same
   behave the same and live in the same place [apple-design: Familiarity].
5. **Honest feedback.** Every action answers with status, completion, warning or error,
   next to where it happened [apple-design §16, baseline-ui].

## 3. Motion

Motion is off by default [baseline-ui: "never add animation unless requested"].

- Overlays (menus, selects, popovers, dialogs, tooltips, sheets) open and close
  instantly, like Raycast [emil-design-eng: things used 100+ times a day never animate].
  `globals.css` removes their entrance and exit animations in one add-on rule.
- Allowed: color/background changes on hover and press, `transition-colors`, at most
  150 ms; the 1 px press nudge on buttons; spinners and skeleton pulse, because they
  report status [emil-design-eng, apple-design §1].
- Never: `transition-all`, entrance choreography, staggers, springs, page transitions,
  scroll-linked effects, animating layout properties [web-design-guidelines,
  fixing-motion-performance].
- Hover styles apply only on devices that can hover (Tailwind v4's `hover:` already
  does this) [mobile-native].

## 4. Typography

- Page title `text-xl font-semibold` (hero: `text-3xl`/`text-4xl`, `leading-tight`);
  section title `text-base font-semibold`; body `text-sm`; meta `text-xs text-muted-foreground`.
- Hierarchy comes from weight, size and color together, not size alone [apple-design §15].
- Headings `text-balance`, paragraphs `text-pretty` [baseline-ui, web-design-guidelines].
- Numbers that line up (sizes, counts, prices, times) use `tabular-nums`; SHAs, paths,
  CRS codes, file sizes and commands use `font-mono` [baseline-ui].
- Don't change `tracking-*` on body text [baseline-ui]. Tight leading only on large
  display text [apple-design §15].
- Copy: sentence case (Craton's existing convention; this overrides the Title Case rule
  in web-design-guidelines), active voice, second person, numerals for counts, specific
  button labels ("Revoke token", not "OK"), `…` not `...`, loading text ends in `…`
  ("Saving…"), errors say how to fix it [web-design-guidelines, writing-guidelines].

## 5. Layout and density

- Page gutter `px-4 sm:px-6 lg:px-8 xl:px-10`; content column plus optional 340–380 px
  right sidebar on wide screens.
- Every page starts with a header block: title, one-line description, primary action
  on the right. Every screen answers "where am I, where can I go, how do I get out"
  (breadcrumb or Back link) [apple-design: Wayfinding].
- Lists and tables beat card grids for data. Rows 36–44 px, hairline `border-border`
  dividers, the whole row clickable when it leads somewhere [Linear convention].
- Use `flex`/`grid` with `gap-*`, never `space-x/y-*`; `size-*` for squares; flex
  children that truncate get `min-w-0` [shadcn, web-design-guidelines].
- `min-h-dvh`, never `h-screen` [baseline-ui, mobile-native].
- Group related controls and put each control next to what it affects
  [apple-design: Grouping & mapping].

## 6. Components (shadcn `base-nova` first)

Use the existing component before writing markup [shadcn, pick-ui-library].

| Need | Use |
| --- | --- |
| Action | `Button` with a variant; icons get `data-icon="inline-start"` |
| Navigation that looks like a button | `Button href="…"` (renders a Next `Link`) |
| Menus | `DropdownMenu` (Base UI). Never hand-built `div` menus |
| Command palette | `CommandDialog` from `components/ui/command` (cmdk) |
| Keyboard hint | `Kbd` |
| Confirm destructive action | `AlertDialog`; never destroy on first click [baseline-ui] |
| Forms | `FieldGroup` + `Field`; validation with `data-invalid` + `aria-invalid` |
| 2–7 options | `ToggleGroup` |
| Status | `Badge` variants; never colored `span`s |
| Callout | `Alert` |
| Empty state | `Empty` with exactly one next action [baseline-ui] |
| Loading | `Skeleton` in the page's real shape; `Spinner` inside buttons |
| Toast | `toast()` from sonner for completion and undo, never the only record of an error [ask-sonner, fixing-accessibility] |
| Charts | `Chart` (recharts), blue ramp `chart-1…5`, loaded with `next/dynamic` |

Build components by composition (compound parts, children) instead of piles of
boolean props [vercel-composition-patterns].

## 7. Interaction and feedback

- Press feedback is instant (`:active`), never only on release [apple-design §1].
- Buttons submitting work show a `Spinner` and "Saving…", then a toast; the button
  stays enabled until the request starts [web-design-guidelines].
- Validate inline next to the field; focus the first error on submit.
- Destructive actions: `AlertDialog` naming the exact object ("Revoke ci-pipeline?").
  Reversible actions: act immediately and offer Undo in the toast [apple-design: Agency].
- Copy buttons change to a check for 2 s and announce "Copied".
- Links are real `<a>`/`Link` so Cmd-click and middle-click work; buttons are `<button>`
  [web-design-guidelines]. Filters and tabs that matter go in the URL.
- Warn before leaving a form with unsaved changes.

## 8. Accessibility (WCAG 2.2 AA)

- Every control has an accessible name; icon-only buttons get `aria-label`; decorative
  icons `aria-hidden` [fixing-accessibility, accessibility].
- Visible focus with `focus-visible:ring-*`; never remove an outline without a
  replacement; the sticky header must not cover the focused element.
- Dialogs trap focus, restore it to the trigger, and always have a title
  (`sr-only` if hidden) [shadcn, fixing-accessibility].
- Headings don't skip levels; one `h1` per page; a skip link to `#main`.
- Contrast: 4.5:1 for text, 3:1 for UI; states never rely on color alone.
- Targets at least 24×24 px [accessibility, WCAG 2.5.8].
- `aria-live="polite"` for async results; `aria-busy` on loading regions.

## 9. Performance budgets

| Resource | Budget | Source |
| --- | --- | --- |
| JS per route (compressed) | < 300 KB | performance |
| LCP / INP / CLS | ≤ 2.5 s / ≤ 200 ms / ≤ 0.1 | core-web-vitals |
| Third-party requests at runtime | 0 | performance |

- No request waterfalls; independent work runs in parallel [vercel-react-best-practices].
- Heavy, below-the-fold or rarely used parts (charts, editors) load with `next/dynamic`.
- Don't disable `Link` prefetch; prefetching makes tab switches instant.
- No `useEffect` for anything derivable during render; no state mirrored from props
  [baseline-ui, vercel-react-best-practices].
- Lists over ~50 rows use `content-visibility: auto` or virtualization.
- Measure dev-mode speed only as a hint: `next dev` compiles each route on first visit.
  Judge speed with `next build && next start`.

## 10. Metadata

- Every page sets a title through the root template `%s · Craton` and a plain-text
  description; no duplicate tags [fixing-metadata, seo].
- `<meta name="theme-color">` matches the dark background; `color-scheme: dark` on `<html>`
  so scrollbars and native inputs match [web-design-guidelines].
- `lang="en"` on `<html>`; brand names and code tokens get `translate="no"` where they
  appear in prose.

## 11. Checking work

- Run the Playwright crawler (every route: status, console errors, dead buttons) after
  UI changes [webapp-testing, next-dev-loop].
- Audit a surface against this file before redesigning it [improve-ui, web-quality-audit].
- `npx tsc --noEmit` must pass (the build ignores type errors, so check by hand).
