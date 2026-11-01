// Pure logic for Chrome extension support (no Electron): on-disk layout, persisted state, content-blocker
// detection, manifest helpers and chrome.windows.create planning. Electron glue lives in extensions.ts.
import path from "node:path";

export const EXTENSIONS_DIR_NAME = "extensions";
export const EXTENSIONS_STATE_FILE = "extensions-settings.json";
/** Private tabs only get a persistent partition (needed by Electron to host extensions) when an extension is allowed there. */
export const PRIVATE_EXT_PARTITION_NAME = "monobrowser-private-ext";
export const PRIVATE_EXT_PARTITION = `persist:${PRIVATE_EXT_PARTITION_NAME}`;

/** "<userData>/extensions": unpacked extensions (one folder each) and Chrome Web Store installs (<id>/<version>/). In portable mode userData is already the portable data folder. */
export const extensionsDirFor = (userData: string): string => path.join(userData, EXTENSIONS_DIR_NAME);
export const extensionsStateFileFor = (userData: string): string => path.join(userData, EXTENSIONS_STATE_FILE);
/** Folder Chromium keeps the persistent private-extension partition in (wiped at every start). */
export const privateExtensionsProfileDirFor = (userData: string): string => path.join(userData, "Partitions", PRIVATE_EXT_PARTITION_NAME);

// ── Persisted state ──────────────────────────────────────────────────────────
/**
 * Extensions are addressed by a stable "key": the Web Store id for store installs, `dir:<folder>` for folders inside
 * the extensions directory and `path:<absolute folder>` for "Load unpacked…" folders kept in place.
 */
export type ExtensionsState = {
  /** Keys of extensions that are installed but switched off (not loaded at startup). */
  disabled: string[];
  /** Keys of extensions allowed to run in private tabs. */
  privateAllowed: string[];
  /** Folders registered with "Load unpacked…" (kept where they are, never deleted by the browser). */
  external: string[];
};

export const EMPTY_EXTENSIONS_STATE: ExtensionsState = { disabled: [], privateAllowed: [], external: [] };

const stringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const result: string[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim() && !result.includes(entry)) result.push(entry);
  }
  return result;
};

export const normalizeExtensionsState = (value: unknown): ExtensionsState => {
  const raw = typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    disabled: stringList(raw.disabled),
    privateAllowed: stringList(raw.privateAllowed),
    external: stringList(raw.external).filter((entry) => path.isAbsolute(entry)),
  };
};

/** Adds or removes `key` (no duplicates); returns a new list. */
export const withListEntry = (list: readonly string[], key: string, present: boolean): string[] => {
  const without = list.filter((entry) => entry !== key);
  return present ? [...without, key] : without;
};

export const storeKey = (id: string): string => id;
export const dirKey = (folder: string): string => `dir:${folder}`;
export const externalKey = (absolutePath: string): string => `path:${absolutePath}`;

// ── Directory layout ─────────────────────────────────────────────────────────
/** Chrome Web Store ids are 32 letters a-p. */
export const isWebStoreExtensionId = (name: string): boolean => /^[a-p]{32}$/.test(name);

