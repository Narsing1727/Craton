# Vendored components

Components copied in from 13 open-source registries with the shadcn CLI. They're our code now:
edit them freely. All of them were retinted to Craton's tokens, so they inherit the theme (the 90/10
radius system from `DESIGN.md`: square unless they render one of our rounded slots, dark surfaces, DM Sans / Space Mono, the chart blues). See them together at
`/dev/components` (development only).

## Wired into the product

30 integrations, each chosen because it uses data the page already has, matches an existing
interaction, and doesn't delay access to anything a user came to the page for. None change a
token, a radius, a font, or add motion beyond what was already on the page — see "Rules that keep
the theme intact" below.

| Page | Component | Why |
| --- | --- | --- |
| Blob page, "Swipe to compare" view | Dice UI `compare-slider` | A third preview mode alongside "This version" and "Change since …": drag to compare the raw render of the previous version against the current one. |
| Blob page, preview switching | Motion Primitives `transition-panel` | Cross-fades between single/diff/swipe preview modes instead of an instant content swap. |
| Repo card, repo list | Dice UI `badge-overflow` | Tag rows collapse to "+N" instead of wrapping or overflowing when a repo has many data-type tags. |
| Releases page | Dice UI `timeline` | Replaced a hand-rolled absolute-positioned `<ol>` with the same visual result, properly structured. |
| Settings → Plan and usage | Dice UI `circular-progress` | Storage-used ring, replacing a linear bar; same value, clearer at a glance next to the byte counts. |
| Settings → Plan and usage | Dice UI `stat` + Magic UI `number-ticker` | A real, computed dedup-savings stat (sum of logical vs. stored bytes across the account's repos), counting up on load. |
| CLI dialog (push/pull instructions) | Dice UI `responsive-dialog` | Centered dialog on desktop, bottom drawer on mobile — same content, better fit for the viewport. |
| Commit page, "committed … ago" | Dice UI `relative-time-card` | Hover reveals the exact time in UTC and IST, not just the relative string. |
| Commit page, copy Merkle root | Animate UI `copy-button` | Same copy action, with a check-mark confirmation instead of a silent copy. |
| About page, value props | ReUI `icon-tile` | Consistent icon framing instead of bare Lucide icons. |
| About page, "works today / not yet" | coss ui `frame` | Two-panel comparison layout built for exactly this. |
| CLI page, reasons list | ReUI `icon-tile` | Same icon framing as the about page, for consistency. |
| Pull request header | Kibo UI `avatar-stack` | Reviewers shown as an overlapping stack instead of a flat list. |
| Status page | Kibo UI `pill` + `pill-indicator` | Replaced a custom `StatusBadge` with a pulsing indicator when a component is operational. |
| Docs page | Magic UI `scroll-progress` | A thin progress bar for a genuinely long reference page. |
| Docs page, first-repo walkthrough | Magic UI `file-tree` | A real, static illustration of the sample project's actual folder structure. |
| Dashboard, pushes stat | Motion Primitives `sliding-number` | The raw push count animates on change instead of jumping. |
| Dashboard, checks pass rate | coss ui `meter` | A real meter bar under the checks-passing text, bound to the same percentage. |
| Landing page, entry-point cards | Motion Primitives `in-view` | A brief, one-time fade-in as each card scrolls into view. |
| Repo header, tab badges | SmoothUI `notification-badge` | Replaced a plain inline count badge; only renders when the count is non-zero. |
| Commits list, SHA hover | coss ui `preview-card` | Hovering a commit SHA shows the full message, author and Merkle status without navigating away. |
| Issue page, title | Dice UI `editable` | Double-click to rename, wired to the real `PATCH /issues/:n` route with optimistic update and rollback on failure. |
| API reference, 409 example | Kibo UI `code-block` | Real Shiki syntax highlighting and a copy button, replacing a plain `<pre>`. |
| Settings → tokens, scopes | coss ui `fieldset` | Semantic `<fieldset>`/`<legend>` instead of a generic `<div>`. |
| Settings → tokens, new-token form | coss ui `form` | Base UI form primitive; native `onSubmit` still works unchanged. |
| New repository, create/import pending state | Kokonut UI `loader` | Shown only while `pending` is true, with copy specific to create vs. import — it never adds wait time of its own. |
| `/dev/components` gallery | SmoothUI `breakpoint-indicator` | A dev-only fixture on an already dev-only page. |

**Tried and reverted:** Magic UI's `terminal` + `TypingAnimation` on `/cli`'s "push a project"
walkthrough. It looked good but made people wait several seconds, one command at a time, to see
commands they came to the page to copy — the opposite of this product's "no fancy animations,
Linear-style" rule, and of its own stated commands ("real commands, copy any of them"). Reverted
to the plain `CommandLine` list. The component is still vendored at `ui/terminal.tsx` for a
context where that trade-off makes sense (a marketing page, not a reference page).

**Skipped, with reasons:** Watermelon's `licence-key` (a full-page activation screen, not a
display component — no props to embed it); Kokonut's `team-selector` (a numeric size picker, not
an org switcher); SmoothUI's `user-account-avatar` (ships hardcoded fake order data); Kibo's
`tags` (a searchable popover is worse than the existing 4 always-visible label buttons for a
4-option picker); an inline-editable repo description on the repo header (the PATCH route needs
`admin` on that specific repo, and nothing in `RepoContext` currently tells the header whether the
viewer has it — showing an edit affordance to every signed-in visitor would be misleading; the
existing Settings → General form, which the user already explicitly navigates to, is the right
place for this).

