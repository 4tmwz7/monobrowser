import assert from "node:assert/strict";
import test from "node:test";
import { buildSessionData, normalizeSessionData } from "./session-store.js";

test("normalizeSessionData migrates the old format into the main workspace", () => {
  const data = normalizeSessionData({
    version: 1,
    tabs: [{ url: "https://a.test/" }, { url: "https://b.test/", pinned: true }],
    activeIndex: 1,
    recentlyClosed: [],
  });
  assert.equal(data.version, 2);
  assert.deepEqual(data.workspaces.map((workspace) => workspace.id), ["main"]);
  assert.equal(data.currentWorkspaceId, "main");
  assert.deepEqual(data.tabs.map((tab) => tab.workspaceId), ["main", "main"]);
  assert.equal(data.activeIndex, 1);
  assert.equal(data.workspaces[0].activeIndex, 1);
});

test("buildSessionData stores workspaces with per-workspace active tabs and skips private tabs", () => {
  const tab = (id: number, workspaceId: string, extra: Record<string, unknown> = {}) => ({
    id, url: `https://t${id}.test/`, title: `T${id}`, isPinned: false, isMuted: false, isPrivate: false, internal: false, workspaceId, ...extra,
  });
  const data = buildSessionData(
    [tab(1, "main"), tab(2, "main"), tab(3, "ws-a"), tab(4, "ws-a", { isPrivate: true }), tab(5, "ws-a")],
    5,
    [],
    {
      workspaces: [{ id: "main", name: "", icon: "◼", color: null }, { id: "ws-a", name: "Praca", icon: "P", color: "accent" }],
      currentWorkspaceId: "ws-a",
      activeTabIdByWorkspace: { main: 2, "ws-a": 5 },
    },
  );
  assert.deepEqual(data.tabs.map((entry) => entry.workspaceId), ["main", "main", "ws-a", "ws-a"]);
  assert.equal(data.currentWorkspaceId, "ws-a");
  assert.equal(data.activeIndex, 3);
  assert.deepEqual(data.workspaces.map((workspace) => workspace.activeIndex), [1, 3]);
  assert.equal(data.workspaces[1].name, "Praca");
});

test("workspace sessions round-trip through normalizeSessionData", () => {
  const built = buildSessionData(
    [
      { id: 1, url: "https://a.test/", title: "A", isPinned: true, isMuted: false, isPrivate: false, internal: false, workspaceId: "main" },
      { id: 2, url: "https://b.test/", title: "B", isPinned: false, isMuted: true, isPrivate: false, internal: false, workspaceId: "ws-x" },
      { id: 3, url: "https://c.test/", title: "C", isPinned: false, isMuted: false, isPrivate: false, internal: false, workspaceId: "ws-x" },
    ],
    2,
    [],
    {
      workspaces: [{ id: "main", name: "", icon: "◼", color: null }, { id: "ws-x", name: "X", icon: "★", color: "#3f88c5" }],
      currentWorkspaceId: "ws-x",
      activeTabIdByWorkspace: { main: 1, "ws-x": 2 },
    },
  );
  const restored = normalizeSessionData(JSON.parse(JSON.stringify(built)));
  assert.deepEqual(restored, built);
});

test("normalizeSessionData repairs tabs of unknown workspaces and a bad current workspace", () => {
  const data = normalizeSessionData({
    workspaces: [{ id: "ws-a", name: "A" }],
    currentWorkspaceId: "ghost",
    tabs: [{ url: "https://a.test/", workspaceId: "ghost" }, { url: "https://b.test/", workspaceId: "ws-a" }],
    activeIndex: 1,
  });
  assert.deepEqual(data.workspaces.map((workspace) => workspace.id), ["main", "ws-a"]);
  assert.equal(data.currentWorkspaceId, "main");
  assert.deepEqual(data.tabs.map((entry) => entry.workspaceId), ["main", "ws-a"]);
  assert.equal(data.activeIndex, 0);
});
