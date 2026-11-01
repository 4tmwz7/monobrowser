import { app, BrowserWindow, dialog, session, shell } from "electron";
import type { ContextMenuParams, Extension, MenuItem, Session, WebContents } from "electron";
import { ElectronChromeExtensions } from "electron-chrome-extensions";
import { installChromeWebStore, uninstallExtension, updateExtensions } from "electron-chrome-web-store";
import fs from "node:fs";
import path from "node:path";
import {
  EMPTY_EXTENSIONS_STATE, PRIVATE_EXT_PARTITION, dirKey, discoverExtensionEntries, extensionPageUrl, extensionsDirFor,
  extensionsStateFileFor, externalKey, getOptionsPagePath, normalizeExtensionsState, pickIconPath, pickPausingBlocker,
  canExtensionBlock, detectContentBlocker, findUnsupportedFeatures, planWindowCreate, privateExtensionsProfileDirFor, resolveManifestString, summarizePermissions,
  withListEntry,
  type ExtensionEntry, type ExtensionSource, type ExtensionsState,
} from "./extensions-logic.js";

// Chrome extension support: electron-chrome-extensions (chrome.* APIs, toolbar actions, popups, context menus,
// chrome.windows) plus electron-chrome-web-store (install from chromewebstore.google.com, auto-updates).
// Normal tabs use session.defaultSession. Private tabs use an in-memory session by default, where Electron cannot
// load extensions at all; when at least one extension is allowed in private mode the private session becomes a
// persistent partition that is wiped at startup and whenever the private tabs are closed (see privatePartitionFor).

export type Language = "pl" | "en";

export interface ExtensionsHost {
  /** Creates a tab (normal or private) and returns its webContents, or null when impossible. */
  createTab: (url: string, active: boolean, isPrivate: boolean) => WebContents | null;
  /** Activates the tab owning this webContents. */
  selectTab: (contents: WebContents) => void;
  /** Closes the tab owning this webContents. */
  removeTab: (contents: WebContents) => void;
  getWindow: () => BrowserWindow | null;
  /** webContents of the active tab if it is a web tab of the given kind (not internal, not sleeping). */
  getActiveContents: (isPrivate: boolean) => WebContents | null;
  getLanguage: () => Language;
  /** Top-left of the view hosting the toolbar in window coordinates (non-zero for the compact overlay). */
  getShellOrigin: () => { x: number; y: number };
  /** The set of installed/enabled extensions changed (toolbar, settings page, built-in blocker). */
  onChanged: () => void;
}

type Scope = "default" | "private";

export type ExtensionInfo = {
  key: string;
  id: string | null;
  name: string;
  version: string;
  description: string;
  iconDataUrl: string | null;
  source: ExtensionSource;
  enabled: boolean;
  allowedInPrivate: boolean;
  hasOptions: boolean;
  path: string;
  /** Known content blocker this extension is (it pauses the built-in blocker while enabled and working). */
  contentBlocker: string | null;
  /** The blocker is enabled and able to block now, so the built-in blocker is paused for it. */
  blockerWorking: boolean;
  /** Manifest features this browser cannot provide (permissions of missing chrome.* APIs). */
  unsupported: string[];
  manifestVersion: number;
  error: string | null;
};

export type ExtensionsSnapshot = {
  items: ExtensionInfo[];
  directory: string;
  /** Name of the extension that currently pauses the built-in blocker in normal tabs. */
  pausedBlocker: string | null;
  /** The private session is a persistent partition hosting extensions (otherwise "allow in private" needs a restart). */
  privateReady: boolean;
  privateRestartNeeded: boolean;
};

let host: ExtensionsHost | null = null;
let state: ExtensionsState = EMPTY_EXTENSIONS_STATE;
const instances: Record<Scope, ElectronChromeExtensions | null> = { default: null, private: null };
let privateSession: Session | null = null;
let privateProfileWanted = false;
let started = false;
let hostCallbacksSuppressed = 0;
const loadedIds = new Map<string, string>();
const loadErrors = new Map<string, string>();
const popupWindows = new Set<BrowserWindow>();
const actionPopups = new Set<{ isDestroyed: () => boolean }>();
let blockerCache: Record<Scope, string | null> = { default: null, private: null };
/** Extension ids whose service worker reached "running" at least once (a worker that fails at startup never does). */
const startedWorkers: Record<Scope, Set<string>> = { default: new Set(), private: new Set() };
let changeTimer: NodeJS.Timeout | null = null;

