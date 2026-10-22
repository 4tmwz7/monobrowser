import { strict as assert } from "node:assert";
import { test } from "node:test";
import { DEFAULT_SETTINGS_TAB, normalizeSettingsTab, SETTINGS_TABS } from "./settings-tabs.js";

test("known settings tabs are kept", () => {
  for (const tab of SETTINGS_TABS) assert.equal(normalizeSettingsTab(tab), tab);
});

test("unknown or non-string values fall back to the first tab", () => {
  for (const value of ["", "nope", "__proto__", null, undefined, 3, {}]) assert.equal(normalizeSettingsTab(value), DEFAULT_SETTINGS_TAB);
});
