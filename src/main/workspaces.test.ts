import assert from "node:assert/strict";
import test from "node:test";
import {
  MAIN_WORKSPACE_ID, MAX_WORKSPACES, addWorkspace, adjacentWorkspaceId, createMainWorkspace, mostRecentTabInWorkspace,
  moveWorkspace, normalizeWorkspaces, orderTabsByWorkspaces, orderTabsForWorkspace, removeWorkspace, reorderTabIds,
  sanitizeColor, sanitizeIcon, sanitizeName, updateWorkspace, workspaceDisplayName, workspaceIdByNumber,
  type Workspace,
} from "./workspaces.js";

const seeded = (values: number[]) => { let i = 0; return () => values[i++ % values.length]; };

test("main workspace has a localized default name", () => {
  const main = createMainWorkspace();
  assert.equal(workspaceDisplayName(main, "pl"), "Główna");
  assert.equal(workspaceDisplayName(main, "en"), "Main");
  assert.equal(workspaceDisplayName({ ...main, name: "Praca" }, "en"), "Praca");
});

test("sanitizers clean icon, name and color", () => {
  assert.equal(sanitizeIcon("  ab"), "a");
  assert.equal(sanitizeIcon("👨‍👩‍👧 family"), "👨‍👩‍👧");
  assert.equal(sanitizeIcon(""), null);
  assert.equal(sanitizeIcon(5), null);
  assert.equal(sanitizeName("  Praca   i   dom  "), "Praca i dom");
  assert.equal(sanitizeName("   "), null);
  assert.equal(sanitizeName("x".repeat(100))?.length, 40);
  assert.equal(sanitizeColor("ACCENT"), "accent");
  assert.equal(sanitizeColor("#3f88c5"), "#3f88c5");
  assert.equal(sanitizeColor("#123456"), null);
  assert.equal(sanitizeColor("url(x)"), null);
});

test("normalizeWorkspaces keeps main, drops duplicates and junk", () => {
  const list = normalizeWorkspaces([
    { id: "ws-a", name: "A", icon: "★", color: "danger" },
    { id: "ws-a", name: "dup" },
    "junk",
    { id: "Bad Id!", name: "x" },
    { id: "ws-b", name: "", icon: "", color: "javascript:1" },
  ]);
  assert.deepEqual(list.map((w) => w.id), [MAIN_WORKSPACE_ID, "ws-a", "ws-b"]);
  assert.equal(list[2].color, null);
  assert.equal(list[1].icon, "★");
  assert.deepEqual(normalizeWorkspaces(null).map((w) => w.id), [MAIN_WORKSPACE_ID]);
});

test("normalizeWorkspaces caps the list", () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ id: `ws-${i}`, name: String(i) }));
  assert.equal(normalizeWorkspaces(many).length, MAX_WORKSPACES);
});

test("addWorkspace generates unique ids, default names and icons", () => {
  let list: Workspace[] = [createMainWorkspace()];
  const first = addWorkspace(list, {}, "pl", seeded([0.1]))!;
  list = first.list;
  assert.equal(first.workspace.name, "Przestrzeń 2");
  assert.notEqual(first.workspace.icon, list[0].icon);
  const second = addWorkspace(list, { name: " Praca ", icon: "P", color: "accent" }, "en", seeded([0.1, 0.1, 0.9]))!;
  assert.notEqual(second.workspace.id, first.workspace.id);
  assert.equal(second.workspace.name, "Praca");
  assert.equal(second.workspace.icon, "P");
  assert.equal(second.workspace.color, "accent");
});

test("addWorkspace refuses beyond the limit", () => {
  let list: Workspace[] = [createMainWorkspace()];
  for (let i = 1; i < MAX_WORKSPACES; i += 1) list = addWorkspace(list, {}, "en")!.list;
  assert.equal(list.length, MAX_WORKSPACES);
  assert.equal(addWorkspace(list, {}, "en"), null);
});

test("updateWorkspace patches only given fields", () => {
  const list = addWorkspace([createMainWorkspace()], { name: "A", icon: "A" }, "en")!.list;
  const id = list[1].id;
  const renamed = updateWorkspace(list, id, { name: "Nowa" })!;
  assert.equal(renamed[1].name, "Nowa");
  assert.equal(renamed[1].icon, "A");
  assert.equal(updateWorkspace(renamed, id, { name: "   " })![1].name, "Nowa");
  assert.equal(updateWorkspace(renamed, id, { color: "danger" })![1].color, "danger");
  assert.equal(updateWorkspace(renamed, id, { color: null })![1].color, null);
  assert.equal(updateWorkspace(renamed, "nope", {}), null);
  assert.equal(updateWorkspace([createMainWorkspace()], MAIN_WORKSPACE_ID, { name: "" })![0].name, "");
});

