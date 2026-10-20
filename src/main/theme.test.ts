import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DARK, DEFAULT_LIGHT, THEME_PRESETS, THEME_TOKEN_KEYS, contrastRatio, injectThemeIntoHtml,
  migrateLegacyColors, normalizeHex, normalizeThemeColors, normalizeThemeSettings, resolveTheme, themeApplyScript, themeCss,
} from "./theme.js";

test("domyslny motyw: jasny i ciemny maja kontrast i poprawne kolory", () => {
  for (const t of [DEFAULT_LIGHT, DEFAULT_DARK]) {
    for (const key of THEME_TOKEN_KEYS) assert.match(t[key], /^#[0-9a-f]{6}$/, key);
    assert.ok(contrastRatio(t.fg, t.bg) >= 4.5);
    assert.ok(contrastRatio(t.muted, t.bg) >= 3);
    assert.ok(contrastRatio(t.fg, t.surface) >= 4.5);
    assert.ok(contrastRatio(t.onAccent, t.accent) >= 4.5);
  }
  assert.equal(DEFAULT_LIGHT.scheme, "light");
  assert.equal(DEFAULT_DARK.scheme, "dark");
});

test("resolveTheme: default podaza za systemem, preset i custom", () => {
  assert.equal(resolveTheme({ id: "default" }, false), DEFAULT_LIGHT);
  assert.equal(resolveTheme({ id: "default" }, true), DEFAULT_DARK);
  assert.equal(resolveTheme({ id: "gruvbox-dark" }, false).bg, "#282828");
  assert.equal(resolveTheme({ id: "rose-pine-dawn" }, true).scheme, "light");
  assert.equal(resolveTheme({ id: "nieznany" }, true), DEFAULT_DARK);
  const custom = { ...DEFAULT_DARK, bg: "#ffffff", fg: "#000000" };
  assert.equal(resolveTheme({ id: "custom", custom }, true).scheme, "light");
});

test("normalizeHex i normalizeThemeColors", () => {
  assert.equal(normalizeHex("#ABCDEF"), "#abcdef");
  assert.equal(normalizeHex("red"), null);
  assert.equal(normalizeHex("#fff"), null);
  assert.equal(normalizeThemeColors(null), null);
  assert.equal(normalizeThemeColors({ bg: "zly" }), null);
  const partial = normalizeThemeColors({ bg: "#112233" });
  assert.equal(partial?.bg, "#112233");
  assert.equal(partial?.fg, DEFAULT_LIGHT.fg);
});

test("normalizeThemeSettings: odrzuca smieci", () => {
  assert.deepEqual(normalizeThemeSettings(undefined), { id: "default" });
  assert.deepEqual(normalizeThemeSettings({ id: "nord" }), { id: "nord" });
  assert.deepEqual(normalizeThemeSettings({ id: "nope" }), { id: "default" });
  assert.deepEqual(normalizeThemeSettings({ id: "custom" }), { id: "default" });
  const custom = normalizeThemeSettings({ id: "custom", custom: { bg: "#010203", fg: "#fefefe" } });
  assert.equal(custom.id, "custom");
  assert.equal(custom.custom?.bg, "#010203");
});

test("migracja starych customColors", () => {
  assert.deepEqual(migrateLegacyColors(undefined), { id: "default" });
  assert.deepEqual(migrateLegacyColors({ startPage: {}, tabBar: {} }), { id: "default" });
  assert.deepEqual(migrateLegacyColors({ startPage: { background: "nie-kolor" }, tabBar: {} }), { id: "default" });
  const migrated = migrateLegacyColors({
    startPage: { background: "#101010", text: "#eeeeee", accent: "#ff8800" },
    tabBar: { tabbarBg: "#050505", tabHoverBg: "#202020", tabFg: "#999999" },
  });
  assert.equal(migrated.id, "custom");
  assert.equal(migrated.custom?.bg, "#101010");
  assert.equal(migrated.custom?.fg, "#eeeeee");
  assert.equal(migrated.custom?.accent, "#ff8800");
  assert.equal(migrated.custom?.surface, "#050505");
  assert.equal(migrated.custom?.surface2, "#202020");
  assert.equal(migrated.custom?.muted, "#999999");
  assert.match(migrated.custom?.onAccent ?? "", /^#[0-9a-f]{6}$/);
});

test("themeCss: blok :root ze wszystkimi tokenami i color-scheme", () => {
  const css = themeCss(DEFAULT_DARK);
  assert.ok(css.startsWith(":root{color-scheme:dark;"));
  for (const name of ["--mb-bg", "--mb-surface", "--mb-surface-2", "--mb-fg", "--mb-muted", "--mb-accent", "--mb-on-accent", "--mb-border", "--mb-danger"]) {
    assert.ok(css.includes(`${name}:#`), name);
  }
  assert.ok(themeCss(DEFAULT_LIGHT).includes("color-scheme:light"));
});

test("injectThemeIntoHtml i themeApplyScript", () => {
  const html = `<!doctype html><html><head><meta charset="UTF-8"></head><body></body></html>`;
  const out = injectThemeIntoHtml(html, DEFAULT_LIGHT);
  assert.ok(out.includes(`<head><style id="mb-theme">:root{`));
  assert.ok(injectThemeIntoHtml("<p>x</p>", DEFAULT_LIGHT).startsWith(`<style id="mb-theme">`));
  assert.ok(themeApplyScript(DEFAULT_DARK).includes("mb-theme"));
  // transitions are suspended during the swap so background tabs never keep half the old colors
  assert.ok(themeApplyScript(DEFAULT_DARK).includes("mb-theme-swap"));
});

test("presety: bazowe kolory zgodne z oficjalnymi paletami", () => {
  const gruvbox = THEME_PRESETS.find((p) => p.id === "gruvbox-dark");
  assert.equal(gruvbox?.tokens.bg, "#282828");
  assert.equal(gruvbox?.tokens.fg, "#ebdbb2");
  assert.equal(gruvbox?.tokens.scheme, "dark");
});

test("every preset keeps muted text at >= 4.5:1 on bg, surface and surface2", async () => {
  const { THEME_PRESETS, contrastRatio } = await import("./theme.js");
  for (const preset of THEME_PRESETS) {
    const k = preset.tokens;
    for (const surface of [k.bg, k.surface, k.surface2]) {
      assert.ok(contrastRatio(k.muted, surface) >= 4.5, `${preset.id}: ${k.muted} on ${surface}`);
    }
  }
});
