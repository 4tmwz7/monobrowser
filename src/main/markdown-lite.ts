// Tiny, safe Markdown renderer for THIRD-PARTY-NOTICES.md on the About page.
// Everything is HTML-escaped first; only a fixed set of tags is ever produced and only http(s) links are linked.
// Supported: # headings, paragraphs, - / * / 1. lists, > quotes, --- rules, ``` fenced code, `code`, **bold**, *italic*, [text](url), bare URLs.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeMd = (value: string): string => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

/** http(s) URLs that appear in the Markdown (as links or bare), for the About page's "open link" allow-list. */
export const extractMarkdownUrls = (markdown: string): string[] =>
  Array.from(new Set(markdown.match(/https?:\/\/[^\s)<>\]"'`]+/g)?.map((url) => url.replace(/[.,;:]+$/, "")) ?? []));

const renderInline = (raw: string): string => {
  const slots: string[] = [];
  const stash = (html: string): string => `\u0000${slots.push(html) - 1}\u0000`;
  let text = raw;
  // Code spans first: their content is literal.
  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => stash(`<code>${escapeMd(code)}</code>`));
  // [label](url): only http(s) targets become links, anything else stays plain text.
  text = text.replace(/\[([^\]\n]+)\]\((\S+?)\)/g, (_m, label: string, url: string) =>
    /^https?:\/\//i.test(url)
      ? stash(`<a href="${escapeMd(url)}" data-link rel="noopener noreferrer">${escapeMd(label)}</a>`)
      : stash(escapeMd(`${label} (${url})`)));
  // Bare URLs (a trailing sentence punctuation mark stays outside of the link).
  text = text.replace(/https?:\/\/[^\s<>"'`]+/g, (url) => {
    const trail = /[.,;:)\]]+$/.exec(url)?.[0] ?? "";
    const clean = trail ? url.slice(0, -trail.length) : url;
    return stash(`<a href="${escapeMd(clean)}" data-link rel="noopener noreferrer">${escapeMd(clean)}</a>`) + trail;
  });
  text = escapeMd(text);
  text = text.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_m, index: string) => slots[Number(index)] ?? "");
};

export const renderMarkdownLite = (markdown: string): string => {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | null = null;
  let quote: string[] = [];
  const flushParagraph = (): void => {
    if (paragraph.length) out.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list) out.push(`<${list.tag}>${list.items.map((item) => `<li>${renderInline(item)}</li>`).join("")}</${list.tag}>`);
    list = null;
  };
  const flushQuote = (): void => {
    if (quote.length) out.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
    quote = [];
  };
  const flushAll = (): void => { flushParagraph(); flushList(); flushQuote(); };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      flushAll();
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { code.push(lines[i]); i += 1; }
      out.push(`<pre class="md-code"><code>${escapeMd(code.join("\n"))}</code></pre>`);
      continue;
    }
    if (!line.trim()) { flushAll(); continue; }
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      out.push(`<h${level} class="md-h">${renderInline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushAll(); out.push("<hr>"); continue; }
    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || numbered) {
      flushParagraph(); flushQuote();
      const tag = bullet ? "ul" : "ol";
      if (list && list.tag !== tag) flushList();
      if (!list) list = { tag, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    // Continuation line of a list item (indented text right below it).
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += ` ${line.trim()}`; continue; }
    const quoted = /^\s*>\s?(.*)$/.exec(line);
    if (quoted) { flushParagraph(); flushList(); quote.push(quoted[1]); continue; }
    flushList(); flushQuote();
    paragraph.push(line.trim());
  }
  flushAll();
  return out.join("\n");
};
