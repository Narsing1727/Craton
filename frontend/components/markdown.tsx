// A README or notes file as formatted text. Headings, paragraphs, lists, tables, quotes, code, rules, bold, italic, code spans and links; never raw
// HTML, and images are shown as their description (a page that loads pictures from anywhere would tell that site who read it).

import * as React from "react";
import { parseMarkdown } from "@/lib/markdown-blocks";

const SAFE_LINK = /^(https?:\/\/|mailto:|#|\/|\.\.?\/|[A-Za-z0-9_.-]+(\/|$))/i;

function Inline({ text }: { text: string }) {
  const out: React.ReactNode[] = [];
  // Order matters: code spans first (nothing inside them is formatted), then images, links, bold, italic, bare addresses.
  const pattern = /`([^`]+)`|!\[([^\]]*)\]\(([^)\s]+)[^)]*\)|\[([^\]]+)\]\(([^)\s]+)[^)]*\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])|(https?:\/\/[^\s<)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = pattern.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = n++;
    if (m[1] !== undefined) out.push(<code key={key} className="bg-muted/60 px-1 py-0.5 font-mono text-[0.9em]">{m[1]}</code>);
    else if (m[3] !== undefined) out.push(<span key={key} className="text-muted-foreground">[image{m[2] ? `: ${m[2]}` : ""}]</span>);
    else if (m[5] !== undefined) {
      const href = m[5];
      out.push(
        SAFE_LINK.test(href) ? (
          <a key={key} href={href} className="text-primary underline underline-offset-2 hover:text-foreground" {...(/^https?:/i.test(href) ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
            <Inline text={m[4]} />
          </a>
        ) : (
          m[4]
        ),
      );
    } else if (m[6] !== undefined || m[7] !== undefined) out.push(<strong key={key} className="font-semibold text-foreground"><Inline text={(m[6] ?? m[7])!} /></strong>);
    else if (m[8] !== undefined || m[9] !== undefined) out.push(<em key={key}><Inline text={(m[8] ?? m[9])!} /></em>);
    else if (m[10] !== undefined) out.push(<a key={key} href={m[10]} target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-2 hover:text-foreground">{m[10]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

const HEADING = ["", "text-2xl", "text-xl", "text-lg", "text-base", "text-sm", "text-sm"];

export function Markdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="flex max-w-3xl flex-col gap-3 text-sm leading-relaxed text-foreground/90">
      {blocks.map((b, i) => {
        switch (b.t) {
          case "h":
            {
              // The page's own title is the h1, so a document's top heading is an h2.
              const Heading = `h${Math.min(6, b.level + 1)}` as "h2";
              return (
                <Heading key={i} className={`${HEADING[b.level]} mt-3 font-semibold text-foreground first:mt-0 ${b.level <= 2 ? "border-b border-border pb-1.5" : ""}`}>
                  <Inline text={b.text} />
                </Heading>
              );
            }
          case "p":
            return (
              <p key={i} className="text-pretty">
                <Inline text={b.text} />
              </p>
            );
          case "code":
            return (
              <pre key={i} tabIndex={0} className="overflow-x-auto border border-border bg-muted/30 p-3 font-mono text-xs leading-relaxed">
                {b.text}
              </pre>
            );
          case "quote":
            return (
              <blockquote key={i} className="border-l-2 border-border pl-4 text-muted-foreground">
                <Inline text={b.text} />
              </blockquote>
            );
          case "hr":
            return <hr key={i} className="border-border" />;
          case "list": {
            const Tag = b.ordered ? "ol" : "ul";
            return (
              <Tag key={i} className={`flex flex-col gap-1 pl-6 ${b.ordered ? "list-decimal" : "list-disc"}`}>
                {b.items.map((item, k) => (
                  <li key={k}>
                    <Inline text={item.replace(/^\[( |x|X)\]\s+/, (_, c) => (c === " " ? "☐ " : "☑ "))} />
                  </li>
                ))}
              </Tag>
            );
          }
          case "table":
            return (
              <div key={i} className="overflow-x-auto" tabIndex={0} role="region" aria-label="Table">
                <table className="w-full border border-border text-left text-xs">
                  <thead className="border-b border-border bg-muted/30">
                    <tr>
                      {b.head.map((c, k) => (
                        <th key={k} scope="col" className="px-3 py-2 font-medium" style={{ textAlign: b.align[k] }}>
                          <Inline text={c} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {b.rows.map((r, k) => (
                      <tr key={k}>
                        {r.map((c, j) => (
                          <td key={j} className="px-3 py-1.5" style={{ textAlign: b.align[j] }}>
                            <Inline text={c} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
        }
      })}
    </div>
  );
}