The rest are building blocks for `../ROADMAP.md` and `../GLOBAL_ROADMAP.md`, not wired in yet.

## Where they live

| Library | Path | What we took |
| --- | --- | --- |
| [shadcn/ui](https://ui.shadcn.com) (base-nova) | `ui/` | calendar, context-menu, drawer, input-otp, menubar, navigation-menu, resizable, slider, aspect-ratio |
| [coss ui](https://coss.com/ui) (Cal.com, Base UI) | `ui/`, `coss/` | autocomplete, combobox, number-field, meter, toolbar, frame, group, preview-card, fieldset, checkbox-group, otp-field, form; its own `input` and `scroll-area` in `coss/` |
| [Kibo UI](https://www.kibo-ui.com) | `kibo-ui/` | code-block, snippet, dropzone, tree, status, relative-time, pill, avatar-stack, banner, tags, choicebox, ticker, table |
| [Dice UI](https://diceui.com) | `ui/` | compare-slider, timeline, stepper, editable, key-value, action-bar, selection-toolbar, stat, scroll-spy, badge-overflow, relative-time-card, responsive-dialog, tour, sortable, circular-progress, file-upload |
| [ReUI](https://reui.io) | `reui/` | filters (Linear-style), data-grid (+ table, virtual, pagination, column header and visibility), cascader, tree, kanban, date-selector, icon-tile; copy and file-upload hooks |
| [tablecn](https://github.com/sadmann7/tablecn) | `data-table/` | server-side data table: virtual rows, pinning, resizing, reordering, inline editing, selection bar |
| [Magic UI](https://magicui.design) | `ui/` | terminal, file-tree, code-comparison, grid-pattern, dot-pattern, number-ticker, animated-list, blur-fade, scroll-progress |
| [Animate UI](https://animate-ui.com) | `animate-ui/` | copy button, tabs with sliding highlight, code-tabs, avatar-group |
| [Cult UI](https://cult-ui.com) | `ui/` | mock-browser-window, file-icons, side-panel, sortable-list, popover-form, floating-panel, expandable, terminal-animation, texture-overlay |
| [Kokonut UI](https://kokonutui.com) | `kokonutui/` | action-search-bar, team-selector, profile-dropdown, toolbar, smooth-drawer, loader |
| [SmoothUI](https://smoothui.dev) | `smoothui/` | scrubber, number-flow, skeleton-loader, searchable-dropdown, notification-badge, pinned-list, rich-popover, user-account-avatar, breakpoint-indicator |
| [Watermelon UI](https://ui.watermelon.sh) | `watermelon/` | quick-switcher, copy-confirm, onboarding-checklist, deployment-card, credit-usage-card, filter-disclosure, inline-edit, inline-table-control, labeled-progress-indicator, licence-key, quick-feedback, dialog-stack, integration-card, command-search |
| [Motion Primitives](https://motion-primitives.com) | `ui/` | image-comparison, text-shimmer, animated-background, sliding-number, transition-panel, disclosure, in-view |

Our own 41 themed primitives in `ui/` (button, input, select, dialog…) are unchanged.

## Rules that keep the theme intact

- **Our primitives win.** Registries ship their own button, input, select…; the install script
  restores ours afterwards, so vendored components render with Craton's.
- **A library that needs its own primitive gets it under its own name**, imported only by that
  library: `ui/base-select.tsx` (the Base UI select API, for tablecn and ReUI; our `ui/select.tsx`
  is a custom string-only select), `coss/input.tsx` and `coss/scroll-area.tsx` (coss's sizes and
  scroll props).
- **No new hues.** Registry colour tokens are mapped onto our palette in `app/globals.css`:
  `success` = chart-1 (how "passed" already looks), `info` = chart-2, `warning` = chart-3, plus
  `destructive`. SmoothUI's pink `brand`, amber and green are remapped the same way. Hard-coded
  colours in vendored files (`bg-emerald-500/20`, `dark:bg-[#171717]`) were rewritten to these
  tokens by `scripts/vendor/retint.py`; window "traffic lights" are neutral grey.

## Adding another component

```sh
bash scripts/vendor/add.sh @<registry>/<item>      # e.g. @kibo-ui/gantt
python scripts/vendor/retint.py <files…>           # map its colours onto our tokens
```

`add.sh` runs `shadcn add` with npm (bun isn't installed here): it sets `bun.lock` aside, installs,
puts it back, and restores any of our files a registry overwrote. Then check `git diff
app/globals.css` (keep additions, never changed values) and run `tsc --noEmit`.

## Known adaptations

- Kibo's table is built on TanStack Table v8; it imports `@tanstack/react-table-v8` (an npm
  alias) so it can sit beside v9, which tablecn and ReUI use.
- The CLI rewrites Radix `asChild` into Base UI `render` for our style, which broke SmoothUI's
  popovers and Animate UI's avatar group (they use Radix and their own primitives); those three
  files are the registries' original source.
- Animate UI's Base UI variants need the pre-1.0 `@base-ui-components/react` beta, which would
  duplicate our Base UI 1.5, so only its motion-only components are here.
- Cult UI's mock-browser-window names a dependency the CLI can't resolve; it was copied in by hand.
- `react-is` is a direct dependency: npm's `legacy-peer-deps` would otherwise prune it (recharts
  needs it).
- `bun.lock` predates these packages. Run `bun install` once bun is available to bring it up to
  date with `package.json`.