const t = (pl: string, en: string): string => (host?.getLanguage() === "pl" ? pl : en);
const userData = (): string => app.getPath("userData");

export const getExtensionsDir = (): string => extensionsDirFor(userData());

/** Runs `fn` while the library's selectTab/removeTab callbacks (fired as side effects of our own calls) are ignored. */
const quietly = <T>(fn: () => T): T => {
  hostCallbacksSuppressed += 1;
  try { return fn(); } finally { hostCallbacksSuppressed -= 1; }
};

// ── Persisted state ──────────────────────────────────────────────────────────
const readState = (): ExtensionsState => {
  try {
    return normalizeExtensionsState(JSON.parse(fs.readFileSync(extensionsStateFileFor(userData()), "utf8")));
  } catch {
    return { ...EMPTY_EXTENSIONS_STATE, disabled: [], privateAllowed: [], external: [] };
  }
};

let saveChain: Promise<void> = Promise.resolve();
const saveState = (): void => {
  const file = extensionsStateFileFor(userData());
  const text = JSON.stringify(state, null, 2);
  saveChain = saveChain.then(async () => {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      await fs.promises.writeFile(tmp, text, "utf8");
      await fs.promises.rename(tmp, file);
    } catch (error) {
      await fs.promises.rm(tmp, { force: true }).catch(() => undefined);
      console.error("[extensions] failed to save settings:", error);
    }
  });
};

const setState = (next: ExtensionsState): void => {
  state = next;
  saveState();
};

// ── Discovery ────────────────────────────────────────────────────────────────
const discover = (): ExtensionEntry[] =>
  discoverExtensionEntries(getExtensionsDir(), state.external, {
    subfolders: (dir) => {
      try {
        return fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
      } catch {
        return [];
      }
    },
    hasManifest: (dir) => fs.existsSync(path.join(dir, "manifest.json")),
  });

const samePath = (a: string, b: string): boolean => {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === "win32" ? left.toLowerCase() === right.toLowerCase() : left === right;
};

const entryForPath = (extensionPath: string): ExtensionEntry | undefined =>
  discover().find((entry) => samePath(entry.dir, extensionPath));

