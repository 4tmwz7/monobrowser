import assert from "node:assert/strict";
import test from "node:test";
import { isToolbarActionId, normalizeToolbarPins, PINNABLE_TOOLBAR_ACTIONS, setToolbarPinned } from "./toolbar-pins.js";

test("normalizeToolbarPins returns an empty list for invalid input", () => {
  assert.deepEqual(normalizeToolbarPins(null), []);
  assert.deepEqual(normalizeToolbarPins(undefined), []);
  assert.deepEqual(normalizeToolbarPins("notes"), []);
  assert.deepEqual(normalizeToolbarPins({ pinned: "notes" }), []);
  assert.deepEqual(normalizeToolbarPins(42), []);
});

test("normalizeToolbarPins accepts arrays and { pinned } objects, dropping unknown and duplicate ids", () => {
  assert.deepEqual(normalizeToolbarPins(["notes", "history"]), ["notes", "history"]);
  assert.deepEqual(normalizeToolbarPins({ pinned: ["downloads", "bogus", 7, "downloads", "settings"] }), ["downloads"], "settings is no longer pinnable (the toolbar has its own button)");
  assert.deepEqual(normalizeToolbarPins(["__proto__", "constructor", "toString"]), []);
});

test("every pinnable action id is recognized", () => {
  for (const id of PINNABLE_TOOLBAR_ACTIONS) assert.equal(isToolbarActionId(id), true);
  assert.equal(isToolbarActionId("about"), false);
  assert.equal(isToolbarActionId(null), false);
});

test("setToolbarPinned appends new pins, removes unpinned ones and ignores unknown ids", () => {
  assert.deepEqual(setToolbarPinned(["notes"], "history", true), ["notes", "history"]);
  assert.deepEqual(setToolbarPinned(["notes", "history"], "notes", true), ["history", "notes"]);
  assert.deepEqual(setToolbarPinned(["notes", "history"], "notes", false), ["history"]);
  assert.deepEqual(setToolbarPinned(["notes"], "bogus", true), ["notes"]);
  assert.deepEqual(setToolbarPinned(["notes"], 5, false), ["notes"]);
});
