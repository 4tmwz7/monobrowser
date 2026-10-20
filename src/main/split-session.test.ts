import assert from "node:assert/strict";
import test from "node:test";
import { buildStoredSplits, matchStoredSplits, normalizeStoredSplits } from "./split-session.js";

const tab = (id: number, url: string, extra: Partial<{ isPrivate: boolean; internal: boolean }> = {}) =>
  ({ id, url, isPrivate: false, internal: false, ...extra });

test("buildStoredSplits skips private, internal and unrestorable tabs", () => {
  const tabs = [
    tab(1, "https://a.test/"), tab(2, "https://b.test/"), tab(3, "https://p.test/", { isPrivate: true }),
    tab(4, "monobrowser://settings", { internal: true }), tab(5, "data:text/html,x"),
  ];
  const stored = buildStoredSplits([
    { left: 1, right: 2, ratio: 0.3 }, { left: 1, right: 3, ratio: 0.5 }, { left: 2, right: 4, ratio: 0.5 },
    { left: 2, right: 5, ratio: 0.5 }, { left: 9, right: 1, ratio: 0.5 },
  ], tabs);
  assert.deepEqual(stored, [{ leftUrl: "https://a.test/", rightUrl: "https://b.test/", ratio: 0.3, workspaceId: "main" }]);
});

test("normalizeStoredSplits sanitizes untrusted input", () => {
  assert.deepEqual(normalizeStoredSplits(null), []);
  assert.deepEqual(normalizeStoredSplits("x"), []);
  const out = normalizeStoredSplits([
    { leftUrl: "https://a.test/", rightUrl: "https://b.test/", ratio: 7 },
    { leftUrl: "javascript:x", rightUrl: "https://b.test/" },
    "junk",
  ]);
  assert.deepEqual(out, [{ leftUrl: "https://a.test/", rightUrl: "https://b.test/", ratio: 0.85, workspaceId: "main" }]);
});

test("matchStoredSplits pairs restored tabs by URL, each tab once", () => {
  const stored = [
    { leftUrl: "https://a.test/", rightUrl: "https://b.test/", ratio: 0.4, workspaceId: "main" },
    { leftUrl: "https://a.test/", rightUrl: "https://gone.test/", ratio: 0.5, workspaceId: "main" },
    { leftUrl: "https://c.test/", rightUrl: "https://a.test/", ratio: 0.6, workspaceId: "main" },
  ];
  const restored = [{ id: 10, url: "https://a.test/" }, { id: 11, url: "https://b.test/" }, { id: 12, url: "https://c.test/" }, { id: 13, url: "https://a.test/" }];
  assert.deepEqual(matchStoredSplits(stored, restored), [
    { left: 10, right: 11, ratio: 0.4, workspaceId: "main" },
    { left: 12, right: 13, ratio: 0.6, workspaceId: "main" },
  ]);
});

test("splits keep their workspace and only match tabs of that workspace", () => {
  const stored = normalizeStoredSplits([
    { leftUrl: "https://a.test/", rightUrl: "https://b.test/", workspaceId: "ws-1" },
    { leftUrl: "https://a.test/", rightUrl: "https://b.test/" },
  ]);
  assert.deepEqual(stored.map((entry) => entry.workspaceId), ["ws-1", "main"]);
  const restored = [
    { id: 1, url: "https://a.test/", workspaceId: "main" }, { id: 2, url: "https://b.test/", workspaceId: "main" },
    { id: 3, url: "https://a.test/", workspaceId: "ws-1" }, { id: 4, url: "https://b.test/", workspaceId: "ws-1" },
  ];
  assert.deepEqual(matchStoredSplits(stored, restored), [
    { left: 3, right: 4, ratio: 0.5, workspaceId: "ws-1" },
    { left: 1, right: 2, ratio: 0.5, workspaceId: "main" },
  ]);
  assert.deepEqual(matchStoredSplits([stored[0]], restored.slice(0, 2)), []);
  const built = buildStoredSplits([{ left: 3, right: 4, ratio: 0.5, workspaceId: "ws-1" }], restored.map((t) => ({ id: t.id, url: t.url, isPrivate: false, internal: false })));
  assert.equal(built[0].workspaceId, "ws-1");
});