/** "1.2.10_0" style folder names compared numerically ("1.2.10" > "1.2.9"). */
export const compareVersionFolders = (a: string, b: string): number => {
  const parts = (value: string): number[] => value.split("_")[0].split(".").map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/** The newest version folder of a Web Store extension (older ones are leftovers of an update). */
export const pickLatestVersionFolder = (folders: readonly string[]): string | null =>
  folders.length === 0 ? null : [...folders].sort(compareVersionFolders)[folders.length - 1];

export type ExtensionSource = "store" | "unpacked" | "external";

export type ExtensionEntry = {
  key: string;
  source: ExtensionSource;
  /** Folder that holds manifest.json. */
  dir: string;
  /** Web Store id for store installs. */
  storeId?: string;
};

export type DirectoryReader = {
  /** Names of the sub-folders of `dir` (empty when it does not exist). */
  subfolders: (dir: string) => string[];
  hasManifest: (dir: string) => boolean;
};

/**
 * Finds every extension under the extensions directory: `<root>/<id>/<version>/` (Web Store, latest version only)
 * and `<root>/<name>/` with a manifest.json (unpacked), plus the registered external folders.
 */
export const discoverExtensionEntries = (root: string, external: readonly string[], reader: DirectoryReader): ExtensionEntry[] => {
  const entries: ExtensionEntry[] = [];
  for (const name of reader.subfolders(root)) {
    const dir = path.join(root, name);
    if (reader.hasManifest(dir)) {
      entries.push({ key: dirKey(name), source: "unpacked", dir });
    } else if (isWebStoreExtensionId(name)) {
      const withManifest = reader.subfolders(dir).filter((version) => reader.hasManifest(path.join(dir, version)));
      const latest = pickLatestVersionFolder(withManifest);
      if (latest) entries.push({ key: storeKey(name), source: "store", dir: path.join(dir, latest), storeId: name });
    }
  }
  for (const folder of external) {
    if (reader.hasManifest(folder) && !entries.some((entry) => entry.dir === folder)) {
      entries.push({ key: externalKey(folder), source: "external", dir: folder });
    }
  }
  return entries;
};

// ── Content blockers ─────────────────────────────────────────────────────────
type KnownBlocker = { name: string; ids: readonly string[]; names: readonly RegExp[] };

export const KNOWN_CONTENT_BLOCKERS: readonly KnownBlocker[] = [
  { name: "uBlock Origin", ids: ["cjpalhdlnbpafiamejdnhcphjbkeiagm"], names: [/^ublock origin(?! lite)\b/i] },
  { name: "uBlock Origin Lite", ids: ["ddkjiahejlhfcafbddmgiahcphecmpfh"], names: [/^ublock origin lite\b/i] },
  { name: "AdGuard", ids: ["bgnkhhnnamicmpeenaelnjfhikgbkllg"], names: [/^adguard\b(?!.*\bvpn\b)/i] },
  { name: "Ghostery", ids: ["mlomiejdfkolichcflejclcbmpeaniij"], names: [/^ghostery\b/i] },
  { name: "AdBlock Plus", ids: ["cfhdojbkjhnklbpkdaibdccddilifddb"], names: [/^ad\s?block\s?plus\b/i] },
  { name: "AdBlock", ids: ["gighmmpiobklfepjocnamgkkbiglidom"], names: [/^ad\s?block(?!\s?plus)\b/i] },
];

/** The well-known content blocker this extension is (by Web Store id, else by name), or null. */
export const detectContentBlocker = (extension: { id?: string | null; name?: string | null }): string | null => {
  const id = extension.id ?? "";
  const name = (extension.name ?? "").trim();
  for (const blocker of KNOWN_CONTENT_BLOCKERS) {
    if (id && blocker.ids.includes(id)) return blocker.name;
  }
  for (const blocker of KNOWN_CONTENT_BLOCKERS) {
    if (name && blocker.names.some((pattern) => pattern.test(name))) return blocker.name;
  }
  return null;
};

/** How a manifest blocks requests: Electron enforces both webRequest (+ blocking) and declarativeNetRequest rulesets. */
export type BlockerMechanism = "webRequest" | "declarativeNetRequest";

const permissionList = (manifest: Record<string, unknown>): string[] =>
  [manifest.permissions, manifest.host_permissions].flatMap((value) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []));

/** The request-blocking mechanism an extension declares (MV3 declarativeNetRequest, or MV2-style webRequest + webRequestBlocking), or null. */
export const blockerMechanism = (manifest: Record<string, unknown> | null | undefined): BlockerMechanism | null => {
  if (!manifest) return null;
  const permissions = permissionList(manifest);
  if (permissions.includes("declarativeNetRequest") || permissions.includes("declarativeNetRequestWithHostAccess")) return "declarativeNetRequest";
  if (permissions.includes("webRequest") && permissions.includes("webRequestBlocking")) return "webRequest";
  return null;
};

