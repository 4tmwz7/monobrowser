import assert from "node:assert/strict";
import test from "node:test";
import { isHostExcepted, isUrlExcepted, normalizeExceptionHost, parseExceptionList } from "./adblock-exceptions.js";

test("normalizeExceptionHost lowercases, strips www and validates", () => {
  assert.equal(normalizeExceptionHost("WWW.Example.COM"), "example.com");
  assert.equal(normalizeExceptionHost("https://www.Example.com/a?b"), "example.com");
  assert.equal(normalizeExceptionHost("localhost"), "localhost");
  assert.equal(normalizeExceptionHost("bad host"), null);
  assert.equal(normalizeExceptionHost("a..b"), null);
  assert.equal(normalizeExceptionHost("exa/mple.com"), null);
  assert.equal(normalizeExceptionHost(""), null);
  assert.equal(normalizeExceptionHost(5), null);
});

test("isHostExcepted matches site and subdomains only", () => {
  const set = new Set(["example.com"]);
  assert.equal(isHostExcepted("example.com", set), true);
  assert.equal(isHostExcepted("www.example.com", set), true);
  assert.equal(isHostExcepted("a.b.example.com", set), true);
  assert.equal(isHostExcepted("notexample.com", set), false);
  assert.equal(isHostExcepted("example.com.evil.net", set), false);
  assert.equal(isUrlExcepted("https://m.example.com/x", set), true);
  assert.equal(isUrlExcepted("garbage", set), false);
});

test("parseExceptionList dedupes and drops invalid entries", () => {
  assert.deepEqual(parseExceptionList({ hosts: ["B.com", "www.b.com", "a.com", "x y", 3] }), ["a.com", "b.com"]);
  assert.deepEqual(parseExceptionList(null), []);
});
