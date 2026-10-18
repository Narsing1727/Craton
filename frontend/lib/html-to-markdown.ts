// A small HTML → Markdown converter for the "Markdown version" of the site's reading pages (/docs.md and the like).
//
// The pages are rendered by React, so the HTML is well formed; this does not try to cope with arbitrary markup. It
// keeps what a reader or a language model needs (headings, paragraphs, lists, tables, code, links) and drops what is
// only for a browser (scripts, styles, icons, buttons, forms, navigation). Generating the Markdown from the page that
// people read means the two can never disagree.

type El = { tag: string; attrs: Record<string, string>; children: Node[] };
type Node = El | string;

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "source", "wbr", "col"]);
/** Elements dropped together with everything inside them. */
const SKIP = new Set(["script", "style", "svg", "template", "noscript", "button", "form", "nav", "aside", "select", "textarea", "canvas", "iframe", "head"]);
const BLOCK = new Set(["p", "div", "section", "article", "header", "footer", "main", "figure", "figcaption", "details", "summary", "dl", "dt", "dd", "address", "fieldset"]);

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", mdash: "—", ndash: "–", hellip: "…", middot: "·", times: "×", rarr: "→", larr: "←", copy: "©" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code = name[1].toLowerCase() === "x" ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED[name.toLowerCase()] ?? whole;
  });
}

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of source.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return attrs;
}

const isLetter = (c: string) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z");

/**
 * A hand-written scanner rather than one big regular expression: a Tailwind class attribute can run to several
 * kilobytes, and quoted values may contain ">" and "&". It reads a start tag by walking to the ">" outside quotes.
 */
function parse(html: string): El {
  const root: El = { tag: "#root", attrs: {}, children: [] };
  const stack: El[] = [root];
  const top = () => stack[stack.length - 1];
  const lower = html.toLowerCase();
  let i = 0;
  while (i < html.length) {
    if (html[i] !== "<") {
      const next = html.indexOf("<", i);
      const end = next === -1 ? html.length : next;
      top().children.push(html.slice(i, end));
      i = end;
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const end = html.indexOf("-->", i + 4);
      i = end === -1 ? html.length : end + 3;
    } else if (html[i + 1] === "!" || html[i + 1] === "?") {
      const end = html.indexOf(">", i);
      i = end === -1 ? html.length : end + 1;
    } else if (html[i + 1] === "/" && isLetter(html[i + 2] ?? "")) {
      const end = html.indexOf(">", i);
      const tag = html.slice(i + 2, end === -1 ? html.length : end).trim().toLowerCase();
      // Close the nearest open element of that name; a stray closing tag is ignored.
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].tag === tag) {
          stack.length = k;
          break;
        }
      }
      i = end === -1 ? html.length : end + 1;
    } else if (isLetter(html[i + 1] ?? "")) {
      let j = i + 1;
      while (j < html.length && /[A-Za-z0-9-]/.test(html[j])) j++;
      const tag = lower.slice(i + 1, j);
      const attrStart = j;
      let quote = "";
      for (; j < html.length; j++) {
        const c = html[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
      }
      const raw = html.slice(attrStart, j);
      const selfClosing = raw.endsWith("/");
      const el: El = { tag, attrs: parseAttrs(selfClosing ? raw.slice(0, -1) : raw), children: [] };
      top().children.push(el);
      i = j + 1;
      if (!VOID.has(tag) && !selfClosing) {
        // A raw-text element's content is not markup.
        if (tag === "script" || tag === "style") {
          const end = lower.indexOf(`</${tag}`, i);
          const close = end === -1 ? -1 : html.indexOf(">", end);
          i = close === -1 ? html.length : close + 1;
        } else stack.push(el);
      }
    } else {
      // A "<" that starts nothing: plain text.
      top().children.push("<");
      i++;
    }
  }
  return root;
}

const find = (node: El, tag: string): El | null => {
  if (node.tag === tag) return node;
  for (const c of node.children) {
    if (typeof c !== "string") {
      const hit = find(c, tag);
      if (hit) return hit;
    }
  }
  return null;
};

