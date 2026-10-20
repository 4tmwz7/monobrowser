import assert from "node:assert/strict";
import { test } from "node:test";
import { getErrorCode, isAboutBlankUrl, isHttpUrl, looksLikeHost } from "./url-utils.js";

test("looksLikeHost rozpoznaje hosty", () => {
  for (const value of ["example.com", "sub.example.co.uk/path", "localhost:3000", "192.168.0.1:8080/x", "wp.pl"]) {
    assert.equal(looksLikeHost(value), true, value);
  }
});

test("looksLikeHost odrzuca zapytania", () => {
  for (const value of ["", "   ", "hello world", "example.com is down", "kot", "a.b", "foo."]) {
    assert.equal(looksLikeHost(value), false, value);
  }
});

test("isHttpUrl i isAboutBlankUrl", () => {
  assert.equal(isHttpUrl("HTTPS://a.pl"), true);
  assert.equal(isHttpUrl("file:///etc/passwd"), false);
  assert.equal(isHttpUrl("javascript:alert(1)"), false);
  assert.equal(isAboutBlankUrl("about:blank#x"), true);
  assert.equal(isAboutBlankUrl("about:config"), false);
});

test("getErrorCode", () => {
  assert.equal(getErrorCode({ code: "ERR_ABORTED" }), "ERR_ABORTED");
  assert.equal(getErrorCode(new Error("x")), undefined);
  assert.equal(getErrorCode(null), undefined);
});

test("buildViewSourceUrl only wraps http(s) pages", async () => {
  const { buildViewSourceUrl, isViewSourceUrl } = await import("./url-utils.js");
  assert.equal(buildViewSourceUrl("https://example.com/a"), "view-source:https://example.com/a");
  assert.equal(buildViewSourceUrl("monobrowser://settings"), null);
  assert.equal(buildViewSourceUrl("view-source:https://example.com"), null);
  assert.equal(isViewSourceUrl("view-source:https://example.com"), true);
  assert.equal(isViewSourceUrl("view-source:file:///etc/passwd"), false);
});

test("displayUrl strips a lone trailing slash of a bare origin only", async () => {
  const { displayUrl } = await import("./url-utils.js");
  assert.equal(displayUrl("http://nonexistent.invalid/"), "http://nonexistent.invalid");
  assert.equal(displayUrl("https://example.com/a/"), "https://example.com/a/");
  assert.equal(displayUrl("https://example.com/?q=1"), "https://example.com/?q=1");
});

test("recoverEmbeddedUrl recovers a URL glued to the internal scheme and nothing else", async () => {
  const { recoverEmbeddedUrl, isInternalSchemeInput, shortUrlLabel } = await import("./url-utils.js");
  assert.equal(recoverEmbeddedUrl("monobrowser://settingshttps://example.com"), "https://example.com");
  assert.equal(recoverEmbeddedUrl("  monobrowser://http://a.pl/x?y=1 "), "http://a.pl/x?y=1");
  assert.equal(recoverEmbeddedUrl("monobrowser://settingsfoo"), null);
  assert.equal(recoverEmbeddedUrl("monobrowser://settings"), null);
  assert.equal(isInternalSchemeInput(" MonoBrowser://x"), true);
  assert.equal(isInternalSchemeInput("https://monobrowser://x"), false);
  assert.equal(shortUrlLabel("https://www.example.com/"), "example.com");
  assert.equal(shortUrlLabel("https://example.com/a/b?c=1"), "example.com/a/b?c=1");
});
