import assert from "node:assert/strict";
import test from "node:test";
import {
  SPLIT_FRAME_PAD, SPLIT_GAP, clampSplitRatio, computeSplitLayout, dropZoneForPoint, paneBorderRect, ratioFromPointer,
} from "./split-layout.js";

const area = { x: 0, y: 36, width: 1000, height: 600 };

test("computeSplitLayout tiles the area without overlap and leaves the divider gap", () => {
  const layout = computeSplitLayout(area, 0.5);
  assert.equal(layout.left.x, SPLIT_FRAME_PAD);
  assert.equal(layout.left.y, 36 + SPLIT_FRAME_PAD);
  assert.equal(layout.divider.x, layout.left.x + layout.left.width);
  assert.equal(layout.right.x, layout.divider.x + SPLIT_GAP);
  assert.equal(layout.right.x + layout.right.width, area.width - SPLIT_FRAME_PAD);
  assert.equal(layout.left.height, area.height - SPLIT_FRAME_PAD * 2);
  assert.equal(layout.left.width + layout.right.width + SPLIT_GAP, area.width - SPLIT_FRAME_PAD * 2);
});

test("computeSplitLayout honours the ratio", () => {
  const layout = computeSplitLayout(area, 0.3);
  assert.ok(Math.abs(layout.left.width / (layout.left.width + layout.right.width) - 0.3) < 0.01);
});

test("clampSplitRatio rejects garbage and keeps a minimum pane width", () => {
  assert.equal(clampSplitRatio(NaN), 0.5);
  assert.equal(clampSplitRatio("x"), 0.5);
  assert.equal(clampSplitRatio(0), 0.15);
  assert.equal(clampSplitRatio(1), 0.85);
  // narrow window: 220px minimum pane forces a ratio close to 0.5
  const narrow = clampSplitRatio(0.1, 600);
  assert.ok(narrow > 0.15 && narrow <= 0.5);
  const layout = computeSplitLayout({ x: 0, y: 0, width: 600, height: 400 }, 0.05);
  assert.ok(layout.left.width >= 219);
  assert.ok(layout.right.width >= 219);
});

test("ratioFromPointer centers the divider under the pointer", () => {
  const ratio = ratioFromPointer(area, 400);
  const layout = computeSplitLayout(area, ratio);
  const center = layout.divider.x + layout.divider.width / 2;
  assert.ok(Math.abs(center - 400) <= 2);
  assert.equal(ratioFromPointer(area, -500), clampSplitRatio(0, area.width));
  assert.equal(ratioFromPointer(area, 99999), clampSplitRatio(1, area.width));
});

test("dropZoneForPoint reports halves of the area only", () => {
  assert.equal(dropZoneForPoint(area, { x: 100, y: 200 }), "left");
  assert.equal(dropZoneForPoint(area, { x: 900, y: 200 }), "right");
  assert.equal(dropZoneForPoint(area, { x: 500, y: 200 }), "right");
  assert.equal(dropZoneForPoint(area, { x: 100, y: 10 }), null);
  assert.equal(dropZoneForPoint(area, { x: 1000, y: 200 }), null);
});

test("paneBorderRect grows the pane by 2px on each side", () => {
  assert.deepEqual(paneBorderRect({ x: 5, y: 5, width: 10, height: 10 }), { x: 3, y: 3, width: 14, height: 14 });
});
