import assert from "node:assert/strict";
import test from "node:test";
import { clampZoom, formatZoomPercent, normalizeZoomStore, stepZoom, withZoomEntry, zoomOriginKey } from "./zoom-utils.js";

test("stepZoom walks the Chrome-like ladder", () => {
  assert.equal(stepZoom(1, "in"), 1.1);
  assert.equal(stepZoom(1.1, "in"), 1.25);
  assert.equal(stepZoom(1, "out"), 0.9);
  assert.equal(stepZoom(0.9, "out"), 0.8);
  assert.equal(stepZoom(5, "in"), 5);
  assert.equal(stepZoom(0.25, "out"), 0.25);
  assert.equal(stepZoom(1.05, "in"), 1.1);
  assert.equal(stepZoom(Number.NaN, "in"), 1.1);
});

test("clampZoom and formatZoomPercent", () => {
  assert.equal(clampZoom(10), 5);
  assert.equal(clampZoom(0.01), 0.25);
  assert.equal(formatZoomPercent(1.1), "110%");
  assert.equal(formatZoomPercent(0.67), "67%");
});

test("zoomOriginKey only keys http(s) origins", () => {
  assert.equal(zoomOriginKey("https://example.com/a/b?c"), "https://example.com");
  assert.equal(zoomOriginKey("http://localhost:3000/x"), "https://localhost");
  assert.equal(zoomOriginKey("http://example.com:81/"), "https://example.com");
  assert.equal(zoomOriginKey("file:///tmp/a.html"), null);
  assert.equal(zoomOriginKey("not a url"), null);
});

test("normalizeZoomStore drops invalid and default entries", () => {
  assert.deepEqual(normalizeZoomStore({ "https://a.test": 1.5, "https://b.test": 1, "ftp://c": 2, "https://d.test": "big", "https://e.test": 99 }), {
    "https://a.test": 1.5,
    "https://e.test": 5,
  });
  assert.deepEqual(normalizeZoomStore([1, 2]), {});
});

test("withZoomEntry sets and removes entries immutably", () => {
  const base = { "https://a.test": 1.5 };
  const updated = withZoomEntry(base, "https://b.test", 0.8);
  assert.deepEqual(updated, { "https://a.test": 1.5, "https://b.test": 0.8 });
  assert.deepEqual(base, { "https://a.test": 1.5 });
  assert.deepEqual(withZoomEntry(updated, "https://a.test", 1), { "https://b.test": 0.8 });
});

test("zoomOriginKey treats view-source as its underlying origin", () => {
  assert.equal(zoomOriginKey("view-source:http://localhost:8791/fs.html"), "https://localhost");
});
