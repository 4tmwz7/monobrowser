import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  KNOWN_CONTENT_BLOCKERS, PRIVATE_EXT_PARTITION, compareVersionFolders, detectContentBlocker, discoverExtensionEntries, extensionPageUrl,
  extensionsDirFor, extensionsStateFileFor, getOptionsPagePath, isAllowedWindowUrl, isWebStoreExtensionId, normalizeExtensionsState,
  blockerMechanism, canExtensionBlock, findUnsupportedFeatures, usesServiceWorker, pickIconPath, pickLatestVersionFolder, pickPausingBlocker, planWindowCreate, privateExtensionsProfileDirFor, resolveManifestString,
  summarizePermissions, withListEntry, type DirectoryReader,
} from "./extensions-logic.js";

const STORE_ID = "ddkjiahejlhfcafbddmgiahcphecmpfh";

test("paths live under the given userData (portable data folder included)", () => {
  const portable = path.join("/usb", "MonoBrowser Data");
  assert.equal(extensionsDirFor(portable), path.join(portable, "extensions"));
  assert.equal(extensionsStateFileFor(portable), path.join(portable, "extensions-settings.json"));
  assert.equal(privateExtensionsProfileDirFor(portable), path.join(portable, "Partitions", "monobrowser-private-ext"));
  assert.ok(PRIVATE_EXT_PARTITION.startsWith("persist:"));
});

test("state normalization drops junk, duplicates and relative external paths", () => {
  assert.deepEqual(normalizeExtensionsState(null), { disabled: [], privateAllowed: [], external: [] });
  assert.deepEqual(normalizeExtensionsState({
    disabled: ["a", "a", 3, "", "b"],
    privateAllowed: "nope",
    external: [path.resolve("/x/ext"), "relative/dir"],
  }), { disabled: ["a", "b"], privateAllowed: [], external: [path.resolve("/x/ext")] });
});

test("disabled state toggles without duplicates", () => {
  let disabled = withListEntry([], "k", true);
  disabled = withListEntry(disabled, "k", true);
  assert.deepEqual(disabled, ["k"]);
  assert.deepEqual(withListEntry(disabled, "k", false), []);
  assert.deepEqual(withListEntry(["a"], "b", true), ["a", "b"]);
});

test("web store ids and version folders", () => {
  assert.equal(isWebStoreExtensionId(STORE_ID), true);
  assert.equal(isWebStoreExtensionId("my-extension"), false);
  assert.equal(isWebStoreExtensionId(`${STORE_ID}x`), false);
  assert.ok(compareVersionFolders("1.2.10_0", "1.2.9_0") > 0);
  assert.equal(compareVersionFolders("2025.1.1_0", "2025.1.1_1"), 0);
  assert.equal(pickLatestVersionFolder(["1.9_0", "1.10_0", "1.2_0"]), "1.10_0");
  assert.equal(pickLatestVersionFolder([]), null);
});

test("discovery separates unpacked folders, store installs (latest version) and external folders", () => {
  const root = path.join("/data", "extensions");
  const tree: Record<string, string[]> = {
    [root]: ["dark-reader", STORE_ID, "empty-dir"],
    [path.join(root, STORE_ID)]: ["1.0_0", "1.1_0"],
    [path.join(root, "dark-reader")]: ["icons"],
    [path.join(root, "empty-dir")]: [],
  };
  const manifests = new Set([
    path.join(root, "dark-reader"),
    path.join(root, STORE_ID, "1.0_0"),
    path.join(root, STORE_ID, "1.1_0"),
    path.resolve("/dev/my-ext"),
  ]);
  const reader: DirectoryReader = { subfolders: (dir) => tree[dir] ?? [], hasManifest: (dir) => manifests.has(dir) };
  const entries = discoverExtensionEntries(root, [path.resolve("/dev/my-ext"), path.resolve("/dev/gone")], reader);
  assert.deepEqual(entries.map((entry) => [entry.key, entry.source, entry.dir]), [
    ["dir:dark-reader", "unpacked", path.join(root, "dark-reader")],
    [STORE_ID, "store", path.join(root, STORE_ID, "1.1_0")],
    [`path:${path.resolve("/dev/my-ext")}`, "external", path.resolve("/dev/my-ext")],
  ]);
  assert.equal(entries[1].storeId, STORE_ID);
});

