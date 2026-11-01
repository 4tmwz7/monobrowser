import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPACT_TITLEBAR_HEIGHT, TITLEBAR_HEIGHT, WINDOW_CONTROLS_FALLBACK_WIDTH, compactViewportTop, shellViewport, titleBarOverlayFor,
  titlebarHeightFor, usesNativeControlsOverlay, windowControlsReserve, windowControlsRect,
} from "./titlebar.js";

test("only Windows uses the native controls overlay", () => {
  assert.equal(usesNativeControlsOverlay("win32"), true);
  assert.equal(usesNativeControlsOverlay("linux"), false);
  assert.equal(usesNativeControlsOverlay("darwin"), false);
});

test("overlay takes the chrome colors and the top bar height", () => {
  assert.deepEqual(titleBarOverlayFor({ surface: "#161614", fg: "#f0efe9" }, false), { color: "#161614", symbolColor: "#f0efe9", height: TITLEBAR_HEIGHT });
  assert.equal(titleBarOverlayFor({ surface: "#fff", fg: "#000" }, true).height, COMPACT_TITLEBAR_HEIGHT);
  assert.ok(titlebarHeightFor(true) < titlebarHeightFor(false));
});

test("compact mode keeps a title strip only on Windows", () => {
  assert.equal(compactViewportTop("win32"), COMPACT_TITLEBAR_HEIGHT);
  assert.equal(compactViewportTop("linux"), 0);
  assert.equal(compactViewportTop("darwin"), 0);
});

test("controls reserve: real geometry, fallback, fullscreen", () => {
  assert.equal(windowControlsReserve({ fullscreen: false, viewportWidth: 1400, titlebarArea: { x: 0, width: 1262 } }), 138);
  assert.equal(windowControlsReserve({ fullscreen: false, viewportWidth: 1400, titlebarArea: { x: 0, width: 1230 } }), 170);
  assert.equal(windowControlsReserve({ fullscreen: false, viewportWidth: 1400 }), WINDOW_CONTROLS_FALLBACK_WIDTH);
  assert.equal(windowControlsReserve({ fullscreen: false, viewportWidth: 1400, titlebarArea: { x: 0, width: 1400 } }), WINDOW_CONTROLS_FALLBACK_WIDTH);
  assert.equal(windowControlsReserve({ fullscreen: false, viewportWidth: 1400, titlebarArea: { x: 0, width: 500 } }), WINDOW_CONTROLS_FALLBACK_WIDTH);
  assert.equal(windowControlsReserve({ fullscreen: false, viewportWidth: 1400, titlebarArea: { x: NaN, width: 1 } }), WINDOW_CONTROLS_FALLBACK_WIDTH);
  assert.equal(windowControlsReserve({ fullscreen: true, viewportWidth: 1400, titlebarArea: { x: 0, width: 1262 } }), 0);
});

test("controls rect sits at the top-right corner of the content", () => {
  assert.deepEqual(windowControlsRect("win32", 1000, false, false), { x: 1000 - 138, y: 0, width: 138, height: 36 });
  assert.deepEqual(windowControlsRect("win32", 1000, true, false), { x: 1000 - 138, y: 0, width: 138, height: 32 });
  assert.equal(windowControlsRect("win32", 1000, false, true), null);
  assert.equal(windowControlsRect("linux", 1000, false, false), null);
  assert.equal(windowControlsRect("win32", 100, false, false)?.x, 0);
});

test("shell viewport: Windows vertical layouts get a top bar, others are unchanged", () => {
  const left = { vertical: true, sidebarRight: false, sidebarWidth: 240 };
  const right = { vertical: true, sidebarRight: true, sidebarWidth: 240 };
  assert.deepEqual(shellViewport({ platform: "linux", ...left }), { x: 240, y: 0, right: 0 });
  assert.deepEqual(shellViewport({ platform: "linux", ...right }), { x: 0, y: 0, right: 240 });
  assert.deepEqual(shellViewport({ platform: "win32", ...left }), { x: 240, y: 36, right: 0 });
  assert.deepEqual(shellViewport({ platform: "win32", ...right }), { x: 0, y: 36, right: 240 });
  for (const platform of ["win32", "linux"]) {
    assert.deepEqual(shellViewport({ platform, vertical: false, sidebarRight: false, sidebarWidth: 240 }), { x: 0, y: 36, right: 0 });
  }
});
