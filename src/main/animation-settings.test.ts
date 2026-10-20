import test from "node:test";
import assert from "node:assert/strict";
import { animationCss, normalizeAnimationSettings, resolveAnimationsEffective } from "./animation-settings.js";

test("normalizeAnimationSettings: domyślnie włączone, tylko boolean jest przyjmowany", () => {
  assert.deepEqual(normalizeAnimationSettings(undefined), { enabled: true });
  assert.deepEqual(normalizeAnimationSettings({ enabled: "no" }), { enabled: true });
  assert.deepEqual(normalizeAnimationSettings({ enabled: false }), { enabled: false });
});

test("resolveAnimationsEffective: wyłączenie przez ustawienie, reduced-motion lub env", () => {
  assert.equal(resolveAnimationsEffective({ enabled: true }, false, false), true);
  assert.equal(resolveAnimationsEffective({ enabled: false }, false, false), false);
  assert.equal(resolveAnimationsEffective({ enabled: true }, true, false), false);
  assert.equal(resolveAnimationsEffective({ enabled: true }, false, true), false);
});

test("animationCss: zmienne czasu zależą od stanu", () => {
  assert.ok(animationCss(true).includes("--mb-dur:160ms"));
  assert.ok(animationCss(true).includes("--mb-dur-slow:240ms"));
  assert.ok(animationCss(false).startsWith(":root{--mb-dur:0ms"));
  assert.ok(animationCss(true).includes("prefers-reduced-motion"));
});