test("known content blockers are detected by id and by name", () => {
  assert.equal(detectContentBlocker({ id: "cjpalhdlnbpafiamejdnhcphjbkeiagm", name: "whatever" }), "uBlock Origin");
  assert.equal(detectContentBlocker({ id: STORE_ID, name: "x" }), "uBlock Origin Lite");
  assert.equal(detectContentBlocker({ id: null, name: "uBlock Origin" }), "uBlock Origin");
  assert.equal(detectContentBlocker({ id: null, name: "uBlock Origin Lite" }), "uBlock Origin Lite");
  assert.equal(detectContentBlocker({ id: null, name: "AdGuard AdBlocker" }), "AdGuard");
  assert.equal(detectContentBlocker({ id: null, name: "AdGuard VPN" }), null);
  assert.equal(detectContentBlocker({ id: null, name: "Ghostery – Privacy Ad Blocker" }), "Ghostery");
  assert.equal(detectContentBlocker({ id: null, name: "Adblock Plus - free ad blocker" }), "AdBlock Plus");
  assert.equal(detectContentBlocker({ id: null, name: "AdBlock — block ads across the web" }), "AdBlock");
  assert.equal(detectContentBlocker({ id: null, name: "Bitwarden Password Manager" }), null);
  assert.equal(detectContentBlocker({ id: null, name: "Dark Reader" }), null);
  assert.equal(detectContentBlocker({}), null);
  assert.equal(new Set(KNOWN_CONTENT_BLOCKERS.map((blocker) => blocker.name)).size, KNOWN_CONTENT_BLOCKERS.length);
});

test("an enabled blocker pauses the built-in one; private tabs need the extension allowed there", () => {
  const ubo = { id: "cjpalhdlnbpafiamejdnhcphjbkeiagm", name: "uBlock Origin", enabled: true, allowedInPrivate: false, canBlock: true };
  const other = { id: "a".repeat(32), name: "Dark Reader", enabled: true, allowedInPrivate: true, canBlock: false };
  assert.equal(pickPausingBlocker([other], "default"), null);
  assert.equal(pickPausingBlocker([other, ubo], "default"), "uBlock Origin");
  assert.equal(pickPausingBlocker([other, ubo], "private"), null);
  assert.equal(pickPausingBlocker([{ ...ubo, allowedInPrivate: true }], "private"), "uBlock Origin");
  assert.equal(pickPausingBlocker([{ ...ubo, enabled: false }], "default"), null);
  assert.equal(pickPausingBlocker([{ ...ubo, canBlock: false }], "default"), null, "a blocker whose worker failed to start must not replace the built-in one");
});

test("manifest strings are localized from _locales with fallbacks", () => {
  const bundles: Record<string, Record<string, { message: string }>> = {
    en: { extName: { message: "Dark Reader" }, extDesc: { message: "English description" } },
    pl: { extname: { message: "Ciemny czytnik" } },
  };
  const read = (locale: string) => bundles[locale] ?? null;
  assert.equal(resolveManifestString("Plain", read, "pl"), "Plain");
  assert.equal(resolveManifestString("__MSG_extName__", read, "pl"), "Ciemny czytnik");
  assert.equal(resolveManifestString("__MSG_extDesc__", read, "pl"), "English description");
  assert.equal(resolveManifestString("__MSG_missing__", read, "pl"), "__MSG_missing__");
  assert.equal(resolveManifestString("__MSG_extName__", read, "de", "en"), "Dark Reader");
  assert.equal(resolveManifestString(undefined, read, "en"), "");
});

test("icon and options page selection", () => {
  assert.equal(pickIconPath({ icons: { "16": "a16.png", "48": "a48.png", "128": "a128.png" } }), "a48.png");
  assert.equal(pickIconPath({ icons: { "16": "a16.png", "32": "a32.png" } }), "a32.png");
  assert.equal(pickIconPath({ action: { default_icon: "act.png" } }), "act.png");
  assert.equal(pickIconPath({ browser_action: { default_icon: { "19": "b19.png" } } }), "b19.png");
  assert.equal(pickIconPath({}), null);
  assert.equal(getOptionsPagePath({ options_page: "old.html" }), "old.html");
  assert.equal(getOptionsPagePath({ options_page: "old.html", options_ui: { page: "new.html" } }), "new.html");
  assert.equal(getOptionsPagePath({}), null);
  assert.equal(extensionPageUrl(STORE_ID, "/options/index.html"), `chrome-extension://${STORE_ID}/options/index.html`);
  assert.equal(extensionPageUrl(STORE_ID, "../x"), null);
});

