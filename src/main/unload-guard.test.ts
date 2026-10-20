import assert from "node:assert/strict";
import test from "node:test";
import { createIntentStore, createLeaveGate, INTENT_TTL_MS } from "./unload-guard.js";

test("intent store returns a fresh intent exactly once", () => {
  let now = 1000;
  const store = createIntentStore(() => now);
  store.set({ kind: "load", url: "https://a.test/" });
  assert.deepEqual(store.take(), { kind: "load", url: "https://a.test/" });
  assert.equal(store.take(), null);
});

test("intent store drops stale intents and keeps only the latest", () => {
  let now = 0;
  const store = createIntentStore(() => now);
  store.set({ kind: "reload", ignoreCache: false });
  now += INTENT_TTL_MS + 1;
  assert.equal(store.take(), null);
  store.set({ kind: "back" });
  store.set({ kind: "close" });
  assert.deepEqual(store.take(), { kind: "close" });
  store.set({ kind: "forward" });
  store.clear();
  assert.equal(store.take(), null);
});

test("leave gate lets exactly one unload through while armed", () => {
  let now = 0;
  const gate = createLeaveGate(() => now);
  assert.equal(gate.consume(), false);
  gate.arm(1000);
  assert.equal(gate.isArmed(), true);
  assert.equal(gate.consume(), true);
  assert.equal(gate.consume(), false);
  gate.arm(1000);
  now += 1001;
  assert.equal(gate.consume(), false);
  gate.arm(1000);
  gate.disarm();
  assert.equal(gate.consume(), false);
});
