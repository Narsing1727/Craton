// The shape of a Markdown document: its blocks, found line by line. (Formatting inside a block is the component's.)

export type Block =
  | { t: "h"; level: number; text: string }
  | { t: "p"; text: string }
  | { t: "code"; text: string; lang: string }
  | { t: "quote"; text: string }
  | { t: "hr" }
  | { t: "list"; ordered: boolean; items: string[] }
  | { t: "table"; head: string[]; rows: string[][]; align: ("left" | "right" | "center")[] };

const cells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parseMarkdown(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s*(```|~~~)\s*([\w+-]*)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence[1])) body.push(lines[i++]);
      i++;
      blocks.push({ t: "code", text: body.join("\n"), lang: fence[2] });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      blocks.push({ t: "h", level: h[1].length, text: h[2] });
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ t: "hr" });
      i++;
      continue;
    }
    if (line.startsWith(">")) {
      const body: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) body.push(lines[i++].replace(/^>\s?/, ""));
      blocks.push({ t: "quote", text: body.join("\n") });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : "left") as "left" | "right" | "center");
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push({ t: "table", head, rows, align });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+/.exec(line);
    if (li) {
      const ordered = /\d/.test(li[1]);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ""));
        i++;
        // A wrapped line of the same item.
        while (i < lines.length && lines[i].trim() && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items[items.length - 1] += ` ${lines[i++].trim()}`;
      }
      blocks.push({ t: "list", ordered, items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|>|\s*(```|~~~))/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) body.push(lines[i++].trim());
    blocks.push({ t: "p", text: body.join(" ") });
  }
  return blocks;
}
