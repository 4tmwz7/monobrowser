import assert from "node:assert/strict";
import test from "node:test";
import { ABOUT_LINKS, describeUpdateStatus, escapeAboutHtml, isAllowedAboutLink, renderAboutPageHtml, SHORTCUT_GROUPS, type AboutInfo, type UpdateStatus } from "./about-page.js";

const info: AboutInfo = { version: "1.2.3", electron: "44.0.0", chrome: "150.0.0.0", node: "24.0.0", platform: "linux", arch: "x64" };
const idle: UpdateStatus = { state: "idle", version: null, checkedAt: null, packaged: true };

test("about page shows versions in both languages", () => {
  for (const language of ["pl", "en"] as const) {
    const html = renderAboutPageHtml({ language, info, status: idle });
    assert.match(html, /1\.2\.3/);
    assert.match(html, /44\.0\.0/);
    assert.match(html, /150\.0\.0\.0/);
    assert.match(html, new RegExp(`<html lang="${language}">`));
    assert.match(html, /Content-Security-Policy/);
  }
  assert.match(renderAboutPageHtml({ language: "pl", info, status: idle }), /Skróty klawiszowe/);
  assert.match(renderAboutPageHtml({ language: "en", info, status: idle }), /Keyboard shortcuts/);
});

test("about page escapes injected values", () => {
  const html = renderAboutPageHtml({ language: "en", info: { ...info, version: '<img src=x onerror="1">' }, status: idle });
  assert.doesNotMatch(html, /<img src=x/);
  assert.equal(escapeAboutHtml(`<a href="x">&'`), "&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
});

test("shortcut table lists every group with both translations", () => {
  assert.ok(SHORTCUT_GROUPS.length >= 3);
  for (const group of SHORTCUT_GROUPS) {
    assert.ok(group.pl && group.en);
    for (const row of group.rows) assert.ok(row.keys && row.pl && row.en);
  }
  const keys = SHORTCUT_GROUPS.flatMap((group) => group.rows.map((row) => row.keys)).join(" ");
  for (const needle of ["Ctrl+P", "Ctrl+S", "Ctrl+U", "Ctrl+Shift+T", "Ctrl+9"]) assert.ok(keys.includes(needle), needle);
});

test("describeUpdateStatus covers each state", () => {
  assert.match(describeUpdateStatus({ ...idle, state: "checking" }, "en"), /Checking/);
  assert.match(describeUpdateStatus({ ...idle, state: "up-to-date", checkedAt: Date.now() }, "pl"), /najnowsz/);
  assert.match(describeUpdateStatus({ ...idle, state: "available", version: "9.9.9" }, "en"), /9\.9\.9/);
  assert.match(describeUpdateStatus({ ...idle, state: "error" }, "en"), /Could not/);
  assert.match(describeUpdateStatus({ ...idle, packaged: false }, "en"), /Development/);
});

test("only the known project links may be opened from the about page", () => {
  assert.equal(isAllowedAboutLink(ABOUT_LINKS.github), true);
  assert.equal(isAllowedAboutLink(ABOUT_LINKS.site), true);
  assert.equal(isAllowedAboutLink("https://evil.example/"), false);
  assert.equal(isAllowedAboutLink(42), false);
});

test("portable build is labelled in both languages and updates are manual", () => {
  const status: UpdateStatus = { ...idle, portable: true };
  assert.match(renderAboutPageHtml({ language: "pl", info: { ...info, portable: true }, status }), /przenośny/);
  assert.match(renderAboutPageHtml({ language: "en", info: { ...info, portable: true }, status }), /portable \(runs from a drive\)/);
  assert.doesNotMatch(renderAboutPageHtml({ language: "en", info, status: idle }), /runs from a drive/);
  assert.match(describeUpdateStatus(status, "en"), /Portable build/);
  assert.match(describeUpdateStatus(status, "pl"), /przenośna/);
});

test("portable build: available update gives rebuild instructions and the release page button", () => {
  const status: UpdateStatus = { ...idle, portable: true, state: "available", version: "0.7.0", releaseUrl: "https://github.com/o/r/releases/tag/v0.7.0" };
  assert.match(describeUpdateStatus(status, "en"), /0\.7\.0.*dist:win:portable/);
  assert.match(describeUpdateStatus(status, "pl"), /Zbuduj nową wersję przenośną/);
  assert.doesNotMatch(renderAboutPageHtml({ language: "en", info, status }), /id="update-release" hidden/);
  assert.match(renderAboutPageHtml({ language: "en", info, status: { ...status, releaseUrl: null } }), /id="update-release" hidden/);
  assert.match(renderAboutPageHtml({ language: "pl", info, status }), /Otwórz stronę wydania/);
  assert.match(renderAboutPageHtml({ language: "en", info, status }), /Open release page/);
  assert.match(describeUpdateStatus({ ...idle, state: "error" }, "en"), /Could not check for updates/);
});
