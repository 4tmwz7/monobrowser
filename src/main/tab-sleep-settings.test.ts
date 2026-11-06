import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TAB_SLEEP_SETTINGS,
  MAX_NEVER_SLEEP_SITES,
  isSiteExcludedFromSleep,
  mergeTabSleepSettings,
  normalizeSleepSite,
  normalizeSleepSites,
  normalizeTabSleepSettings,
} from "./tab-sleep-settings.js";

test("normalizeSleepSite accepts hosts, URLs and wildcards", () => {
  assert.equal(normalizeSleepSite("example.com"), "example.com");
  assert.equal(normalizeSleepSite("  Example.COM  "), "example.com");
  assert.equal(normalizeSleepSite("https://www.Example.com/path?q=1#x"), "example.com");
  assert.equal(normalizeSleepSite("*.example.com"), "example.com");
  assert.equal(normalizeSleepSite("example.com:8080/a"), "example.com");
  assert.equal(normalizeSleepSite("http://localhost:3000/"), "localhost");
});

test("normalizeSleepSite rejects invalid input", () => {
  for (const bad of ["", "   ", "a b.com", "-bad.com", "ftp://example.com", "http://", "foo@bar.com", 5, null, undefined, "a..b"]) {
    assert.equal(normalizeSleepSite(bad), null, String(bad));
  }
});

test("normalizeSleepSites de-duplicates, drops invalid entries and caps the list", () => {
  assert.deepEqual(normalizeSleepSites(["B.com", "https://b.com/x", "*.a.com", "", 1, "bad host"]), ["a.com", "b.com"]);
  assert.deepEqual(normalizeSleepSites("nope"), []);
  const many = Array.from({ length: MAX_NEVER_SLEEP_SITES + 50 }, (_, i) => `site${i}.com`);
  assert.equal(normalizeSleepSites(many).length, MAX_NEVER_SLEEP_SITES);
});

test("normalizeTabSleepSettings falls back to defaults", () => {
  assert.deepEqual(normalizeTabSleepSettings(null), DEFAULT_TAB_SLEEP_SETTINGS);
  assert.deepEqual(normalizeTabSleepSettings({ afterMinutes: 7, neverSleepSites: "x" }), DEFAULT_TAB_SLEEP_SETTINGS);
  assert.deepEqual(normalizeTabSleepSettings({ afterMinutes: 0, neverSleepSites: ["Example.com"] }), { afterMinutes: 0, neverSleepSites: ["example.com"] });
});

test("mergeTabSleepSettings applies valid fields and ignores invalid ones", () => {
  const current = { afterMinutes: 30, neverSleepSites: ["a.com"] };
  assert.deepEqual(mergeTabSleepSettings(current, { afterMinutes: 60 }), { afterMinutes: 60, neverSleepSites: ["a.com"] });
  assert.deepEqual(mergeTabSleepSettings(current, { afterMinutes: 11, neverSleepSites: ["b.com"] }), { afterMinutes: 30, neverSleepSites: ["b.com"] });
  assert.deepEqual(mergeTabSleepSettings(current, "garbage"), current);
  assert.deepEqual(mergeTabSleepSettings(current, { afterMinutes: "5" }), current);
  assert.deepEqual(mergeTabSleepSettings(current, { neverSleepSites: [] }), { afterMinutes: 30, neverSleepSites: [] });
});

test("isSiteExcludedFromSleep matches host and subdomains over http(s) only", () => {
  const list = ["example.com", "localhost"];
  assert.equal(isSiteExcludedFromSleep("https://example.com/a", list), true);
  assert.equal(isSiteExcludedFromSleep("https://www.example.com", list), true);
  assert.equal(isSiteExcludedFromSleep("http://a.b.example.com:81/x", list), true);
  assert.equal(isSiteExcludedFromSleep("https://notexample.com", list), false);
  assert.equal(isSiteExcludedFromSleep("https://example.com.evil.org", list), false);
  assert.equal(isSiteExcludedFromSleep("ftp://example.com", list), false);
  assert.equal(isSiteExcludedFromSleep("data:text/html,example.com", list), false);
  assert.equal(isSiteExcludedFromSleep("not a url", list), false);
  assert.equal(isSiteExcludedFromSleep(undefined, list), false);
  assert.equal(isSiteExcludedFromSleep("https://example.com", []), false);
  assert.equal(isSiteExcludedFromSleep("http://localhost:3000", list), true);
});

test("normalizeSleepSite strips a leading www. like adblock exceptions", () => {
  assert.equal(normalizeSleepSite("www.example.com"), "example.com");
  assert.equal(normalizeSleepSite("*.www.example.com"), "example.com");
});
