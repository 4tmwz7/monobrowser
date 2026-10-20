import assert from "node:assert/strict";
import { test } from "node:test";
import { COLOR_THEMES } from "./color-themes.js";
import { THEME_TOKEN_KEYS, contrastRatio } from "./theme.js";

const HEX = /^#[0-9a-f]{6}$/;

test("motywy: 14 presetow, unikalne id, komplet tokenow, poprawne #rrggbb", () => {
  assert.equal(COLOR_THEMES.length, 14);
  assert.equal(new Set(COLOR_THEMES.map((t) => t.id)).size, COLOR_THEMES.length);
  for (const theme of COLOR_THEMES) {
    for (const key of THEME_TOKEN_KEYS) assert.match(theme.tokens[key], HEX, `${theme.id}.${key}`);
    assert.ok(theme.tokens.scheme === "light" || theme.tokens.scheme === "dark");
  }
});

test("motywy: kontrast fg/bg >= 4.5, muted/bg >= 3", () => {
  for (const { id, tokens: t } of COLOR_THEMES) {
    assert.ok(contrastRatio(t.fg, t.bg) >= 4.5, `${id} fg/bg ${contrastRatio(t.fg, t.bg).toFixed(2)}`);
    assert.ok(contrastRatio(t.muted, t.bg) >= 3, `${id} muted/bg ${contrastRatio(t.muted, t.bg).toFixed(2)}`);
  }
});

test("motywy: kontrast na powierzchniach, akcencie i danger", () => {
  for (const { id, tokens: t } of COLOR_THEMES) {
    for (const surface of [t.surface, t.surface2]) {
      assert.ok(contrastRatio(t.fg, surface) >= 4.5, `${id} fg/${surface} ${contrastRatio(t.fg, surface).toFixed(2)}`);
      assert.ok(contrastRatio(t.muted, surface) >= 3, `${id} muted/${surface} ${contrastRatio(t.muted, surface).toFixed(2)}`);
    }
    assert.ok(contrastRatio(t.onAccent, t.accent) >= 4.5, `${id} onAccent ${contrastRatio(t.onAccent, t.accent).toFixed(2)}`);
    assert.ok(contrastRatio(t.danger, t.bg) >= 3, `${id} danger ${contrastRatio(t.danger, t.bg).toFixed(2)}`);
  }
});
