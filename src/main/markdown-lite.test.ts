import assert from "node:assert/strict";
import { test } from "node:test";
import { extractMarkdownUrls, renderMarkdownLite } from "./markdown-lite.js";

test("renders headings, lists, code and links", () => {
  const html = renderMarkdownLite("# Title\n\nSome **bold** and `code` text.\n\n- one\n- two\n\n1. first\n\n```\nlet a = 1 < 2;\n```\n\nSee [site](https://example.com/x) and https://a.org/b.");
  assert.match(html, /<h1 class="md-h">Title<\/h1>/);
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<code>code<\/code>/);
  assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<ol><li>first<\/li><\/ol>/);
  assert.match(html, /<pre class="md-code"><code>let a = 1 &lt; 2;<\/code><\/pre>/);
  assert.match(html, /<a href="https:\/\/example\.com\/x" data-link/);
  assert.match(html, /<a href="https:\/\/a\.org\/b" data-link[^>]*>https:\/\/a\.org\/b<\/a>\./);
});

test("escapes HTML and never links non-http schemes", () => {
  const html = renderMarkdownLite("<script>alert(1)</script> [x](javascript:alert(1)) [y](data:text/html,hi)\n\n```\n<img src=x onerror=1>\n```");
  assert.doesNotMatch(html, /<script/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /href="javascript/);
  assert.doesNotMatch(html, /href="data/);
  assert.match(html, /&lt;script&gt;/);
});

test("code spans keep their content literal", () => {
  const html = renderMarkdownLite("Use `**not bold** [a](https://x.y)` here");
  assert.match(html, /<code>\*\*not bold\*\* \[a\]\(https:\/\/x\.y\)<\/code>/);
  assert.doesNotMatch(html, /<strong>/);
});

test("extractMarkdownUrls lists unique http(s) urls", () => {
  assert.deepEqual(extractMarkdownUrls("a https://a.org/x. b (https://b.org) https://a.org/x"), ["https://a.org/x", "https://b.org"]);
});
