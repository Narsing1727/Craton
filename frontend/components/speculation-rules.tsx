// Chromium's Speculation Rules API: the browser fully renders a page in the background on hover
// intent (200ms hover, or pointerdown), so clicking it feels instant — no network round trip on
// click. A progressive enhancement; browsers that don't support it just ignore the tag. The
// browser itself already skips this under Save-Data, low battery or memory pressure.
// https://developer.chrome.com/docs/web-platform/prerender-pages
//
// Same-origin only (no `relative_to: "document"` cross-origin opt-in), and excluded from anything
// that isn't a plain read: downloads, and the few places a GET has a side effect (signing out,
// confirming an email, resetting a password — all single-use, so prerendering one would burn it
// before the person clicks).
const RULES = {
  prerender: [
    {
      source: "document",
      eagerness: "moderate",
      where: {
        and: [
          { href_matches: "/*" },
          { not: { href_matches: "/settings/export" } },
          { not: { href_matches: "/*/raw/*" } },
          { not: { href_matches: "/verify-email*" } },
          { not: { href_matches: "/reset-password*" } },
          { not: { selector_matches: "[data-no-prerender]" } },
        ],
      },
    },
  ],
};

export function SpeculationRules() {
  return (
    // eslint-disable-next-line react/no-danger -- the one element type React has no prop API for
    <script type="speculationrules" dangerouslySetInnerHTML={{ __html: JSON.stringify(RULES) }} />
  );
}
