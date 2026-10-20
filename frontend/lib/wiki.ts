// Wiki pages (none yet). Bodies use a tiny markdown subset:
// blank-line separated blocks, "## " headings, "- " lists, and "[map]" for a terrain figure.

export type WikiPage = { slug: string; title: string; author: string; updated: string; body: string };

export const wikiPages: WikiPage[] = [];

