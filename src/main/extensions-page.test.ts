import assert from "node:assert/strict";
import test from "node:test";
import { extensionsPageCopy, renderExtensionsPageHtml } from "./extensions-page.js";

test("extensions page renders in both languages with a strict CSP", () => {
  for (const language of ["pl", "en"] as const) {
    const html = renderExtensionsPageHtml({ language });
    assert.match(html, new RegExp(`<html lang="${language}">`));
    assert.match(html, /default-src 'none'/);
    assert.match(html, /id="open-store"/);
    assert.match(html, /id="load-unpacked"/);
    assert.match(html, /id="open-folder"/);
    assert.ok(html.includes(extensionsPageCopy(language).heading));
  }
  assert.match(renderExtensionsPageHtml({ language: "pl" }), /Rozszerzenia/);
  assert.match(renderExtensionsPageHtml({ language: "en" }), /Extensions/);
});

test("extensions page copy is complete in both languages", () => {
  assert.deepEqual(Object.keys(extensionsPageCopy("pl")).sort(), Object.keys(extensionsPageCopy("en")).sort());
});

test("extension data is only inserted via textContent (no innerHTML in the page script)", () => {
  const html = renderExtensionsPageHtml({ language: "en" });
  assert.doesNotMatch(html, /innerHTML/);
});