test("main cannot be removed, others can", () => {
  const list = addWorkspace([createMainWorkspace()], {}, "en")!.list;
  assert.equal(removeWorkspace(list, MAIN_WORKSPACE_ID), null);
  assert.deepEqual(removeWorkspace(list, list[1].id)!.map((w) => w.id), [MAIN_WORKSPACE_ID]);
  assert.equal(removeWorkspace(list, "nope"), null);
});

test("moveWorkspace reorders with clamping", () => {
  const ids = ["main", "ws-a", "ws-b"];
  const list = normalizeWorkspaces(ids.map((id) => ({ id })));
  assert.deepEqual(moveWorkspace(list, "ws-b", -1)!.map((w) => w.id), ["main", "ws-b", "ws-a"]);
  assert.deepEqual(moveWorkspace(list, "main", -5)!.map((w) => w.id), ids);
  assert.deepEqual(moveWorkspace(list, "main", 9)!.map((w) => w.id), ["ws-a", "ws-b", "main"]);
  assert.equal(moveWorkspace(list, "zzz", 1), null);
});

test("adjacentWorkspaceId cycles and workspaceIdByNumber is 1-based", () => {
  const list = normalizeWorkspaces([{ id: "ws-a" }, { id: "ws-b" }]);
  assert.equal(adjacentWorkspaceId(list, "ws-b", 1), MAIN_WORKSPACE_ID);
  assert.equal(adjacentWorkspaceId(list, MAIN_WORKSPACE_ID, -1), "ws-b");
  assert.equal(adjacentWorkspaceId([createMainWorkspace()], MAIN_WORKSPACE_ID, 1), null);
  assert.equal(workspaceIdByNumber(list, 2), "ws-a");
  assert.equal(workspaceIdByNumber(list, 4), null);
  assert.equal(workspaceIdByNumber(list, 0), null);
});

test("orderTabsForWorkspace filters and puts pinned first; orderTabsByWorkspaces groups", () => {
  const tabs = [
    { id: 1, workspaceId: "main", isPinned: false },
    { id: 2, workspaceId: "ws-a", isPinned: false },
    { id: 3, workspaceId: "main", isPinned: true },
    { id: 4, workspaceId: "ws-a", isPinned: true },
    { id: 5, workspaceId: "gone", isPinned: false },
  ];
  assert.deepEqual(orderTabsForWorkspace(tabs, "main").map((t) => t.id), [3, 1]);
  const list = normalizeWorkspaces([{ id: "ws-a" }]);
  assert.deepEqual(orderTabsByWorkspaces(tabs, list).map((t) => t.id), [3, 1, 5, 4, 2]);
});

test("mostRecentTabInWorkspace follows MRU order", () => {
  const owner: Record<number, string> = { 1: "main", 2: "ws-a", 3: "main", 4: "ws-a" };
  const lookup = (id: number) => owner[id];
  assert.equal(mostRecentTabInWorkspace([4, 3, 2, 1], lookup, "main"), 3);
  assert.equal(mostRecentTabInWorkspace([4, 3, 2, 1], lookup, "ws-a"), 4);
  assert.equal(mostRecentTabInWorkspace([3, 1], lookup, "ws-a"), null);
});

test("reorderTabIds moves within a group and ignores other groups", () => {
  const group = new Set([1, 3, 5]);
  const inGroup = (id: number) => group.has(id);
  const order = [1, 2, 3, 4, 5];
  assert.deepEqual(reorderTabIds(order, 5, 1, inGroup), [5, 1, 2, 3, 4]);
  assert.deepEqual(reorderTabIds(order, 1, null, inGroup), [2, 3, 4, 5, 1]);
  assert.deepEqual(reorderTabIds(order, 1, 4, inGroup), [2, 3, 4, 5, 1]);
  assert.equal(reorderTabIds(order, 1, 1, inGroup), null);
  assert.equal(reorderTabIds(order, 9, null, inGroup), null);
});
