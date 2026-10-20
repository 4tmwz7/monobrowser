import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { detectPortable, normalizePortableSettings, portablePaths, PORTABLE_DATA_DIR_NAME } from "./portable-paths.js";

const none = () => false;

test("PORTABLE_EXECUTABLE_DIR enables portable mode", () => {
  const found = detectPortable({ env: { PORTABLE_EXECUTABLE_DIR: "/mnt/usb" }, execPath: "/tmp/x/app", exists: none });
  assert.deepEqual(found, { exeDir: "/mnt/usb", dataDir: path.join("/mnt/usb", PORTABLE_DATA_DIR_NAME), source: "env" });
});

test("no env and no marker means a normal install", () => {
  assert.equal(detectPortable({ env: {}, execPath: "/opt/mb/monobrowser", exists: none }), null);
  assert.equal(detectPortable({ env: { PORTABLE_EXECUTABLE_DIR: "  " }, execPath: "/opt/mb/monobrowser", exists: none }), null);
});

test("portable.txt or the data folder next to the executable enables portable mode", () => {
  const file = detectPortable({ env: {}, execPath: "/mnt/usb/MonoBrowser", exists: (p) => p === "/mnt/usb/portable.txt" });
  assert.equal(file?.source, "marker-file");
  assert.equal(file?.exeDir, "/mnt/usb");
  const folder = detectPortable({ env: {}, execPath: "/mnt/usb/MonoBrowser", exists: (p) => p === path.join("/mnt/usb", PORTABLE_DATA_DIR_NAME) });
  assert.equal(folder?.source, "marker-folder");
});

test("AppImage directory is checked for markers, not assumed portable", () => {
  const env = { APPIMAGE: "/home/u/stick/MonoBrowser.AppImage" };
  assert.equal(detectPortable({ env, execPath: "/tmp/.mount_x/monobrowser", exists: none }), null);
  const found = detectPortable({ env, execPath: "/tmp/.mount_x/monobrowser", exists: (p) => p === "/home/u/stick/portable.txt" });
  assert.equal(found?.exeDir, "/home/u/stick");
});

test("all paths stay inside the data directory", () => {
  const data = "/mnt/usb/MonoBrowser Data";
  for (const value of Object.values(portablePaths(data))) assert.ok(value === data || value.startsWith(`${data}${path.sep}`), value);
  assert.equal(portablePaths(data).vault, path.join(data, "portable-cookies.json"));
});

test("portable settings default to system downloads", () => {
  assert.deepEqual(normalizePortableSettings(null), { downloadsInDataFolder: false });
  assert.deepEqual(normalizePortableSettings({ downloadsInDataFolder: true }), { downloadsInDataFolder: true });
  assert.deepEqual(normalizePortableSettings({ downloadsInDataFolder: "yes" }), { downloadsInDataFolder: false });
});
