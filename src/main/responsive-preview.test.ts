import assert from "node:assert/strict";
import test from "node:test";
import { clampPreviewWidth, computeEmulation, createPreviewRegistry, DEVICE_PRESETS, emulationKey, isMobileWidth, toMobileUserAgent } from "./responsive-preview.js";

test("presets are phone/tablet/laptop", () => {
  assert.deepEqual(DEVICE_PRESETS.map((p) => p.width), [375, 768, 1280]);
});

test("mobile decision", () => {
  assert.equal(isMobileWidth(375), true);
  assert.equal(isMobileWidth(768), true);
  assert.equal(isMobileWidth(769), false);
});

test("clampPreviewWidth", () => {
  assert.equal(clampPreviewWidth(NaN), 375);
  assert.equal(clampPreviewWidth("x"), 375);
  assert.equal(clampPreviewWidth(10), 200);
  assert.equal(clampPreviewWidth(99999), 4000);
  assert.equal(clampPreviewWidth(400.4), 400);
});

test("emulation fits wide pane without scaling", () => {
  const p = computeEmulation(375, 600, 800);
  assert.equal(p.scale, 1);
  assert.equal(p.screenPosition, "mobile");
  assert.deepEqual(p.viewSize, { width: 375, height: 800 });
  assert.deepEqual(p.screenSize, { width: 375, height: 800 });
  assert.equal(p.deviceScaleFactor, 0);
});

test("emulation scales down in narrow pane", () => {
  const p = computeEmulation(1280, 640, 500);
  assert.equal(p.scale, 0.5);
  assert.equal(p.screenPosition, "desktop");
  assert.deepEqual(p.viewSize, { width: 1280, height: 1000 });
});

test("emulation survives degenerate pane sizes", () => {
  const p = computeEmulation(375, 0, 0);
  assert.ok(p.scale > 0 && p.scale <= 1);
  assert.ok(p.viewSize.height >= 1);
});

test("emulationKey changes with the pane size", () => {
  assert.notEqual(emulationKey(computeEmulation(375, 600, 800)), emulationKey(computeEmulation(375, 600, 700)));
  assert.equal(emulationKey(computeEmulation(375, 600, 800)), emulationKey(computeEmulation(375, 900, 800)));
});

test("mobile user agent", () => {
  const ua = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
  const mobile = toMobileUserAgent(ua);
  assert.match(mobile, /\(Linux; Android 14; Pixel 7\)/);
  assert.match(mobile, /Chrome\/140\.0\.0\.0 Mobile Safari\/537\.36/);
  assert.equal(toMobileUserAgent(mobile), mobile);
  assert.equal(toMobileUserAgent(""), "");
});

test("preview registry", () => {
  const registry = createPreviewRegistry();
  registry.set(5, 2, 9999);
  assert.deepEqual(registry.get(5), { sourceTabId: 2, width: 4000 });
  assert.equal(registry.previewOfSource(2), 5);
  assert.equal(registry.previewOfSource(3), null);
  assert.equal(registry.setWidth(5, 768)?.width, 768);
  assert.equal(registry.setWidth(6, 768), null);
  assert.deepEqual(registry.ids(), [5]);
  assert.equal(registry.remove(5), true);
  assert.equal(registry.get(5), null);
  registry.set(7, 1, 375);
  registry.clear();
  assert.deepEqual(registry.ids(), []);
});