const readManifest = (dir: string): Record<string, unknown> | null => {
  try {
    const text = fs.readFileSync(path.join(dir, "manifest.json"), "utf8").replace(/^﻿/, "");
    const parsed = JSON.parse(text) as unknown;
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const readMessagesFor = (dir: string) => (locale: string): Record<string, { message?: unknown }> | null => {
  const root = path.join(dir, "_locales");
  const candidates = [locale];
  try {
    for (const name of fs.readdirSync(root)) {
      if (name !== locale && name.toLowerCase().startsWith(`${locale.toLowerCase()}_`)) candidates.push(name);
    }
  } catch {
    return null;
  }
  for (const candidate of candidates) {
    try {
      return JSON.parse(fs.readFileSync(path.join(root, candidate, "messages.json"), "utf8").replace(/^﻿/, ""));
    } catch {
      continue;
    }
  }
  return null;
};

const MIME_BY_EXT: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

const readIconDataUrl = (dir: string, manifest: Record<string, unknown>): string | null => {
  const relative = pickIconPath(manifest);
  if (!relative) return null;
  const file = path.resolve(dir, relative.replace(/^\/+/, ""));
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()];
  if (!mime || !file.startsWith(path.resolve(dir) + path.sep)) return null;
  try {
    const bytes = fs.readFileSync(file);
    return bytes.length > 0 && bytes.length <= 512 * 1024 ? `data:${mime};base64,${bytes.toString("base64")}` : null;
  } catch {
    return null;
  }
};

const loadedExtensionFor = (entry: ExtensionEntry, ses: Session = session.defaultSession): Extension | undefined =>
  ses.extensions.getAllExtensions().find((extension) => samePath(extension.path, entry.dir));

const describeEntry = (entry: ExtensionEntry): ExtensionInfo => {
  const manifest = readManifest(entry.dir);
  const loaded = loadedExtensionFor(entry);
  const uiLocale = host?.getLanguage() ?? "en";
  const defaultLocale = typeof manifest?.default_locale === "string" ? manifest.default_locale : undefined;
  const resolve = (value: unknown): string => resolveManifestString(value, readMessagesFor(entry.dir), uiLocale, defaultLocale);
  const enabled = !state.disabled.includes(entry.key);
  const id = loaded?.id ?? entry.storeId ?? loadedIds.get(entry.key) ?? null;
  const name = loaded?.name || resolve(manifest?.name) || path.basename(entry.dir);
  return {
    key: entry.key,
    id,
    name,
    version: typeof manifest?.version === "string" ? manifest.version : "",
    description: resolve(manifest?.description),
    iconDataUrl: manifest ? readIconDataUrl(entry.dir, manifest) : null,
    source: entry.source,
    enabled,
    allowedInPrivate: state.privateAllowed.includes(entry.key),
    hasOptions: Boolean(manifest && getOptionsPagePath(manifest)),
    path: entry.dir,
    contentBlocker: detectContentBlocker({ id, name }),
    blockerWorking: Boolean(manifest && enabled && loaded && detectContentBlocker({ id, name }) && canExtensionBlock(manifest, startedWorkers.default.has(loaded.id))),
    unsupported: findUnsupportedFeatures(manifest),
    manifestVersion: typeof manifest?.manifest_version === "number" ? manifest.manifest_version : 0,
    error: !manifest ? t("Nie udało się odczytać manifest.json.", "Could not read manifest.json.")
      : enabled && !loaded ? (loadErrors.get(entry.key) ?? null) : null,
  };
};

export const getPausingBlocker = (scope: Scope = "default"): string | null => blockerCache[scope];

export const privateExtensionsReady = (): boolean => Boolean(instances.private);

export const listExtensions = (): ExtensionsSnapshot => {
  const items = discover().map(describeEntry).sort((a, b) => a.name.localeCompare(b.name));
  return {
    items,
    directory: getExtensionsDir(),
    pausedBlocker: blockerCache.default,
    privateReady: Boolean(instances.private),
    privateRestartNeeded: !instances.private && items.some((item) => item.enabled && item.allowedInPrivate),
  };
};

const refreshBlockerCache = (): void => {
  const entries = discover();
  const next: Record<Scope, string | null> = { default: null, private: null };
  for (const scope of ["default", "private"] as const) {
    const candidates = entries.map((entry) => {
      const loaded = loadedExtensionFor(entry, sessionForScope(scope));
      const manifest = loaded ? readManifest(entry.dir) : null;
      return {
        id: loaded?.id ?? null,
        name: loaded?.name ?? "",
        enabled: Boolean(loaded) && !state.disabled.includes(entry.key),
        allowedInPrivate: state.privateAllowed.includes(entry.key),
        canBlock: Boolean(loaded) && canExtensionBlock(manifest, startedWorkers[scope].has(loaded?.id ?? "")),
      };
    }).filter((candidate) => candidate.id);
    next[scope] = pickPausingBlocker(candidates, scope);
  }
  blockerCache = next;
};

/** State keys of extensions that no longer exist are dropped, so a re-installed extension does not inherit old grants. */
const pruneState = (): void => {
  const keys = new Set(discover().map((entry) => entry.key));
  const keep = (key: string): boolean => keys.has(key);
  const next: ExtensionsState = {
    disabled: state.disabled.filter(keep),
    privateAllowed: state.privateAllowed.filter(keep),
    external: state.external.filter((folder) => fs.existsSync(path.join(folder, "manifest.json"))),
  };
  if (JSON.stringify(next) !== JSON.stringify(state)) setState(next);
};

const emitChanged = (): void => {
  if (changeTimer) clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    changeTimer = null;
    pruneState();
    refreshBlockerCache();
    host?.onChanged();
  }, 60);
};

// ── Loading / unloading ──────────────────────────────────────────────────────
const startServiceWorker = (ses: Session, extension: Extension): void => {
  const manifest = extension.manifest as { manifest_version?: number; background?: { service_worker?: string } };
  if (manifest.manifest_version === 3 && manifest.background?.service_worker) {
    void ses.serviceWorkers.startWorkerForScope(`chrome-extension://${extension.id}`).catch(() => undefined);
  }
};

