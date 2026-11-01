import assert from "node:assert/strict";
import test from "node:test";
import { computeAnchoredPopupBounds, computePopupGeometry, resizePopupBounds } from "./popup-placement.js";

const base = { width: 340, preferredHeight: 520, contentWidth: 1200, contentHeight: 800 };

test("legacy anchor point hangs below and shrinks to the room", () => {
  const g = computePopupGeometry({ ...base, anchor: { x: 100, y: 600 } });
  assert.equal(g.bounds.y, 600);
  assert.equal(g.bounds.height, 800 - 600 - 7);
  assert.equal(g.fixedEdge, "top");
});

test("a button at the window bottom opens the popup above it with the bottom edge fixed", () => {
  const rect = { x: 8, y: 750, width: 40, height: 36 };
  const g = computePopupGeometry({ ...base, anchor: { x: 8, y: 786 }, rect, placement: "below" });
  assert.equal(g.fixedEdge, "bottom");
  assert.equal(g.bounds.y + g.bounds.height, 746);
  assert.equal(g.bounds.x, 8);
  assert.equal(g.bounds.height, 520);
  const shrunk = resizePopupBounds(g.bounds, g.fixedEdge, g.edgeY, 300, 800);
  assert.equal(shrunk.bounds.y + shrunk.bounds.height, 746);
  assert.equal(shrunk.bounds.height, 300);
  const huge = resizePopupBounds(g.bounds, g.fixedEdge, g.edgeY, 5000, 800);
  assert.ok(huge.heightLimited);
  assert.ok(huge.bounds.y >= 4);
});

test("a toolbar button with room below keeps the popup below", () => {
  const rect = { x: 900, y: 8, width: 36, height: 36 };
  const g = computePopupGeometry({ ...base, anchor: { x: 900, y: 44 }, rect });
  assert.equal(g.fixedEdge, "top");
  assert.equal(g.bounds.y, 44);
  assert.ok(g.bounds.x + g.bounds.width <= 1200 - 4);
});

test("explicit above flips below when the top has no room", () => {
  const rect = { x: 10, y: 20, width: 36, height: 36 };
  const g = computePopupGeometry({ ...base, anchor: { x: 10, y: 56 }, rect, placement: "above" });
  assert.equal(g.fixedEdge, "top");
  assert.equal(g.bounds.y, 56);
});

test("right placement sits beside the element and stays inside the window", () => {
  const rect = { x: 0, y: 700, width: 220, height: 36 };
  const g = computePopupGeometry({ ...base, anchor: { x: 224, y: 700 }, rect, placement: "right" });
  assert.equal(g.bounds.x, 224);
  assert.ok(g.bounds.y + g.bounds.height <= 800 - 4);
});

test("clampInside keeps context popups inside the window", () => {
  const g = computePopupGeometry({ ...base, preferredHeight: 300, anchor: { x: 1190, y: 790 }, clampInside: true });
  assert.ok(g.bounds.x + g.bounds.width <= 1196);
  assert.ok(g.bounds.y + g.bounds.height <= 796);
});

test("left placement sits beside the element on its left and stays inside the window", () => {
  const rect = { x: 976, y: 700, width: 220, height: 36 };
  const g = computePopupGeometry({ ...base, anchor: { x: 976, y: 700 }, rect, placement: "left" });
  assert.equal(g.bounds.x + g.bounds.width, 976 - 4);
  assert.ok(g.bounds.y + g.bounds.height <= 800 - 4);
});

