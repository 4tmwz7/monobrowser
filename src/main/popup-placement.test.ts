import assert from "node:assert/strict";
import test from "node:test";
import { computePopupGeometry, resizePopupBounds } from "./popup-placement.js";

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
