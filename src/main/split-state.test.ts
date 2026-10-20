import assert from "node:assert/strict";
import test from "node:test";
import { createSplitRegistry } from "./split-state.js";

test("create registers a group and exposes partner and side", () => {
  const registry = createSplitRegistry();
  const group = registry.create(1, 2, 0.4)!;
  assert.equal(group.ratio, 0.4);
  assert.equal(registry.partnerOf(1), 2);
  assert.equal(registry.partnerOf(2), 1);
  assert.equal(registry.partnerOf(3), null);
  assert.equal(registry.sideOf(group, 1), "left");
  assert.equal(registry.sideOf(group, 2), "right");
  assert.equal(registry.sideOf(group, 3), null);
});

test("a tab belongs to at most one group", () => {
  const registry = createSplitRegistry();
  registry.create(1, 2);
  registry.create(2, 3);
  assert.equal(registry.groupOf(1), null);
  assert.equal(registry.partnerOf(2), 3);
  assert.equal(registry.groups().length, 1);
});

test("invalid groups are rejected", () => {
  const registry = createSplitRegistry();
  assert.equal(registry.create(1, 1), null);
  assert.equal(registry.create(1, 1.5), null);
  assert.equal(registry.groups().length, 0);
});

test("setRatio clamps and dissolve removes the group", () => {
  const registry = createSplitRegistry();
  const group = registry.create(1, 2)!;
  assert.equal(registry.setRatio(group.id, 5)!.ratio, 0.85);
  assert.equal(registry.setRatio(999, 0.5), null);
  assert.equal(registry.dissolve(2)!.id, group.id);
  assert.equal(registry.dissolve(2), null);
  assert.equal(registry.groupOf(1), null);
});

test("groups remember their workspace and can be dissolved per workspace", () => {
  const registry = createSplitRegistry();
  assert.equal(registry.create(1, 2)!.workspaceId, "main");
  registry.create(3, 4, 0.5, "ws-1");
  registry.create(5, 6, 0.5, "ws-1");
  const removed = registry.dissolveWorkspace("ws-1");
  assert.equal(removed.length, 2);
  assert.deepEqual(registry.groups().map((group) => group.workspaceId), ["main"]);
  assert.deepEqual(registry.dissolveWorkspace("ws-1"), []);
});
