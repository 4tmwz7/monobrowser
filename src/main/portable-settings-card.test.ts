import assert from "node:assert/strict";
import test from "node:test";
import { renderPortableSettingsCard } from "./portable-settings-card.js";

test("portable settings card is bilingual and warns about unencrypted sessions", () => {
  const pl = renderPortableSettingsCard("pl");
  const en = renderPortableSettingsCard("en");
  assert.match(pl, /Tryb przenośny/);
  assert.match(pl, /Szyfruj sesje na pendrive hasłem/);
  assert.match(en, /Portable mode/);
  assert.match(en, /anyone who has this USB drive/);
  for (const html of [pl, en]) {
    assert.match(html, /id="portable-card"/);
  }
});

test("portable settings card styles only through theme variables with fallbacks", () => {
  const css = renderPortableSettingsCard("en").split("<style>")[1].split("</style>")[0];
  const colors = css.match(/#[0-9a-fA-F]{3,6}\b/g) ?? [];
  const bare = css.split(/;|\{/).filter((rule) => /#[0-9a-fA-F]{3,6}\b/.test(rule) && !/var\(--mb-/.test(rule));
  assert.ok(colors.length > 0);
  assert.deepEqual(bare, []);
});

test("portable settings card describes notify-only updates in portable builds", () => {
  const description = (html: string): string => /<p class="description">([^<]*)<\/p>/.exec(html)?.[1] ?? "";
  assert.match(description(renderPortableSettingsCard("en")), /only notifies you/);
  assert.match(description(renderPortableSettingsCard("en", true)), /install automatically/);
  assert.doesNotMatch(description(renderPortableSettingsCard("pl", true)), /tylko powiadamia/);
});
