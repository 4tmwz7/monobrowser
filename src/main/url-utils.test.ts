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
