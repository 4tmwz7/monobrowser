import assert from "node:assert/strict";
import test from "node:test";
import { renderWorkspaceDeleteHtml, renderWorkspaceEditorHtml, renderWorkspaceMenuHtml, renderWorkspaceSwitcherHtml } from "./workspace-popups.js";
import { createMainWorkspace, type Workspace } from "./workspaces.js";

const ctx = { language: "en" as const, themeCss: ":root{}", popupStyles: "" };
const evil: Workspace = { id: "ws-evil", name: '<img src=x onerror=alert(1)>"', icon: "<", color: "accent" };

test("switcher lists every workspace, escapes names and marks the current one", () => {
  const { html, height } = renderWorkspaceSwitcherHtml(ctx, [{ ...createMainWorkspace(), count: 2 }, { ...evil, count: 0 }], "ws-evil");
  assert.ok(html.includes("monobrowser-menu://ws-switch?id=main"));
  assert.ok(html.includes("monobrowser-menu://ws-new"));
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("&lt;img"));
  assert.match(html, /selected[^>]*ws-switch\?id=ws-evil/);
  assert.ok(height > 100);
});

test("menu hides delete for the main workspace and move arrows at the edges", () => {
  const main = renderWorkspaceMenuHtml(ctx, createMainWorkspace(), { index: 0, total: 2 }, "row").html;
  assert.ok(!main.includes("ws-delete"));
  assert.ok(!main.includes("ws-left"));
  assert.ok(main.includes("ws-right"));
  const other = renderWorkspaceMenuHtml(ctx, evil, { index: 1, total: 2 }, "column").html;
  assert.ok(other.includes("ws-delete"));
  assert.ok(other.includes("ws-left"));
  assert.ok(!other.includes("ws-right"));
});

test("editor embeds the workspace data safely", () => {
  const { html } = renderWorkspaceEditorHtml(ctx, evil);
  assert.ok(!html.includes("<img src=x"));
  assert.ok(html.includes("monobrowser-menu://ws-save"));
  assert.ok(html.includes('"ws-evil"'));
});

test("delete confirmation offers move/close only when the workspace has tabs", () => {
  const withTabs = renderWorkspaceDeleteHtml(ctx, evil, 3, "Main").html;
  assert.ok(withTabs.includes("ws-delete-move"));
  assert.ok(withTabs.includes("ws-delete-close"));
  const empty = renderWorkspaceDeleteHtml(ctx, evil, 0, "Main").html;
  assert.ok(!empty.includes("ws-delete-close"));
  assert.ok(empty.includes("ws-delete-move"));
});

test("switcher offers deleting every space except the main one", () => {
  const html = renderWorkspaceSwitcherHtml(ctx, [{ ...createMainWorkspace(), count: 1 }, { ...evil, count: 0 }], "main").html;
  assert.ok(html.includes("monobrowser-menu://ws-delete?id=ws-evil"));
  assert.ok(!html.includes("ws-delete?id=main"));
});
