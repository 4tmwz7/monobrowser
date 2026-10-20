import assert from "node:assert/strict";
import test from "node:test";
import { buildCookieUrl, cookieKey, parseCookieList, serializeCookies, toSetDetails, type PortableCookie } from "./portable-cookies.js";

const NOW = 1_800_000_000;
const base: PortableCookie = {
  name: "sid", value: "abc", domain: ".example.com", hostOnly: false, path: "/", secure: true,
  httpOnly: true, sameSite: "lax", expirationDate: NOW + 1000,
};

test("serializeCookies keeps persistent unexpired cookies only", () => {
  const list = serializeCookies([
    { name: "keep", value: "1", domain: ".a.test", hostOnly: false, path: "/x", secure: true, httpOnly: true, session: false, expirationDate: NOW + 5, sameSite: "strict" },
    { name: "session", value: "1", domain: "a.test", session: true },
    { name: "noexp", value: "1", domain: "a.test" },
    { name: "expired", value: "1", domain: "a.test", session: false, expirationDate: NOW - 1 },
    { name: "nodomain", value: "1", session: false, expirationDate: NOW + 5 },
  ], NOW);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { name: "keep", value: "1", domain: ".a.test", hostOnly: false, path: "/x", secure: true, httpOnly: true, sameSite: "strict", expirationDate: NOW + 5 });
});

test("serializeCookies infers hostOnly from the domain when missing", () => {
  const [host, domain] = serializeCookies([
    { name: "a", value: "1", domain: "a.test", expirationDate: NOW + 5 },
    { name: "b", value: "1", domain: ".a.test", expirationDate: NOW + 5 },
  ], NOW);
  assert.equal(host.hostOnly, true);
  assert.equal(domain.hostOnly, false);
});

test("buildCookieUrl uses scheme, host without leading dot and path", () => {
  assert.equal(buildCookieUrl(base), "https://example.com/");
  assert.equal(buildCookieUrl({ ...base, secure: false, path: "/app", domain: "www.example.com" }), "http://www.example.com/app");
  assert.equal(buildCookieUrl({ ...base, secure: false, name: "__Secure-x" }), "https://example.com/");
  assert.equal(buildCookieUrl({ ...base, name: "__Host-x", path: "/deep" }), "https://example.com/");
  assert.equal(buildCookieUrl({ ...base, path: "bad" }), "https://example.com/");
  assert.equal(buildCookieUrl({ ...base, domain: "::1" }), "https://[::1]/");
});

test("toSetDetails skips expired cookies", () => {
  assert.equal(toSetDetails({ ...base, expirationDate: NOW - 1 }, NOW), null);
  assert.equal(toSetDetails({ ...base, expirationDate: NOW }, NOW), null);
});

test("toSetDetails: domain cookies keep a dotted domain, host-only cookies get none", () => {
  const domain = toSetDetails(base, NOW);
  assert.equal(domain?.domain, ".example.com");
  assert.equal(domain?.url, "https://example.com/");
  assert.equal(domain?.expirationDate, base.expirationDate);
  assert.equal(domain?.httpOnly, true);
  assert.equal(domain?.sameSite, "lax");
  const host = toSetDetails({ ...base, domain: "example.com", hostOnly: true }, NOW);
  assert.equal(host?.domain, undefined);
});

test("toSetDetails handles __Host- and __Secure- prefixes", () => {
  const hostCookie = toSetDetails({ ...base, name: "__Host-id", domain: ".example.com", hostOnly: false, path: "/x", secure: false }, NOW);
  assert.equal(hostCookie?.domain, undefined);
  assert.equal(hostCookie?.path, "/");
  assert.equal(hostCookie?.secure, true);
  const secure = toSetDetails({ ...base, name: "__Secure-id", secure: false }, NOW);
  assert.equal(secure?.secure, true);
  assert.equal(secure?.url.startsWith("https://"), true);
});

test("SameSite=None without Secure is downgraded, with Secure it is kept", () => {
  assert.equal(toSetDetails({ ...base, secure: false, sameSite: "no_restriction" }, NOW)?.sameSite, "unspecified");
  assert.equal(toSetDetails({ ...base, secure: true, sameSite: "no_restriction" }, NOW)?.sameSite, "no_restriction");
});

test("parseCookieList validates untrusted input", () => {
  const list = parseCookieList([
    base,
    null, 5, "x", {},
    { name: "a", value: "b", domain: "x.test", expirationDate: "soon" },
    { name: "ok", value: "v", domain: "x.test", expirationDate: NOW + 1, sameSite: "weird", path: "nope" },
  ]);
  assert.equal(list.length, 2);
  assert.equal(list[1].sameSite, "unspecified");
  assert.equal(list[1].path, "/");
  assert.deepEqual(parseCookieList("nope"), []);
});

test("cookieKey ignores the leading dot and case of the domain", () => {
  assert.equal(cookieKey({ name: "a", domain: ".Example.com", path: "/" }), cookieKey({ name: "a", domain: "example.com", path: "/" }));
  assert.notEqual(cookieKey({ name: "a", domain: "example.com", path: "/" }), cookieKey({ name: "a", domain: "example.com", path: "/x" }));
});
