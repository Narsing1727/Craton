// A small status badge for README files and wikis: "checks | passing" for a repository's default branch.
// Plain SVG, no scripts, text escaped; only public repositories get one (the route enforces that).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Width of a string in the badge's 11 px sans face; an estimate that errs slightly wide. */
const textWidth = (s: string) => Math.ceil(s.length * 6.3) + 12;

export type BadgeTone = "good" | "bad" | "neutral";
const TONES: Record<BadgeTone, string> = { good: "#2f6fda", bad: "#c2554e", neutral: "#6b6b6b" };

export function renderBadge(label: string, value: string, tone: BadgeTone): string {
  const lw = textWidth(label), vw = textWidth(value), w = lw + vw;
  const l = esc(label), v = esc(value);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${l}: ${v}">
<title>${l}: ${v}</title>
<rect width="${lw}" height="20" fill="#1f1f1f"/>
<rect x="${lw}" width="${vw}" height="20" fill="${TONES[tone]}"/>
<g fill="#ffffff" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">
<text x="${lw / 2}" y="14">${l}</text>
<text x="${lw + vw / 2}" y="14">${v}</text>
</g>
</svg>
`;
}

export function checksBadge(status: "passed" | "failed" | null): string {
  if (status === "passed") return renderBadge("checks", "passing", "good");
  if (status === "failed") return renderBadge("checks", "failing", "bad");
  return renderBadge("checks", "none yet", "neutral");
}

/** The latest non-pre-release version, or "none yet". */
export function releaseBadge(tag: string | null): string {
  return tag ? renderBadge("release", tag.slice(0, 24), "good") : renderBadge("release", "none yet", "neutral");
}

/** What the repository holds: the unique stored size, in the units people read. */
export function sizeBadge(bytes: number): string {
  const v = bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : bytes >= 1024 ** 2 ? `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB` : bytes >= 1024 ? `${Math.round(bytes / 1024)} KB` : `${bytes} B`;
  return renderBadge("size", v, "neutral");
}

export function licenseBadge(id: string | null): string {
  return id ? renderBadge("license", id.slice(0, 24), "good") : renderBadge("license", "not stated", "neutral");
}

