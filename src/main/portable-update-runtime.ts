// Update mode + GitHub release lookup for the notify-only portable edition (no download, no self-replace).
// Pure rules live in portable-update.ts. Electron-updater keeps handling installed builds and the Linux AppImage.
import fs from "node:fs";
import path from "node:path";
import { app, net } from "electron";
import { isPortableMode } from "./portable-mode.js";
import {
  DEFAULT_API_BASE, DEFAULT_UPDATE_REPO, isNewerVersion, parseAppUpdateYml, parseLatestRelease, releaseApiUrl,
  releasePageUrl, repoFromPackageJson, resolveUpdateMode, type UpdateMode, type UpdateRepo,
} from "./portable-update.js";

const CHECK_TIMEOUT_MS = 10_000;

let cachedMode: UpdateMode | null = null;

export const getUpdateMode = (): UpdateMode => {
  cachedMode ??= resolveUpdateMode({
    packaged: app.isPackaged,
    portable: isPortableMode(),
    platform: process.platform,
    env: process.env,
  });
  return cachedMode;
};

const apiBase = (): string => {
  const override = process.env.MONOBROWSER_UPDATE_API_BASE?.trim();
  return !app.isPackaged && override ? override : DEFAULT_API_BASE;
};

const resolveRepo = (): UpdateRepo => {
  try {
    const fromYml = parseAppUpdateYml(fs.readFileSync(path.join(process.resourcesPath, "app-update.yml"), "utf8"));
    if (fromYml) return fromYml;
  } catch { /* not present in dev */ }
  try {
    const fromPkg = repoFromPackageJson(JSON.parse(fs.readFileSync(path.join(app.getAppPath(), "package.json"), "utf8")));
    if (fromPkg) return fromPkg;
  } catch { /* fall through */ }
  return DEFAULT_UPDATE_REPO;
};

export type NewerRelease = { version: string; url: string };

/** Asks GitHub for the latest release; null when it is not newer than the running app. Throws on network/payload errors. */
export const checkForNewerRelease = async (): Promise<NewerRelease | null> => {
  const repo = resolveRepo();
  const response = await net.fetch(releaseApiUrl(apiBase(), repo), {
    headers: { Accept: "application/vnd.github+json", "User-Agent": `MonoBrowser/${app.getVersion()}` },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub release check failed with HTTP ${response.status}`);
  const release = parseLatestRelease(await response.json());
  if (!release) throw new Error("Unexpected release payload");
  if (!isNewerVersion(release.version, app.getVersion())) return null;
  return { version: release.version, url: releasePageUrl(repo, release.tag) };
};
