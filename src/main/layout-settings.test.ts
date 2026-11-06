import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_LAYOUT_SETTINGS, mergeLayoutSettings, normalizeLayoutSettings } from "./layout-settings.js";

test("normalizeLayoutSettings falls back to defaults for invalid input", () => {
  assert.deepEqual(normalizeLayoutSettings(null), DEFAULT_LAYOUT_SETTINGS);
  assert.deepEqual(normalizeLayoutSettings({ tabBarLayout: "diagonal", verticalTabBarWidth: "wide" }), DEFAULT_LAYOUT_SETTINGS);
});

test("normalizeLayoutSettings clamps the vertical bar width", () => {
  assert.equal(normalizeLayoutSettings({ verticalTabBarWidth: 50 }).verticalTabBarWidth, 180);
  assert.equal(normalizeLayoutSettings({ verticalTabBarWidth: 9000 }).verticalTabBarWidth, 400);
  assert.equal(normalizeLayoutSettings({ verticalTabBarWidth: 300.4 }).verticalTabBarWidth, 300);
});

test("mergeLayoutSettings applies partial patches", () => {
  const current = { tabBarLayout: "vertical" as const, verticalTabBarWidth: 260, verticalTabBarCollapsed: false, verticalTabBarSide: "left" as const, compactMode: false, hideWindowControls: true };
  assert.deepEqual(mergeLayoutSettings(current, { verticalTabBarCollapsed: true }), { ...current, verticalTabBarCollapsed: true });
  assert.equal(mergeLayoutSettings(current, { tabBarLayout: "horizontal" }).tabBarLayout, "horizontal");
});

test("compactMode defaults to off, is persisted as boolean only", () => {
  assert.equal(DEFAULT_LAYOUT_SETTINGS.compactMode, false);
  assert.equal(normalizeLayoutSettings({ compactMode: true }).compactMode, true);
  assert.equal(normalizeLayoutSettings({ compactMode: "yes" }).compactMode, false);
  const current = { ...DEFAULT_LAYOUT_SETTINGS, compactMode: true };
  assert.equal(mergeLayoutSettings(current, { tabBarLayout: "vertical" }).compactMode, true);
  assert.equal(mergeLayoutSettings(current, { compactMode: false }).compactMode, false);
});

test("verticalTabBarSide defaults to left and only accepts left or right", () => {
  assert.equal(DEFAULT_LAYOUT_SETTINGS.verticalTabBarSide, "left");
  assert.equal(normalizeLayoutSettings({ verticalTabBarSide: "right" }).verticalTabBarSide, "right");
  assert.equal(normalizeLayoutSettings({ verticalTabBarSide: "top" }).verticalTabBarSide, "left");
  const current = { ...DEFAULT_LAYOUT_SETTINGS, verticalTabBarSide: "right" as const };
  assert.equal(mergeLayoutSettings(current, { verticalTabBarSide: 3 }).verticalTabBarSide, "right");
  assert.equal(mergeLayoutSettings(current, { tabBarLayout: "vertical" }).verticalTabBarSide, "right");
  assert.equal(mergeLayoutSettings(current, { verticalTabBarSide: "left" }).verticalTabBarSide, "left");
});

test("hideWindowControls defaults to on, is persisted as boolean only", () => {
  assert.equal(DEFAULT_LAYOUT_SETTINGS.hideWindowControls, true);
  assert.equal(normalizeLayoutSettings({}).hideWindowControls, true);
  assert.equal(normalizeLayoutSettings({ hideWindowControls: false }).hideWindowControls, false);
  assert.equal(normalizeLayoutSettings({ hideWindowControls: "no" }).hideWindowControls, true);
  assert.equal(normalizeLayoutSettings({ hideWindowControls: 0 }).hideWindowControls, true);
  const off = { ...DEFAULT_LAYOUT_SETTINGS, hideWindowControls: false };
  assert.equal(mergeLayoutSettings(off, { tabBarLayout: "vertical" }).hideWindowControls, false);
  assert.equal(mergeLayoutSettings(off, { hideWindowControls: "yes" }).hideWindowControls, false);
  assert.equal(mergeLayoutSettings(off, { hideWindowControls: true }).hideWindowControls, true);
});
