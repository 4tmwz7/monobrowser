// Portable build update notice: pure logic (no Electron, no I/O) so it can be unit-tested on any OS.
// The portable Windows edition is private and built locally (`npm run dist:win:portable`), so it never downloads or
// replaces itself: it only checks GitHub Releases for a newer version and tells the user to rebuild.
// Installed builds and the Linux AppImage keep using electron-updater.
import type { PromptRequest } from "./prompt-overlay.js";

// --- versions -----------------------------------------------------------------------------------------------------

export type ParsedVersion = { core: [number, number, number]; prerelease: Array<string | number> };

/** Parses "v1.2.3", "1.2.3-beta.1+build"; returns null for anything that is not semver-like. */
export const parseVersion = (value: unknown): ParsedVersion | null => {
  if (typeof value !== "string") return null;
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(value.trim());
  if (!match) return null;
  const prerelease = match[4]
    ? match[4].split(".").map((part) => (/^\d+$/.test(part) ? Number(part) : part))
    : [];
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease };
};

/** Semver precedence: -1 / 0 / 1, or null when either side is not a valid version. */
export const compareVersions = (a: unknown, b: unknown): -1 | 0 | 1 | null => {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  for (let index = 0; index < 3; index += 1) {
    if (left.core[index] !== right.core[index]) return left.core[index] > right.core[index] ? 1 : -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1; // 1.0.0 > 1.0.0-rc.1
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const x = left.prerelease[index];
    const y = right.prerelease[index];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    if (typeof x === "number" && typeof y === "number") return x > y ? 1 : -1;
    if (typeof x === "number") return -1; // numeric identifiers sort before alphanumeric ones
    if (typeof y === "number") return 1;
    return x > y ? 1 : -1;
  }
  return 0;
};

export const isNewerVersion = (candidate: unknown, current: unknown): boolean => compareVersions(candidate, current) === 1;

export const stripVersionPrefix = (value: string): string => value.trim().replace(/^v/i, "");

// --- repository ---------------------------------------------------------------------------------------------------

export type UpdateRepo = { owner: string; repo: string };

export const DEFAULT_UPDATE_REPO: UpdateRepo = { owner: "4tmwz7", repo: "monobrowser" };
export const DEFAULT_API_BASE = "https://api.github.com";

const REPO_PART = /^[A-Za-z0-9._-]{1,100}$/;
const validRepo = (owner: unknown, repo: unknown): UpdateRepo | null =>
  typeof owner === "string" && typeof repo === "string" && REPO_PART.test(owner) && REPO_PART.test(repo) ? { owner, repo } : null;

/** electron-builder writes `provider: github` / `owner:` / `repo:` into resources/app-update.yml. */
export const parseAppUpdateYml = (text: string): UpdateRepo | null => {
  const read = (key: string): string | undefined => new RegExp(`^${key}:\\s*['"]?([^'"\\s#]+)['"]?\\s*$`, "m").exec(text)?.[1];
  const provider = read("provider");
  if (provider && provider !== "github") return null;
  return validRepo(read("owner"), read("repo"));
};

/** The `build.publish` entry of package.json (the same config electron-builder publishes to). */
export const repoFromPackageJson = (pkg: unknown): UpdateRepo | null => {
  const publish = (pkg as { build?: { publish?: unknown } } | null)?.build?.publish;
  const entries = Array.isArray(publish) ? publish : publish ? [publish] : [];
  for (const entry of entries) {
    const item = entry as { provider?: unknown; owner?: unknown; repo?: unknown };
    if (item && item.provider === "github") {
      const found = validRepo(item.owner, item.repo);
      if (found) return found;
    }
  }
  return null;
};

export const releaseApiUrl = (base: string, repo: UpdateRepo): string =>
  `${base.replace(/\/+$/, "")}/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/latest`;

// --- release -----------------------------------------------------------------------------------------------------

export type LatestRelease = { tag: string; version: string };

/** Validates the (untrusted) GitHub API payload; drafts and prereleases are refused. */
export const parseLatestRelease = (payload: unknown): LatestRelease | null => {
  if (typeof payload !== "object" || payload === null) return null;
  const release = payload as { tag_name?: unknown; draft?: unknown; prerelease?: unknown };
  if (release.draft === true || release.prerelease === true) return null;
  if (typeof release.tag_name !== "string" || !parseVersion(release.tag_name)) return null;
  return { tag: release.tag_name, version: stripVersionPrefix(release.tag_name) };
};

/** GitHub release page for a tag (built locally, never taken from the API payload). */
export const releasePageUrl = (repo: UpdateRepo, tag: string): string =>
  `https://github.com/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/releases/tag/${encodeURIComponent(tag)}`;

/** Hosts a release URL may point to (initial URL; the optional extra origin is for tests / local mocks). */
export const isTrustedAssetUrl = (url: string, extraOrigin?: string): boolean => {
  try {
    const parsed = new URL(url);
    if (extraOrigin && parsed.origin === extraOrigin) return true;
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "github.com" || host === "api.github.com" || host.endsWith(".githubusercontent.com");
  } catch {
    return false;
  }
};

// --- update mode --------------------------------------------------------------------------------------------------

export type UpdateMode = "dev" | "electron-updater" | "notify";

export type UpdateModeInput = {
  packaged: boolean;
  portable: boolean;
  platform: string;
  env: Record<string, string | undefined>;
};

/**
 * - electron-updater: installed builds and the Linux AppImage (also when running in portable mode)
 * - notify: any other portable layout (Windows portable .exe, unpacked folder): checks for a new release and only informs
 * - dev: unpackaged; manual check only, informs only
 */
export const resolveUpdateMode = (input: UpdateModeInput): UpdateMode => {
  if (!input.packaged) return "dev";
  if (!input.portable) return "electron-updater";
  if (input.platform === "linux" && Boolean(input.env.APPIMAGE?.trim())) return "electron-updater";
  return "notify";
};

// --- in-window notice ---------------------------------------------------------------------------------------------

export const buildNewVersionNotice = (lang: "pl" | "en", version: string): PromptRequest => {
  const pl = lang === "pl";
  return {
    kind: "confirm",
    tabId: null,
    title: pl ? "Nowa wersja" : "New version",
    lines: [
      {
        text: pl
          ? `Dostępna jest nowa wersja MonoBrowser ${version}. Zbuduj nową wersję przenośną (npm run dist:win:portable) i podmień plik .exe na pendrive.`
          : `A new version of MonoBrowser ${version} is available. Build a new portable version (npm run dist:win:portable) and replace the .exe file on the USB drive.`,
        style: "strong",
      },
    ],
    primary: pl ? "Otwórz stronę wydania" : "Open release page",
    secondary: pl ? "Zamknij" : "Close",
  };
};
