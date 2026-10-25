import assert from "node:assert/strict";
import { test } from "node:test";
import { SITE_CACHE_STORAGES, siteCacheOrigin } from "./site-cache.js";

test("siteCacheOrigin zwraca origin tylko dla http(s)", () => {
  assert.equal(siteCacheOrigin("https://example.com/a/b?x=1#h"), "https://example.com");
  assert.equal(siteCacheOrigin("http://localhost:5173/app"), "http://localhost:5173");
  for (const value of ["monobrowser://settings", "file:///tmp/a.html", "data:text/html,hi", "about:blank", "", "not a url"]) {
    assert.equal(siteCacheOrigin(value), null, value);
  }
});

test("SITE_CACHE_STORAGES nie obejmuje ciasteczek ani localStorage", () => {
  assert.deepEqual([...SITE_CACHE_STORAGES], ["cachestorage", "serviceworkers"]);
});