const loadIntoPrivate = async (extension: Extension): Promise<void> => {
  const target = privateSession;
  if (!target || !instances.private) return;
  try {
    if (target.extensions.getExtension(extension.id)) target.extensions.removeExtension(extension.id);
    const loaded = await target.extensions.loadExtension(extension.path, { allowFileAccess: false });
    startServiceWorker(target, loaded);
  } catch (error) {
    console.error(`[extensions] failed to load ${extension.name} in the private session:`, error);
  }
};

const unloadFromPrivate = (extensionId: string): void => {
  startedWorkers.private.delete(extensionId);
  try {
    if (privateSession?.extensions.getExtension(extensionId)) privateSession.extensions.removeExtension(extensionId);
  } catch (error) {
    console.error("[extensions] failed to unload from the private session:", error);
  }
};

const loadEntry = async (entry: ExtensionEntry): Promise<Extension | null> => {
  const ses = session.defaultSession;
  try {
    const existing = loadedExtensionFor(entry, ses);
    const extension = existing ?? await ses.extensions.loadExtension(entry.dir, { allowFileAccess: false });
    loadErrors.delete(entry.key);
    loadedIds.set(entry.key, extension.id);
    if (!existing) startServiceWorker(ses, extension);
    return extension;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    loadErrors.set(entry.key, message);
    console.error(`[extensions] failed to load ${path.basename(entry.dir)}:`, error);
    return null;
  }
};

const unloadEntry = (entry: ExtensionEntry): void => {
  const loaded = loadedExtensionFor(entry);
  if (!loaded) return;
  try {
    session.defaultSession.extensions.removeExtension(loaded.id);
  } catch (error) {
    console.error(`[extensions] failed to unload ${loaded.name}:`, error);
  }
  unloadFromPrivate(loaded.id);
};

const onExtensionLoaded = (extension: Extension): void => {
  const entry = entryForPath(extension.path);
  if (entry) {
    loadedIds.set(entry.key, extension.id);
    // Installing a disabled extension again from the Web Store switches it back on.
    if (state.disabled.includes(entry.key)) setState({ ...state, disabled: withListEntry(state.disabled, entry.key, false) });
    if (state.privateAllowed.includes(entry.key)) void loadIntoPrivate(extension);
  }
  emitChanged();
};

const onExtensionUnloaded = (extension: Extension): void => {
  startedWorkers.default.delete(extension.id);
  unloadFromPrivate(extension.id);
  emitChanged();
};

// ── chrome.windows ───────────────────────────────────────────────────────────
const sessionForScope = (scope: Scope): Session => (scope === "private" && privateSession ? privateSession : session.defaultSession);

const createExtensionWindow = async (scope: Scope, details: unknown): Promise<BrowserWindow> => {
  const main = host?.getWindow();
  if (!host || !main || main.isDestroyed()) throw new Error("No browser window");
  const plan = planWindowCreate(details);
  const isPrivate = scope === "private";
  if (plan.kind === "popup" && plan.urls.length > 0) {
    const instance = instances[scope];
    const popup = new BrowserWindow({
      width: plan.width,
      height: plan.height,
      ...(plan.x !== undefined && plan.y !== undefined ? { x: plan.x, y: plan.y } : {}),
      show: false,
      autoHideMenuBar: true,
      minWidth: 200,
      minHeight: 150,
      backgroundColor: "#ffffff",
      icon: path.join(app.getAppPath(), "assets", "icon.png"),
      webPreferences: { session: sessionForScope(scope), sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    popup.setMenuBarVisibility(false);
    popupWindows.add(popup);
    popup.on("closed", () => popupWindows.delete(popup));
    popup.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url)) host?.createTab(url, true, isPrivate);
      return { action: "deny" };
    });
    popup.once("ready-to-show", () => {
      if (popup.isDestroyed()) return;
      if (plan.focused) popup.show();
      else popup.showInactive();
    });
    quietly(() => instance?.addTab(popup.webContents, popup));
    popup.loadURL(plan.urls[0]).catch((error) => console.error("[extensions] popup window failed to load:", error));
    return popup;
  }
  // A normal window: the app is single-window, so the URLs become tabs of the main window.
  const urls = plan.urls.length > 0 ? plan.urls : [""];
  urls.forEach((url, index) => host?.createTab(url, index === 0 && plan.focused, isPrivate));
  return main;
};

