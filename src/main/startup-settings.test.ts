import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_STARTUP_SETTINGS, normalizeStartupSettings } from "./startup-settings.js";

test("normalizeStartupSettings defaults to restoring the session", () => {
  assert.deepEqual(normalizeStartupSettings(undefined), DEFAULT_STARTUP_SETTINGS);
  assert.deepEqual(normalizeStartupSettings({ startupMode: "bogus" }), DEFAULT_STARTUP_SETTINGS);
  assert.equal(DEFAULT_STARTUP_SETTINGS.startupMode, "restore");
});

test("normalizeStartupSettings keeps valid modes", () => {
  assert.equal(normalizeStartupSettings({ startupMode: "newtab" }).startupMode, "newtab");
  assert.equal(normalizeStartupSettings({ startupMode: "restore" }).startupMode, "restore");
});
