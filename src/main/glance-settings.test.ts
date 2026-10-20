import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GLANCE_SETTINGS, mergeGlanceSettings, normalizeGlanceSettings } from "./glance-settings.js";
import { buildGlanceTriggerScript, GLANCE_MESSAGE_PREFIX, parseGlanceMessage } from "./glance-trigger.js";

test("normalizeGlanceSettings falls back to defaults for invalid input", () => {
  assert.deepEqual(normalizeGlanceSettings(null), DEFAULT_GLANCE_SETTINGS);
  assert.deepEqual(normalizeGlanceSettings("alt"), DEFAULT_GLANCE_SETTINGS);
  assert.deepEqual(normalizeGlanceSettings({ enabled: "yes", trigger: "meta" }), DEFAULT_GLANCE_SETTINGS);
});

test("normalizeGlanceSettings keeps valid values", () => {
  assert.deepEqual(normalizeGlanceSettings({ enabled: false, trigger: "longpress" }), { enabled: false, trigger: "longpress" });
  assert.equal(normalizeGlanceSettings({ trigger: "ctrl" }).trigger, "ctrl");
  assert.equal(normalizeGlanceSettings({ trigger: "shift" }).trigger, "shift");
});

test("mergeGlanceSettings applies partial patches and ignores invalid fields", () => {
  const current = { enabled: true, trigger: "shift" as const };
  assert.deepEqual(mergeGlanceSettings(current, { enabled: false }), { enabled: false, trigger: "shift" });
  assert.deepEqual(mergeGlanceSettings(current, { trigger: "bogus" }), current);
  assert.deepEqual(mergeGlanceSettings(current, undefined), current);
});

test("parseGlanceMessage accepts only the right nonce and http(s) URLs", () => {
  const nonce = "abc123";
  assert.equal(parseGlanceMessage(`${GLANCE_MESSAGE_PREFIX}${nonce}:https://example.com/a?b=1:2`, nonce), "https://example.com/a?b=1:2");
  assert.equal(parseGlanceMessage(`${GLANCE_MESSAGE_PREFIX}other:https://example.com/`, nonce), null);
  assert.equal(parseGlanceMessage(`${GLANCE_MESSAGE_PREFIX}${nonce}:javascript:alert(1)`, nonce), null);
  assert.equal(parseGlanceMessage(`${GLANCE_MESSAGE_PREFIX}${nonce}:file:///etc/passwd`, nonce), null);
  assert.equal(parseGlanceMessage("hello", nonce), null);
  assert.equal(parseGlanceMessage(`${GLANCE_MESSAGE_PREFIX}${nonce}:https://example.com/${"a".repeat(5000)}`, nonce), null);
});

test("buildGlanceTriggerScript embeds the nonce and settings as data", () => {
  const script = buildGlanceTriggerScript("n0nce", { enabled: true, trigger: "ctrl" });
  assert.ok(script.includes("n0nce"));
  assert.ok(script.includes('"trigger":"ctrl"'));
  assert.doesNotThrow(() => new Function(script));
});
