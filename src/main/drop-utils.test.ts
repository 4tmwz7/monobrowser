import assert from "node:assert/strict";
import test from "node:test";
import { resolveDropTargets } from "./drop-utils.js";

test("files become file:// URLs", () => {
  assert.deepEqual(resolveDropTargets({ filePaths: ["/tmp/a b.html"] }), ["file:///tmp/a%20b.html"]);
  assert.deepEqual(resolveDropTargets({ filePaths: ["relative.html", 5] }), []);
});

test("uri-list entries are filtered to safe schemes", () => {
  const uriList = "# comment\r\nhttps://example.com/a\r\njavascript:alert(1)\r\nhttp://b.test/";
  assert.deepEqual(resolveDropTargets({ uriList }), ["https://example.com/a", "http://b.test/"]);
});

test("plain text only opens when it is a single URL or host", () => {
  assert.deepEqual(resolveDropTargets({ text: "https://example.com" }), ["https://example.com"]);
  assert.deepEqual(resolveDropTargets({ text: "example.com/page" }), ["https://example.com/page"]);
  assert.deepEqual(resolveDropTargets({ text: "hello world" }), []);
  assert.deepEqual(resolveDropTargets({ text: "javascript:alert(1)" }), []);
});

test("files win over text and the list is capped and deduplicated", () => {
  assert.deepEqual(resolveDropTargets({ filePaths: ["/a.html"], text: "https://x.test" }), ["file:///a.html"]);
  const many = Array.from({ length: 30 }, (_, index) => `/f${index}.html`);
  assert.equal(resolveDropTargets({ filePaths: many }).length, 10);
  assert.deepEqual(resolveDropTargets({ uriList: "https://a.test/\nhttps://a.test/" }), ["https://a.test/"]);
});