test("permission summary is deduplicated and capped", () => {
  assert.deepEqual(summarizePermissions({ permissions: ["storage", "tabs"], host_permissions: ["<all_urls>", "tabs"] }), ["storage", "tabs", "<all_urls>"]);
  const many = Array.from({ length: 20 }, (_, index) => `p${index}`);
  const summary = summarizePermissions({ permissions: many }, 5);
  assert.equal(summary.length, 6);
  assert.equal(summary[5], "+15");
});

test("chrome.windows.create: popups become windows, everything else tabs; unsafe URLs are dropped", () => {
  const popup = planWindowCreate({ url: "chrome-extension://abc/popup.html", type: "popup", width: 400, height: 10, left: 5.4, top: 7 });
  assert.equal(popup.kind, "popup");
  assert.deepEqual(popup.urls, ["chrome-extension://abc/popup.html"]);
  assert.equal(popup.width, 400);
  assert.equal(popup.height, 200); // clamped
  assert.deepEqual([popup.x, popup.y], [5, 7]);
  const normal = planWindowCreate({ url: ["https://a.example", "file:///etc/passwd", "javascript:alert(1)"] });
  assert.equal(normal.kind, "tab");
  assert.deepEqual(normal.urls, ["https://a.example"]);
  assert.equal(planWindowCreate({ type: "panel" }).kind, "popup");
  assert.equal(planWindowCreate(undefined).kind, "tab");
  assert.equal(planWindowCreate({ focused: false }).focused, false);
  assert.equal(planWindowCreate({ incognito: true }).incognito, true);
  assert.equal(isAllowedWindowUrl("about:blank"), true);
  assert.equal(isAllowedWindowUrl("data:text/html,x"), false);
});

test("blocker mechanism: declarativeNetRequest (MV3) or webRequest + webRequestBlocking (MV2)", () => {
  assert.equal(blockerMechanism({ manifest_version: 3, permissions: ["declarativeNetRequest", "storage"] }), "declarativeNetRequest");
  assert.equal(blockerMechanism({ manifest_version: 3, permissions: ["declarativeNetRequestWithHostAccess"] }), "declarativeNetRequest");
  assert.equal(blockerMechanism({ manifest_version: 2, permissions: ["webRequest", "webRequestBlocking", "<all_urls>"] }), "webRequest");
  assert.equal(blockerMechanism({ manifest_version: 2, permissions: ["webRequest"] }), null);
  assert.equal(blockerMechanism({ permissions: ["storage"] }), null);
  assert.equal(blockerMechanism(null), null);
});

test("a service-worker blocker only counts once its worker has started", () => {
  const mv3 = { manifest_version: 3, permissions: ["declarativeNetRequest"], background: { service_worker: "/js/background.js" } };
  const mv2 = { manifest_version: 2, permissions: ["webRequest", "webRequestBlocking"], background: { scripts: ["bg.js"] } };
  assert.equal(usesServiceWorker(mv3), true);
  assert.equal(usesServiceWorker(mv2), false);
  assert.equal(canExtensionBlock(mv3, false), false);
  assert.equal(canExtensionBlock(mv3, true), true);
  assert.equal(canExtensionBlock(mv2, false), true);
  assert.equal(canExtensionBlock({ manifest_version: 3, permissions: ["storage"] }, true), false);
});

test("unsupported features are reported (identity, sidePanel, shortcuts, ...)", () => {
  assert.deepEqual(findUnsupportedFeatures({ permissions: ["storage", "tabs", "scripting"] }), []);
  assert.deepEqual(findUnsupportedFeatures({ permissions: ["identity", "storage"], optional_permissions: ["history"], host_permissions: ["<all_urls>"] }).sort(), ["history", "identity"]);
  assert.deepEqual(findUnsupportedFeatures({ commands: { run: { description: "x", suggested_key: { default: "Ctrl+Shift+Y" } } } }), ["commands (keyboard shortcuts)"]);
  assert.deepEqual(findUnsupportedFeatures({ commands: { run: { description: "x" } } }), []);
  assert.deepEqual(findUnsupportedFeatures(undefined), []);
});
