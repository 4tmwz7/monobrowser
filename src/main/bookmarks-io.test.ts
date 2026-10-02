import assert from "node:assert/strict";
import { test } from "node:test";
import { exportBookmarksHtml, exportBookmarksJson, parseBookmarksImport } from "./bookmarks-io.js";

const sample = [
  { url: "https://example.com/?a=1&b=2", title: 'Tom & "Jerry" <3', createdAt: "2024-01-02T03:04:05.000Z" },
  { url: "https://wp.pl", title: "" },
];

test("eksport HTML i import zwrotny zachowują dane", () => {
  const parsed = parseBookmarksImport(exportBookmarksHtml(sample));
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].url, sample[0].url);
  assert.equal(parsed[0].title, sample[0].title);
  assert.equal(parsed[0].createdAt, sample[0].createdAt);
  assert.equal(parsed[1].title, "https://wp.pl");
});

test("eksport JSON i import zwrotny", () => {
  const parsed = parseBookmarksImport(exportBookmarksJson(sample));
  assert.deepEqual(parsed.map((entry) => entry.url), sample.map((entry) => entry.url));
});

test("import HTML z Chrome/Firefox (zagnieżdżone foldery, atrybuty)", () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1><DL><p>
    <DT><H3 ADD_DATE="1">Folder</H3><DL><p>
      <DT><A HREF="https://a.com/" ADD_DATE="1700000000" ICON="data:image/png;base64,xx">A <b>site</b></A>
    </DL><p><DT><a href='https://b.com/x?y=1&amp;z=2'>B</a></DL>`;
  const parsed = parseBookmarksImport(html);
  assert.deepEqual(parsed.map((entry) => [entry.url, entry.title]), [
    ["https://a.com/", "A site"],
    ["https://b.com/x?y=1&z=2", "B"],
  ]);
});

test("import JSON z drzewem Chromium", () => {
  const tree = { roots: { bookmark_bar: { children: [{ name: "X", url: "https://x.com" }] } } };
  assert.deepEqual(parseBookmarksImport(JSON.stringify(tree)).map((entry) => entry.url), ["https://x.com"]);
});

test("niepoprawny JSON zgłasza błąd, puste HTML daje pustą listę", () => {
  assert.throws(() => parseBookmarksImport("[oops"));
  assert.deepEqual(parseBookmarksImport("<html></html>"), []);
});