const textOf = (node: Node): string => (typeof node === "string" ? decodeEntities(node) : node.tag === "br" ? "\n" : SKIP.has(node.tag) ? "" : node.children.map(textOf).join(""));

type Ctx = { base: string };

function href(raw: string | undefined, ctx: Ctx): string | null {
  if (!raw || raw.startsWith("#") || /^(javascript|data|mailto:?$)/i.test(raw)) return null;
  try {
    return new URL(raw, ctx.base).toString();
  } catch {
    return null;
  }
}

function inline(nodes: Node[], ctx: Ctx): string {
  let out = "";
  let afterElement = false;
  for (const n of nodes) {
    const piece = render(n, ctx);
    if (!piece) continue;
    const isElement = typeof n !== "string";
    // Two elements side by side with no space between them (a label and its value) would run together in plain text.
    if (isElement && afterElement && /[\w`)\].!?:;]$/.test(out) && /^[\w`[(]/.test(piece)) out += " ";
    out += piece;
    afterElement = isElement;
  }
  return out;
}

/** A block's text, with the blank lines tidied. */
const tidy = (s: string) => s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");

function renderList(el: El, ctx: Ctx, ordered: boolean): string {
  let n = 0;
  const items = el.children
    .filter((c): c is El => typeof c !== "string" && c.tag === "li")
    .map((li) => {
      n++;
      // A tight list: what is inside an item (a nested list, a second paragraph) follows on the next line.
      const body = tidy(inline(li.children, ctx)).trim().replace(/\n+/g, "\n").replace(/\n/g, "\n  ");
      return `${ordered ? `${n}.` : "-"} ${body}`;
    });
  return `\n\n${items.join("\n")}\n\n`;
}

function renderTable(el: El, ctx: Ctx): string {
  const rows: { cells: string[]; head: boolean }[] = [];
  const collect = (node: El) => {
    for (const c of node.children) {
      if (typeof c === "string") continue;
      if (c.tag === "tr") {
        const cells = c.children.filter((x): x is El => typeof x !== "string" && (x.tag === "td" || x.tag === "th"));
        rows.push({ cells: cells.map((x) => inline(x.children, ctx).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim()), head: cells.some((x) => x.tag === "th") });
      } else if (c.tag === "thead" || c.tag === "tbody" || c.tag === "tfoot") collect(c);
    }
  };
  collect(el);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.cells.length));
  const line = (cells: string[]) => `| ${Array.from({ length: width }, (_, i) => cells[i] ?? "").join(" | ")} |`;
  const [first, ...rest] = rows;
  return `\n\n${[line(first.cells), line(Array(width).fill("---")), ...rest.map((r) => line(r.cells))].join("\n")}\n\n`;
}