/** True when the extension's background is a service worker (MV3): it only blocks once that worker has started. */
export const usesServiceWorker = (manifest: Record<string, unknown> | null | undefined): boolean => {
  const background = manifest?.background as { service_worker?: unknown } | undefined;
  return typeof background?.service_worker === "string" && background.service_worker !== "";
};

/** Whether a (known) blocker can really block now: it declares a blocking mechanism and, for service workers, has started. */
export const canExtensionBlock = (manifest: Record<string, unknown> | null | undefined, workerStarted: boolean): boolean =>
  blockerMechanism(manifest) !== null && (!usesServiceWorker(manifest) || workerStarted);

export type BlockerCandidate = {
  id: string | null;
  name: string;
  enabled: boolean;
  allowedInPrivate: boolean;
  /** The extension is able to block right now (see canExtensionBlock). A broken blocker must not replace the built-in one. */
  canBlock: boolean;
};

/**
 * Name of the extension blocker that should pause the built-in one in a session: an enabled, working known blocker
 * (in private tabs it also has to be allowed there). null when the built-in blocker should keep working.
 */
export const pickPausingBlocker = (extensions: readonly BlockerCandidate[], scope: "default" | "private"): string | null => {
  for (const extension of extensions) {
    if (!extension.enabled || !extension.canBlock) continue;
    if (scope === "private" && !extension.allowedInPrivate) continue;
    const blocker = detectContentBlocker(extension);
    if (blocker) return blocker;
  }
  return null;
};

// ── Compatibility ────────────────────────────────────────────────────────────
// Permissions of chrome.* APIs that neither Electron nor electron-chrome-extensions provide (checked against the
// APIs Electron 45 + the library actually expose in an extension page).
const UNSUPPORTED_PERMISSIONS: readonly string[] = [
  "identity", "identity.email", "sidePanel", "downloads", "downloads.open", "history", "bookmarks", "topSites", "sessions", "tabGroups", "browsingData",
  "privacy", "contentSettings", "declarativeContent", "pageCapture", "tabCapture", "desktopCapture", "readingList", "search", "tts", "ttsEngine",
  "fontSettings", "printing", "gcm", "userScripts", "webAuthenticationProxy", "vpnProvider", "platformKeys", "certificateProvider", "debugger",
  "enterprise.deviceAttributes", "enterprise.hardwarePlatform", "enterprise.networkingAttributes", "enterprise.platformKeys",
];

/** Names of the manifest features this browser cannot provide (empty: fully supported as far as we can tell). */
export const findUnsupportedFeatures = (manifest: Record<string, unknown> | null | undefined): string[] => {
  if (!manifest) return [];
  const requested = [...permissionList(manifest), ...(Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions.filter((entry): entry is string => typeof entry === "string") : [])];
  const found = new Set(requested.filter((permission) => UNSUPPORTED_PERMISSIONS.includes(permission)));
  const commands = manifest.commands as Record<string, { suggested_key?: unknown }> | undefined;
  if (commands && typeof commands === "object" && Object.values(commands).some((command) => command && typeof command === "object" && command.suggested_key !== undefined)) {
    found.add("commands (keyboard shortcuts)");
  }
  return [...found];
};

// ── Manifest helpers ─────────────────────────────────────────────────────────
type MessageBundle = Record<string, { message?: unknown }>;

/**
 * Resolves "__MSG_key__" manifest strings from _locales. `readMessages(locale)` returns the parsed messages.json of
 * a locale (or null); locales are tried in order: UI language, its base language, the default locale, "en".
 */
