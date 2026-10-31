import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPACT_HIDE_DELAY_MS, COMPACT_HOT_ZONE, HORIZONTAL_CHROME_HEIGHT, INITIAL_COMPACT_STATE, chromeOverlayRect, hotStripRect,
  sidebarWidthFor, stepCompact, type CompactGeometry,
} from "./compact-layout.js";

const horizontal: CompactGeometry = { kind: "horizontal", contentWidth: 1200, contentHeight: 800, sidebarWidth: 240 };
const vertical: CompactGeometry = { kind: "vertical", contentWidth: 1200, contentHeight: 800, sidebarWidth: 240 };

test("chromeOverlayRect covers the toolbar row or the sidebar", () => {
  assert.deepEqual(chromeOverlayRect(horizontal), { x: 0, y: 0, width: 1200, height: HORIZONTAL_CHROME_HEIGHT });
  assert.deepEqual(chromeOverlayRect(vertical), { x: 0, y: 0, width: 240, height: 800 });
  assert.equal(sidebarWidthFor({ verticalTabBarWidth: 300, verticalTabBarCollapsed: true }), 52);
  assert.equal(sidebarWidthFor({ verticalTabBarWidth: 300, verticalTabBarCollapsed: false }), 300);
});

test("hotStripRect is a thin strip at the top (horizontal) or left (vertical) edge", () => {
  assert.deepEqual(hotStripRect(horizontal), { x: 0, y: 0, width: 1200, height: COMPACT_HOT_ZONE });
  assert.deepEqual(hotStripRect(vertical), { x: 0, y: 0, width: COMPACT_HOT_ZONE, height: 800 });
  assert.equal(hotStripRect({ ...horizontal, contentHeight: 2 }).height, 2);
});

test("stepCompact reveals on the hot strip, hides after the delay and keeps open on demand", () => {
  let state = INITIAL_COMPACT_STATE;
  state = stepCompact(state, { hot: false, inside: true, keepOpen: false, now: 0 });
  assert.equal(state.revealed, false, "inside without being revealed does nothing");
  state = stepCompact(state, { hot: true, inside: false, keepOpen: false, now: 10 });
  assert.deepEqual(state, { revealed: true, hideAt: null });
  state = stepCompact(state, { hot: false, inside: true, keepOpen: false, now: 20 });
  assert.deepEqual(state, { revealed: true, hideAt: null });
  // pointer leaves: the delay starts, not hidden yet
  state = stepCompact(state, { hot: false, inside: false, keepOpen: false, now: 100 });
  assert.deepEqual(state, { revealed: true, hideAt: 100 + COMPACT_HIDE_DELAY_MS });
  state = stepCompact(state, { hot: false, inside: false, keepOpen: false, now: 400 });
  assert.equal(state.revealed, true);
  // returns before the deadline: delay cancelled
  state = stepCompact(state, { hot: false, inside: true, keepOpen: false, now: 450 });
  assert.deepEqual(state, { revealed: true, hideAt: null });
  state = stepCompact(state, { hot: false, inside: false, keepOpen: false, now: 500 });
  state = stepCompact(state, { hot: false, inside: false, keepOpen: false, now: 500 + COMPACT_HIDE_DELAY_MS });
  assert.deepEqual(state, INITIAL_COMPACT_STATE);
  // keepOpen forces a reveal and prevents hiding
  state = stepCompact(state, { hot: false, inside: false, keepOpen: true, now: 1000 });
  assert.deepEqual(state, { revealed: true, hideAt: null });
  state = stepCompact(state, { hot: false, inside: false, keepOpen: true, now: 9000 });
  assert.equal(state.revealed, true);
  // keepOpen released: the hide delay starts from then
  state = stepCompact(state, { hot: false, inside: false, keepOpen: false, now: 9100 });
  assert.equal(state.hideAt, 9100 + COMPACT_HIDE_DELAY_MS);
});

test("a right-hand sidebar puts the overlay and hot strip on the right edge", () => {
  const right: CompactGeometry = { ...vertical, side: "right" };
  assert.deepEqual(chromeOverlayRect(right), { x: 960, y: 0, width: 240, height: 800 });
  assert.deepEqual(hotStripRect(right), { x: 1200 - COMPACT_HOT_ZONE, y: 0, width: COMPACT_HOT_ZONE, height: 800 });
  assert.deepEqual(chromeOverlayRect({ ...right, side: "left" }), chromeOverlayRect(vertical));
  assert.deepEqual(chromeOverlayRect({ ...right, sidebarWidth: 5000 }), { x: 0, y: 0, width: 1200, height: 800 });
});