const removeExtensionWindow = (window: { isDestroyed: () => boolean; close?: () => void }): void => {
  if (window === host?.getWindow() || window.isDestroyed()) return; // the main window is never closed by an extension
  if (popupWindows.has(window as BrowserWindow)) (window as BrowserWindow).close();
};

// ── Instances ────────────────────────────────────────────────────────────────
const confirmPermissions = async (extension: Extension, permissions: { permissions?: string[]; origins?: string[] }): Promise<boolean> => {
  const wanted = [...(permissions.permissions ?? []), ...(permissions.origins ?? [])];
  const parent = host?.getWindow();
  const options = {
    type: "question" as const,
    buttons: [t("Zezwól", "Allow"), t("Odmów", "Deny")],
    defaultId: 1,
    cancelId: 1,
    title: extension.name,
    message: t(`„${extension.name}” prosi o dodatkowe uprawnienia`, `"${extension.name}" is requesting additional permissions`),
    detail: wanted.join("\n"),
  };
  const result = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return result.response === 0;
};

interface ActionPopup {
  browserWindow?: BrowserWindow;
  on: (event: string, listener: () => void) => void;
  isDestroyed: () => boolean;
}

// Chromium 146+ gives extension contexts a native `browser` global that is separate from `chrome`; the library only
// patches `chrome` (commands, tabs, windows, ...). MV3 code written for `browser.*` (uBlock Origin Lite: browser.commands)
// then crashes at startup. This preload, registered after the library's, points `browser` at the patched `chrome`.
const registerBrowserAlias = (target: Session): void => {
  const filePath = path.join(__dirname, "extension-browser-alias-preload.js");
  try {
    target.registerPreloadScript({ id: "mb-extension-browser-alias-sw", type: "service-worker", filePath });
    target.registerPreloadScript({ id: "mb-extension-browser-alias-frame", type: "frame", filePath, includeGlobs: ["chrome-extension://*"] });
  } catch (error) {
    console.error("[extensions] could not register the browser alias preload:", error);
  }
};

const trackWorkers = (scope: Scope, target: Session): void => {
  target.serviceWorkers.on("running-status-changed", ({ versionId, runningStatus }) => {
    if (runningStatus !== "running") return;
    const match = /^chrome-extension:\/\/([a-p]{32})/.exec(target.serviceWorkers.getWorkerFromVersionID(versionId)?.scope ?? "");
    if (!match || startedWorkers[scope].has(match[1])) return;
    startedWorkers[scope].add(match[1]);
    emitChanged();
  });
};

const createInstance = (scope: Scope, target: Session): ElectronChromeExtensions => {
  const instance = new ElectronChromeExtensions({
    session: target,
    async createTab(details) {
      const window = host?.getWindow();
      const contents = host?.createTab(details.url ?? "", details.active !== false, scope === "private") ?? null;
      if (!contents || !window) throw new Error("Cannot create tab");
      return [contents, window];
    },
    selectTab(contents) {
      if (hostCallbacksSuppressed === 0) host?.selectTab(contents);
    },
    removeTab(contents) {
      if (hostCallbacksSuppressed === 0) host?.removeTab(contents);
    },
    createWindow: (details) => createExtensionWindow(scope, details),
    removeWindow: (window) => removeExtensionWindow(window as BrowserWindow),
    requestPermissions: (extension, permissions) => confirmPermissions(extension, permissions),
  });
  registerBrowserAlias(target);
  trackWorkers(scope, target);
  instance.on("browser-action-popup-created", (popup: ActionPopup) => {
    actionPopups.add(popup);
    // The library anchors popups to window coordinates; the compact-mode overlay is offset inside the window.
    popup.on("moved", () => {
      const origin = host?.getShellOrigin() ?? { x: 0, y: 0 };
      const window = popup.browserWindow;
      if ((origin.x === 0 && origin.y === 0) || !window || window.isDestroyed()) return;
      const bounds = window.getBounds();
      window.setBounds({ ...bounds, x: bounds.x + origin.x, y: bounds.y + origin.y });
    });
    popup.browserWindow?.once("closed", () => actionPopups.delete(popup));
  });
  return instance;
};

export const isExtensionPopupOpen = (): boolean => {
  for (const popup of actionPopups) {
    if (popup.isDestroyed()) actionPopups.delete(popup);
  }
  return actionPopups.size > 0;
};

