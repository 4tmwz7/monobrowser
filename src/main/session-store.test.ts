import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionData, isRestorableUrl, normalizeSessionData, pushClosedTab } from "./session-store.js";

test("isRestorableUrl accepts web, file and start page only", () => {
  assert.equal(isRestorableUrl("https://example.com/a"), true);
  assert.equal(isRestorableUrl("file:///tmp/a.html"), true);
  assert.equal(isRestorableUrl("monobrowser://new-tab"), true);
  assert.equal(isRestorableUrl("data:text/html,x"), false);
  assert.equal(isRestorableUrl("monobrowser://settings"), false);
  assert.equal(isRestorableUrl(""), false);
  assert.equal(isRestorableUrl(42), false);
});

test("buildSessionData skips private and internal tabs and tracks the active index", () => {
  const data = buildSessionData([
    { id: 1, url: "https://a.test/", title: "A", isPinned: true, isMuted: false, isPrivate: false, internal: false },
    { id: 2, url: "https://secret.test/", title: "S", isPinned: false, isMuted: false, isPrivate: true, internal: false },
    { id: 3, url: "monobrowser://settings", title: "Settings", isPinned: false, isMuted: false, isPrivate: false, internal: true },
    { id: 4, url: "https://b.test/", title: "B", isPinned: false, isMuted: true, isPrivate: false, internal: false },
  ], 4, [{ url: "https://c.test/", title: "C", pinned: false }]);
  assert.deepEqual(data.tabs.map((tab) => tab.url), ["https://a.test/", "https://b.test/"]);
  assert.equal(data.activeIndex, 1);
  assert.equal(data.tabs[1].muted, true);
  assert.equal(data.recentlyClosed.length, 1);
});

test("buildSessionData falls back to the first tab when the active tab is not persisted", () => {
  const data = buildSessionData([
    { id: 1, url: "https://a.test/", title: "A", isPinned: false, isMuted: false, isPrivate: false, internal: false },
    { id: 2, url: "https://p.test/", title: "P", isPinned: false, isMuted: false, isPrivate: true, internal: false },
  ], 2, []);
  assert.equal(data.activeIndex, 0);
});

test("normalizeSessionData sanitizes untrusted input", () => {
  assert.deepEqual(normalizeSessionData(null).tabs, []);
  const data = normalizeSessionData({
    tabs: [{ url: "javascript:alert(1)" }, { url: "https://ok.test/", title: 5, pinned: true }, "junk", { url: "https://two.test/" }],
    activeIndex: 3,
    recentlyClosed: ["https://x.test/", { url: "data:text/html,boom" }, { url: "https://y.test/", title: "Y", pinned: true }],
  });
  assert.deepEqual(data.tabs.map((tab) => tab.url), ["https://ok.test/", "https://two.test/"]);
  assert.equal(data.tabs[0].title, "");
  assert.equal(data.tabs[0].pinned, true);
  assert.equal(data.activeIndex, 1);
  assert.deepEqual(data.recentlyClosed.map((tab) => tab.url), ["https://x.test/", "https://y.test/"]);
});

test("normalizeSessionData clamps an out-of-range active index", () => {
  const data = normalizeSessionData({ tabs: [{ url: "https://a.test/" }], activeIndex: 9 });
  assert.equal(data.activeIndex, 0);
});

test("pushClosedTab keeps newest first, dedupes and caps the list", () => {
  let list = pushClosedTab([], { url: "https://a.test/", title: "A", pinned: false });
  list = pushClosedTab(list, { url: "https://b.test/", title: "B", pinned: false });
  list = pushClosedTab(list, { url: "https://a.test/", title: "A2", pinned: false });
  assert.deepEqual(list.map((tab) => tab.url), ["https://a.test/", "https://b.test/"]);
  for (let index = 0; index < 40; index += 1) {
    list = pushClosedTab(list, { url: `https://t${index}.test/`, title: "", pinned: false });
  }
  assert.equal(list.length, 25);
  assert.equal(list[0].url, "https://t39.test/");
  assert.deepEqual(pushClosedTab(list, { url: "data:x", title: "", pinned: false }), list);
});

test("pushClosedTab keeps every closed new-tab page (no dedupe for the start page)", () => {
  let list = pushClosedTab([], { url: "monobrowser://new-tab", title: "Nowa karta", pinned: false });
  list = pushClosedTab(list, { url: "monobrowser://new-tab", title: "Nowa karta", pinned: false });
  assert.equal(list.length, 2);
});
