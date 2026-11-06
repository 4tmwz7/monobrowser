import assert from "node:assert/strict";
import test from "node:test";
import { REOPEN_GUARD_MS, shouldIgnoreReopen } from "./popup-toggle.js";

test("a re-open right after a blur-dismissal of the same extension is ignored", () => {
  assert.equal(shouldIgnoreReopen({ extensionId: "a", at: 1000 }, "a", 1000), true);
  assert.equal(shouldIgnoreReopen({ extensionId: "a", at: 1000 }, "a", 1000 + REOPEN_GUARD_MS - 1), true);
});

test("a re-open after the guard window, of another extension, or without a recent dismissal is allowed", () => {
  assert.equal(shouldIgnoreReopen({ extensionId: "a", at: 1000 }, "a", 1000 + REOPEN_GUARD_MS), false);
  assert.equal(shouldIgnoreReopen({ extensionId: "a", at: 1000 }, "b", 1100), false);
  assert.equal(shouldIgnoreReopen(null, "a", 1100), false);
});

test("a clock that went backwards does not block opening", () => {
  assert.equal(shouldIgnoreReopen({ extensionId: "a", at: 5000 }, "a", 4000), false);
});