/** Name of the session partition private tabs use: persistent (wiped) only when private extensions are wanted. */
export const privatePartitionFor = (memoryPartition: string): string => (privateProfileWanted ? PRIVATE_EXT_PARTITION : memoryPartition);

const wipePrivateProfile = (): void => {
  try {
    fs.rmSync(privateExtensionsProfileDirFor(userData()), { recursive: true, force: true });
  } catch {
    // Best effort: the folder is wiped again at the next start.
  }
};

/** Called once when the private session is first created. Hosts the extensions allowed in private tabs. */
export const attachPrivateSession = (target: Session): void => {
  if (!privateProfileWanted || instances.private || !started) return;
  privateSession = target;
  try {
    instances.private = createInstance("private", target);
  } catch (error) {
    console.error("[extensions] private session init failed:", error);
    return;
  }
  for (const entry of discover()) {
    if (state.disabled.includes(entry.key) || !state.privateAllowed.includes(entry.key)) continue;
    const loaded = loadedExtensionFor(entry);
    if (loaded) void loadIntoPrivate(loaded);
  }
  emitChanged();
};

/** The API instance of the session a tab lives in (null for sessions without extension support, e.g. in-memory private). */
const instanceFor = (contents: WebContents): ElectronChromeExtensions | null => {
  if (contents.isDestroyed()) return null;
  if (privateSession && contents.session === privateSession) return instances.private;
  return contents.session === session.defaultSession ? instances.default : null;
};

// ── Startup ──────────────────────────────────────────────────────────────────
const beforeInstall = async (details: { localizedName: string; manifest: unknown; icon: Electron.NativeImage; browserWindow?: BrowserWindow }): Promise<{ action: "allow" | "deny" }> => {
  const parent = details.browserWindow ?? host?.getWindow() ?? undefined;
  const permissions = summarizePermissions((details.manifest ?? {}) as Record<string, unknown>);
  const options = {
    type: "question" as const,
    buttons: [t("Dodaj rozszerzenie", "Add extension"), t("Anuluj", "Cancel")],
    defaultId: 1,
    cancelId: 1,
    title: t("Dodaj rozszerzenie", "Add extension"),
    message: t(`Dodać „${details.localizedName}”?`, `Add "${details.localizedName}"?`),
    detail: permissions.length > 0
      ? `${t("Rozszerzenie będzie mogło:", "The extension will have access to:")}\n${permissions.join("\n")}`
      : t("To rozszerzenie nie prosi o specjalne uprawnienia.", "This extension does not request special permissions."),
    ...(details.icon && !details.icon.isEmpty() ? { icon: details.icon } : {}),
  };
  const result = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  return { action: result.response === 0 ? "allow" : "deny" };
};

/**
 * Sets up extension support: state, API instance for the default session, <browser-action-list> icons, the Web
 * Store, and loads every enabled extension. Call before any tab is created.
 */
export const startExtensions = async (extensionsHost: ExtensionsHost): Promise<void> => {
  if (started) return;
  host = extensionsHost;
  started = true;
  state = readState();
  wipePrivateProfile();
  app.once("will-quit", wipePrivateProfile);

  const entries = discover();
  privateProfileWanted = entries.some((entry) => !state.disabled.includes(entry.key) && state.privateAllowed.includes(entry.key));

  // The Chrome Web Store only offers "Add to Chrome" to Chrome-like browsers: drop the Electron/app tokens from the UA.
  const stockUserAgent = app.userAgentFallback;
  const chromeUserAgent = stockUserAgent.replace(/\s(Electron|MonoBrowser)\/\S+/g, "");
  if (chromeUserAgent !== stockUserAgent) {
    app.userAgentFallback = chromeUserAgent;
    session.defaultSession.setUserAgent(chromeUserAgent);
  }

  try {
    instances.default = createInstance("default", session.defaultSession);
    // The shell UI (<browser-action-list>) runs in the default session and draws icons through crx://.
    ElectronChromeExtensions.handleCRXProtocol(session.defaultSession);
  } catch (error) {
    instances.default = null;
    console.error("[extensions] init failed:", error);
    return;
  }

  const defaultExtensions = session.defaultSession.extensions;
  defaultExtensions.on("extension-loaded", (_event, extension) => onExtensionLoaded(extension));
  defaultExtensions.on("extension-unloaded", (_event, extension) => onExtensionUnloaded(extension));

  try {
    await fs.promises.mkdir(getExtensionsDir(), { recursive: true });
    // Web Store installs live in the same directory as unpacked extensions. We load everything ourselves so that
    // disabled extensions stay unloaded (and nothing is loaded twice).
    await installChromeWebStore({
      session: session.defaultSession,
      extensionsPath: getExtensionsDir(),
      loadExtensions: false,
      autoUpdate: true,
      beforeInstall: (details) => beforeInstall(details),
    });
  } catch (error) {
    console.error("[extensions] Chrome Web Store init failed:", error);
  }

  for (const entry of entries) {
    if (state.disabled.includes(entry.key)) continue;
    await loadEntry(entry);
  }
  refreshBlockerCache();
  host.onChanged();
  void updateExtensions(session.defaultSession).catch((error) => console.error("[extensions] update check failed:", error));
};

