import test from "node:test";
import assert from "node:assert/strict";
import { animationCss, normalizeAnimationSettings, overlayFadeOutMs, resolveAnimationsEffective, setAnimationsEffective } from "./animation-settings.js";

test("normalizeAnimationSettings: domyślnie włączone i pełne, tylko poprawne wartości są przyjmowane", () => {
  assert.deepEqual(normalizeAnimationSettings(undefined), { enabled: true, level: "full" });
  assert.deepEqual(normalizeAnimationSettings({ enabled: "no", level: "wild" }), { enabled: true, level: "full" });
  assert.deepEqual(normalizeAnimationSettings({ enabled: false }), { enabled: false, level: "full" });
  assert.deepEqual(normalizeAnimationSettings({ enabled: true, level: "subtle" }), { enabled: true, level: "subtle" });
  assert.deepEqual(normalizeAnimationSettings({ level: "subtle" }), { enabled: true, level: "subtle" });
});

test("resolveAnimationsEffective: wyłączenie przez ustawienie, reduced-motion lub env", () => {
  const on = { enabled: true, level: "full" } as const;
  assert.equal(resolveAnimationsEffective(on, false, false), true);
  assert.equal(resolveAnimationsEffective({ enabled: false, level: "full" }, false, false), false);
  assert.equal(resolveAnimationsEffective(on, true, false), false);
  assert.equal(resolveAnimationsEffective(on, false, true), false);
});

test("animationCss: zmienne czasu zależą od stanu i poziomu", () => {
  const full = animationCss(true);
  assert.ok(full.includes("--mb-dur-fast:120ms") && full.includes("--mb-dur:180ms") && full.includes("--mb-dur-slow:320ms"));
  assert.ok(full.includes("--mb-stagger:24ms"));
  const subtle = animationCss(true, "subtle");
  assert.ok(subtle.includes("--mb-dur:130ms") && subtle.includes("--mb-stagger:0ms"));
  assert.ok(!subtle.includes("--mb-dur:180ms"));
  const off = animationCss(false, "subtle");
  assert.ok(off.startsWith(":root{--mb-dur-fast:0ms;--mb-dur:0ms;--mb-dur-slow:0ms"));
  assert.ok(off.includes("--mb-on:0"));
  assert.ok(animationCss(true).includes("prefers-reduced-motion"));
});

test("animationCss: reduced-motion zeruje wszystkie czasy i przesunięcia", () => {
  const css = animationCss(true);
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion:reduce)"));
  assert.ok(reduced.includes("--mb-dur:0ms") && reduced.includes("--mb-dur-fast:0ms") && reduced.includes("--mb-shift:0px"));
});

test("overlayFadeOutMs: czas wyjścia wynika z poziomu, przy wyłączonych animacjach wynosi 0", () => {
  setAnimationsEffective(true, "full");
  const full = overlayFadeOutMs();
  assert.ok(full >= 120 && full < 200);
  setAnimationsEffective(true, "subtle");
  const subtle = overlayFadeOutMs();
  assert.ok(subtle >= 90 && subtle < full);
  setAnimationsEffective(false, "subtle");
  assert.equal(overlayFadeOutMs(), 0);
  setAnimationsEffective(true, "full");
});
