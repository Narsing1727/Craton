// Snippets for embedding a commit-pinned preview in another document. Pure, so it can be tested alone.

export function embedSnippets(origin: string, owner: string, repo: string, commit: string, path: string, alt: string) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const image = `${origin}/${owner}/${repo}/render/${encoded}?${new URLSearchParams({ ref: commit, size: "768" })}`;
  const page = `${origin}/${owner}/${repo}/blob/${encoded}?ref=${commit}`;
  const safeAlt = alt.replace(/[\[\]"<>]/g, "");
  return {
    image,
    page,
    markdown: `[![${safeAlt}](${image})](${page})`,
    html: `<a href="${page}"><img src="${image}" alt="${safeAlt}" width="768"></a>`,
  };
}