// ── Tab registration ─────────────────────────────────────────────────────────
export const extensionsAddTab = (contents: WebContents, window: BrowserWindow): void => {
  const instance = instanceFor(contents);
  if (!instance || !host) return;
  try {
    quietly(() => {
      instance.addTab(contents, window);
      // The library treats every added tab as the active one: put the real active tab back.
      const active = host?.getActiveContents(contents.session === privateSession);
      if (active && active !== contents && !active.isDestroyed() && active.session === contents.session) instance.selectTab(active);
    });
  } catch (error) {
    console.error("[extensions] addTab failed:", error);
  }
};

export const extensionsSelectTab = (contents: WebContents): void => {
  try {
    quietly(() => instanceFor(contents)?.selectTab(contents));
  } catch (error) {
    console.error("[extensions] selectTab failed:", error);
  }
};

export const extensionsRemoveTab = (contents: WebContents): void => {
  try {
    quietly(() => instanceFor(contents)?.removeTab(contents));
  } catch (error) {
    console.error("[extensions] removeTab failed:", error);
  }
};

// ── Context menu ─────────────────────────────────────────────────────────────
export type ExtensionMenuEntry = {
  label: string;
  enabled: boolean;
  separator: boolean;
  children: ExtensionMenuEntry[];
  run: () => void;
};

export const getExtensionContextMenu = (contents: WebContents, params: ContextMenuParams): ExtensionMenuEntry[] => {
  const instance = instanceFor(contents);
  if (!instance) return [];
  const convert = (item: MenuItem): ExtensionMenuEntry => ({
    label: item.label,
    enabled: item.enabled,
    separator: item.type === "separator",
    children: item.submenu ? item.submenu.items.map(convert) : [],
    run: () => (item.click as (event: unknown, window: unknown, contents: unknown) => void)(undefined, host?.getWindow() ?? undefined, contents),
  });
  try {
    return instance.getContextMenuItems(contents, params).map(convert);
  } catch (error) {
    console.error("[extensions] context menu failed:", error);
    return [];
  }
};

// ── Management (extensions page) ─────────────────────────────────────────────
const findEntry = (key: unknown): ExtensionEntry | undefined =>
  typeof key === "string" ? discover().find((entry) => entry.key === key) : undefined;

export const setExtensionEnabled = async (key: unknown, enabled: boolean): Promise<ExtensionsSnapshot> => {
  const entry = findEntry(key);
  if (!entry) return listExtensions();
  setState({ ...state, disabled: withListEntry(state.disabled, entry.key, !enabled) });
  if (enabled) await loadEntry(entry);
  else unloadEntry(entry);
  refreshBlockerCache();
  host?.onChanged();
  return listExtensions();
};

export const setExtensionAllowedInPrivate = async (key: unknown, allowed: boolean): Promise<ExtensionsSnapshot> => {
  const entry = findEntry(key);
  if (!entry) return listExtensions();
  setState({ ...state, privateAllowed: withListEntry(state.privateAllowed, entry.key, allowed) });
  const loaded = loadedExtensionFor(entry);
  if (loaded && instances.private) {
    if (allowed) await loadIntoPrivate(loaded);
    else unloadFromPrivate(loaded.id);
  }
  refreshBlockerCache();
  host?.onChanged();
  return listExtensions();
};

