import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPACT_TITLEBAR_HEIGHT, TITLEBAR_HEIGHT, WINDOW_CONTROLS_FALLBACK_WIDTH, compactViewportTop, minViewportTop, shellViewport, titleBarOverlayFor, titleBarOverlayHeight,
  titlebarHeightFor, usesNativeControlsOverlay, windowControlsReserve, windowControlsRect,
  controlsFrameIndex, controlsFrameRect, sanitizeControlsWidth, keepBelowControls, clipLeftOfControls,
  CONTROLS_HIDE_DELAY_MS, CONTROLS_HOVER_MARGIN, TRANSPARENT_OVERLAY_COLOR, autoHidesControls, nextControlsReveal, pointInControlsZone, resolveTitleBarOverlay,
} from "./titlebar.js";

test("only Windows uses the native controls overlay", () => {
  assert.equal(usesNativeControlsOverlay("win32"), true);
  assert.equal(usesNativeControlsOverlay("linux"), false);
  assert.equal(usesNativeControlsOverlay("darwin"), false);
});

test("overlay takes the chrome colors and the top bar height", () => {
  assert.deepEqual(titleBarOverlayFor({ surface: "#161614", fg: "#f0efe9" }, false), { color: "#161614", symbolColor: "#f0efe9", height: TITLEBAR_HEIGHT - 1 });
  assert.equal(titleBarOverlayFor({ surface: "#fff", fg: "#000" }, true).height, COMPACT_TITLEBAR_HEIGHT - 1);
  assert.ok(titlebarHeightFor(true) < titlebarHeightFor(false));
});

test("overlay is 1 px shorter than the strip so its bottom line reaches the window edge; vertical layout uses the full height", () => {
  assert.equal(titleBarOverlayHeight(false, false), 35);
  assert.equal(titleBarOverlayHeight(true, false), 31);
  assert.equal(titleBarOverlayHeight(false, true), 36);
  assert.equal(titleBarOverlayHeight(true, true), 31);
  assert.equal(titleBarOverlayFor({ surface: "#fff", fg: "#000" }, false, true).height, 36);
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
  assert.deepEqual(windowControlsRect("win32", 1000, false, false), { x: 1000 - 138, y: 0, width: 138, height: 35 });
  assert.deepEqual(windowControlsRect("win32", 1000, true, false), { x: 1000 - 138, y: 0, width: 138, height: 31 });
  assert.deepEqual(windowControlsRect("win32", 1000, false, false, 160, true), { x: 1000 - 160, y: 0, width: 160, height: 36 });
  assert.equal(windowControlsRect("win32", 1000, false, true), null);
  assert.equal(windowControlsRect("linux", 1000, false, false), null);
  assert.equal(windowControlsRect("win32", 100, false, false)?.x, 0);
});

test("shell viewport: the vertical layout starts the page at y=0 (the controls float over it), horizontal sits below the strip", () => {
  assert.deepEqual(shellViewport({ vertical: true, sidebarRight: false, sidebarWidth: 240 }), { x: 240, y: 0, right: 0 });
  assert.deepEqual(shellViewport({ vertical: true, sidebarRight: true, sidebarWidth: 240 }), { x: 0, y: 0, right: 240 });
  assert.deepEqual(shellViewport({ vertical: false, sidebarRight: false, sidebarWidth: 240 }), { x: 0, y: 36, right: 0 });
});

test("page views never reach into the native controls strip on Windows, except in the vertical layout", () => {
  assert.equal(minViewportTop("win32", false, false), TITLEBAR_HEIGHT);
  assert.equal(minViewportTop("win32", true, false), COMPACT_TITLEBAR_HEIGHT);
  assert.equal(minViewportTop("win32", true, true), COMPACT_TITLEBAR_HEIGHT);
  assert.equal(minViewportTop("win32", false, true), 0);
  assert.equal(minViewportTop("linux", false, false), 0);
  assert.equal(minViewportTop("darwin", true, false), 0);
  // The viewport the shell reports is always at or below the floor.
  for (const vertical of [false, true]) {
    assert.ok(shellViewport({ vertical, sidebarRight: false, sidebarWidth: 240 }).y >= minViewportTop("win32", false, vertical));
  }
});

test("sanitizeControlsWidth keeps plausible widths and falls back otherwise", () => {
  assert.equal(sanitizeControlsWidth(138), 138);
  assert.equal(sanitizeControlsWidth(172.5), 173);
  for (const bad of [0, -5, NaN, Infinity, 5000, "138", null, undefined]) {
    assert.equal(sanitizeControlsWidth(bad), WINDOW_CONTROLS_FALLBACK_WIDTH);
  }
});