function render(node: Node, ctx: Ctx): string {
  if (typeof node === "string") return decodeEntities(node).replace(/\s+/g, " ");
  const { tag, attrs, children } = node;
  if (SKIP.has(tag) || "hidden" in attrs || attrs["aria-hidden"] === "true") return "";
  switch (tag) {
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return `\n\n${"#".repeat(Number(tag[1]))} ${inline(children, ctx).replace(/\s+/g, " ").trim()}\n\n`;
    case "p":
      return `\n\n${tidy(inline(children, ctx)).trim()}\n\n`;
    case "br":
      return "\n";
    case "hr":
      return "\n\n---\n\n";
    case "strong":
    case "b": {
      const t = inline(children, ctx).trim();
      return t ? `**${t}**` : "";
    }
    case "em":
    case "i": {
      const t = inline(children, ctx).trim();
      return t ? `*${t}*` : "";
    }
    case "code": {
      const t = textOf(node).replace(/\s+/g, " ").trim();
      return t ? `\`${t.includes("`") ? t.replace(/`/g, "'") : t}\`` : "";
    }
    case "pre": {
      const t = textOf(node).replace(/\n+$/, "");
      return t.trim() ? `\n\n\`\`\`\n${t}\n\`\`\`\n\n` : "";
    }
    case "a": {
      const text = inline(children, ctx).replace(/\s+/g, " ").trim();
      const url = href(attrs.href, ctx);
      return !text ? "" : url ? `[${text}](${url})` : text;
    }
    case "img":
      return attrs.alt ? `![${attrs.alt}]` : "";
    case "ul":
      return renderList(node, ctx, false);
    case "ol":
      return renderList(node, ctx, true);
    case "li":
      return `\n- ${inline(children, ctx).trim()}\n`;
    case "table":
      return renderTable(node, ctx);
    case "blockquote":
      return `\n\n${tidy(inline(children, ctx)).trim().replace(/^/gm, "> ")}\n\n`;
    case "summary":
      return `\n\n**${inline(children, ctx).replace(/\s+/g, " ").trim()}**\n\n`;
    case "dt":
      return `\n\n**${inline(children, ctx).replace(/\s+/g, " ").trim()}**\n`;
    case "div": {
      // A command shown on its own line (a prompt, the command, a copy button) is a code block.
      const parts = children.filter((c) => (typeof c === "string" ? c.trim() !== "" : !(SKIP.has(c.tag) || "hidden" in c.attrs || c.attrs["aria-hidden"] === "true")));
      const only = parts.length === 1 ? parts[0] : null;
      if (only && typeof only !== "string" && only.tag === "code") {
        const t = textOf(only).trim();
        return t ? `\n\n\`\`\`\n${t}\n\`\`\`\n\n` : "";
      }
      return `\n\n${inline(children, ctx)}\n\n`;
    }
    case "label":
    case "span":
    default:
      return BLOCK.has(tag) ? `\n\n${inline(children, ctx)}\n\n` : inline(children, ctx);
  }
}

/** Every element with this tag, outermost first. */
function findAll(node: El, tag: string, out: El[] = []): El[] {
  if (node.tag === tag) out.push(node);
  for (const c of node.children) if (typeof c !== "string") findAll(c, tag, out);
  return out;
}

/**
 * A page that streams (Next.js with a loading state) arrives as placeholders first and its real content later, in
 * hidden elements with ids like "S:0" that a script swaps in: "B:n" marks a whole boundary's fallback, "P:n" a
 * smaller piece of it. A browser shows the swapped result, so this does the same swap: every <template id="P:x"> is
 * replaced by what "S:x" holds, and the main content is the <main> inside a hidden element nothing else refers to.
 */
function streamedMain(root: El): El | null {
  const segments = new Map<string, El>();
  for (const d of findAll(root, "div")) {
    const id = d.attrs.id ?? "";
    if ("hidden" in d.attrs && id.startsWith("S:")) segments.set(id.slice(2), d);
  }
  if (!segments.size) return null;
  const used = new Set<string>();
  const expand = (el: El, trail: Set<string>) => {
    el.children = el.children.flatMap((c): Node[] => {
      if (typeof c === "string") return [c];
      const id = c.tag === "template" ? (c.attrs.id ?? "") : "";
      const seg = id.startsWith("P:") ? segments.get(id.slice(2)) : undefined;
      if (seg && !trail.has(id)) {
        used.add(id.slice(2));
        const next = new Set(trail).add(id);
        expand(seg, next);
        return seg.children;
      }
      expand(c, trail);
      return [c];
    });
  };
  expand(root, new Set());
  const mains = [...segments].filter(([id]) => !used.has(id)).flatMap(([, d]) => findAll(d, "main"));
  if (!mains.length) return null;
  return mains.reduce((best, m) => (textOf(m).length > textOf(best).length ? m : best));
}

/** The page's <main> as Markdown. `base` makes every link absolute. */
export function htmlToMarkdown(html: string, base: string): string {
  const root = parse(html);
  const main = streamedMain(root) ?? find(root, "main") ?? find(root, "body") ?? root;
  // A single space left at the start of a line is whitespace between tags; deeper indentation is a nested list's.
  // Commands that follow one another share one block.
  const text = tidy(render(main, { base }).replace(/\n[ ](?=\S)/g, "\n")).replace(/\n```\n\n```\n/g, "\n").trim();
  return `${text}\n`;
}
