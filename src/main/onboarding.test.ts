import assert from "node:assert/strict";
import test from "node:test";
import {
  ONBOARDING_STEPS, clampStep, isLastStep, nextStep, normalizeOnboardingFlag, onboardingKeyAction, prevStep, shouldAutoShowOnboarding,
} from "./onboarding.js";

test("steps are ordered welcome..done", () => {
  assert.deepEqual([...ONBOARDING_STEPS], ["welcome", "look", "layout", "privacy", "done"]);
});

test("next/prev stay within bounds", () => {
  const n = ONBOARDING_STEPS.length;
  assert.equal(nextStep(0, n), 1);
  assert.equal(nextStep(n - 1, n), n - 1);
  assert.equal(prevStep(0), 0);
  assert.equal(prevStep(3), 2);
  assert.equal(isLastStep(n - 1, n), true);
  assert.equal(isLastStep(0, n), false);
});

test("clampStep sanitizes untrusted input", () => {
  assert.equal(clampStep(2), 2);
  assert.equal(clampStep(99), ONBOARDING_STEPS.length - 1);
  assert.equal(clampStep(-4), 0);
  assert.equal(clampStep("x"), 0);
  assert.equal(clampStep(NaN), 0);
});

test("key actions: Enter next, Escape skip, buttons keep Enter", () => {
  assert.equal(onboardingKeyAction("Enter", "BODY"), "next");
  assert.equal(onboardingKeyAction("Enter", "INPUT"), "next");
  assert.equal(onboardingKeyAction("Enter", "BUTTON"), null);
  assert.equal(onboardingKeyAction("Escape", "BUTTON"), "skip");
  assert.equal(onboardingKeyAction("a", "BODY"), null);
});

test("flag normalization", () => {
  assert.deepEqual(normalizeOnboardingFlag({ done: true }), { done: true });
  assert.equal(normalizeOnboardingFlag({ done: "yes" }), null);
  assert.equal(normalizeOnboardingFlag(null), null);
});

test("auto show only on a pristine profile", () => {
  assert.equal(shouldAutoShowOnboarding({ flag: null, existingFiles: [], skipEnv: false }), true);
  assert.equal(shouldAutoShowOnboarding({ flag: null, existingFiles: ["Cache", "Cookies"], skipEnv: false }), true);
  assert.equal(shouldAutoShowOnboarding({ flag: null, existingFiles: ["language.json"], skipEnv: false }), false);
  assert.equal(shouldAutoShowOnboarding({ flag: { done: true }, existingFiles: [], skipEnv: false }), false);
  assert.equal(shouldAutoShowOnboarding({ flag: { done: false }, existingFiles: [], skipEnv: false }), true);
  assert.equal(shouldAutoShowOnboarding({ flag: null, existingFiles: [], skipEnv: true }), false);
});

test("onboarding page carries the reworded reopen hint and the Glance tip follows the Glance choice", async () => {
  const { renderOnboardingPageHtml } = await import("./onboarding-page.js");
  const html = renderOnboardingPageHtml({ language: "pl", step: 4, presets: [], defaultColors: {} });
  assert.match(html, /Ekran powitalny możesz otworzyć ponownie z palety poleceń \(Ctrl\+K\)\./);
  assert.match(html, /glanceView\.sync/);
});
