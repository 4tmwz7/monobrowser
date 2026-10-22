import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateStats, dayKeyOf } from "./stats-periods.js";

const c = (n: number) => ({ seconds: n, visits: n, blocked: n, downloads: n, searches: n });
const now = new Date(2026, 9, 22, 12);

test("total returns all-time totals regardless of days", () => {
  assert.deepEqual(aggregateStats(c(100), { [dayKeyOf(now)]: c(1) }, "total", now), c(100));
});

test("today, week and month sum the right days", () => {
  const days = {
    [dayKeyOf(now)]: c(1),
    [dayKeyOf(new Date(2026, 9, 16))]: c(2), // 6 days ago
    [dayKeyOf(new Date(2026, 9, 15))]: c(4), // 7 days ago (outside week)
    [dayKeyOf(new Date(2026, 8, 23))]: c(8), // 29 days ago
    [dayKeyOf(new Date(2026, 8, 22))]: c(16), // 30 days ago (outside month)
  };
  assert.deepEqual(aggregateStats(c(99), days, "today", now), c(1));
  assert.deepEqual(aggregateStats(c(99), days, "week", now), c(3));
  assert.deepEqual(aggregateStats(c(99), days, "month", now), c(15));
});

test("missing days and partial data yield zeros", () => {
  assert.deepEqual(aggregateStats(c(5), { [dayKeyOf(now)]: { visits: 3 } }, "week", now), { seconds: 0, visits: 3, blocked: 0, downloads: 0, searches: 0 });
});