test("controlsFrameRect: 1px outline view only for the Windows vertical layout", () => {
  const base = { platform: "win32", vertical: true, compact: false, fullscreen: false, controlsWidth: 138, contentWidth: 1200 };
  // One pixel wider and taller than the controls (overlay 36 px), anchored top-right: left and bottom lines show.
  assert.deepEqual(controlsFrameRect(base), { x: 1200 - 139, y: 0, width: 139, height: 37 });
  assert.equal(controlsFrameRect({ ...base, controlsWidth: 172 })?.width, 173);
  assert.equal(controlsFrameRect({ ...base, contentWidth: 100 })?.width, 100);
  assert.equal(controlsFrameRect({ ...base, contentWidth: 100 })?.x, 0);
  assert.equal(controlsFrameRect({ ...base, platform: "linux" }), null);
  assert.equal(controlsFrameRect({ ...base, platform: "darwin" }), null);
  assert.equal(controlsFrameRect({ ...base, vertical: false }), null);
  assert.equal(controlsFrameRect({ ...base, compact: true }), null);
  assert.equal(controlsFrameRect({ ...base, fullscreen: true }), null);
  assert.equal(controlsFrameRect({ ...base, contentWidth: 0 }), null);
});

test("controlsFrameIndex puts the frame right above the topmost page, below overlays", () => {
  const pages = new Set(["tabA", "tabB"]);
  // Frame missing: inserted above the topmost page, under popup and HUD.
  assert.equal(controlsFrameIndex(["shell", "tabA", "tabB", "popup", "hud"], pages, "frame"), 3);
  // Already in place: nothing to do.
  assert.equal(controlsFrameIndex(["shell", "tabA", "tabB", "frame", "popup", "hud"], pages, "frame"), null);
  // A tab was re-attached on top of the frame: move it up (index computed without the frame).
  assert.equal(controlsFrameIndex(["shell", "tabB", "frame", "tabA", "popup"], pages, "frame"), 3);
  // Frame too high (above a popup): moved back under it.
  assert.equal(controlsFrameIndex(["shell", "tabA", "popup", "frame"], pages, "frame"), 2);
  // No page attached: frame goes to the end unless it already is there.
  assert.equal(controlsFrameIndex(["shell"], pages, "frame"), 1);
  assert.equal(controlsFrameIndex(["shell", "frame"], pages, "frame"), null);
});

test("overlays that start under the native controls move below them and keep their bottom edge", () => {
  const controls = windowControlsRect("win32", 1000, false, false, 140, true); // 860..1000 x 0..36
  assert.deepEqual(keepBelowControls({ x: 646, y: 0, width: 340, height: 700 }, controls), { x: 646, y: 36, width: 340, height: 664 });
  // no horizontal overlap, already below, or no controls: unchanged
  const left = { x: 0, y: 0, width: 300, height: 700 };
  assert.equal(keepBelowControls(left, controls), left);
  const below = { x: 900, y: 36, width: 80, height: 40 };
  assert.equal(keepBelowControls(below, controls), below);
  assert.equal(keepBelowControls(left, null), left);
  // the rect touching the controls' left edge does not overlap
  const touching = { x: 520, y: 0, width: 340, height: 100 };
  assert.equal(keepBelowControls(touching, controls), touching);
  assert.deepEqual(keepBelowControls({ x: 800, y: 16, width: 100, height: 10 }, controls), { x: 800, y: 36, width: 100, height: 0 });
});

test("a top progress line ends where the native controls begin", () => {
  const controls = windowControlsRect("win32", 1000, false, false, 140, true);
  assert.deepEqual(clipLeftOfControls({ x: 240, y: 0, width: 760, height: 2 }, controls), { x: 240, y: 0, width: 620, height: 2 });
  const unaffected = { x: 0, y: 36, width: 1000, height: 2 };
  assert.equal(clipLeftOfControls(unaffected, controls), unaffected);
  assert.equal(clipLeftOfControls(unaffected, null), unaffected);
});

const TOKENS = { surface: "#161614", fg: "#f0efe9" };
const OVERLAY_BASE = { platform: "win32", tokens: TOKENS, compact: false, vertical: true, fullscreen: false, hideControls: true, revealed: false };

test("auto-hide applies only on Windows, vertical, non-compact, non-fullscreen, with the option on", () => {
  const on = { platform: "win32", vertical: true, compact: false, fullscreen: false, enabled: true };
  assert.equal(autoHidesControls(on), true);
  assert.equal(autoHidesControls({ ...on, platform: "linux" }), false);
  assert.equal(autoHidesControls({ ...on, platform: "darwin" }), false);
  assert.equal(autoHidesControls({ ...on, vertical: false }), false);
  assert.equal(autoHidesControls({ ...on, compact: true }), false);
  assert.equal(autoHidesControls({ ...on, fullscreen: true }), false);
  assert.equal(autoHidesControls({ ...on, enabled: false }), false);
});

