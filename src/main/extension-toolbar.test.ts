import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_TOOLBAR_INFO, extensionRunBlock, isExtensionId, normalizeToolbarInfo, pinnedActionsCss } from "./extension-toolbar.js";

const A = "a".repeat(32);
const B = "b".repeat(32);

test("extension ids are 32 letters a-p", () => {
  assert.equal(isExtensionId(A), true);
  assert.equal(isExtensionId("a".repeat(31)), false);
  assert.equal(isExtensionId("z".repeat(32)), false);
  assert.equal(isExtensionId(`${A}"]{}`), false);
  assert.equal(isExtensionId(42), false);
});

test("pinned CSS hides every button except the pinned ones", () => {
  assert.equal(pinnedActionsCss([]), ".action { display: none !important; }");
  assert.equal(pinnedActionsCss([A, B]), `.action:not([id="${A}"]):not([id="${B}"]) { display: none !important; }`);
});

test("pinned CSS never lets a malformed id into the selector", () => {
  assert.equal(pinnedActionsCss([`x"] { color: red } .a[id="`]), ".action { display: none !important; }");
});

test("toolbar info normalization keeps only valid data", () => {
  assert.deepEqual(normalizeToolbarInfo(undefined), EMPTY_TOOLBAR_INFO);
  assert.deepEqual(normalizeToolbarInfo({ privatePartition: "persist:x", pinnedIds: [A, A, "bad", 3], hasActions: true }), {
    privatePartition: "persist:x", pinnedIds: [A], hasActions: true,
  });
  assert.deepEqual(normalizeToolbarInfo({ privatePartition: "", pinnedIds: "nope", hasActions: "yes" }), EMPTY_TOOLBAR_INFO);
});

test("extensionRunBlock: internal pages block running but the decision never involves pinning", () => {
  const web = { internal: false, isPrivate: false, hasLiveView: true };
  assert.equal(extensionRunBlock(web, false, false), null);
  assert.equal(extensionRunBlock({ ...web, internal: true }, true, true), "no-page");
  assert.equal(extensionRunBlock({ ...web, hasLiveView: false }, true, true), "no-page");
  assert.equal(extensionRunBlock(null, true, true), "no-page");
  assert.equal(extensionRunBlock({ ...web, isPrivate: true }, true, true), null);
  assert.equal(extensionRunBlock({ ...web, isPrivate: true }, false, true), "private");
  assert.equal(extensionRunBlock({ ...web, isPrivate: true }, true, false), "private");
});
