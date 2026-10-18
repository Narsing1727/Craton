import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, htmlToMarkdown } from "../lib/html-to-markdown.ts";

const BASE = "https://craton.example";

test("headings, paragraphs, emphasis and inline code", () => {
  const md = htmlToMarkdown("<main><h1>Docs</h1><p>Use <code>craton push</code> to <strong>upload</strong> and <em>verify</em>.</p><h2 id=x>Next</h2></main>", BASE);
  assert.equal(md, "# Docs\n\nUse `craton push` to **upload** and *verify*.\n\n## Next\n");
});

test("only the main content is kept: no scripts, styles, icons, buttons, forms or navigation", () => {
  const html = `<html><head><title>x</title><style>p{}</style></head><body><nav><a href="/a">Menu</a></nav><header>Site header</header>
    <main><script>alert(1)</script><svg><path d="M0"/></svg><p>Hello <button>Copy</button>world</p><form><input value="q"></form><aside>On this page</aside></main><footer>Footer</footer></body></html>`;
  assert.equal(htmlToMarkdown(html, BASE), "Hello world\n");
});

test("links become absolute, in-page and script links are dropped to their text", () => {
  const md = htmlToMarkdown(`<main><p><a href="/docs">Docs</a>, <a href="#top">top</a>, <a href="javascript:void(0)">js</a>, <a href="https://example.org/x?a=1&amp;b=2">out</a></p></main>`, BASE);
  assert.equal(md, "[Docs](https://craton.example/docs), top, js, [out](https://example.org/x?a=1&b=2)\n");
});

test("lists, nested lists and ordered lists", () => {
  const md = htmlToMarkdown("<main><ul><li>one</li><li>two<ul><li>inner</li></ul></li></ul><ol><li>a</li><li>b</li></ol></main>", BASE);
  assert.equal(md, "- one\n- two\n  - inner\n\n1. a\n2. b\n");
});

test("code blocks keep their lines and are fenced", () => {
  const md = htmlToMarkdown(`<main><p>Run:</p><pre class="x"><code>craton init a\ncraton push\n</code></pre></main>`, BASE);
  assert.equal(md, "Run:\n\n```\ncraton init a\ncraton push\n```\n");
});

test("a table becomes a pipe table, with the first row as the header", () => {
  const md = htmlToMarkdown("<main><table><thead><tr><th>Plan</th><th>Price</th></tr></thead><tbody><tr><td>Free</td><td>$0</td></tr><tr><td>a|b</td><td></td></tr></tbody></table></main>", BASE);
  assert.equal(md, "| Plan | Price |\n| --- | --- |\n| Free | $0 |\n| a\\|b |  |\n");
});

test("entities and React's comment markers are handled; hidden things are dropped", () => {
  const md = htmlToMarkdown(`<main><p>Tom &amp; Jerry<!-- -->&rsquo;s &#8212; &#x41;</p><p hidden>secret</p><div aria-hidden="true">icon</div></main>`, BASE);
  assert.equal(md, "Tom & Jerry’s — A\n");
  assert.equal(decodeEntities("&unknown; &#0;"), "&unknown; &#0;");
});

test("details show their summary as a bold line, and a stray closing tag does no harm", () => {
  const md = htmlToMarkdown("<main></span><details><summary>More</summary><p>Body</p></details></main>", BASE);
  assert.equal(md, "**More**\n\nBody\n");
});

test("a streamed page: the swapped-in content is used, not the loading placeholder", () => {
  const html = `<body><div hidden=""><!--$?--><template id="B:0"></template></div><main id="main"><svg></svg><span>Loading</span></main>
    <div hidden id="S:0"><main id="main"><h1>Docs</h1><p>Real content</p></main></div><script>$RC("B:0","S:0")</script></body>`;
  assert.equal(htmlToMarkdown(html, BASE), "# Docs\n\nReal content\n");
});

test("a command shown on its own line is a code block, and commands that follow one another share it", () => {
  const cmd = (c: string) => `<div class="flex"><span aria-hidden="true">$</span><code>${c}</code><button>Copy</button></div>`;
  const md = htmlToMarkdown(`<main><p>Run:</p>${cmd("craton add .")}${cmd("craton push")}<p>Done.</p></main>`, BASE);
  assert.equal(md, "Run:\n\n```\ncraton add .\ncraton push\n```\n\nDone.\n");
});

test("a streamed page whose pieces arrive separately is put back together", () => {
  const html = `<body><main id="main"><span>Loading</span></main>
    <div hidden id="S:0"><main id="main"><h1>API</h1><template id="P:1"></template><template id="P:2"></template></main></div>
    <div hidden id="S:1"><p>First piece</p><template id="P:3"></template></div>
    <div hidden id="S:2"><p>Second piece</p></div>
    <div hidden id="S:3"><ul><li>Nested piece</li></ul></div></body>`;
  assert.equal(htmlToMarkdown(html, BASE), "# API\n\nFirst piece\n\n- Nested piece\n\nSecond piece\n");
});

test("elements side by side are kept apart, text and punctuation are not disturbed", () => {
  const md = htmlToMarkdown(`<main><ul><li><span>GET</span><code>/user</code><span>Your profile.</span><span>Token</span></li></ul><p><strong>a</strong>, <em>b</em>.</p></main>`, BASE);
  assert.equal(md, "- GET `/user` Your profile. Token\n\n**a**, *b*.\n");
});
