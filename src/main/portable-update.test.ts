import assert from "node:assert/strict";
import test from "node:test";
import {
  buildNewVersionNotice, compareVersions, isNewerVersion, isTrustedAssetUrl, parseAppUpdateYml, parseLatestRelease,
  releaseApiUrl, releasePageUrl, repoFromPackageJson, resolveUpdateMode,
} from "./portable-update.js";

test("version comparison follows semver precedence", () => {
  assert.equal(compareVersions("0.5.2", "0.5.2"), 0);
  assert.equal(compareVersions("v0.6.0", "0.5.9"), 1);
  assert.equal(compareVersions("0.5.2", "0.10.0"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-rc.1"), 1);
  assert.equal(compareVersions("1.0.0-rc.2", "1.0.0-rc.10"), -1);
  assert.equal(compareVersions("1.0.0-alpha", "1.0.0-1"), 1);
  assert.equal(compareVersions("1.0.0+build5", "1.0.0"), 0);
  assert.equal(compareVersions("nope", "1.0.0"), null);
  assert.equal(isNewerVersion("v0.5.3", "0.5.2"), true);
  assert.equal(isNewerVersion("0.5.2", "0.5.2"), false);
  assert.equal(isNewerVersion("0.5.1", "0.5.2"), false);
  assert.equal(isNewerVersion("garbage", "0.5.2"), false);
});

test("update repo is read from app-update.yml and package.json publish config", () => {
  assert.deepEqual(parseAppUpdateYml("owner: 4tmwz7\nrepo: monobrowser\nprovider: github\nupdaterCacheDirName: monobrowser-updater\n"), { owner: "4tmwz7", repo: "monobrowser" });
  assert.equal(parseAppUpdateYml("provider: generic\nurl: https://x\n"), null);
  assert.equal(parseAppUpdateYml("owner: a/b\nrepo: c\nprovider: github"), null);
  const pkg = { build: { publish: [{ provider: "github", owner: "o", repo: "r", releaseType: "draft" }] } };
  assert.deepEqual(repoFromPackageJson(pkg), { owner: "o", repo: "r" });
  assert.equal(repoFromPackageJson({}), null);
  assert.equal(releaseApiUrl("https://api.github.com/", { owner: "o", repo: "r" }), "https://api.github.com/repos/o/r/releases/latest");
});


test("latest release payload is validated", () => {
  assert.deepEqual(parseLatestRelease({ tag_name: "v0.6.0", draft: false, prerelease: false, assets: [] }), { tag: "v0.6.0", version: "0.6.0" });
  assert.equal(parseLatestRelease({ tag_name: "v0.6.0", prerelease: true }), null);
  assert.equal(parseLatestRelease({ tag_name: "v0.6.0", draft: true }), null);
  assert.equal(parseLatestRelease({ tag_name: "latest" }), null);
  assert.equal(parseLatestRelease(null), null);
});

test("release page URL is built from the repo and tag", () => {
  assert.equal(releasePageUrl({ owner: "o", repo: "r" }, "v0.7.0"), "https://github.com/o/r/releases/tag/v0.7.0");
  assert.equal(isTrustedAssetUrl(releasePageUrl({ owner: "o", repo: "r" }, "v1.0.0")), true);
});

test("release URLs must come from GitHub (or an explicitly allowed origin)", () => {
  assert.equal(isTrustedAssetUrl("https://objects.githubusercontent.com/x"), true);
  assert.equal(isTrustedAssetUrl("http://github.com/o/r/a.exe"), false);
  assert.equal(isTrustedAssetUrl("https://evilgithub.com/a.exe"), false);
  assert.equal(isTrustedAssetUrl("https://github.com.evil.io/a.exe"), false);
  assert.equal(isTrustedAssetUrl("http://127.0.0.1:9999/a.exe"), false);
  assert.equal(isTrustedAssetUrl("http://127.0.0.1:9999/a.exe", "http://127.0.0.1:9999"), true);
});

test("update mode: installed and AppImage use electron-updater, other portable builds only notify", () => {
  const base = { packaged: true, portable: false, platform: "win32", env: {} as Record<string, string | undefined> };
  assert.equal(resolveUpdateMode(base), "electron-updater");
  assert.equal(resolveUpdateMode({ ...base, portable: true, env: { PORTABLE_EXECUTABLE_FILE: "E:\\MonoBrowser.exe" } }), "notify");
  assert.equal(resolveUpdateMode({ ...base, portable: true }), "notify");
  assert.equal(resolveUpdateMode({ ...base, platform: "linux", portable: true, env: { APPIMAGE: "/mnt/usb/MonoBrowser.AppImage" } }), "electron-updater");
  assert.equal(resolveUpdateMode({ ...base, platform: "linux", portable: true }), "notify");
  assert.equal(resolveUpdateMode({ ...base, packaged: false }), "dev");
  assert.equal(resolveUpdateMode({ ...base, packaged: false, portable: true }), "dev");
});

test("new version notice is bilingual, shown in any tab, names the version and offers the release page", () => {
  const pl = buildNewVersionNotice("pl", "0.7.0");
  const en = buildNewVersionNotice("en", "0.7.0");
  assert.equal(pl.tabId, null);
  assert.equal(pl.primary, "Otwórz stronę wydania");
  assert.equal(en.primary, "Open release page");
  assert.match(pl.lines[0].text, /0\.7\.0.*npm run dist:win:portable.*pendrive/);
  assert.match(en.lines[0].text, /0\.7\.0.*npm run dist:win:portable.*USB drive/);
});
