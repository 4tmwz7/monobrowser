import assert from "node:assert/strict";
import test from "node:test";
import {
  authDedupeKey, buildAuthRequest, buildLeaveRequest, buildPermissionRequest, computeOverlayBounds,
  createPendingGroups, selectVisibleEntry,
} from "./prompt-queue.js";

const entry = (tabId: number | null) => ({ request: { tabId } });

test("selectVisibleEntry shows tab-less prompts always and tab prompts only for the active tab", () => {
  const queue = [entry(1), entry(2), entry(null)];
  assert.equal(selectVisibleEntry(queue, 2), queue[1]);
  assert.equal(selectVisibleEntry(queue, 1), queue[0]);
  assert.equal(selectVisibleEntry(queue, 9), queue[2]);
  assert.equal(selectVisibleEntry([entry(1)], 2), null);
  assert.equal(selectVisibleEntry([entry(1)], null), null);
  assert.equal(selectVisibleEntry([], 1), null);
});

test("selectVisibleEntry keeps queue order (first in, first shown)", () => {
  const queue = [entry(3), entry(3)];
  assert.equal(selectVisibleEntry(queue, 3), queue[0]);
});

test("computeOverlayBounds anchors permissions left and centers the rest", () => {
  const base = { contentWidth: 1400, contentHeight: 900, top: 36, left: 0, reportedHeight: 150 };
  const permission = computeOverlayBounds({ ...base, kind: "permission" });
  assert.deepEqual(permission, { x: 12, y: 40, width: 380, height: 150 });
  const auth = computeOverlayBounds({ ...base, kind: "auth" });
  assert.equal(auth.width, 420);
  assert.equal(auth.x, 490);
  assert.equal(auth.y, 52);
});

test("computeOverlayBounds respects the sidebar offset and small windows", () => {
  const sidebar = computeOverlayBounds({ kind: "permission", contentWidth: 1000, contentHeight: 700, top: 0, left: 220, reportedHeight: 120 });
  assert.equal(sidebar.x, 232);
  const tiny = computeOverlayBounds({ kind: "auth", contentWidth: 300, contentHeight: 200, top: 36, left: 0, reportedHeight: 900 });
  assert.ok(tiny.width <= 300 - 24 + 1);
  assert.ok(tiny.height <= 200 - 36 - 16);
  assert.ok(tiny.x >= 0);
});

test("createPendingGroups opens one prompt per key and answers every waiter", () => {
  const groups = createPendingGroups<string | null>();
  const answers: Array<string | null> = [];
  assert.equal(groups.join("a", (value) => answers.push(value)), true);
  assert.equal(groups.join("a", (value) => answers.push(value)), false);
  assert.equal(groups.join("b", (value) => answers.push(value)), true);
  assert.equal(groups.size(), 2);
  assert.equal(groups.resolve("a", "x"), 2);
  assert.deepEqual(answers, ["x", "x"]);
  assert.equal(groups.has("a"), false);
  assert.equal(groups.resolve("a", "late"), 0);
  assert.equal(groups.join("a", () => undefined), true);
});

test("authDedupeKey separates host, realm and tab", () => {
  assert.notEqual(authDedupeKey("h", "r", 1), authDedupeKey("h", "r", 2));
  assert.notEqual(authDedupeKey("h", "r", 1), authDedupeKey("h", "other", 1));
  assert.equal(authDedupeKey("h", "r", 1), "h|r|1");
});

test("buildAuthRequest is bilingual, has fields and warns on plain http", () => {
  const input = { tabId: 4, host: "example.test", realm: "Private", isProxy: false, scheme: "basic", secure: false };
  const en = buildAuthRequest({ ...input, lang: "en" });
  assert.equal(en.kind, "auth");
  assert.equal(en.tabId, 4);
  assert.equal(en.primary, "Sign in");
  assert.equal(en.secondary, "Cancel");
  assert.deepEqual(en.fields, { username: "Username", password: "Password" });
  assert.ok(en.lines.some((line) => line.style === "warn"));
  const pl = buildAuthRequest({ ...input, lang: "pl", secure: true });
  assert.equal(pl.primary, "Zaloguj");
  assert.equal(pl.secondary, "Anuluj");
  assert.ok(!pl.lines.some((line) => line.style === "warn"));
  assert.ok(pl.lines.some((line) => line.text.includes("Private")));
});

test("buildPermissionRequest and buildLeaveRequest carry PL and EN copy", () => {
  const en = buildPermissionRequest("en", 2, "https://a.test", "know your location");
  assert.equal(en.kind, "permission");
  assert.equal(en.primary, "Allow");
  assert.equal(en.secondary, "Block");
  assert.match(en.lines[0].text, /a\.test wants to know your location/);
  const pl = buildPermissionRequest("pl", null, "https://a.test", "poznać Twoją lokalizację");
  assert.equal(pl.tabId, null);
  assert.equal(pl.primary, "Zezwól");
  assert.equal(pl.secondary, "Zablokuj");
  assert.equal(buildLeaveRequest("pl", 1, "a.test").title, "Opuścić stronę?");
  assert.equal(buildLeaveRequest("en", 1, "a.test").title, "Leave site?");
  assert.equal(buildLeaveRequest("en", 1, "a.test").kind, "confirm");
});

test("computeOverlayBounds anchors to a split pane rect", () => {
  // right pane of a split: x=520.., width 480, height 600 below a 36px toolbar
  const permission = computeOverlayBounds({ kind: "permission", contentWidth: 1000, contentHeight: 700, top: 36, left: 520, reportedHeight: 120, areaWidth: 480, areaHeight: 600 });
  assert.equal(permission.x, 532);
  assert.equal(permission.y, 40);
  assert.ok(permission.x + permission.width <= 1000);
  const auth = computeOverlayBounds({ kind: "auth", contentWidth: 1000, contentHeight: 700, top: 36, left: 520, reportedHeight: 900, areaWidth: 480, areaHeight: 300 });
  assert.ok(auth.x >= 520 && auth.x + auth.width <= 1000);
  assert.ok(auth.height <= 300 - 16);
});