export const removeInstalledExtension = async (key: unknown): Promise<ExtensionsSnapshot> => {
  const entry = findEntry(key);
  if (!entry) return listExtensions();
  const info = describeEntry(entry);
  const parent = host?.getWindow();
  const options = {
    type: "warning" as const,
    buttons: [t("Usuń", "Remove"), t("Anuluj", "Cancel")],
    defaultId: 1,
    cancelId: 1,
    title: t("Usuń rozszerzenie", "Remove extension"),
    message: t(`Usunąć „${info.name}”?`, `Remove "${info.name}"?`),
    detail: entry.source === "external"
      ? t("Folder rozszerzenia zostanie tylko odłączony od przeglądarki, pliki nie zostaną usunięte.", "The extension folder is only detached from the browser; its files are not deleted.")
      : t("Rozszerzenie i jego pliki zostaną usunięte z dysku.", "The extension and its files will be deleted from disk."),
  };
  const answer = parent && !parent.isDestroyed() ? await dialog.showMessageBox(parent, options) : await dialog.showMessageBox(options);
  if (answer.response !== 0) return listExtensions();
  try {
    unloadEntry(entry);
    if (entry.source === "store" && entry.storeId) {
      await uninstallExtension(entry.storeId, { session: session.defaultSession, extensionsPath: getExtensionsDir() });
    } else if (entry.source === "unpacked") {
      await fs.promises.rm(entry.dir, { recursive: true, force: true });
    }
    setState({
      disabled: withListEntry(state.disabled, entry.key, false),
      privateAllowed: withListEntry(state.privateAllowed, entry.key, false),
      external: entry.source === "external" ? state.external.filter((folder) => folder !== entry.dir) : state.external,
    });
    loadedIds.delete(entry.key);
    loadErrors.delete(entry.key);
  } catch (error) {
    console.error("[extensions] failed to remove extension:", error);
    await dialog.showMessageBox({ type: "error", message: t("Nie udało się usunąć rozszerzenia.", "Could not remove the extension."), detail: error instanceof Error ? error.message : String(error) });
  }
  refreshBlockerCache();
  host?.onChanged();
  return listExtensions();
};

export const openExtensionOptions = (key: unknown): boolean => {
  const entry = findEntry(key);
  const loaded = entry ? loadedExtensionFor(entry) : undefined;
  const manifest = entry ? readManifest(entry.dir) : null;
  const page = manifest ? getOptionsPagePath(manifest) : null;
  const url = loaded && page ? extensionPageUrl(loaded.id, page) : null;
  if (!url || !host) return false;
  return Boolean(host.createTab(url, true, false));
};

export const openExtensionsFolder = async (): Promise<boolean> => {
  const dir = getExtensionsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  return (await shell.openPath(dir)) === "";
};

/** "Load unpacked…": a folder picker; the folder is used in place (Chrome developer mode behavior). */
export const loadUnpackedExtension = async (): Promise<{ snapshot: ExtensionsSnapshot; message: string | null }> => {
  const parent = host?.getWindow();
  const options = {
    title: t("Wybierz folder rozszerzenia (z plikiem manifest.json)", "Choose the extension folder (containing manifest.json)"),
    properties: ["openDirectory" as const],
  };
  const picked = parent && !parent.isDestroyed() ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  const folder = picked.filePaths[0];
  if (picked.canceled || !folder) return { snapshot: listExtensions(), message: null };
  const manifest = readManifest(folder);
  if (!manifest || typeof manifest.name !== "string") {
    return { snapshot: listExtensions(), message: t("Ten folder nie zawiera poprawnego pliku manifest.json.", "This folder does not contain a valid manifest.json.") };
  }
  const resolved = path.resolve(folder);
  const inside = samePath(path.dirname(resolved), getExtensionsDir());
  const key = inside ? dirKey(path.basename(resolved)) : externalKey(resolved);
  if (!inside && !state.external.some((existing) => samePath(existing, resolved))) setState({ ...state, external: [...state.external, resolved] });
  setState({ ...state, disabled: withListEntry(state.disabled, key, false) });
  const entry = findEntry(key);
  if (!entry) return { snapshot: listExtensions(), message: t("Nie udało się dodać rozszerzenia.", "Could not add the extension.") };
  const loaded = await loadEntry(entry);
  refreshBlockerCache();
  host?.onChanged();
  return { snapshot: listExtensions(), message: loaded ? null : (loadErrors.get(entry.key) ?? t("Nie udało się wczytać rozszerzenia.", "Could not load the extension.")) };
};