test("overlay is transparent while auto-hidden and takes the chrome colors once revealed", () => {
  assert.deepEqual(resolveTitleBarOverlay(OVERLAY_BASE), { color: TRANSPARENT_OVERLAY_COLOR, symbolColor: TRANSPARENT_OVERLAY_COLOR, height: TITLEBAR_HEIGHT });
  assert.deepEqual(resolveTitleBarOverlay({ ...OVERLAY_BASE, revealed: true }), { color: "#161614", symbolColor: "#f0efe9", height: TITLEBAR_HEIGHT });
});

test("overlay keeps the chrome colors whenever auto-hide does not apply, and is null off Windows", () => {
  const visible = { color: "#161614", symbolColor: "#f0efe9" };
  assert.deepEqual(resolveTitleBarOverlay({ ...OVERLAY_BASE, hideControls: false }), { ...visible, height: 36 });
  assert.deepEqual(resolveTitleBarOverlay({ ...OVERLAY_BASE, vertical: false }), { ...visible, height: 35 });
  assert.deepEqual(resolveTitleBarOverlay({ ...OVERLAY_BASE, compact: true }), { ...visible, height: 31 });
  assert.deepEqual(resolveTitleBarOverlay({ ...OVERLAY_BASE, fullscreen: true }), { ...visible, height: 36 });
  assert.equal(resolveTitleBarOverlay({ ...OVERLAY_BASE, platform: "linux" }), null);
  assert.equal(resolveTitleBarOverlay({ ...OVERLAY_BASE, platform: "darwin", revealed: true }), null);
});

test("theme change while hidden keeps the overlay transparent, while revealed it follows the new colors", () => {
  const light = { surface: "#ffffff", fg: "#111111" };
  assert.equal(resolveTitleBarOverlay({ ...OVERLAY_BASE, tokens: light })?.color, TRANSPARENT_OVERLAY_COLOR);
  assert.deepEqual(resolveTitleBarOverlay({ ...OVERLAY_BASE, tokens: light, revealed: true }), { color: "#ffffff", symbolColor: "#111111", height: 36 });
});

test("pointer zone is the controls rect grown by the margin", () => {
  const rect = { x: 862, y: 0, width: 138, height: 36 };
  assert.equal(pointInControlsZone({ x: 900, y: 10 }, rect), true);
  assert.equal(pointInControlsZone({ x: 999, y: 0 }, rect), true);
  assert.equal(pointInControlsZone({ x: 862 - CONTROLS_HOVER_MARGIN, y: 10 }, rect), true);
  assert.equal(pointInControlsZone({ x: 862 - CONTROLS_HOVER_MARGIN - 1, y: 10 }, rect), false);
  assert.equal(pointInControlsZone({ x: 900, y: 36 + CONTROLS_HOVER_MARGIN - 1 }, rect), true);
  assert.equal(pointInControlsZone({ x: 900, y: 36 + CONTROLS_HOVER_MARGIN }, rect), false);
  assert.equal(pointInControlsZone({ x: 900, y: 10 }, null), false);
  assert.equal(pointInControlsZone({ x: 900, y: 10 }, undefined), false);
});

test("reveal is immediate, hide waits for the delay and a return cancels it", () => {
  const hidden = { revealed: false, outsideSince: null };
  const shown = nextControlsReveal(hidden, true, 1000);
  assert.deepEqual(shown, { revealed: true, outsideSince: null });
  // Outside: the first check only starts the countdown.
  const leaving = nextControlsReveal(shown, false, 2000);
  assert.deepEqual(leaving, { revealed: true, outsideSince: 2000 });
  assert.deepEqual(nextControlsReveal(leaving, false, 2000 + CONTROLS_HIDE_DELAY_MS - 1), leaving);
  assert.deepEqual(nextControlsReveal(leaving, false, 2000 + CONTROLS_HIDE_DELAY_MS), { revealed: false, outsideSince: null });
  // Back in the zone before the delay: stays revealed, countdown cleared.
  assert.deepEqual(nextControlsReveal(leaving, true, 2200), { revealed: true, outsideSince: null });
  // Hidden and outside: nothing happens.
  assert.deepEqual(nextControlsReveal(hidden, false, 5000), hidden);
});

test("the frame outline is not drawn while the buttons are auto-hidden", () => {
  const input = { platform: "win32", vertical: true, compact: false, fullscreen: false, controlsWidth: 138, contentWidth: 1000 };
  assert.notEqual(controlsFrameRect(input), null);
  assert.equal(controlsFrameRect({ ...input, controlsHidden: true }), null);
  assert.notEqual(controlsFrameRect({ ...input, controlsHidden: false }), null);
});
