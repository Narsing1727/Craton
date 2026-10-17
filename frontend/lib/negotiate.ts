// Does this request's Accept header ask for Markdown rather than HTML? Used to serve a page's Markdown version at the
// page's own address, for tools that send `Accept: text/markdown`. A browser never does, so people are unaffected.

export function prefersMarkdown(accept: string | null | undefined): boolean {
  if (!accept) return false;
  const q = new Map<string, number>();
  for (const part of accept.split(",")) {
    const [type, ...params] = part.trim().toLowerCase().split(";");
    if (!type) continue;
    const weight = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    const value = weight ? Number(weight.slice(2)) : 1;
    q.set(type.trim(), Number.isFinite(value) ? value : 1);
  }
  const markdown = q.get("text/markdown") ?? 0;
  // Asked for explicitly, and at least as eagerly as HTML (listed alone, or with an equal or higher weight).
  return markdown > 0 && markdown >= (q.get("text/html") ?? 0);
}
