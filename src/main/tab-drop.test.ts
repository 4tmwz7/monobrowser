import assert from "node:assert/strict";
import test from "node:test";
import { applyTabMove, nearestTabDrop, planTabMove, rectContainsPoint, trustedDragEndPoint, type DropButton } from "./tab-drop.js";

// A row of four 100px tabs with 2px gaps: ids 1..4.
const row: DropButton[] = [1, 2, 3, 4].map((id, i) => ({ id, rect: { left: i * 102, top: 0, right: i * 102 + 100, bottom: 36 } }));
const column: DropButton[] = [1, 2, 3, 4].map((id, i) => ({ id, rect: { left: 0, top: i * 32, right: 200, bottom: i * 32 + 30 } }));

test("nearestTabDrop picks the tab under the pointer and the side of it", () => {
  assert.deepEqual(nearestTabDrop(row, { x: 110, y: 10 }, false), { tabId: 2, before: true });
  assert.deepEqual(nearestTabDrop(row, { x: 190, y: 10 }, false), { tabId: 2, before: false });
  assert.deepEqual(nearestTabDrop(column, { x: 50, y: 40 }, true), { tabId: 2, before: true });
  assert.deepEqual(nearestTabDrop(column, { x: 50, y: 60 }, true), { tabId: 2, before: false });
});

test("nearestTabDrop falls back to the nearest tab outside every button (gaps, empty strip)", () => {
  assert.deepEqual(nearestTabDrop(row, { x: 101, y: 10 }, false), { tabId: 1, before: false });
  assert.deepEqual(nearestTabDrop(row, { x: 900, y: 10 }, false), { tabId: 4, before: false });
  assert.deepEqual(nearestTabDrop(row, { x: -50, y: 10 }, false), { tabId: 1, before: true });
  assert.equal(nearestTabDrop([], { x: 0, y: 0 }, false), null);
});

test("moving a tab to the right and to the left both reorder (symmetry)", () => {
  const group = [1, 2, 3, 4];
  // right: tab 1 dropped on the right half of tab 3 -> in front of 4
  const right = planTabMove(group, 1, { tabId: 3, before: false });
  assert.deepEqual(right, { beforeId: 4 });
  assert.deepEqual(applyTabMove(group, 1, right!.beforeId), [2, 3, 1, 4]);
  // left: tab 4 dropped on the left half of tab 2 -> in front of 2
  const left = planTabMove(group, 4, { tabId: 2, before: true });
  assert.deepEqual(left, { beforeId: 2 });
  assert.deepEqual(applyTabMove(group, 4, left!.beforeId), [1, 4, 2, 3]);
  // left by one: tab 3 on the left half of tab 2
  assert.deepEqual(applyTabMove(group, 3, planTabMove(group, 3, { tabId: 2, before: true })!.beforeId), [1, 3, 2, 4]);
  // left, after the previous tab: tab 3 on the right half of tab 1 -> same result
  assert.deepEqual(applyTabMove(group, 3, planTabMove(group, 3, { tabId: 1, before: false })!.beforeId), [1, 3, 2, 4]);
  // to the very end / very start
  assert.deepEqual(applyTabMove(group, 1, planTabMove(group, 1, { tabId: 4, before: false })!.beforeId), [2, 3, 4, 1]);
  assert.deepEqual(applyTabMove(group, 4, planTabMove(group, 4, { tabId: 1, before: true })!.beforeId), [4, 1, 2, 3]);
});

test("planTabMove ignores drops that change nothing", () => {
  const group = [1, 2, 3];
  assert.equal(planTabMove(group, 2, { tabId: 2, before: true }), undefined);
  assert.equal(planTabMove(group, 2, { tabId: 1, before: false }), undefined); // right behind where it already is
  assert.equal(planTabMove(group, 2, { tabId: 3, before: true }), undefined); // right in front of its successor
  assert.equal(planTabMove(group, 2, null), undefined);
  assert.equal(planTabMove(group, 9, { tabId: 1, before: true }), undefined);
  assert.equal(planTabMove(group, 2, { tabId: 9, before: true }), undefined);
});

test("dragend coordinates of 0,0 are not trusted", () => {
  assert.equal(trustedDragEndPoint({ clientX: 0, clientY: 0, screenX: 0, screenY: 0 }), null);
  assert.deepEqual(trustedDragEndPoint({ clientX: 120, clientY: 14, screenX: 500, screenY: 300 }), { x: 120, y: 14 });
  assert.deepEqual(trustedDragEndPoint({ clientX: 0, clientY: 14, screenX: 0, screenY: 14 }), { x: 0, y: 14 });
});

test("rectContainsPoint", () => {
  const rect = { left: 0, top: 0, right: 10, bottom: 10 };
  assert.equal(rectContainsPoint(rect, { x: 5, y: 5 }), true);
  assert.equal(rectContainsPoint(rect, { x: 11, y: 5 }), false);
});
