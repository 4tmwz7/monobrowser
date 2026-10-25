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

test("hostInputToUrl opens local and LAN hosts over http", async () => {
  const { hostInputToUrl, isLocalHost } = await import("./url-utils.js");
  for (const value of ["localhost", "localhost:3000/api", "app.localhost:5173", "127.0.0.1:8080", "0.0.0.0:4000", "192.168.1.10", "10.0.0.2:3000", "172.20.0.5", "[::1]:8000/x", "raspberrypi.local"]) {
    assert.equal(looksLikeHost(value), true, value);
    assert.equal(isLocalHost(value), true, value);
    assert.equal(hostInputToUrl(value), `http://${value}`, value);
  }
  for (const value of ["example.com", "172.32.0.1", "8.8.8.8", "localhost.example.com"]) {
    assert.equal(isLocalHost(value), false, value);
    assert.equal(hostInputToUrl(value), `https://${value}`, value);
  }
});

test("isLoopbackHost akceptuje tylko loopback, nie LAN", async () => {
  const { isLoopbackHost } = await import("./url-utils.js");
  for (const value of ["localhost", "localhost:5173", "app.localhost", "127.0.0.1", "127.0.0.1:8443", "[::1]", "[::1]:3000", "[0:0:0:0:0:0:0:1]"]) {
    assert.equal(isLoopbackHost(value), true, value);
  }
  for (const value of ["192.168.0.2", "10.0.0.1", "172.16.0.1", "0.0.0.0", "printer.local", "example.com", "localhost.evil.com", "evil-localhost", "[2001:db8::1]"]) {
    assert.equal(isLoopbackHost(value), false, value);
  }
});