test("keepClearOf: popups below the native controls are untouched, overlapping ones move down", () => {
  const avoid = { x: 1062, y: 0, width: 138, height: 36 };
  // hamburger menu hanging from the toolbar: already below the controls
  const below = computePopupGeometry({ ...base, anchor: { x: 1160, y: 36 }, rect: { x: 1160, y: 4, width: 28, height: 32 }, avoid });
  assert.equal(below.bounds.y, 36);
  // a context popup clamped near the top-right corner is pushed under them
  const ctx = computePopupGeometry({ ...base, preferredHeight: 300, anchor: { x: 1190, y: 5 }, clampInside: true, avoid });
  assert.equal(ctx.bounds.y, 36);
  assert.equal(ctx.edgeY, 36);
  // left of the controls: nothing to avoid
  const left = computePopupGeometry({ ...base, preferredHeight: 300, anchor: { x: 100, y: 5 }, clampInside: true, avoid });
  assert.equal(left.bounds.y, 5);
  // no avoid area (Linux/macOS): unchanged
  assert.equal(computePopupGeometry({ ...base, preferredHeight: 300, anchor: { x: 1190, y: 5 }, clampInside: true }).bounds.y, 5);
});

test("keepClearOf: a popup hanging from the bottom edge keeps its bottom and gets shorter", () => {
  const avoid = { x: 1062, y: 0, width: 138, height: 36 };
  const rect = { x: 1100, y: 740, width: 36, height: 36 };
  const g = computePopupGeometry({ ...base, preferredHeight: 760, anchor: { x: 1100, y: 776 }, rect, placement: "above", avoid });
  assert.equal(g.fixedEdge, "bottom");
  assert.equal(g.bounds.y + g.bounds.height, 736);
  assert.ok(g.bounds.y >= 36);
  assert.equal(g.minTop, 36);
  const resized = resizePopupBounds(g.bounds, g.fixedEdge, g.edgeY, 5000, 800, g.minTop);
  assert.ok(resized.bounds.y >= 36);
});

test("anchored popup (extension action): under a top-right button, right-aligned, inside the window", () => {
  const anchor = { x: 1840, y: 4, width: 28, height: 28 };
  const b = computeAnchoredPopupBounds({ anchor, alignment: "bottom left", width: 285, height: 375, contentWidth: 1904, contentHeight: 1184 });
  assert.equal(b.y, 4 + 28 + 5);
  assert.equal(b.x + b.width, 1840 + 28);
  assert.ok(b.x > 1500, "must not end up mid-window");
});

test("anchored popup: sidebar button at the bottom opens above it, left-aligned to the button", () => {
  const anchor = { x: 60, y: 1150, width: 28, height: 28 };
  const b = computeAnchoredPopupBounds({ anchor, alignment: "top right", width: 285, height: 375, contentWidth: 1904, contentHeight: 1184 });
  assert.equal(b.x, 60);
  assert.equal(b.y + b.height, 1150 - 5);
});

test("anchored popup: flips when it does not fit, is clamped into the window and avoids the controls", () => {
  // asks for "above" at the top of the window: flips below
  const flipped = computeAnchoredPopupBounds({ anchor: { x: 10, y: 4, width: 28, height: 28 }, alignment: "top right", width: 200, height: 300, contentWidth: 800, contentHeight: 600 });
  assert.equal(flipped.y, 37);
  // hanging off the bottom: clamped
  const clamped = computeAnchoredPopupBounds({ anchor: { x: 10, y: 560, width: 28, height: 28 }, alignment: "bottom left", width: 200, height: 300, contentWidth: 800, contentHeight: 600 });
  assert.ok(clamped.y + clamped.height <= 596);
  // oversized popup shrinks to the window
  const huge = computeAnchoredPopupBounds({ anchor: { x: 10, y: 4, width: 28, height: 28 }, width: 5000, height: 5000, contentWidth: 800, contentHeight: 600 });
  assert.ok(huge.width <= 792 && huge.height <= 592);
  // Windows: never under the native controls
  const clear = computeAnchoredPopupBounds({ anchor: { x: 1860, y: 0, width: 28, height: 4 }, alignment: "top right", width: 200, height: 300, contentWidth: 1904, contentHeight: 800, avoid: { x: 1766, y: 0, width: 138, height: 36 } });
  assert.ok(clear.y >= 36);
});
