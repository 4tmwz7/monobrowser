import test from "node:test";
import assert from "node:assert/strict";
import { createOverlayTracker } from "./shell-overlay.js";

test("overlay tracker reports only real state flips", () => {
  const events: boolean[] = [];
  const tracker = createOverlayTracker<object>((open) => events.push(open));
  const a = {};
  const b = {};
  tracker.addView(a);
  tracker.addView(a); // raised again: no change
  tracker.addView(b);
  assert.deepEqual(events, [true]);
  tracker.removeView(a);
  assert.equal(tracker.isOpen(), true);
  tracker.removeView(b);
  tracker.removeView(b);
  assert.deepEqual(events, [true, false]);
  assert.equal(tracker.isOpen(), false);
});

test("overlay tracker combines views and named flags", () => {
  const events: boolean[] = [];
  const tracker = createOverlayTracker<object>((open) => events.push(open));
  const v = {};
  tracker.setFlag("popup", true);
  tracker.addView(v);
  tracker.setFlag("popup", false);
  assert.equal(tracker.isOpen(), true);
  tracker.removeView(v);
  tracker.setFlag("ext", true);
  tracker.setFlag("ext", false);
  assert.deepEqual(events, [true, false, true, false]);
});
