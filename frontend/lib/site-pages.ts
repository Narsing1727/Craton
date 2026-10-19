// The public pages and how they are grouped: the footer, the sitemap and the "where next" links on the pages themselves read this one list.

export type SiteLink = { href: string; label: string; summary: string };
export type SiteGroup = { title: string; links: SiteLink[] };

export const SITE_GROUPS: SiteGroup[] = [
  {
    title: "Product",
    links: [
      { href: "/features", label: "Features", summary: "What Craton does, from storing a 20 GB DEM to reviewing a re-survey" },
      { href: "/formats", label: "Supported formats", summary: "What opens, what is checked and what is compared, for each kind of file" },
      { href: "/compare", label: "Compare", summary: "Craton next to Git LFS, DVC and a shared drive" },
      { href: "/pricing", label: "Pricing", summary: "Plans, storage and what each includes" },
      { href: "/changelog", label: "Changelog", summary: "What changed in each release" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "Documentation", summary: "Getting started, checks, branches, reviews, webhooks and limits" },
      { href: "/guides", label: "Guides", summary: "Short, step-by-step walk-throughs of real tasks" },
      { href: "/glossary", label: "Glossary", summary: "Plain meanings of the hydrology, GIS and storage words used here" },
      { href: "/cli", label: "Command line", summary: "Installing the craton command and every command it has" },
      { href: "/api-reference", label: "API", summary: "Every REST endpoint, the MCP server and the Python client" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About", summary: "What Craton is for and who it is for" },
      { href: "/security", label: "Security", summary: "How data, accounts and tokens are protected" },
      { href: "/help", label: "Help & support", summary: "Answers to common questions" },
      { href: "/contact", label: "Contact", summary: "Talk to a person" },
      { href: "/privacy", label: "Privacy", summary: "What is collected and why" },
      { href: "/terms", label: "Terms", summary: "The terms of using Craton" },
    ],
  },
];

/** Every public page that is not a repository, in the order a sitemap lists them. */
export const PUBLIC_PATHS = ["/", "/explore", "/trending", ...SITE_GROUPS.flatMap((g) => g.links.map((l) => l.href))];