export const resolveManifestString = (
  value: unknown,
  readMessages: (locale: string) => MessageBundle | null,
  uiLocale: string,
  defaultLocale?: string,
): string => {
  if (typeof value !== "string") return "";
  const match = /^__MSG_([A-Za-z0-9_@]+)__$/.exec(value.trim());
  if (!match) return value;
  const wanted = match[1].toLowerCase();
  const locales = [uiLocale, uiLocale.split(/[-_]/)[0], defaultLocale ?? "", "en"].filter(Boolean);
  for (const locale of locales) {
    const bundle = readMessages(locale);
    if (!bundle) continue;
    const key = Object.keys(bundle).find((candidate) => candidate.toLowerCase() === wanted);
    const message = key ? bundle[key]?.message : undefined;
    if (typeof message === "string" && message) return message;
  }
  return value;
};

type IconMap = Record<string, unknown>;

/** Relative path of the best icon for a ~48px display: the smallest one at least 48px, else the largest. */
export const pickIconPath = (manifest: Record<string, unknown>): string | null => {
  const action = (manifest.action ?? manifest.browser_action ?? manifest.page_action) as { default_icon?: unknown } | undefined;
  const candidates: unknown[] = [manifest.icons, action?.default_icon];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate) return candidate;
    if (typeof candidate !== "object" || candidate === null) continue;
    const sizes = Object.entries(candidate as IconMap)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== "")
      .map(([size, file]) => ({ size: Number.parseInt(size, 10) || 0, file }))
      .sort((a, b) => a.size - b.size);
    if (sizes.length === 0) continue;
    return (sizes.find((item) => item.size >= 48) ?? sizes[sizes.length - 1]).file;
  }
  return null;
};

/** Path of the options page declared by the manifest (options_ui.page wins over options_page). */
export const getOptionsPagePath = (manifest: Record<string, unknown>): string | null => {
  const ui = manifest.options_ui as { page?: unknown } | undefined;
  if (typeof ui?.page === "string" && ui.page) return ui.page;
  return typeof manifest.options_page === "string" && manifest.options_page ? manifest.options_page : null;
};

/** chrome-extension:// URL of a file inside an extension (leading slashes and ../ segments are rejected). */
export const extensionPageUrl = (extensionId: string, relativePath: string): string | null => {
  if (!extensionId || !relativePath) return null;
  const clean = relativePath.replace(/^\/+/, "");
  if (clean.split("/").some((part) => part === "..")) return null;
  return `chrome-extension://${extensionId}/${clean}`;
};

/** A short list of the permissions an extension asks for, for the install confirmation. */
export const summarizePermissions = (manifest: Record<string, unknown>, max = 12): string[] => {
  const collect = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  const all = [...new Set([...collect(manifest.permissions), ...collect(manifest.host_permissions)])];
  return all.length > max ? [...all.slice(0, max), `+${all.length - max}`] : all;
};

// ── chrome.windows.create ────────────────────────────────────────────────────
export type WindowPlan = {
  /** "tab": open the URLs as tabs of the main window; "popup": a small separate window. */
  kind: "tab" | "popup";
  urls: string[];
  width: number;
  height: number;
  x?: number;
  y?: number;
  focused: boolean;
  /** The extension asked for an incognito window. */
  incognito: boolean;
};

const clampSize = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(3000, Math.max(200, Math.round(value))) : fallback;

const finiteInt = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;

export const isAllowedWindowUrl = (url: string): boolean => /^(https?:|chrome-extension:)\/\//i.test(url) || url === "about:blank";

export const planWindowCreate = (details: unknown): WindowPlan => {
  const raw = typeof details === "object" && details !== null ? (details as Record<string, unknown>) : {};
  const urlInput = Array.isArray(raw.url) ? raw.url : raw.url === undefined ? [] : [raw.url];
  const urls = urlInput.filter((url): url is string => typeof url === "string" && isAllowedWindowUrl(url));
  const type = raw.type;
  return {
    kind: type === "popup" || type === "panel" || type === "detached_panel" ? "popup" : "tab",
    urls,
    width: clampSize(raw.width, 500),
    height: clampSize(raw.height, 640),
    x: finiteInt(raw.left),
    y: finiteInt(raw.top),
    focused: raw.focused !== false,
    incognito: raw.incognito === true,
  };
};
