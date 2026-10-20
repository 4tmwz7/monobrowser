import { COLOR_THEMES } from "./color-themes.js";
import {
  DEFAULT_DARK, DEFAULT_LIGHT, defaultTokens, stripScheme, DEFAULT_THEME_SETTINGS, injectThemeIntoHtml, migrateLegacyColors, normalizeThemeSettings, resolveTheme,
  themeApplyScript, LEGACY_ALIAS_CSS, themeCss, type ThemeSettings, type ThemeTokens,
} from "./theme.js";
import { findHighlightCss, UI_BASE_END_CSS, UI_BASE_START_CSS } from "./ui-base-css.js";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, systemPreferences, session, Menu, webContents, shell, WebContentsView, MenuItemConstructorOptions } from "electron";
import type { DownloadItem, IpcMainEvent, IpcMainInvokeEvent, WebContents } from "electron";
import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ElectronBlocker, fullLists } from "@ghostery/adblocker-electron";
import { autoUpdater, CancellationToken } from "electron-updater";
import { exportBookmarksHtml, exportBookmarksJson, parseBookmarksImport } from "./bookmarks-io.js";
import { buildViewSourceUrl, getErrorCode, isAboutBlankUrl, isFileUrl, isHttpUrl, isInternalSchemeInput, isViewSourceUrl, looksLikeHost, recoverEmbeddedUrl, shortUrlLabel } from "./url-utils.js";
import { DEFAULT_LAYOUT_SETTINGS, mergeLayoutSettings, normalizeLayoutSettings, type LayoutSettings } from "./layout-settings.js";
import { DEFAULT_GLANCE_SETTINGS, mergeGlanceSettings, normalizeGlanceSettings, type GlanceSettings } from "./glance-settings.js";
import { isHostExcepted, isUrlExcepted, normalizeExceptionHost, parseExceptionList } from "./adblock-exceptions.js";
import { buildGlanceTriggerScript, parseGlanceMessage } from "./glance-trigger.js";
import { clearPrivateCertExceptions, getFailedUrlForErrorPage, registerCertificateErrorHandler, setErrorPageFontDataUrl, setErrorPageThemeCss, wireErrorPages } from "./error-pages.js";
import { normalizeExperimentalSettings, mergeExperimentalSettings, type ExperimentalSettings } from "./experimental-settings.js";
import { getActiveHardLimitMb, getSystemInfo, isSystemdRunAvailable, limitOwnScopeIfNeeded, relaunchUnderMemoryScope, ResourceLimiter, type TabSnapshot } from "./resource-limiter-runtime.js";
import { shouldRelaunchUnderScope } from "./resource-limiter.js";
import { createCompactChrome, type CompactChrome } from "./compact-runtime.js";
import { createSplitFrame, type SplitFrame, type SplitFrameState } from "./split-frame.js";
import { computeSplitLayout, ratioFromPointer, type Rect as SplitRect, type SplitSide } from "./split-layout.js";
import { createSplitRegistry, type SplitGroup } from "./split-state.js";
import { computePopupGeometry, resizePopupBounds, type PopupPlacement, type PopupRect } from "./popup-placement.js";
import { buildStoredSplits, matchStoredSplits, normalizeStoredSplits } from "./split-session.js";
import { buildSessionData, normalizeSessionData, pushClosedTab, type ClosedTab, type SessionData } from "./session-store.js";
import {
  MAIN_WORKSPACE_ID, addWorkspace, adjacentWorkspaceId, createMainWorkspace, mostRecentTabInWorkspace, moveWorkspace,
  orderTabsByWorkspaces, orderTabsForWorkspace, removeWorkspace, reorderTabIds, updateWorkspace, workspaceDisplayName,
  WORKSPACE_COLOR_PALETTE, WORKSPACE_COLOR_TOKENS, workspaceColorCss, workspaceIdByNumber, type Workspace, type WorkspaceDraft,
} from "./workspaces.js";
import {
  renderWorkspaceDeleteHtml, renderWorkspaceEditorHtml, renderWorkspaceMenuHtml, renderWorkspaceSwitcherHtml,
  type PopupContext as WorkspacePopupContext,
} from "./workspace-popups.js";
import { DEFAULT_ANIMATION_SETTINGS, areAnimationsEffective, normalizeAnimationSettings, resolveAnimationsEffective, setAnimationsEffective, type AnimationSettings } from "./animation-settings.js";
import { DEFAULT_STARTUP_SETTINGS, normalizeStartupSettings, type StartupSettings } from "./startup-settings.js";
import { clampZoom, normalizeZoomStore, stepZoom, withZoomEntry, zoomOriginKey, type ZoomStore } from "./zoom-utils.js";
import { resolveDropTargets } from "./drop-utils.js";
import { spellcheckLanguagesFor } from "./spellcheck-utils.js";
import { PROGRESS_HUD_HTML, STATUS_HUD_HTML } from "./hud-html.js";
import { createPromptOverlay, type PromptOverlay } from "./prompt-overlay.js";
import { authDedupeKey, buildAuthRequest, buildPermissionRequest, createPendingGroups } from "./prompt-queue.js";
import { isUnloadPromptOpen, recordCloseIntent, wireUnloadGuard } from "./unload-guard.js";
import { ONBOARDING_FILE, clampStep, normalizeOnboardingFlag, shouldAutoShowOnboarding } from "./onboarding.js";
import { renderOnboardingPageHtml } from "./onboarding-page.js";
import { extractMarkdownUrls, renderMarkdownLite } from "./markdown-lite.js";
import { isAllowedAboutLink, describeUpdateStatus, renderAboutPageHtml, type UpdateStatus } from "./about-page.js";
import { getPortableInfo, isPortableMode } from "./portable-mode.js";
import { initPortableSession, registerPortableIpc } from "./portable-runtime.js";
import { renderPortableSettingsCard } from "./portable-settings-card.js";
import { checkForNewerRelease, getUpdateMode } from "./portable-update-runtime.js";
import { buildNewVersionNotice } from "./portable-update.js";

type TabState = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
  isSleeping: boolean;
  isPrivate: boolean;
  isAudible: boolean;
  zoom: number;
  favicon: string | null;
};

type InternalKind = "settings" | "history" | "downloads" | "site-data" | "stats" | "about" | "onboarding";

type TabRecord = TabState & {
  // Przestrzeń (workspace), do której należy karta; widoczne i układane są tylko karty bieżącej przestrzeni.
  workspaceId: string;
  view: WebContentsView | null;
  lastActiveAt: number;
  adblockPaused: boolean;
  blockedCount: number;
  faviconOrigin?: string | null;
  // Karta wewnętrzna z mostem preload (strony MonoBrowser); nigdy zwykła strona.
  internalKind?: InternalKind;
};

type HistoryEntry = {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
};

type BookmarkEntry = {
  id: string;
  url: string;
  title: string;
  createdAt: string;
};

type DownloadStatus =
  | "in-progress"
  | "completed"
  | "cancelled"
  | "interrupted"
  | "failed";

type DownloadRecord = {
  id: string;
  fileName: string;
  sourceUrl: string;
  sourceOrigin: string;
  savePath: string;
  startedAt: string;
  finishedAt: string | null;
  receivedBytes: number;
  totalBytes: number;
  status: DownloadStatus;
  error?: string;
  kind?: "update";
};

type DownloadStatePayload = {
  downloads: DownloadRecord[];
};

type SiteOriginRecord = {
  origin: string;
  lastSeenAt: string;
};

type SiteDataType =
  | "cookies"
  | "localStorage"
  | "indexedDB"
  | "cache"
  | "serviceWorkers";

type SiteDataEntry = {
  origin: string;
  lastSeenAt: string | null;
  cookieCount: number;
};

type ClearResult = {
  ok: boolean;
  message: string;
};

type AppLanguage = "pl" | "en";

type SearchEngine = "google" | "duckduckgo" | "custom";

type SearchSettings = {
  engine: SearchEngine;
  customUrl: string;
};

type AdblockerStatus = {
  enabled: boolean;
  ready: boolean;
  blockedTotal: number;
  activeTabBlocked: number;
  activeTabPaused: boolean;
  error: string | null;
};

type StatsDay = {
  seconds: number;
  visits: number;
  blocked: number;
  downloads: number;
  searches: number;
};

type StatsData = {
  firstUsedAt: string;
  totals: {
    visits: number;
    blocked: number;
    downloads: number;
    searches: number;
    seconds: number;
  };
  days: Record<string, StatsDay>;
  domains: Record<string, number>;
};

const createEmptyStatsData = (): StatsData => ({
  firstUsedAt: new Date().toISOString(),
  totals: { visits: 0, blocked: 0, downloads: 0, searches: 0, seconds: 0 },
  days: {},
  domains: {},
});

type SearchSettingsResult = {
  ok: boolean;
  message: string;
  settings: SearchSettings;
};

type UserScriptRunAt = "document-start" | "document-idle";

type UserScript = {
  id: string;
  name: string;
  enabled: boolean;
  matches: string[];
  excludes: string[];
  runAt: UserScriptRunAt;
  code: string;
  createdAt: string;
  updatedAt: string;
};

type UserScriptDraft = {
  id: string | null;
  name: string;
  enabled: boolean;
  matches: string;
  excludes: string;
  runAt: UserScriptRunAt;
  code: string;
};

type UserScriptResult = {
  ok: boolean;
  message: string;
  script?: UserScript;
};

type UserScriptImportResult = {
  ok: boolean;
  message: string;
  draft: UserScriptDraft | null;
};

const START_PAGE_URL = "monobrowser://new-tab";
const INTERNAL_KINDS: readonly InternalKind[] = ["settings", "history", "downloads", "site-data", "stats", "about", "onboarding"];
const DEFAULT_URL = START_PAGE_URL;
const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  engine: "google",
  customUrl: "https://example.com/search?q={query}",
};
const MAX_HISTORY_ITEMS = 500;
const MAX_BOOKMARK_ITEMS = 250;
const MAX_DOWNLOAD_ITEMS = 500;
const MAX_STATS_DOMAINS = 512;
const MAX_STATS_DAYS = 90;
const MAX_USERSCRIPT_ITEMS = 100;
const MAX_USERSCRIPT_CODE_LENGTH = 500_000;
const MAX_USERSCRIPT_NAME_LENGTH = 200;
const MAX_USERSCRIPT_PATTERNS = 50;
const USERSCRIPT_HEADER_START = "==UserScript==";
const USERSCRIPT_HEADER_END = "==/UserScript==";
const ALLOWED_SITE_DATA_TYPES = new Set<SiteDataType>([
  "cookies",
  "localStorage",
  "indexedDB",
  "cache",
  "serviceWorkers",
]);
const TAB_SLEEP_AFTER_MS = 10 * 60 * 1000;
const TAB_SLEEP_SWEEP_INTERVAL_MS = 30_000;
const NOTES_WIDTH = 340;
const NOTES_SCROLLBAR_INSET = 14; // keeps the page's right scrollbar reachable
const PALETTE_MAX_ROWS = 10;
const SPLASH_ONLY_MODE =
  process.argv.includes("--splash-only") ||
  process.env.MONOBROWSER_SPLASH_ONLY === "1";

let mainWindow: BrowserWindow | null = null;
let downloadProgressView: WebContentsView | null = null;
let downloadProgressVisible = false;
let popupView: WebContentsView | null = null;
let findView: WebContentsView | null = null;
let findVisible = false;
let findViewReady: Promise<boolean> | null = null;
let findBarLastQuery = "";
let paletteView: WebContentsView | null = null;
let paletteVisible = false;
let paletteViewHeight = 240;
let notesView: WebContentsView | null = null;
let notesVisible = false;
let notesFilePath = "";
let notesContent = "";
let historyFilePath = "";
let bookmarksFilePath = "";
let userscriptsFilePath = "";
let downloadsFilePath = "";
let siteOriginsFilePath = "";
let languageFilePath = "";
let searchSettingsFilePath = "";
// Top-left corner of the area occupied by tab views/overlays; the shell renderer reports it
// (below the compact toolbar in horizontal layout, right of the sidebar in vertical layout).
let viewportTop = 36;
let viewportLeft = 0;
let sidebarDragging = false;
// Split view (two tabs side by side) and compact mode (chrome revealed from the screen edge).
const splitRegistry = createSplitRegistry();
let splitFrame: SplitFrame | null = null;
let compactChrome: CompactChrome | null = null;
let splitDividerDragging = false;
let splitTabDragId: number | null = null;
// Where the shell says the page area starts (before compact mode zeroes it).
let reportedViewportLeft = 0;
let reportedViewportTop = 36;
// In-window prompts (permissions, HTTP auth, "Leave site?"); one per main window.
let promptOverlay: PromptOverlay | null = null;
// While the sidebar edge is dragged, the page view trails the edge by this
// margin so the shell (not the page) keeps receiving the pointer moves.
const SIDEBAR_DRAG_MARGIN = 64;
let layoutSettingsFilePath = "";
let layoutSettings: LayoutSettings = { ...DEFAULT_LAYOUT_SETTINGS };
let glanceSettingsFilePath = "";
let glanceSettings: GlanceSettings = { ...DEFAULT_GLANCE_SETTINGS };
let experimentalSettingsFilePath = "";
let experimentalSettings: ExperimentalSettings = normalizeExperimentalSettings(null, getSystemInfo());
let resourceLimiter: ResourceLimiter | null = null;
// Secret shared only with the isolated-world trigger script (see glance-trigger.ts).
const glanceNonce = crypto.randomBytes(16).toString("hex");
const GLANCE_WORLD_ID = 1001;
// Only one Glance (quick link preview overlay) exists at a time.
type GlanceRecord = {
  view: WebContentsView;
  shell: WebContentsView;
  sourceTabId: number;
  isPrivate: boolean;
  requestedUrl: string;
  favicons: string[];
  shellReady: boolean;
};
let glance: GlanceRecord | null = null;
let nextTabId = 1;
let nextFindRequestId = 1;
let activeTabId: number | null = null;
let historyEntries: HistoryEntry[] = [];
let bookmarkEntries: BookmarkEntry[] = [];
let userScriptEntries: UserScript[] = [];
let downloadRecords: DownloadRecord[] = [];
let siteOriginRecords: SiteOriginRecord[] = [];
let appLanguage: AppLanguage = "pl";
let searchSettings: SearchSettings = { ...DEFAULT_SEARCH_SETTINGS };
let statsFilePath = "";
let statsData: StatsData = createEmptyStatsData();
let statsDirty = false;
let statsTimer: NodeJS.Timeout | null = null;
let adblockBlocker: ElectronBlocker | null = null;
let adblockEnabled = true;
let adblockReady = false;
let adblockError: string | null = null;
let adblockSessionBlocks = 0;
let adblockSettingsFilePath = "";
let adblockExceptionsFilePath = "";
const adblockExceptions = new Set<string>();
let adblockEngineCachePath = "";
let adblockRefreshTimer: NodeJS.Timeout | null = null;
let bebasNeueFontDataUrl: string | null = null;
let splashWindow: BrowserWindow | null = null;

const tabs = new Map<number, TabRecord>();
const activeDownloads = new Map<string, DownloadItem>();
const jsonWriteQueues = new Map<string, Promise<void>>();
const tabMruOrder: number[] = [];
// Przestrzenie: lista (kolejność = kolejność w interfejsie) i id bieżącej; zapisywane w session.json.
let workspaces: Workspace[] = [createMainWorkspace()];
let currentWorkspaceId = MAIN_WORKSPACE_ID;
let recentlyClosedTabs: ClosedTab[] = [];
let sessionFilePath = "";
let sessionSaveTimer: NodeJS.Timeout | null = null;
let sessionSavingEnabled = false;
let animationSettingsFilePath = "";
let animationSettings: AnimationSettings = { ...DEFAULT_ANIMATION_SETTINGS };
let startupSettingsFilePath = "";
let startupSettings: StartupSettings = { ...DEFAULT_STARTUP_SETTINGS };
let zoomFilePath = "";
let zoomStore: ZoomStore = {};
const startPageDataUrls = new Set<string>();
// URL of the main-frame navigation a tab is currently starting (used to tell a page's auth prompt from a subresource's).
const pendingMainFrameUrls = new WeakMap<WebContents, string>();
let tabsBroadcastScheduled = false;

let updateCheckInProgress = false;
let startPageBackgroundColor = "#101114";
let startPageBackgroundFilePath = "";

const START_PAGE_BACKGROUND_FILE = "start-page-background-v2.json";

const START_PAGE_BG_PROBE_SCRIPT = String.raw`(() => {
  const parseColor = (value) => {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    if (!normalized || normalized === "transparent") {
      return null;
    }

    const shortHexMatch = normalized.match(/^#([0-9a-f]{3})$/i);
    if (shortHexMatch) {
      const [r, g, b] = shortHexMatch[1].split("");
      return "#" + r + r + g + g + b + b;
    }

    const fullHexMatch = normalized.match(/^#([0-9a-f]{6})$/i);
    if (fullHexMatch) {
      return "#" + fullHexMatch[1];
    }

    const rgbMatch = normalized.match(/^rgba?\(([^)]+)\)$/);
    if (!rgbMatch) {
      return null;
    }

    const parts = rgbMatch[1].split(",").map((part) => part.trim());
    if (parts.length < 3) {
      return null;
    }

    const toByte = (raw) => {
      if (raw.endsWith("%")) {
        const value = Number(raw.slice(0, -1));
        if (!Number.isFinite(value)) {
          return null;
        }

        return Math.max(0, Math.min(255, Math.round((value / 100) * 255)));
      }

      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return null;
      }

      return Math.max(0, Math.min(255, Math.round(value)));
    };

    const parseAlpha = (raw) => {
      if (typeof raw !== "string") {
        return 1;
      }

      if (raw.endsWith("%")) {
        const value = Number(raw.slice(0, -1));
        if (!Number.isFinite(value)) {
          return 0;
        }

        return Math.max(0, Math.min(1, value / 100));
      }

      const value = Number(raw);
      if (!Number.isFinite(value)) {
        return 0;
      }

      return Math.max(0, Math.min(1, value));
    };

    const r = toByte(parts[0]);
    const g = toByte(parts[1]);
    const b = toByte(parts[2]);
    const alpha = parseAlpha(parts[3]);

    if (r === null || g === null || b === null || alpha <= 0.05) {
      return null;
    }

    const toHex = (value) => value.toString(16).padStart(2, "0");
    return "#" + toHex(r) + toHex(g) + toHex(b);
  };

  const candidates = [];

  const collectColor = (value) => {
    if (typeof value === "string" && value.trim()) {
      candidates.push(value);
    }
  };

  const collectFrom = (element) => {
    if (!element) {
      return;
    }

    collectColor(getComputedStyle(element).backgroundColor);
  };

  collectFrom(document.body);
  collectFrom(document.documentElement);
  collectFrom(document.querySelector("main"));
  collectFrom(document.querySelector("[role='main']"));

  const themeMeta = document.querySelector("meta[name='theme-color']");
  collectColor(themeMeta && themeMeta.getAttribute("content"));

  for (const candidate of candidates) {
    const parsed = parseColor(candidate);
    if (parsed) {
      return parsed;
    }
  }

  return null;
})()`;

const normalizeHexColor = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  const shortMatch = normalized.match(/^#([0-9a-f]{3})$/i);
  if (shortMatch) {
    const [r, g, b] = shortMatch[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`;
  }

  const fullMatch = normalized.match(/^#([0-9a-f]{6})$/i);
  if (fullMatch) {
    return `#${fullMatch[1]}`;
  }

  return null;
};

const getSafeStartPageBackgroundColor = (value: unknown): string => {
  return normalizeHexColor(value) ?? "#101114";
};

const isDefaultStartPageUrl = (value: string): boolean => {
  return value === START_PAGE_URL;
};

const loadStartPageBackgroundColor = async (): Promise<void> => {
  if (!startPageBackgroundFilePath) {
    return;
  }

  try {
    const raw = await fs.readFile(startPageBackgroundFilePath, "utf8");
    const parsed = JSON.parse(raw) as { color?: unknown };
    const nextColor = normalizeHexColor(parsed.color);

    if (nextColor) {
      startPageBackgroundColor = nextColor;
    }
  } catch {
    startPageBackgroundColor = getSafeStartPageBackgroundColor(
      startPageBackgroundColor,
    );
  }
};

const saveStartPageBackgroundColor = async (): Promise<void> => {
  if (!startPageBackgroundFilePath) {
    return;
  }

  await fs.mkdir(path.dirname(startPageBackgroundFilePath), { recursive: true });
  await fs.writeFile(
    startPageBackgroundFilePath,
    JSON.stringify({ color: startPageBackgroundColor }, null, 2),
    "utf8",
  );
};

type SplashTheme = {
  bg: string;
  text: string;
  border: string;
  logoBg: string;
  trackBg: string;
  fillA: string;
  fillB: string;
};

const getColorLuminance = (hexColor: string): number => {
  const safeColor = getSafeStartPageBackgroundColor(hexColor);
  const red = parseInt(safeColor.slice(1, 3), 16);
  const green = parseInt(safeColor.slice(3, 5), 16);
  const blue = parseInt(safeColor.slice(5, 7), 16);

  const toLinear = (channel: number): number => {
    const normalized = channel / 255;
    if (normalized <= 0.03928) {
      return normalized / 12.92;
    }

    return ((normalized + 0.055) / 1.055) ** 2.4;
  };

  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const getSplashTheme = (backgroundColor: string): SplashTheme => {
  const bg = getSafeStartPageBackgroundColor(backgroundColor);
  const isDarkBackground = getColorLuminance(bg) < 0.45;

  if (isDarkBackground) {
    return {
      bg,
      text: "#ececec",
      border: "#8e8e8e",
      logoBg: "rgba(0, 0, 0, 0.26)",
      trackBg: "rgba(0, 0, 0, 0.35)",
      fillA: "#e4e4e4",
      fillB: "#8a8a8a",
    };
  }

  return {
    bg,
    text: "#111111",
    border: "#383838",
    logoBg: "rgba(255, 255, 255, 0.62)",
    trackBg: "rgba(0, 0, 0, 0.08)",
    fillA: "#1f1f1f",
    fillB: "#666666",
  };
};

const applyStartPageBackgroundToView = (view: WebContentsView): void => {
  const color = getSafeStartPageBackgroundColor(startPageBackgroundColor);

  try {
    view.setBackgroundColor(color);
  } catch {
    return;
  }
};

const applySplashThemeToWindow = (windowRef: BrowserWindow): void => {
  if (windowRef.isDestroyed()) {
    return;
  }

  const theme = getSplashTheme(startPageBackgroundColor);
  windowRef.setBackgroundColor(theme.bg);

  const serializedTheme = JSON.stringify(theme);
  void windowRef.webContents
    .executeJavaScript(
      `window.updateSplashTheme && window.updateSplashTheme(${serializedTheme});`,
      true,
    )
    .catch(() => undefined);
};

const applyStartPageBackgroundColor = (): void => {
  startPageBackgroundColor = getSafeStartPageBackgroundColor(
    startPageBackgroundColor,
  );

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setBackgroundColor(startPageBackgroundColor);
  }

  if (splashWindow && !splashWindow.isDestroyed()) {
    applySplashThemeToWindow(splashWindow);
  }

  for (const tab of tabs.values()) {
    if (isDefaultStartPageUrl(tab.url) && tab.view) {
      applyStartPageBackgroundToView(tab.view);
    }
  }
};

const updateStartPageBackgroundFromContents = async (
  contents: WebContents,
): Promise<void> => {
  if (contents.isDestroyed()) {
    return;
  }

  const currentUrl = contents.getURL();
  if (!isDefaultStartPageUrl(currentUrl)) {
    return;
  }

  try {
    const detectedColor = await contents.executeJavaScript(
      START_PAGE_BG_PROBE_SCRIPT,
      true,
    );

    const nextColor = normalizeHexColor(detectedColor);
    if (!nextColor || nextColor === startPageBackgroundColor) {
      return;
    }

    startPageBackgroundColor = nextColor;
    applyStartPageBackgroundColor();
    await saveStartPageBackgroundColor();
  } catch {
    return;
  }
};

const getSplashLogoDataUrl = async (): Promise<string | null> => {
  const candidatePaths = [
    path.join(process.resourcesPath, "assets", "icon.png"),
    path.join(process.resourcesPath, "icon.png"),
    path.join(app.getAppPath(), "assets", "icon.png"),
    path.join(__dirname, "..", "..", "assets", "icon.png"),
  ];

  for (const candidatePath of candidatePaths) {
    try {
      const fileBuffer = await fs.readFile(candidatePath);
      return `data:image/png;base64,${fileBuffer.toString("base64")}`;
    } catch {
      // Try next path.
    }
  }

  return null;
};

const renderSplashHtml = (logoDataUrl: string | null): string => {
  const logo = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="MonoBrowser logo" />`
    : '<div class="logo-fallback" aria-hidden="true"></div>';
  const theme = getSplashTheme(startPageBackgroundColor);
  const serializedTheme = JSON.stringify(theme);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MonoBrowser loading</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: Consolas, "Courier New", monospace;
        --bg: ${theme.bg};
        --text: ${theme.text};
        --border: ${theme.border};
        --logo-bg: ${theme.logoBg};
        --track-bg: ${theme.trackBg};
        --fill-a: ${theme.fillA};
        --fill-b: ${theme.fillB};
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        width: 100vw;
        height: 100vh;
        background: var(--bg);
        display: grid;
        place-items: center;
      }

      .splash {
        width: min(320px, 86vw);
        display: grid;
        justify-items: center;
        gap: 12px;
        padding: 8px 0;
      }

      .logo img,
      .logo-fallback {
        width: 60px;
        height: 60px;
        image-rendering: pixelated;
        border: 1px solid var(--border);
        background: var(--logo-bg);
      }

      .logo img {
        padding: 5px;
        object-fit: contain;
        filter: grayscale(1) contrast(1.12) brightness(0.92);
      }

      #progress-value {
        color: var(--text);
        font-size: 24px;
        font-weight: 700;
        letter-spacing: 0.06em;
        line-height: 1;
      }

      .progress-track {
        width: 100%;
        height: 12px;
        border: 1px solid var(--border);
        background: var(--track-bg);
        position: relative;
      }

      .progress-fill {
        position: absolute;
        inset: 0 auto 0 0;
        width: 0%;
        height: 100%;
        background: repeating-linear-gradient(
          90deg,
          var(--fill-a) 0 8px,
          var(--fill-b) 8px 16px
        );
        transition: width var(--mb-dur, 200ms) var(--mb-ease, ease);
      }
    </style>
  </head>
  <body>
    <section class="splash" role="status" aria-live="polite">
      <div class="logo">
        ${logo}
      </div>
      <strong id="progress-value">0%</strong>
      <div class="progress-track">
        <div id="progress-fill" class="progress-fill"></div>
      </div>
    </section>

    <script>
      (() => {
        const rootStyle = document.documentElement.style;
        const progressFill = document.getElementById("progress-fill");
        const progressValue = document.getElementById("progress-value");

        const applyTheme = (theme) => {
          if (!theme || typeof theme !== "object") {
            return;
          }

          const entries = [
            ["bg", "--bg"],
            ["text", "--text"],
            ["border", "--border"],
            ["logoBg", "--logo-bg"],
            ["trackBg", "--track-bg"],
            ["fillA", "--fill-a"],
            ["fillB", "--fill-b"],
          ];

          for (const [key, variableName] of entries) {
            const value = theme[key];
            if (typeof value === "string" && value.trim().length > 0) {
              rootStyle.setProperty(variableName, value);
            }
          }
        };

        window.updateSplashTheme = (theme) => {
          applyTheme(theme);
        };

        window.updateSplash = (percent) => {
          const parsed = Number(percent);
          const safePercent = Number.isFinite(parsed)
            ? Math.max(0, Math.min(100, Math.floor(parsed)))
            : 0;

          progressFill.style.width = safePercent + "%";
          progressValue.textContent = safePercent + "%";
        };

        applyTheme(${serializedTheme});
      })();
    </script>
  </body>
</html>`;
};

const createSplashWindow = async (): Promise<void> => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return;
  }

  const logoDataUrl = await getSplashLogoDataUrl();

  splashWindow = new BrowserWindow({
    width: 360,
    height: 220,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    autoHideMenuBar: true,
    backgroundColor: getSafeStartPageBackgroundColor(startPageBackgroundColor),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.on("closed", () => {
    splashWindow = null;
  });

  const html = renderSplashHtml(logoDataUrl);
  const dataUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  await splashWindow.loadURL(dataUrl);
  applySplashThemeToWindow(splashWindow);
};

const updateSplashProgress = (percent: number, label: string): void => {
  if (!splashWindow || splashWindow.isDestroyed()) {
    return;
  }

  const safePercent = Math.max(0, Math.min(100, Math.floor(percent)));
  void label;

  void splashWindow.webContents
    .executeJavaScript(
      `window.updateSplash && window.updateSplash(${safePercent});`,
      true,
    )
    .catch(() => undefined);
};

const destroySplashWindow = (): void => {
  if (!splashWindow) {
    return;
  }

  if (!splashWindow.isDestroyed()) {
    splashWindow.close();
  }

  splashWindow = null;
};

const runBackgroundProbeIfStartPage = (contents: WebContents): void => {
  if (contents.isDestroyed()) {
    return;
  }

  if (isDefaultStartPageUrl(contents.getURL())) {
    void updateStartPageBackgroundFromContents(contents);
  }
};

const getSearchTemplate = (): string => {
  if (searchSettings.engine === "duckduckgo") {
    return "https://duckduckgo.com/?q={query}";
  }

  if (searchSettings.engine === "custom") {
    return searchSettings.customUrl;
  }

  return "https://www.google.com/search?q={query}";
};

const buildSearchUrl = (query: string): string =>
  getSearchTemplate().replaceAll("{query}", encodeURIComponent(query));

const getBebasNeueFontDataUrl = (): string => {
  if (bebasNeueFontDataUrl) {
    return bebasNeueFontDataUrl;
  }

  const candidates = [
    path.join(app.getAppPath(), "assets", "fonts", "BebasNeue-Regular.ttf"),
    path.join(process.resourcesPath, "assets", "fonts", "BebasNeue-Regular.ttf"),
    path.join(__dirname, "..", "..", "assets", "fonts", "BebasNeue-Regular.ttf"),
  ];
  for (const candidate of candidates) {
    try {
      const encoded = fsSync.readFileSync(candidate).toString("base64");
      bebasNeueFontDataUrl = `data:font/ttf;base64,${encoded}`;
      return bebasNeueFontDataUrl;
    } catch {
      continue;
    }
  }

  return "";
};

// ── Unified theme (see theme.ts) ────────────────────────────────────────────
let themeSettings: ThemeSettings = { ...DEFAULT_THEME_SETTINGS };

const getThemeTokens = (): ThemeTokens => resolveTheme(themeSettings, nativeTheme.shouldUseDarkColors);

/** Inserts the current theme as <style id="mb-theme"> into the HTML of an internal page. */
const injectTheme = (html: string): string => injectThemeIntoHtml(html, getThemeTokens());

/** Overlay/shell views that get theme updates (dom-ready + live pushes). Never web pages. */
const themedContents = new Set<WebContents>();

const pushThemeTo = (contents: WebContents): void => {
  if (contents.isDestroyed()) return;
  contents.executeJavaScript(themeApplyScript(getThemeTokens()), true).catch(() => undefined);
};

const trackThemedContents = (contents: WebContents): void => {
  themedContents.add(contents);
  contents.on("dom-ready", () => pushThemeTo(contents));
  contents.once("destroyed", () => themedContents.delete(contents));
};

/** Our own pages are data: URLs and follow the theme; websites keep the classic light canvas behind transparent pages. */
const WEB_CANVAS_COLOR = "#f0efe9";
const tabCanvasColorFor = (url: string): string => (url.startsWith("data:text/html") ? getThemeTokens().bg : WEB_CANVAS_COLOR);

/** Tabs that show our own data: pages (internal pages, start page, error pages), not arbitrary websites. */
const isThemedTabPage = (tab: TabRecord): boolean => {
  if (tab.internalKind) return true;
  const contents = tab.view?.webContents;
  if (!contents || contents.isDestroyed()) return false;
  const url = contents.getURL();
  return startPageDataUrls.has(url) || getFailedUrlForErrorPage(url) !== null;
};

setErrorPageThemeCss(() => themeCss(getThemeTokens()));
setErrorPageFontDataUrl(() => getBebasNeueFontDataUrl());

const getThemeState = (): { settings: ThemeSettings; tokens: ThemeTokens; systemDark: boolean } => ({
  settings: themeSettings, tokens: getThemeTokens(), systemDark: nativeTheme.shouldUseDarkColors,
});

const applyThemeEverywhere = (): void => {
  const tokens = getThemeTokens();
  startPageBackgroundColor = tokens.bg;
  applyStartPageBackgroundColor();
  void saveStartPageBackgroundColor().catch(() => undefined);
  for (const contents of themedContents) pushThemeTo(contents);
  for (const view of [findView, paletteView, notesView]) {
    if (view && !view.webContents.isDestroyed()) view.setBackgroundColor(tokens.bg);
  }
  for (const tab of tabs.values()) {
    if (!tab.view || tab.view.webContents.isDestroyed()) continue;
    try { tab.view.setBackgroundColor(tabCanvasColorFor(tab.view.webContents.getURL())); } catch { /* view may be closing */ }
    if (isThemedTabPage(tab)) pushThemeTo(tab.view.webContents);
  }
  const payload = getThemeState();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("theme:changed", payload);
  compactChrome?.getContents()?.send("theme:changed", payload);
  for (const kind of INTERNAL_KINDS) {
    for (const tab of getInternalTabs(kind)) {
      const contents = getTabContents(tab);
      if (contents) contents.send("theme:changed", payload);
    }
  }
};

const setThemeSettings = async (value: unknown): Promise<ReturnType<typeof getThemeState>> => {
  themeSettings = normalizeThemeSettings(value);
  applyThemeEverywhere();
  await saveSearchSettings();
  return getThemeState();
};

const renderStartPageHtml = (): string => {
  const copy = appLanguage === "pl" ? {
    title: "Nowa karta",
    heading: "Dokąd teraz?",
    placeholder: "Wyszukaj w internecie",
    search: "Szukaj",
  } : {
    title: "New tab",
    heading: "Where to next?",
    placeholder: "Search the web",
    search: "Search",
  };
  const searchTemplateJson = JSON.stringify(getSearchTemplate()).replace(/</g, "\\u003c");
  const bebasNeueFontUrl = getBebasNeueFontDataUrl();

  return `<!doctype html>
<html lang="${appLanguage}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="${getThemeTokens().bg}">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">
  <title>${copy.title}</title>
  <style>
    @font-face { font-family:"Bebas Neue"; src:url("${bebasNeueFontUrl}") format("truetype"); font-style:normal; font-weight:400; font-display:block; }
    :root { ${LEGACY_ALIAS_CSS} --sp-bg:var(--mb-bg); --sp-text:var(--mb-fg); --sp-box-bg:var(--mb-surface); --sp-box-text:var(--mb-fg); --sp-field-bg:var(--mb-bg); font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace; }
    * { box-sizing: border-box; }
    body { min-height:100vh; margin:0; overflow:hidden; background:var(--sp-bg); color:var(--sp-text); cursor:crosshair; }
    body::after { content:""; position:fixed; inset:0; z-index:5; pointer-events:none; opacity:.035; background:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
    main { min-height:100vh; display:grid; grid-template-columns:minmax(330px,.82fr) minmax(520px,1.18fr); }
    .brand-panel { position:relative; padding:clamp(38px,5vw,76px); border-right:3px solid var(--sp-text); display:flex; flex-direction:column; justify-content:center; overflow:hidden; }
    .version { position:absolute; left:clamp(38px,5vw,76px); bottom:22px; color:var(--mb-muted); font-size:12px; letter-spacing:.08em; line-height:1.2; }
    .brand { margin:0; font-family:"Bebas Neue", Impact, sans-serif; font-size:clamp(48px,9vw,160px); white-space:nowrap; font-weight:400; line-height:.85; letter-spacing:-2px; text-transform:uppercase; width:fit-content; transition:transform .15s, text-shadow .15s; }
    .brand:hover { transform:translate(-4px,-4px); text-shadow:6px 6px 0 var(--accent); }
    .brand .outline { color:transparent; -webkit-text-stroke:2px var(--sp-text); }
    .brand .accent { color:var(--accent); transition:text-shadow var(--mb-dur,150ms); }
    .brand:hover .accent { text-shadow:6px 6px 0 var(--grey); }
    .search-panel { position:relative; padding:clamp(42px,6vw,84px); display:flex; flex-direction:column; justify-content:center; background:var(--sp-box-bg); color:var(--sp-box-text); }
    h1 { max-width:640px; margin:0 0 34px; font-family:"Bebas Neue",Impact,sans-serif; font-size:clamp(54px,7vw,96px); font-weight:400; line-height:.9; letter-spacing:1px; text-transform:uppercase; }
    form { display:grid; grid-template-columns:minmax(0,1fr) auto; border:2px solid var(--sp-box-text); background:var(--sp-field-bg); transition:transform var(--mb-dur,150ms), box-shadow var(--mb-dur,150ms); }
    form:focus-within { transform:translate(-4px,-4px); box-shadow:6px 6px 0 var(--accent); }
    input { min-width:0; height:62px; padding:0 18px; border:0; outline:0; background:transparent; color:var(--sp-box-text); font:14px ui-monospace,"Cascadia Mono","Courier New",monospace; }
    input::placeholder { color:var(--mb-muted); opacity:1; }
    button { min-width:132px; height:62px; padding:0 22px; border:0; border-left:2px solid var(--sp-box-text); background:var(--sp-box-text); color:var(--mb-bg); font:700 10px ui-monospace,"Cascadia Mono","Courier New",monospace; letter-spacing:.22em; text-transform:uppercase; cursor:pointer; }
    button:hover { background:var(--accent); color:var(--mb-on-accent); }
    @media(max-width:900px) { body{overflow:auto} main{grid-template-columns:1fr} .brand-panel{min-height:38vh;border-right:0;border-bottom:3px solid var(--sp-text)} .brand{font-size:clamp(48px,20vw,150px)} .search-panel{min-height:62vh} }
    @media(max-width:620px) { .search-panel,.brand-panel{padding:30px 22px} form{grid-template-columns:1fr} button{width:100%;border-left:0;border-top:2px solid var(--sp-box-text)} }
  </style>
</head>
<body>
  <main>
    <section class="brand-panel">
      <div class="brand"><span class="outline">MONO</span><br><span class="accent">BROW</span>SER</div>
      <span class="version">v${escapeHtml(app.getVersion())}</span>
    </section>
    <section class="search-panel">
      <h1>${copy.heading}</h1>
      <form id="search-form">
        <input id="query" type="text" inputmode="url" placeholder="${copy.placeholder}" autocomplete="off" autofocus aria-label="${copy.placeholder}">
        <button type="submit">${copy.search}</button>
      </form>
    </section>
  </main>
  <script>
    (() => {
      const template = ${searchTemplateJson};
      const form = document.getElementById('search-form');
      const input = document.getElementById('query');
      const destinationFor = value => {
        if (/^https?:\\/\\//i.test(value)) return value;
        const host = value.split('/')[0];
        const looksLikeHost = /^localhost(?::\\d+)?$/i.test(host) ||
          /^(?:\\d{1,3}\\.){3}\\d{1,3}(?::\\d+)?$/.test(host) ||
          /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}(?::\\d+)?$/i.test(host);
        return looksLikeHost && !/\\s/.test(value)
          ? 'https://' + value
          : template.replaceAll('{query}', encodeURIComponent(value));
      };
      form.addEventListener('submit', event => {
        event.preventDefault();
        const query = input.value.trim();
        if (!query) return;
        location.assign(destinationFor(query));
      });
    })();
  </script>
</body>
</html>`;
};

const getStartPageDataUrl = (): string => {
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(injectTheme(renderStartPageHtml()))}`;
  startPageDataUrls.add(url);
  if (startPageDataUrls.size > 12) {
    const oldest = startPageDataUrls.values().next().value as string | undefined;
    if (oldest) startPageDataUrls.delete(oldest);
  }
  return url;
};

const resolveUrlForLoading = (url: string): string =>
  isDefaultStartPageUrl(url) ? getStartPageDataUrl() : url;

const normalizeInputToUrl = (input: string): string => {
  const trimmed = input.trim();

  if (!trimmed) {
    return DEFAULT_URL;
  }

  if (trimmed === START_PAGE_URL || isAboutBlankUrl(trimmed) || isHttpUrl(trimmed) || isFileUrl(trimmed) || isViewSourceUrl(trimmed)) {
    return trimmed;
  }

  // Malformed internal-scheme text is never a web search: recover a glued-on URL or fall back to the start page.
  if (isInternalSchemeInput(trimmed)) {
    const recovered = recoverEmbeddedUrl(trimmed);
    return recovered ?? DEFAULT_URL;
  }

  if (looksLikeHost(trimmed)) {
    return `https://${trimmed}`;
  }

  return buildSearchUrl(trimmed);
};

const isSearchQueryInput = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === START_PAGE_URL || isAboutBlankUrl(trimmed) || isHttpUrl(trimmed) || isFileUrl(trimmed) || isViewSourceUrl(trimmed) || isInternalSchemeInput(trimmed)) {
    return false;
  }
  return !looksLikeHost(trimmed);
};

/** Counts a web search (never from a private tab) for the statistics page. */
const recordSearchIfQuery = (input: string, isPrivate: boolean): void => {
  if (!isPrivate && isSearchQueryInput(input)) recordSearch();
};

const logNavigationError = (error: unknown): void => {
  // ERR_ABORTED pojawia się naturalnie przy szybkiej nawigacji i przekierowaniach.
  if (getErrorCode(error) !== "ERR_ABORTED") {
    console.error("Navigation failed:", error);
  }
};

const openUrlInNewTab = (url: string, isPrivate: boolean = false): void => {
  const trimmed = url.trim();

  if (!trimmed) {
    openNewTab(DEFAULT_URL, isPrivate);
    return;
  }

  if (isHttpUrl(trimmed) || isAboutBlankUrl(trimmed)) {
    openNewTab(trimmed, isPrivate);
  }
};

const getTabSnapshot = (tab: TabRecord): TabState & { splitGroupId: number | null; splitSide: SplitSide | null } => ({
  splitGroupId: splitRegistry.groupOf(tab.id)?.id ?? null,
  splitSide: ((group) => (group ? splitRegistry.sideOf(group, tab.id) : null))(splitRegistry.groupOf(tab.id)),
  id: tab.id,
  title: tab.title,
  url: tab.url,
  isLoading: tab.isLoading,
  canGoBack: tab.canGoBack,
  canGoForward: tab.canGoForward,
  isPinned: tab.isPinned,
  isMuted: tab.isMuted,
  isSleeping: tab.isSleeping,
  isPrivate: tab.isPrivate,
  isAudible: tab.isAudible,
  zoom: tab.zoom,
  favicon: tab.favicon,
});

// Karty bieżącej przestrzeni w kolejności wyświetlania (przypięte, potem reszta).
const getOrderedTabRecords = (): TabRecord[] => orderTabsForWorkspace(Array.from(tabs.values()), currentWorkspaceId);

// Wszystkie karty pogrupowane według przestrzeni (sesja, paleta).
const getAllOrderedTabRecords = (): TabRecord[] => orderTabsByWorkspaces(Array.from(tabs.values()), workspaces);

const getWorkspacesPayload = () => ({
  workspaces: workspaces.map((workspace) => ({
    id: workspace.id,
    name: workspaceDisplayName(workspace, appLanguage),
    icon: workspace.icon,
    color: workspace.color,
    colorCss: workspaceColorCss(workspace.color),
    count: Array.from(tabs.values()).filter((tab) => tab.workspaceId === workspace.id).length,
  })),
  currentWorkspaceId,
});

const getTabsStatePayload = () => ({
  tabs: getOrderedTabRecords().map(getTabSnapshot),
  activeTabId,
  ...getWorkspacesPayload(),
});

const promoteTabInMruOrder = (tabId: number): void => {
  const existingIndex = tabMruOrder.indexOf(tabId);
  if (existingIndex !== -1) {
    tabMruOrder.splice(existingIndex, 1);
  }

  tabMruOrder.unshift(tabId);
};

const appendTabToMruOrder = (tabId: number): void => {
  const existingIndex = tabMruOrder.indexOf(tabId);
  if (existingIndex !== -1) {
    tabMruOrder.splice(existingIndex, 1);
  }

  tabMruOrder.push(tabId);
};

const removeTabFromMruOrder = (tabId: number): void => {
  const existingIndex = tabMruOrder.indexOf(tabId);
  if (existingIndex !== -1) {
    tabMruOrder.splice(existingIndex, 1);
  }
};

const getMostRecentTabId = (workspaceId?: string): number | null => {
  for (const tabId of tabMruOrder) {
    const tab = tabs.get(tabId);
    if (tab && (workspaceId === undefined || tab.workspaceId === workspaceId)) {
      return tabId;
    }
  }

  return null;
};

const PRIVATE_PARTITION = "monobrowser-private";
let privateSessionConfigured = false;

// Partycja bez prefiksu "persist:" działa wyłącznie w pamięci – nic nie trafia na dysk.
const getPrivateSession = (): Electron.Session => {
  const privateSession = session.fromPartition(PRIVATE_PARTITION);
  if (!privateSessionConfigured) {
    privateSessionConfigured = true;
    setupPermissionHandlers(privateSession, privatePermissionDecisions, "private");
    try {
      const languages = spellcheckLanguagesFor(appLanguage, privateSession.availableSpellCheckerLanguages);
      if (languages.length > 0) privateSession.setSpellCheckerLanguages(languages);
    } catch {
      // Spellchecker unavailable in this session.
    }
    attachAdblockerToSession(privateSession);
    privateSession.on("will-download", (_event, item) => {
      // Pobrania z kart prywatnych nie są zapisywane w historii pobierania.
      item.setSaveDialogOptions({
        title: appLanguage === "pl" ? "Zapisz pobierany plik" : "Save download",
        defaultPath: path.join(app.getPath("downloads"), getSafeDownloadFileName(item.getFilename() || "download")),
      });
    });
  }
  return privateSession;
};

const clearPrivateSessionData = async (): Promise<void> => {
  privatePermissionDecisions.clear();
  clearPrivateCertExceptions();
  if (!privateSessionConfigured) {
    return;
  }
  const privateSession = session.fromPartition(PRIVATE_PARTITION);
  try {
    await privateSession.clearData();
    await privateSession.clearCache();
    await privateSession.clearAuthCache();
  } catch (error) {
    console.error("Failed to clear private session:", error);
  }
};

let overlayOpenedAt = 0;
let programmaticFocusUntil = 0;
const markOverlayOpening = (): void => {
  overlayOpenedAt = Date.now();
};

// Overlays live in child views of the main window; without OS focus on the
// window itself the view's webContents.focus() does not receive keys (Escape).
const focusMainWindowForOverlay = (): void => {
  overlayOpenedAt = Date.now();
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    mainWindow.focus();
  }
};

// Clicking the page or the shell while notes/palette are open dismisses them.
const dismissOverlaysOnOutsideClick = (): void => {
  const now = Date.now();
  // Focus moved by the app itself (hiding the palette, closing a menu) is not
  // an outside click and must not close an overlay that is just opening.
  if (now - overlayOpenedAt < 500 || now < programmaticFocusUntil) return;
  dismissPopupOnForeignFocus();
  if (paletteVisible) hidePalette();
  if (notesVisible) hideNotesView();
};

const createTabView = (isPrivate: boolean = false, internal: boolean = false): WebContentsView => {
  const view = new WebContentsView({
    webPreferences: {
      // Preload dostają wyłącznie karty wewnętrzne (ustawienia); karty z internetu nigdy.
      ...(internal ? { preload: path.join(__dirname, "preload.js") } : {}),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      ...(isPrivate ? { session: getPrivateSession() } : {}),
    },
  });

  view.setBackgroundColor(internal ? getThemeTokens().bg : WEB_CANVAS_COLOR);
  view.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      pendingMainFrameUrls.set(view.webContents, details.url);
      try { view.setBackgroundColor(tabCanvasColorFor(details.url)); } catch { /* view may be closing */ }
    }
  });
  view.webContents.on("did-redirect-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) pendingMainFrameUrls.set(view.webContents, details.url);
  });
  view.webContents.on("focus", dismissOverlaysOnOutsideClick);
  view.webContents.on("focus", () => onTabViewFocused(view.webContents));

  if (internal) {
    // Strona wewnętrzna nigdy nie ładuje stron z internetu (ma most preload): linki http(s) otwierają się w nowej karcie.
    view.webContents.setWindowOpenHandler(({ url }) => {
      if (isHttpUrl(url)) openUrlInNewTab(url, isPrivate);
      return { action: "deny" };
    });
    view.webContents.on("will-navigate", (event, url) => {
      if (url.startsWith("data:text/html")) return;
      event.preventDefault();
      if (isHttpUrl(url)) openUrlInNewTab(url, isPrivate);
    });
    return view;
  }

  view.webContents.setWindowOpenHandler(({ url }) => {
    openUrlInNewTab(url, isPrivate);
    return { action: "deny" };
  });

  return view;
};

let lastWorkspacesPushJson = "";
const broadcastTabsState = (): void => {
  scheduleSessionSave();
  scheduleSplitSave();
  if (tabsBroadcastScheduled) {
    return;
  }

  tabsBroadcastScheduled = true;
  setImmediate(() => {
    tabsBroadcastScheduled = false;
    const payload = getTabsStatePayload();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tabs:state", payload);
    }
    compactChrome?.getContents()?.send("tabs:state", payload);
    // Nakładki nie wyświetlają favikon – nie wysyłamy im dużych data URL.
    const lightPayload = {
      ...payload,
      tabs: payload.tabs.map((tab) => ({ ...tab, favicon: null })),
    };
    if (findView && !findView.webContents.isDestroyed()) {
      findView.webContents.send("tabs:state", lightPayload);
    }
    if (paletteView && !paletteView.webContents.isDestroyed()) {
      paletteView.webContents.send("tabs:state", lightPayload);
    }
    // The Settings tab lists spaces (names, icons, counts): keep it live without polling.
    const workspacesJson = JSON.stringify({ workspaces: payload.workspaces, currentWorkspaceId: payload.currentWorkspaceId });
    if (workspacesJson !== lastWorkspacesPushJson) {
      lastWorkspacesPushJson = workspacesJson;
      notifySettingsPage("workspaces", getWorkspacesPayload());
    }
  });
};

const broadcastHistory = (): void => {
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send("history:updated", historyEntries);

  // Strona historii odświeża się przyrostowo (bez przeładowania), więc otwarte potwierdzenie nie znika.
  for (const tab of getInternalTabs("history")) {
    const historyContents = getTabContents(tab);
    if (historyContents && !historyContents.isDestroyed()) historyContents.send("history:updated", historyEntries);
  }
};

const normalizeHttpOrigin = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

const writeJsonAtomically = async (filePath: string, value: unknown): Promise<void> => {
  if (!filePath) {
    return;
  }

  const previousWrite = jsonWriteQueues.get(filePath) ?? Promise.resolve();
  const nextWrite = previousWrite.catch(() => undefined).then(async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await fs.writeFile(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    await fs.rename(temporaryPath, filePath);
  });
  jsonWriteQueues.set(filePath, nextWrite);

  try {
    await nextWrite;
  } finally {
    if (jsonWriteQueues.get(filePath) === nextWrite) {
      jsonWriteQueues.delete(filePath);
    }
  }
};

const normalizeLanguage = (value: unknown): AppLanguage | null => {
  return value === "pl" || value === "en" ? value : null;
};

const loadLanguage = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(languageFilePath, "utf8");
    const parsed = JSON.parse(raw) as { language?: unknown };
    appLanguage = normalizeLanguage(parsed.language) ?? "pl";
  } catch {
    appLanguage = "pl";
  }
};

const saveLanguage = async (): Promise<void> => {
  await writeJsonAtomically(languageFilePath, { language: appLanguage });
};

const normalizeSearchSettings = (value: unknown): SearchSettings | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as { engine?: unknown; customUrl?: unknown };
  if (raw.engine !== "google" && raw.engine !== "duckduckgo" && raw.engine !== "custom") {
    return null;
  }

  const customUrl = typeof raw.customUrl === "string"
    ? raw.customUrl.trim()
    : DEFAULT_SEARCH_SETTINGS.customUrl;

  if (customUrl.length > 2048) {
    return null;
  }

  if (raw.engine === "custom") {
    if (!customUrl.includes("{query}")) {
      return null;
    }
    try {
      const parsed = new URL(customUrl.replaceAll("{query}", "test"));
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        return null;
      }
    } catch {
      return null;
    }
  }

  return { engine: raw.engine, customUrl };
};

const loadSearchSettings = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(searchSettingsFilePath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    searchSettings = normalizeSearchSettings(parsed) ?? { ...DEFAULT_SEARCH_SETTINGS };
    const stored = (typeof parsed === "object" && parsed !== null ? parsed : {}) as { theme?: unknown; customColors?: unknown };
    themeSettings = "theme" in stored ? normalizeThemeSettings(stored.theme) : migrateLegacyColors(stored.customColors);
  } catch {
    searchSettings = { ...DEFAULT_SEARCH_SETTINGS };
    themeSettings = { ...DEFAULT_THEME_SETTINGS };
  }
};

const saveSearchSettings = async (): Promise<void> => {
  await writeJsonAtomically(searchSettingsFilePath, { ...searchSettings, theme: themeSettings });
};

const loadLayoutSettings = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(layoutSettingsFilePath, "utf8");
    layoutSettings = normalizeLayoutSettings(JSON.parse(raw));
  } catch {
    layoutSettings = { ...DEFAULT_LAYOUT_SETTINGS };
  }
};

const setLayoutSettings = async (patch: unknown): Promise<LayoutSettings> => {
  layoutSettings = mergeLayoutSettings(layoutSettings, patch);
  await writeJsonAtomically(layoutSettingsFilePath, layoutSettings);
  compactChrome?.setEnabled(layoutSettings.compactMode);
  const targets = [mainWindow?.webContents, compactChrome?.getContents(), ...getInternalTabs("settings").map((tab) => getTabContents(tab))];
  for (const target of targets) {
    if (target && !target.isDestroyed()) {
      target.send("layout:changed", { ...layoutSettings });
    }
  }
  compactChrome?.refresh();
  return { ...layoutSettings };
};

const toggleCompactMode = (): void => {
  void setLayoutSettings({ compactMode: !layoutSettings.compactMode });
};

const refreshAnimationsEffective = (): void => {
  let reduced = false;
  try { reduced = systemPreferences.getAnimationSettings().prefersReducedMotion; } catch { reduced = false; }
  setAnimationsEffective(resolveAnimationsEffective(animationSettings, reduced, process.env.MB_NO_ANIM === "1"));
};

const loadAnimationSettings = async (): Promise<void> => {
  try {
    animationSettings = normalizeAnimationSettings(JSON.parse(await fs.readFile(animationSettingsFilePath, "utf8")));
  } catch {
    animationSettings = { ...DEFAULT_ANIMATION_SETTINGS };
  }
  refreshAnimationsEffective();
};

const setAnimationSettings = async (patch: unknown): Promise<AnimationSettings> => {
  animationSettings = normalizeAnimationSettings({ ...animationSettings, ...(typeof patch === "object" && patch !== null ? patch : {}) });
  refreshAnimationsEffective();
  applyThemeEverywhere();
  await writeJsonAtomically(animationSettingsFilePath, animationSettings);
  return { ...animationSettings };
};

const loadStartupSettings = async (): Promise<void> => {
  try {
    startupSettings = normalizeStartupSettings(JSON.parse(await fs.readFile(startupSettingsFilePath, "utf8")));
  } catch {
    startupSettings = { ...DEFAULT_STARTUP_SETTINGS };
  }
};

const setStartupSettings = async (patch: unknown): Promise<StartupSettings> => {
  startupSettings = normalizeStartupSettings({ ...startupSettings, ...(typeof patch === "object" && patch !== null ? patch : {}) });
  await writeJsonAtomically(startupSettingsFilePath, startupSettings);
  return { ...startupSettings };
};

// ── Sesja (karty + ostatnio zamknięte) ─────────────────────────────────────
const SESSION_SAVE_DEBOUNCE_MS = 800;
let lastSessionJson = "";

const getActiveTabIdByWorkspace = (): Record<string, number | null> => Object.fromEntries(
  workspaces.map((workspace) => [
    workspace.id,
    workspace.id === currentWorkspaceId && activeTabId !== null && tabs.get(activeTabId)?.workspaceId === workspace.id
      ? activeTabId
      : mostRecentTabInWorkspace(tabMruOrder, (tabId) => tabs.get(tabId)?.workspaceId, workspace.id),
  ]),
);

const buildCurrentSession = (): SessionData => buildSessionData(
  getAllOrderedTabRecords().map((tab) => ({
    workspaceId: tab.workspaceId,
    id: tab.id,
    url: tab.url,
    title: tab.title,
    isPinned: tab.isPinned,
    isMuted: tab.isMuted,
    isPrivate: tab.isPrivate,
    internal: Boolean(tab.internalKind),
  })),
  activeTabId,
  recentlyClosedTabs,
  { workspaces, currentWorkspaceId, activeTabIdByWorkspace: getActiveTabIdByWorkspace() },
);

const saveSessionNow = async (): Promise<void> => {
  if (!sessionSavingEnabled || !sessionFilePath) return;
  const data = buildCurrentSession();
  const json = JSON.stringify(data);
  if (json === lastSessionJson) return;
  lastSessionJson = json;
  try {
    await writeJsonAtomically(sessionFilePath, data);
  } catch (error) {
    lastSessionJson = "";
    console.error("Failed to save session:", error);
  }
};

const scheduleSessionSave = (): void => {
  if (!sessionSavingEnabled || sessionSaveTimer) return;
  sessionSaveTimer = setTimeout(() => {
    sessionSaveTimer = null;
    void saveSessionNow();
  }, SESSION_SAVE_DEBOUNCE_MS);
};

// Zapis synchroniczny przy zamykaniu okna/aplikacji (asynchroniczny nie zdąży się dokończyć).
const flushSessionSync = (): void => {
  if (sessionSaveTimer) {
    clearTimeout(sessionSaveTimer);
    sessionSaveTimer = null;
  }
  if (!sessionSavingEnabled || !sessionFilePath) return;
  try {
    const temporaryPath = `${sessionFilePath}.${process.pid}.tmp`;
    fsSync.mkdirSync(path.dirname(sessionFilePath), { recursive: true });
    fsSync.writeFileSync(temporaryPath, JSON.stringify(buildCurrentSession(), null, 2), "utf8");
    fsSync.renameSync(temporaryPath, sessionFilePath);
  } catch (error) {
    console.error("Failed to flush session:", error);
  }
};

const loadSession = async (): Promise<SessionData> => {
  try {
    return normalizeSessionData(JSON.parse(await fs.readFile(sessionFilePath, "utf8")));
  } catch {
    return normalizeSessionData(null);
  }
};

// ── Powiększenie stron (per origin) ────────────────────────────────────────
const privateZoomStore: ZoomStore = {};
let zoomSaveTimer: NodeJS.Timeout | null = null;

const loadZoomStore = async (): Promise<void> => {
  try {
    zoomStore = normalizeZoomStore(JSON.parse(await fs.readFile(zoomFilePath, "utf8")));
  } catch {
    zoomStore = {};
  }
};

const scheduleZoomSave = (): void => {
  if (zoomSaveTimer) return;
  zoomSaveTimer = setTimeout(() => {
    zoomSaveTimer = null;
    void writeJsonAtomically(zoomFilePath, zoomStore).catch((error) => console.error("Failed to save zoom:", error));
  }, 500);
};

const flushZoomSync = (): void => {
  if (!zoomSaveTimer) return;
  clearTimeout(zoomSaveTimer);
  zoomSaveTimer = null;
  try {
    const temporaryPath = `${zoomFilePath}.${process.pid}.tmp`;
    fsSync.writeFileSync(temporaryPath, JSON.stringify(zoomStore, null, 2), "utf8");
    fsSync.renameSync(temporaryPath, zoomFilePath);
  } catch (error) {
    console.error("Failed to flush zoom:", error);
  }
};

const getStoredZoom = (url: string, isPrivate: boolean): number => {
  const origin = zoomOriginKey(url);
  if (!origin) return 1;
  return (isPrivate ? privateZoomStore[origin] : undefined) ?? zoomStore[origin] ?? 1;
};

// Po nawigacji przywraca zapamiętane powiększenie origin (Chromium zeruje je dla nowego hosta).
const applyStoredZoom = (tab: TabRecord, contents: WebContents): void => {
  if (contents.isDestroyed()) return;
  const factor = getStoredZoom(contents.getURL(), tab.isPrivate);
  if (Math.abs(contents.getZoomFactor() - factor) > 0.001) contents.setZoomFactor(factor);
  if (Math.abs(tab.zoom - factor) > 0.001) {
    tab.zoom = factor;
    broadcastTabsState();
  }
};

const setTabZoom = (tab: TabRecord, factor: number): void => {
  const contents = getTabContents(tab);
  if (!contents) return;
  const clamped = clampZoom(factor);
  contents.setZoomFactor(clamped);
  tab.zoom = clamped;
  const origin = zoomOriginKey(contents.getURL());
  if (origin) {
    if (tab.isPrivate) {
      const next = withZoomEntry(privateZoomStore, origin, clamped);
      for (const key of Object.keys(privateZoomStore)) delete privateZoomStore[key];
      Object.assign(privateZoomStore, next);
    } else {
      zoomStore = withZoomEntry(zoomStore, origin, clamped);
      scheduleZoomSave();
    }
    for (const other of tabs.values()) {
      if (other === tab || other.isPrivate !== tab.isPrivate) continue;
      const otherContents = getTabContents(other);
      if (otherContents && zoomOriginKey(otherContents.getURL()) === origin) {
        otherContents.setZoomFactor(clamped);
        other.zoom = clamped;
      }
    }
  }
  broadcastTabsState();
};

const toggleTabMuted = (tabId: number): boolean => {
  const tab = tabs.get(tabId);
  if (!tab) return false;
  tab.isMuted = !tab.isMuted;
  getTabContents(tab)?.setAudioMuted(tab.isMuted);
  broadcastTabsState();
  return true;
};

const loadGlanceSettings = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(glanceSettingsFilePath, "utf8");
    glanceSettings = normalizeGlanceSettings(JSON.parse(raw));
  } catch {
    glanceSettings = { ...DEFAULT_GLANCE_SETTINGS };
  }
};

// Tabs have no preload, so the click trigger runs in an isolated world; this (re)applies it.
const applyGlanceTriggerToContents = (contents: WebContents): void => {
  if (contents.isDestroyed()) return;
  contents
    .executeJavaScriptInIsolatedWorld(GLANCE_WORLD_ID, [{ code: buildGlanceTriggerScript(glanceNonce, glanceSettings) }])
    .catch(() => undefined);
};

const setGlanceSettings = async (patch: unknown): Promise<GlanceSettings> => {
  glanceSettings = mergeGlanceSettings(glanceSettings, patch);
  await writeJsonAtomically(glanceSettingsFilePath, glanceSettings);
  for (const tab of tabs.values()) {
    const contents = getTabContents(tab);
    if (contents && !tab.internalKind) applyGlanceTriggerToContents(contents);
  }
  if (!glanceSettings.enabled) closeGlance(false);
  for (const tab of getInternalTabs("settings")) getTabContents(tab)?.send("glance:changed", { ...glanceSettings });
  return { ...glanceSettings };
};

const refreshStartPages = async (): Promise<void> => {
  const reloads: Promise<void>[] = [];
  for (const tab of tabs.values()) {
    if (tab.url !== START_PAGE_URL || !tab.view || tab.view.webContents.isDestroyed()) {
      continue;
    }
    reloads.push(tab.view.webContents.loadURL(getStartPageDataUrl()).then(() => undefined));
  }
  await Promise.all(reloads);
};

const setSearchSettings = async (value: unknown): Promise<SearchSettingsResult> => {
  const normalized = normalizeSearchSettings(value);
  if (!normalized) {
    return {
      ok: false,
      message: appLanguage === "pl"
        ? "Podaj poprawny adres HTTP(S) zawierający znacznik {query}."
        : "Enter a valid HTTP(S) URL containing the {query} placeholder.",
      settings: { ...searchSettings },
    };
  }

  searchSettings = normalized;
  await saveSearchSettings();
  await refreshStartPages();
  return {
    ok: true,
    message: appLanguage === "pl" ? "Ustawienia zapisane." : "Settings saved.",
    settings: { ...searchSettings },
  };
};

// ── Native content blocking (main-process engine, uBlock/EasyList syntax) ───
// Electron 44 cannot run blocking extensions (MV2 removed, MV3 declarativeNet-
// Request not wired), but session.webRequest in the main process supports
// synchronous blocking handlers — so the blocker lives here.
const ADBLOCK_REFRESH_INTERVAL_MS = 4 * 24 * 60 * 60 * 1000; // refresh lists every 4 days
const ADBLOCK_RETRY_MS = 10 * 60 * 1000;
const ADBLOCK_INJECT_CHANNEL = "@ghostery/adblocker/inject-cosmetic-filters";
const ADBLOCK_MUTATION_CHANNEL = "@ghostery/adblocker/is-mutation-observer-enabled";
const ADBLOCKER_PRELOAD_PATH = require.resolve("@ghostery/adblocker-electron-preload");
const ADBLOCK_LISTS: readonly string[] = [
  ...fullLists,
  "https://easylist-downloads.adblockplus.org/easylistpolish.txt",
];

const isInternalPageUrl = (rawUrl: string): boolean => {
  if (!rawUrl) return true;
  if (rawUrl === START_PAGE_URL) return true;
  try {
    const parsed = new URL(rawUrl);
    const protocol = parsed.protocol;
    return protocol === "monobrowser:" || protocol === "file:" || protocol === "data:" || protocol === "about:" || protocol === "devtools:";
  } catch {
    return true;
  }
};

const resolveTabByWebContentsId = (webContentsId: number | undefined): TabRecord | null => {
  if (!webContentsId) return null;
  // The Glance page is untrusted web content of the source tab (same session, same
  // permission/adblock/IPC treatment).
  if (glance && !glance.view.webContents.isDestroyed() && glance.view.webContents.id === webContentsId) {
    return tabs.get(glance.sourceTabId) ?? null;
  }
  for (const tab of tabs.values()) {
    if (tab.view && !tab.view.webContents.isDestroyed() && tab.view.webContents.id === webContentsId) {
      return tab;
    }
  }
  return null;
};

const loadAdblockSettings = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(adblockSettingsFilePath, "utf8");
    const parsed = JSON.parse(raw) as { enabled?: unknown };
    adblockEnabled = typeof parsed?.enabled === "boolean" ? parsed.enabled : true;
  } catch {
    adblockEnabled = true;
  }
};

const loadAdblockExceptions = async (): Promise<void> => {
  adblockExceptions.clear();
  try {
    const raw = await fs.readFile(adblockExceptionsFilePath, "utf8");
    for (const host of parseExceptionList(JSON.parse(raw))) adblockExceptions.add(host);
  } catch {
    // Missing or corrupt file: no exceptions.
  }
};

const listAdblockExceptions = (): string[] => [...adblockExceptions].sort();

const saveAdblockExceptions = async (): Promise<void> => {
  await writeJsonAtomically(adblockExceptionsFilePath, { hosts: listAdblockExceptions() });
};

const setAdblockException = async (input: unknown, excepted: boolean): Promise<{ ok: boolean; hosts: string[] }> => {
  const host = normalizeExceptionHost(input);
  if (!host) return { ok: false, hosts: listAdblockExceptions() };
  if (excepted) adblockExceptions.add(host);
  else adblockExceptions.delete(host);
  await saveAdblockExceptions();
  notifySettingsPage("adblock-exceptions", listAdblockExceptions());
  return { ok: true, hosts: listAdblockExceptions() };
};

/** Top-level page URL for a request/IPC sender: the page's own URL for main-frame loads, else the tab's committed URL, else the referrer. */
const getTopLevelUrlForRequest = (details: { webContentsId?: number; url?: string; resourceType?: string; referrer?: string }): string => {
  if (details.resourceType === "mainFrame" && details.url) return details.url;
  if (typeof details.webContentsId === "number") {
    const contents = webContents.fromId(details.webContentsId);
    if (contents && !contents.isDestroyed()) {
      const topUrl = contents.getURL();
      if (topUrl && !isInternalPageUrl(topUrl)) return topUrl;
    }
  }
  return details.referrer || "";
};

const isRequestExcepted = (details: { webContentsId?: number; url?: string; resourceType?: string; referrer?: string }): boolean =>
  adblockExceptions.size > 0 && isUrlExcepted(getTopLevelUrlForRequest(details), adblockExceptions);

const getSiteExceptionHost = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? normalizeExceptionHost(parsed.hostname) : null;
  } catch {
    return null;
  }
};

const saveAdblockSettings = async (): Promise<void> => {
  await writeJsonAtomically(adblockSettingsFilePath, { enabled: adblockEnabled });
};

const setAdblockEnabled = async (enabled: boolean): Promise<void> => {
  adblockEnabled = enabled;
  await saveAdblockSettings();
  notifySettingsPage("adblock-status", getAdblockerStatus());
};

const getAdblockerStatus = (): AdblockerStatus => {
  const activeTab = getActiveTab();
  return {
    enabled: adblockEnabled,
    ready: adblockReady,
    blockedTotal: adblockSessionBlocks,
    error: adblockError,
    activeTabBlocked: activeTab?.blockedCount ?? 0,
    activeTabPaused: activeTab?.adblockPaused ?? false,
  };
};

const buildAdblockerEngine = async (): Promise<ElectronBlocker | null> => {
  try {
    console.info("Content blocking: fetching filter lists…");
    const engine = await ElectronBlocker.fromLists(fetch, [...ADBLOCK_LISTS]);
    adblockError = null;
    console.info("Content blocking: engine ready.");
    return engine;
  } catch (error) {
    adblockError = error instanceof Error ? error.message : String(error);
    console.error("Content blocking: failed to build engine:", error);
    return null;
  }
};

const ensureAdblockerEngine = async (): Promise<void> => {
  if (adblockReady) {
    return;
  }

  // Fast path: cached serialized engine from a previous run.
  try {
    const cached = await fs.readFile(adblockEngineCachePath);
    adblockBlocker = ElectronBlocker.deserialize(cached);
    adblockReady = true;
    adblockError = null;
    notifySettingsPage("adblock-status", getAdblockerStatus());
    console.info("Content blocking: engine loaded from cache.");
    return;
  } catch {
    // No cache yet — fall through to a network build.
  }

  const engine = await buildAdblockerEngine();
  if (!engine) {
    // Try again later; blocking stays inactive until an engine is available.
    setTimeout(() => { void ensureAdblockerEngine(); }, ADBLOCK_RETRY_MS);
    return;
  }

  adblockBlocker = engine;
  adblockReady = true;
  notifySettingsPage("adblock-status", getAdblockerStatus());
  try {
    await fs.writeFile(adblockEngineCachePath, Buffer.from(engine.serialize()));
  } catch (error) {
    console.error("Content blocking: failed to cache engine:", error);
  }
};

const swapAdblockerEngine = async (): Promise<void> => {
  const engine = await buildAdblockerEngine();
  if (!engine) {
    setTimeout(() => { void swapAdblockerEngine(); }, ADBLOCK_RETRY_MS);
    return;
  }
  adblockBlocker = engine;
  adblockReady = true;
  try {
    await fs.writeFile(adblockEngineCachePath, Buffer.from(engine.serialize()));
  } catch (error) {
    console.error("Content blocking: failed to cache engine:", error);
  }
};

const scheduleAdblockRefresh = (): void => {
  if (adblockRefreshTimer) {
    clearInterval(adblockRefreshTimer);
  }
  adblockRefreshTimer = setInterval(() => {
    fsSync.stat(adblockEngineCachePath, (error, stats) => {
      if (error) {
        void ensureAdblockerEngine();
        return;
      }
      if (Date.now() - stats.mtimeMs > ADBLOCK_REFRESH_INTERVAL_MS) {
        void swapAdblockerEngine();
      }
    });
  }, 60 * 60 * 1000);
};

const attachAdblockerToSession = (targetSession: Electron.Session): void => {
  targetSession.registerPreloadScript({
    type: "frame",
    filePath: ADBLOCKER_PRELOAD_PATH,
  });

  // Electron's webRequest API allows a single listener per event, so these
  // wrappers own the slot and forward to the engine only when appropriate.
  targetSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    if (!adblockEnabled || !adblockReady || !adblockBlocker) {
      callback({});
      return;
    }
    const tab = resolveTabByWebContentsId(details.webContentsId);
    if (tab?.adblockPaused || isRequestExcepted(details)) {
      callback({});
      return;
    }
    adblockBlocker.onBeforeRequest(details, callback);
  });

  targetSession.webRequest.onHeadersReceived({ urls: ["<all_urls>"] }, (details, callback) => {
    if (!adblockEnabled || !adblockReady || !adblockBlocker) {
      callback({});
      return;
    }
    const tab = resolveTabByWebContentsId(details.webContentsId);
    if (tab?.adblockPaused || isRequestExcepted(details)) {
      callback({});
      return;
    }
    adblockBlocker.onHeadersReceived(details, callback);
  });

  targetSession.webRequest.onErrorOccurred((details) => {
    if (!adblockEnabled || details.error !== "net::ERR_BLOCKED_BY_CLIENT") {
      return;
    }
    adblockSessionBlocks += 1;
    recordBlockedRequest();
    const tab = resolveTabByWebContentsId(details.webContentsId);
    if (tab) {
      tab.blockedCount += 1;
    }
  });

};

const initAdblocker = (): void => {
  attachAdblockerToSession(session.defaultSession);

  ipcMain.handle(ADBLOCK_INJECT_CHANNEL, (event, url: unknown, msg: unknown) => {
    if (!adblockEnabled || !adblockReady || !adblockBlocker || typeof url !== "string" || isInternalPageUrl(url)) {
      return;
    }
    const tab = resolveTabByWebContentsId(event.sender.id);
    if (tab?.adblockPaused) {
      return;
    }
    if (adblockExceptions.size > 0 && (isUrlExcepted(event.sender.getURL(), adblockExceptions) || isUrlExcepted(url, adblockExceptions))) {
      return;
    }
    return adblockBlocker.onInjectCosmeticFilters(
      event,
      url,
      msg as Parameters<ElectronBlocker["onInjectCosmeticFilters"]>[2],
    );
  });

  ipcMain.handle(ADBLOCK_MUTATION_CHANNEL, () => Boolean(adblockEnabled && adblockReady && adblockBlocker));

  void ensureAdblockerEngine();
  scheduleAdblockRefresh();
};

const toggleActiveTabAdblockPause = (): void => {
  const tab = getActiveTab();
  if (!tab) {
    return;
  }
  tab.adblockPaused = !tab.adblockPaused;
  if (!tab.adblockPaused) {
    tab.blockedCount = 0;
  }
};

const localeForLanguage = (): string => appLanguage === "pl" ? "pl-PL" : "en-US";

// ── Usage statistics ────────────────────────────────────────────────────────
const getStatsDayKey = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};

const ensureStatsDay = (): StatsDay => {
  const key = getStatsDayKey();
  const day = statsData.days[key] ?? { seconds: 0, visits: 0, blocked: 0, downloads: 0, searches: 0 };
  statsData.days[key] = day;
  return day;
};

const loadStats = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(statsFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<StatsData> | null;
    const empty = createEmptyStatsData();
    if (parsed && typeof parsed === "object") {
      statsData = {
        firstUsedAt: typeof parsed.firstUsedAt === "string" ? parsed.firstUsedAt : empty.firstUsedAt,
        totals: {
          visits: Number(parsed.totals?.visits) || 0,
          blocked: Number(parsed.totals?.blocked) || 0,
          downloads: Number(parsed.totals?.downloads) || 0,
          searches: Number(parsed.totals?.searches) || 0,
          seconds: Number(parsed.totals?.seconds) || 0,
        },
        days: parsed.days && typeof parsed.days === "object" ? { ...parsed.days } : {},
        domains: parsed.domains && typeof parsed.domains === "object" ? { ...parsed.domains } : {},
      };
    }
  } catch {
    // First launch or unreadable file — start fresh (firstUsedAt set at boot).
    statsData = createEmptyStatsData();
  }
};

const saveStats = async (): Promise<void> => {
  const dayKeys = Object.keys(statsData.days);
  if (dayKeys.length > MAX_STATS_DAYS) {
    dayKeys.sort();
    for (const key of dayKeys.slice(0, dayKeys.length - MAX_STATS_DAYS)) {
      delete statsData.days[key];
    }
  }
  const domainKeys = Object.keys(statsData.domains);
  if (domainKeys.length > MAX_STATS_DOMAINS) {
    domainKeys.sort((a, b) => (statsData.domains[a] ?? 0) - (statsData.domains[b] ?? 0));
    for (const key of domainKeys.slice(0, domainKeys.length - MAX_STATS_DOMAINS)) {
      delete statsData.domains[key];
    }
  }
  await writeJsonAtomically(statsFilePath, statsData);
  statsDirty = false;
};

const recordVisit = (rawUrl: string): void => {
  if (!rawUrl) {
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" && parsed.protocol !== "file:") {
    return;
  }
  statsData.totals.visits += 1;
  ensureStatsDay().visits += 1;
  if (parsed.protocol !== "file:" && parsed.hostname) {
    const hostname = parsed.hostname.toLowerCase();
    statsData.domains[hostname] = (statsData.domains[hostname] ?? 0) + 1;
  }
  statsDirty = true;
};

const recordBlockedRequest = (): void => {
  statsData.totals.blocked += 1;
  ensureStatsDay().blocked += 1;
  statsDirty = true;
};

const recordDownloadCompleted = (): void => {
  statsData.totals.downloads += 1;
  ensureStatsDay().downloads += 1;
  statsDirty = true;
};

const recordSearch = (): void => {
  statsData.totals.searches += 1;
  ensureStatsDay().searches += 1;
  statsDirty = true;
};

const startStatsTimer = (): void => {
  if (statsTimer) {
    clearInterval(statsTimer);
  }
  const tickSeconds = 5;
  let ticksSinceSave = 0;
  statsTimer = setInterval(() => {
    const active = Boolean(
      mainWindow
      && !mainWindow.isDestroyed()
      && !mainWindow.isMinimized()
      && mainWindow.isFocused()
      && tabs.size > 0,
    );
    if (active) {
      statsData.totals.seconds += tickSeconds;
      ensureStatsDay().seconds += tickSeconds;
      statsDirty = true;
    }
    ticksSinceSave = (ticksSinceSave + 1) % 12;
    if (ticksSinceSave === 0 && statsDirty) {
      void saveStats();
    }
  }, tickSeconds * 1000);
};

const formatUsageDuration = (totalSeconds: number): string => {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const pl = appLanguage === "pl";
  const parts: string[] = [];
  if (days > 0) {
    parts.push(pl ? (days === 1 ? "1 dzień" : `${days} dni`) : `${days}d`);
  }
  if (hours > 0) {
    parts.push(pl ? `${hours} godz.` : `${hours}h`);
  }
  if (minutes > 0) {
    parts.push(pl ? `${minutes} min` : `${minutes}m`);
  }
  if (parts.length === 0) {
    parts.push(pl ? `${seconds} s` : `${seconds}s`);
  }
  return parts.join(" ");
};

const formatStatsDate = (isoDate: string): string => {
  const parsed = new Date(isoDate);
  if (Number.isNaN(parsed.getTime())) {
    return isoDate;
  }
  return parsed.toLocaleDateString(localeForLanguage(), { day: "numeric", month: "long", year: "numeric" });
};

const renderStatsPageHtml = (): string => {
  const copy = appLanguage === "pl" ? {
    documentTitle: "MonoBrowser — Statystyki",
    heading: "Statystyki użycia",
    pages: "Odwiedzone strony",
    time: "Czas używania",
    downloads: "Pobrane pliki",
    blocked: "Zablokowane żądania",
    searches: "Wyszukiwania",
    topSites: "Najczęściej odwiedzane",
    noData: "Brak danych.",
    today: "dziś",
    since: "Korzystasz z MonoBrowser od",
  } : {
    documentTitle: "MonoBrowser — Statistics",
    heading: "Usage statistics",
    pages: "Pages visited",
    time: "Time spent",
    downloads: "Files downloaded",
    blocked: "Blocked requests",
    searches: "Searches",
    topSites: "Most visited",
    noData: "No data yet.",
    today: "today",
    since: "Using MonoBrowser since",
  };
  const todayKey = getStatsDayKey();
  const today: StatsDay = statsData.days[todayKey]
    ?? { seconds: 0, visits: 0, blocked: 0, downloads: 0, searches: 0 };
  const timeToday = formatUsageDuration(today.seconds);
  const timeTotal = formatUsageDuration(statsData.totals.seconds);
  const topDomains = Object.entries(statsData.domains)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  const todayCount = (value: number): string => `${copy.today}: ${value}`;
  const timeTodayLabel = `${copy.today}: ${timeToday}`;
  const topRows = topDomains.length > 0
    ? topDomains.map(([hostname, count]) =>
      `<div class="stats-row"><span class="stats-label">${escapeHtml(hostname)}</span><strong>${count}</strong></div>`).join("")
    : `<div class="stats-empty">${copy.noData}</div>`;

  return `<!doctype html>
<html lang="${appLanguage}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:" />
    <title>${copy.documentTitle}</title>
    <style>
      :root {
        ${LEGACY_ALIAS_CSS}
        font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
      }
      ${UI_BASE_START_CSS}

      html,
      body {
        width: 100%;
        height: 100%;
      }

      body {
        margin: 0;
        background: var(--white);
        color: var(--black);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: .03;
        background: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }

      header {
        padding: 15px 18px;
        border-bottom: 3px solid var(--black);
        background: var(--black);
        color: var(--white);
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex: 0 0 auto;
      }

      header > span {
        color: var(--white);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: .12em;
        text-transform: uppercase;
      }

      main {
        flex: 1 1 auto;
        overflow: auto;
        padding: 18px;
        display: flex;
        flex-direction: column;
        gap: 18px;
      }

      h2 {
        margin: 0;
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .14em;
        text-transform: uppercase;
        color: var(--grey);
      }

      .card {
        border: 2px solid var(--black);
        background: var(--white);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }

      .stats-row {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 12px;
        padding: 9px 4px;
        border-bottom: 1px solid var(--accent);
        font-size: 12px;
      }

      .stats-row:last-child {
        border-bottom: 0;
      }

      .stats-row strong {
        font-size: 13px;
      }

      .stats-today {
        margin-left: auto;
        color: var(--grey);
        font-size:11px;
      }

      .stats-empty {
        padding: 10px 4px;
        color: var(--grey);
        font-size: 11px;
      }

      footer {
        flex: 0 0 auto;
        padding: 12px 18px;
        border-top: 2px solid var(--black);
        color: var(--grey);
        font-size:11px;
      }
      ${UI_BASE_END_CSS}
    </style>
  </head>
  <body>
    <header><span>${copy.heading}</span></header>
    <main>
      <div class="card">
        <div class="stats-row"><span class="stats-label">${copy.pages}</span><span class="stats-today">${escapeHtml(today.visits > 0 ? todayCount(today.visits) : "")}</span><strong>${statsData.totals.visits}</strong></div>
        <div class="stats-row"><span class="stats-label">${copy.time}</span><span class="stats-today">${escapeHtml(today.seconds > 0 ? timeTodayLabel : "")}</span><strong>${escapeHtml(timeTotal)}</strong></div>
        <div class="stats-row"><span class="stats-label">${copy.downloads}</span><span class="stats-today">${escapeHtml(today.downloads > 0 ? todayCount(today.downloads) : "")}</span><strong>${statsData.totals.downloads}</strong></div>
        <div class="stats-row"><span class="stats-label">${copy.blocked}</span><span class="stats-today">${escapeHtml(today.blocked > 0 ? todayCount(today.blocked) : "")}</span><strong>${statsData.totals.blocked}</strong></div>
        <div class="stats-row"><span class="stats-label">${copy.searches}</span><span class="stats-today">${escapeHtml(today.searches > 0 ? todayCount(today.searches) : "")}</span><strong>${statsData.totals.searches}</strong></div>
      </div>
      <h2>${copy.topSites}</h2>
      <div class="card">${topRows}</div>
    </main>
    <footer>${escapeHtml(copy.since)} ${escapeHtml(formatStatsDate(statsData.firstUsedAt))}</footer>
  </body>
</html>`;
};



const saveDownloads = async (): Promise<void> => {
  downloadRecords = downloadRecords.slice(0, MAX_DOWNLOAD_ITEMS);
  // Pobieranie aktualizacji jest widoczne tylko w trakcie sesji – nie zapisujemy go na dysk.
  await writeJsonAtomically(downloadsFilePath, downloadRecords.filter((record) => record.kind !== "update"));
};

const getDownloadStatePayload = (): DownloadStatePayload => ({
  downloads: downloadRecords.map((record) => ({ ...record })),
});

let downloadProgressHideTimer: NodeJS.Timeout | null = null;

const positionDownloadProgressView = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !downloadProgressView || downloadProgressView.webContents.isDestroyed()) {
    return;
  }

  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const width = 340;
  const height = 92;
  const margin = 16;
  downloadProgressView.setBounds({
    x: Math.max(viewportLeft, contentWidth - width - margin),
    y: Math.max(viewportTop, contentHeight - height - margin),
    width,
    height,
  });
};

const isViewAttached = (view: WebContentsView): boolean =>
  Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.contentView.children.includes(view));

const attachViewOnTop = (view: WebContentsView): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.contentView.addChildView(view);
  if (view !== toastView) hideToast();
  // Menu popup overlay: any other view attaching (tab switch, palette, notes,
  // find bar) dismisses it, except the small download toast which just
  // keeps the popup on top.
  if (isPopupVisible() && view !== popupView) {
    if (view === downloadProgressView) {
      attachPopupViewOnTop();
    } else {
      closePopup(false);
    }
  }
};

const detachView = (view: WebContentsView): void => {
  if (mainWindow && !mainWindow.isDestroyed() && isViewAttached(view)) {
    mainWindow.contentView.removeChildView(view);
  }
};

const attachDownloadProgressView = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !downloadProgressView || downloadProgressView.webContents.isDestroyed()) {
    return;
  }
  positionDownloadProgressView();
  attachViewOnTop(downloadProgressView);
  downloadProgressView.setVisible(true);
  downloadProgressVisible = true;
};

const hideDownloadProgressView = (): void => {
  downloadProgressVisible = false;
  const view = downloadProgressView;
  if (view) {
    detachView(view);
    // A re-attached WebContentsView can stay composited-hidden (Electron bug
    // family around removeChildView + addChildView), so destroy on hide and
    // let the next broadcast recreate it.
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
    if (downloadProgressView === view) {
      downloadProgressView = null;
    }
  }
};

const createDownloadProgressView = async (): Promise<WebContentsView | null> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  if (downloadProgressView && !downloadProgressView.webContents.isDestroyed()) {
    return downloadProgressView;
  }

  downloadProgressView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "download-progress-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  downloadProgressView.setBackgroundColor("#00000000");
  trackThemedContents(downloadProgressView.webContents);
  downloadProgressView.webContents.on("destroyed", () => {
    downloadProgressView = null;
    downloadProgressVisible = false;
  });
  await downloadProgressView.webContents.loadFile(path.join(__dirname, "../renderer/download-progress.html"));
  positionDownloadProgressView();
  return downloadProgressView;
};

const broadcastDownloadProgress = (): void => {
  const active = downloadRecords.filter((record) => record.status === "in-progress");
  if (!active.length && (!downloadProgressView || downloadProgressView.webContents.isDestroyed())) {
    return;
  }

  void createDownloadProgressView().then((view) => {
    if (!view || view.webContents.isDestroyed()) {
      return;
    }
    const visibleRecords = active.length ? active : downloadRecords.slice(0, 1);
    view.webContents.send("download-progress:updated", {
      downloads: visibleRecords.map((record) => ({ ...record })),
      language: appLanguage,
    });

    if (downloadProgressHideTimer) {
      clearTimeout(downloadProgressHideTimer);
      downloadProgressHideTimer = null;
    }
    if (active.length) {
      attachDownloadProgressView();
      return;
    }
    downloadProgressHideTimer = setTimeout(() => {
      hideDownloadProgressView();
      downloadProgressHideTimer = null;
    }, 3_000);
  }).catch((error) => console.error("Failed to show download progress:", error));
};

const broadcastDownloads = (): void => {
  for (const tab of getInternalTabs("downloads")) {
    const downloadsContents = getTabContents(tab);
    if (downloadsContents && !downloadsContents.isDestroyed()) downloadsContents.send("downloads:updated", getDownloadStatePayload());
  }
  broadcastDownloadProgress();
};

const loadDownloads = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(downloadsFilePath, "utf8");
    const parsed = JSON.parse(raw) as DownloadRecord[];
    downloadRecords = Array.isArray(parsed) ? parsed.slice(0, MAX_DOWNLOAD_ITEMS) : [];
  } catch {
    downloadRecords = [];
  }

  let changed = false;
  const interruptedAt = new Date().toISOString();
  downloadRecords = downloadRecords.map((record) => {
    if (record.status !== "in-progress") {
      return record;
    }
    changed = true;
    return {
      ...record,
      status: "interrupted",
      finishedAt: interruptedAt,
      error: "Pobieranie zostało przerwane przez zamknięcie aplikacji.",
    };
  });

  if (changed) {
    await saveDownloads();
  }
};

const getSafeDownloadFileName = (suggestedName: string): string => {
  const rawName = path.basename(suggestedName.trim() || "download");
  return rawName.replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_") || "download";
};

const registerDownloadHandling = (): void => {
  session.defaultSession.on("will-download", (_event, item) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let savePath = "";

    try {
      const fileName = getSafeDownloadFileName(item.getFilename() || "download");
      item.setSaveDialogOptions({
        title: appLanguage === "pl" ? "Zapisz pobierany plik" : "Save download",
        buttonLabel: appLanguage === "pl" ? "Zapisz" : "Save",
        defaultPath: path.join(app.getPath("downloads"), fileName),
      });

      const sourceUrl = item.getURL();
      const record: DownloadRecord = {
        id,
        fileName,
        sourceUrl,
        sourceOrigin: normalizeHttpOrigin(sourceUrl) ?? "Nieznane źródło",
        savePath,
        startedAt: new Date(item.getStartTime() * 1000 || Date.now()).toISOString(),
        finishedAt: null,
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        status: "in-progress",
      };

      downloadRecords = [record, ...downloadRecords].slice(0, MAX_DOWNLOAD_ITEMS);
      activeDownloads.set(id, item);
      void saveDownloads().catch((error) => console.error("Failed to save downloads:", error));
      broadcastDownloads();

      item.on("updated", (_updatedEvent, state) => {
        savePath = item.getSavePath();
        if (savePath) {
          record.savePath = savePath;
          record.fileName = path.basename(savePath);
        }
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        if (state === "interrupted") {
          record.error = "Połączenie zostało przerwane; Electron próbuje kontynuować pobieranie.";
        } else {
          delete record.error;
        }
        broadcastDownloads();
      });

      item.once("done", (_doneEvent, state) => {
        savePath = item.getSavePath();
        if (savePath) {
          record.savePath = savePath;
          record.fileName = path.basename(savePath);
        }
        record.receivedBytes = item.getReceivedBytes();
        record.totalBytes = item.getTotalBytes();
        record.finishedAt = new Date().toISOString();
        record.status = state;
        if (state === "completed") {
          recordDownloadCompleted();
        }
        if (state === "interrupted") {
          record.error = "Pobieranie zostało przerwane przez błąd sieci lub zapisu.";
        } else if (state === "cancelled") {
          record.error = "Pobieranie zostało anulowane.";
        } else {
          delete record.error;
        }
        activeDownloads.delete(id);
        void saveDownloads().catch((error) => console.error("Failed to save downloads:", error));
        broadcastDownloads();
      });
    } catch (error) {
      item.cancel();
      const message = error instanceof Error ? error.message : "Nieznany błąd pobierania.";
      const failedRecord: DownloadRecord = {
        id,
        fileName: item.getFilename() || "download",
        sourceUrl: item.getURL(),
        sourceOrigin: normalizeHttpOrigin(item.getURL()) ?? "Nieznane źródło",
        savePath,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        receivedBytes: item.getReceivedBytes(),
        totalBytes: item.getTotalBytes(),
        status: "failed",
        error: message,
      };
      downloadRecords = [failedRecord, ...downloadRecords].slice(0, MAX_DOWNLOAD_ITEMS);
      void saveDownloads().catch((saveError) => console.error("Failed to save downloads:", saveError));
      broadcastDownloads();
    }
  });
};

const saveSiteOrigins = async (): Promise<void> => {
  await writeJsonAtomically(siteOriginsFilePath, siteOriginRecords);
};

const loadSiteOrigins = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(siteOriginsFilePath, "utf8");
    const parsed = JSON.parse(raw) as SiteOriginRecord[];
    siteOriginRecords = Array.isArray(parsed)
      ? parsed.filter((entry) => normalizeHttpOrigin(entry.origin) === entry.origin)
      : [];
  } catch {
    siteOriginRecords = [];
  }
};

const registerVisitedOrigin = async (url: string): Promise<void> => {
  const origin = normalizeHttpOrigin(url);
  if (!origin) {
    return;
  }

  const nextRecord = { origin, lastSeenAt: new Date().toISOString() };
  siteOriginRecords = [
    nextRecord,
    ...siteOriginRecords.filter((entry) => entry.origin !== origin),
  ];
  await saveSiteOrigins();
};

const cookieMatchesHostname = (cookieDomain: string, hostname: string): boolean => {
  const normalizedDomain = cookieDomain.replace(/^\./, "").toLowerCase();
  const normalizedHostname = hostname.toLowerCase();
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`);
};

const listSiteData = async (): Promise<SiteDataEntry[]> => {
  const cookies = await session.defaultSession.cookies.get({});
  const entries = new Map<string, SiteDataEntry>();

  for (const record of siteOriginRecords) {
    entries.set(record.origin, {
      origin: record.origin,
      lastSeenAt: record.lastSeenAt,
      cookieCount: 0,
    });
  }

  for (const cookie of cookies) {
    if (!cookie.domain) {
      continue;
    }
    const host = cookie.domain.replace(/^\./, "");
    const origin = normalizeHttpOrigin(`${cookie.secure ? "https" : "http"}://${host}`);
    if (origin && !entries.has(origin)) {
      entries.set(origin, { origin, lastSeenAt: null, cookieCount: 0 });
    }
  }

  for (const entry of entries.values()) {
    const hostname = new URL(entry.origin).hostname;
    entry.cookieCount = cookies.filter((cookie) => Boolean(cookie.domain) && cookieMatchesHostname(cookie.domain!, hostname)).length;
  }

  return [...entries.values()].sort((a, b) => {
    const dateOrder = (b.lastSeenAt ?? "").localeCompare(a.lastSeenAt ?? "");
    return dateOrder || a.origin.localeCompare(b.origin);
  });
};

const validateSiteDataTypes = (value: unknown): SiteDataType[] | null => {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }
  const unique = [...new Set(value)];
  if (!unique.every((item): item is SiteDataType => typeof item === "string" && ALLOWED_SITE_DATA_TYPES.has(item as SiteDataType))) {
    return null;
  }
  return unique;
};

const clearSiteData = async (originValue: unknown, dataTypesValue: unknown): Promise<ClearResult> => {
  if (typeof originValue !== "string") {
    return { ok: false, message: appLanguage === "pl" ? "Nieprawidłowy origin." : "Invalid origin." };
  }
  const origin = normalizeHttpOrigin(originValue);
  if (!origin || origin !== originValue) {
    return { ok: false, message: appLanguage === "pl" ? "Nieprawidłowy lub nieobsługiwany origin." : "Invalid or unsupported origin." };
  }
  const dataTypes = validateSiteDataTypes(dataTypesValue);
  if (!dataTypes) {
    return { ok: false, message: appLanguage === "pl" ? "Wybierz co najmniej jeden prawidłowy typ danych." : "Select at least one valid data type." };
  }

  try {
    await session.defaultSession.clearData({ origins: [origin], dataTypes });
    return { ok: true, message: appLanguage === "pl" ? `Usunięto wybrane dane dla ${origin}.` : `Selected data for ${origin} was cleared.` };
  } catch (error) {
    const detail = error instanceof Error ? error.message : appLanguage === "pl" ? "Nieznany błąd." : "Unknown error.";
    return { ok: false, message: appLanguage === "pl" ? `Nie udało się usunąć danych: ${detail}` : `Data could not be cleared: ${detail}` };
  }
};

const clearGlobalSiteData = async (dataTypesValue: unknown): Promise<ClearResult> => {
  const dataTypes = validateSiteDataTypes(dataTypesValue);
  if (!dataTypes) {
    return { ok: false, message: appLanguage === "pl" ? "Wybierz co najmniej jeden prawidłowy typ danych." : "Select at least one valid data type." };
  }
  try {
    await session.defaultSession.clearData({ dataTypes });
    return { ok: true, message: appLanguage === "pl" ? "Usunięto wybrane dane wszystkich witryn." : "Selected data for all sites was cleared." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : appLanguage === "pl" ? "Nieznany błąd." : "Unknown error.";
    return { ok: false, message: appLanguage === "pl" ? `Nie udało się usunąć danych: ${detail}` : `Data could not be cleared: ${detail}` };
  }
};

const escapeHtml = (value: string): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
};

const getHistoryRowsHtml = (entries: HistoryEntry[]): string => {
  return entries
    .map((entry) => {
      const safeUrl = escapeHtml(entry.url);
      const safeTitle = escapeHtml(entry.title || entry.url);
      const safeVisitedAt = escapeHtml(
        new Date(entry.visitedAt).toLocaleString(localeForLanguage()),
      );

      const safeHost = escapeHtml(shortUrlLabel(entry.url));

      return `<li><a href="${safeUrl}" title="${safeTitle}" target="_blank" rel="noopener noreferrer">${safeTitle}</a><span class="history-url" title="${safeUrl}">${safeHost}</span><span>${safeVisitedAt}</span></li>`;
    })
    .join("");
};

const renderHistoryPageHtml = (entries: HistoryEntry[]): string => {
  const copy = appLanguage === "pl" ? {
    documentTitle: "MonoBrowser — Historia",
    heading: "Historia przeglądania",
    clear: "Usuń całą historię",
    alreadyEmpty: "Historia jest już pusta",
    confirm: "Czy na pewno usunąć całą historię przeglądania?",
    empty: "Brak wpisów w historii.",
  } : {
    documentTitle: "MonoBrowser — History",
    heading: "Browsing history",
    clear: "Clear all history",
    alreadyEmpty: "History is already empty",
    confirm: "Are you sure you want to clear all browsing history?",
    empty: "No browsing history yet.",
  };
  const rows = getHistoryRowsHtml(entries);

  const clearHistoryLabel = rows ? copy.clear : copy.alreadyEmpty;
  const clearHistoryDisabled = rows ? "" : "disabled";

  return `<!doctype html>
<html lang="${appLanguage}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:" />
    <title>${copy.documentTitle}</title>
    <style>
      :root {
        ${LEGACY_ALIAS_CSS}
        font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
      }
      ${UI_BASE_START_CSS}

      html,
      body {
        width: 100%;
        height: 100%;
      }

      body {
        margin: 0;
        background: var(--white);
        color: var(--black);
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      body::after {
        content: "";
        position: fixed;
        inset: 0;
        pointer-events: none;
        opacity: .03;
        background: url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
      }

      header {
        padding: 15px 18px;
        border-bottom: 3px solid var(--black);
        background: var(--black);
        color: var(--white);
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex: 0 0 auto;
      }

      header > span {
        color: var(--white);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: .12em;
        text-transform: uppercase;
      }

      ${INTERNAL_CONFIRM_STYLES}

      .clear-history {
        border: 2px solid var(--white);
        background: var(--white);
        color: var(--black);
        border-radius: 0;
        padding: 8px 11px;
        font-size:11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
        font-family: inherit;
        cursor: pointer;
        transition: background var(--mb-dur, 120ms);
      }

      .clear-history:hover:not(:disabled) {
        background: var(--accent);
      }

      .clear-history:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      main {
        padding: 18px;
        flex: 1 1 auto;
        min-height: 0;
        display: flex;
      }

      .panel {
        background: var(--white);
        border: 3px solid var(--black);
        border-radius: 0;
        flex: 1 1 auto;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
        overflow: hidden;
      }

      .history-panel ul {
        padding: 6px;
        flex: 1 1 auto;
        min-height: 0;
        overflow-y: auto;
      }

      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      li {
        display: grid;
        gap: 2px;
        padding: 12px;
        border-bottom: 1px solid var(--black);
      }

      li:hover {
        background: var(--mb-surface-2);
      }

      a {
        color: var(--black);
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      a:hover {
        text-decoration: underline;
      }

      span {
        color: var(--grey);
        font-size: 12px;
      }

      .history-url {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .empty {
        padding: 16px;
        color: var(--grey);
        flex: 1 1 auto;
      }

      ${UI_BASE_END_CSS}
    </style>
  </head>
  <body>
    <header>
      <span>${copy.heading}</span>
      <button id="clear-history" class="clear-history" type="button" ${clearHistoryDisabled}>${clearHistoryLabel}</button>
    </header>
    <main>
      <section class="panel history-panel">
        ${rows ? `<ul>${rows}</ul>` : `<div class="empty">${copy.empty}</div>`}
      </section>
    </main>
    ${renderInternalConfirmMarkup()}
    <script>
      (() => {
        const copy = ${JSON.stringify({ confirm: copy.confirm, clear: copy.clear, alreadyEmpty: copy.alreadyEmpty, empty: copy.empty, locale: localeForLanguage() }).replace(/</g, "\\u003c")};
        const confirmText = copy.confirm;
        const clearButton = document.getElementById("clear-history");
        const panel = document.querySelector(".history-panel");
        const renderEntries = (entries) => {
          clearButton.disabled = entries.length === 0;
          clearButton.textContent = entries.length ? copy.clear : copy.alreadyEmpty;
          if (!entries.length) {
            const empty = document.createElement("div");
            empty.className = "empty";
            empty.textContent = copy.empty;
            panel.replaceChildren(empty);
            return;
          }
          const list = document.createElement("ul");
          for (const entry of entries) {
            const item = document.createElement("li");
            const link = document.createElement("a");
            link.href = entry.url;
            link.title = entry.title || entry.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = entry.title || entry.url;
            const host = document.createElement("span");
            host.className = "history-url";
            host.title = entry.url;
            host.textContent = String(entry.url).replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
            const visited = document.createElement("span");
            visited.textContent = new Date(entry.visitedAt).toLocaleString(copy.locale);
            item.append(link, host, visited);
            list.append(item);
          }
          panel.replaceChildren(list);
        };
        window.browserApi.onHistoryUpdated(renderEntries);
        clearButton.addEventListener("click", async () => {
          if (clearButton.disabled || !await window.mbConfirm(confirmText)) return;
          await window.browserApi.clearGlobalHistory();
        });
      })();
    </script>
  </body>
</html>`;
};


const createUserscriptId = (): string =>
  `${Date.now()}-${Math.random().toString(16).slice(2)}`;

const isUserScriptRunAt = (value: unknown): value is UserScriptRunAt =>
  value === "document-start" || value === "document-idle";

const escapeUserScriptRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const userScriptPatternCache = new Map<string, RegExp | null>();

const compileUserScriptPattern = (pattern: string): RegExp | null => {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.length > 2048) {
    return null;
  }

  if (userScriptPatternCache.has(trimmed)) {
    return userScriptPatternCache.get(trimmed) ?? null;
  }

  let compiled: RegExp | null = null;
  const structured = trimmed.match(/^(\*|http|https|file):\/\/(\*|(?:\*\.)?[^/*]+)(\/.*)$/i);
  if (structured) {
    const [, rawScheme, rawHost, rawPath] = structured;
    const scheme = rawScheme.toLowerCase() === "*"
      ? "(?:https?|file)"
      : rawScheme.toLowerCase();
    let host: string;
    if (rawHost === "*") {
      host = "[^/]*";
    } else if (rawHost.toLowerCase().startsWith("*.")) {
      host = `(?:[^/]*\\.)?${escapeUserScriptRegExp(rawHost.slice(2))}`;
    } else {
      host = escapeUserScriptRegExp(rawHost);
    }
    const path = escapeUserScriptRegExp(rawPath).replaceAll("\\*", ".*");
    try {
      compiled = new RegExp(`^${scheme}:\\/\\/${host}${path}$`, "i");
    } catch {
      compiled = null;
    }
  } else {
    // Fallback: treat the value as a simple glob with '*' wildcards (@include-style).
    try {
      compiled = new RegExp(`^${escapeUserScriptRegExp(trimmed).replaceAll("\\*", ".*")}$`, "i");
    } catch {
      compiled = null;
    }
  }

  if (userScriptPatternCache.size > 500) {
    userScriptPatternCache.clear();
  }
  userScriptPatternCache.set(trimmed, compiled);
  return compiled;
};

const userScriptMatchesUrl = (script: UserScript, url: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  const protocol = parsed.protocol.replace(":", "").toLowerCase();
  if (protocol !== "http" && protocol !== "https" && protocol !== "file") {
    return false;
  }

  if (script.excludes.some((pattern) => compileUserScriptPattern(pattern)?.test(url))) {
    return false;
  }

  // An empty match list means the script runs on every http(s)/file page.
  if (script.matches.length === 0) {
    return true;
  }

  return script.matches.some((pattern) => compileUserScriptPattern(pattern)?.test(url));
};

const normalizeUserScriptPatterns = (value: unknown): string[] => {
  const items = typeof value === "string"
    ? value.split(/\r?\n/)
    : Array.isArray(value)
      ? value
      : [];
  const patterns: string[] = [];
  for (const item of items) {
    if (typeof item !== "string") {
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed || trimmed.length > 2048 || patterns.includes(trimmed)) {
      continue;
    }
    patterns.push(trimmed);
    if (patterns.length >= MAX_USERSCRIPT_PATTERNS) {
      break;
    }
  }
  return patterns;
};

const parseUserScriptHeader = (code: string): {
  name: string;
  matches: string[];
  excludes: string[];
  runAt: UserScriptRunAt | null;
} => {
  const result = { name: "", matches: [] as string[], excludes: [] as string[], runAt: null as UserScriptRunAt | null };
  const startIndex = code.indexOf(USERSCRIPT_HEADER_START);
  if (startIndex < 0) {
    return result;
  }

  const endIndex = code.indexOf(USERSCRIPT_HEADER_END, startIndex);
  const header = code.slice(
    startIndex + USERSCRIPT_HEADER_START.length,
    endIndex >= 0 ? endIndex : undefined,
  );

  for (const rawLine of header.split(/\r?\n/)) {
    const line = rawLine.trim().replace(/^\/\/+/, "").trim();
    if (!line.startsWith("@")) {
      continue;
    }
    const separator = line.search(/\s/);
    if (separator < 0) {
      continue;
    }
    const key = line.slice(1, separator).toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!value) {
      continue;
    }
    if (key === "name" && !result.name) {
      result.name = value;
    } else if (key === "match" || key === "include") {
      if (result.matches.length < MAX_USERSCRIPT_PATTERNS) {
        result.matches.push(value);
      }
    } else if (key === "exclude") {
      if (result.excludes.length < MAX_USERSCRIPT_PATTERNS) {
        result.excludes.push(value);
      }
    } else if (key === "run-at" && isUserScriptRunAt(value)) {
      result.runAt = value;
    }
  }

  return result;
};

const normalizeUserScript = (value: unknown, index: number): UserScript | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const raw = value as Partial<UserScript>;
  if (typeof raw.code !== "string" || !raw.code.trim() || raw.code.length > MAX_USERSCRIPT_CODE_LENGTH) {
    return null;
  }

  const now = new Date().toISOString();
  const header = parseUserScriptHeader(raw.code);
  const name = typeof raw.name === "string" && raw.name.trim()
    ? raw.name.trim()
    : header.name || `User script ${index + 1}`;

  return {
    id: typeof raw.id === "string" && raw.id.length >= 8 && raw.id.length <= 64
      ? raw.id
      : createUserscriptId(),
    name: name.slice(0, MAX_USERSCRIPT_NAME_LENGTH),
    enabled: raw.enabled !== false,
    matches: normalizeUserScriptPatterns(raw.matches).length > 0
      ? normalizeUserScriptPatterns(raw.matches)
      : header.matches,
    excludes: normalizeUserScriptPatterns(raw.excludes).length > 0
      ? normalizeUserScriptPatterns(raw.excludes)
      : header.excludes,
    runAt: isUserScriptRunAt(raw.runAt) ? raw.runAt : (header.runAt ?? "document-idle"),
    code: raw.code,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : now,
  };
};

const saveUserScripts = async (): Promise<void> => {
  await writeJsonAtomically(userscriptsFilePath, userScriptEntries.slice(0, MAX_USERSCRIPT_ITEMS));
};

const loadUserScripts = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(userscriptsFilePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      userScriptEntries = [];
      return;
    }

    userScriptEntries = parsed
      .map((entry, index) => normalizeUserScript(entry, index))
      .filter((entry): entry is UserScript => entry !== null)
      .slice(0, MAX_USERSCRIPT_ITEMS);
  } catch {
    userScriptEntries = [];
  }
};

const buildUserScriptWrapper = (script: UserScript): string => {
  const nameLiteral = JSON.stringify(script.name);
  const infoLiteral = JSON.stringify({
    name: script.name,
    runAt: script.runAt,
    source: "MonoBrowser",
  });

  return [
    "(function(){",
    `"use strict";`,
    `var GM_info = ${infoLiteral};`,
    "var GM_addStyle = function(css){ var element = document.createElement('style'); element.textContent = String(css); (document.head || document.documentElement).appendChild(element); return element; };",
    "var GM_setClipboard = function(text){ if (navigator.clipboard) { return navigator.clipboard.writeText(String(text)); } };",
    "try {",
    `(function(){\n${script.code}\n})();`,
    "} catch (error) {",
    `console.error('[MonoBrowser userscript] ' + ${nameLiteral} + ':', error);`,
    "}",
    "})();",
  ].join("\n");
};

const executedUserScriptKeys = new WeakMap<WebContents, Set<string>>();

const injectUserScriptsIntoContents = async (
  contents: WebContents,
  runAt: UserScriptRunAt,
): Promise<void> => {
  if (contents.isDestroyed() || userScriptEntries.length === 0) {
    return;
  }

  const url = contents.getURL();
  if (!url) {
    return;
  }

  const matching = userScriptEntries.filter((script) =>
    script.enabled &&
    script.runAt === runAt &&
    userScriptMatchesUrl(script, url)
  );
  if (matching.length === 0) {
    return;
  }

  const key = `${runAt}|${url}`;
  let executed = executedUserScriptKeys.get(contents);
  if (!executed) {
    executed = new Set();
    executedUserScriptKeys.set(contents, executed);
  }
  if (executed.has(key)) {
    return;
  }
  executed.add(key);

  for (const script of matching) {
    if (contents.isDestroyed()) {
      return;
    }
    try {
      await contents.executeJavaScript(buildUserScriptWrapper(script), true);
    } catch (error) {
      console.error(`Failed to run user script "${script.name}":`, error);
    }
  }
};

const saveUserScriptInput = async (input: unknown): Promise<UserScriptResult> => {
  const copy = appLanguage === "pl"
    ? {
      invalid: "Nieprawidłowe dane skryptu.",
      noCode: "Kod skryptu nie może być pusty.",
      codeTooLong: "Kod skryptu jest za długi.",
      tooMany: `Osiągnięto limit skryptów (${MAX_USERSCRIPT_ITEMS}).`,
      saved: "Skrypt zapisany.",
      fallbackName: "Nowy skrypt",
    }
    : {
      invalid: "Invalid script data.",
      noCode: "Script code cannot be empty.",
      codeTooLong: "Script code is too long.",
      tooMany: `Reached the script limit (${MAX_USERSCRIPT_ITEMS}).`,
      saved: "Script saved.",
      fallbackName: "New script",
    };

  if (typeof input !== "object" || input === null) {
    return { ok: false, message: copy.invalid };
  }

  const raw = input as {
    id?: unknown;
    name?: unknown;
    enabled?: unknown;
    matches?: unknown;
    excludes?: unknown;
    runAt?: unknown;
    code?: unknown;
  };

  const code = typeof raw.code === "string" ? raw.code : "";
  if (!code.trim()) {
    return { ok: false, message: copy.noCode };
  }
  if (code.length > MAX_USERSCRIPT_CODE_LENGTH) {
    return { ok: false, message: copy.codeTooLong };
  }

  const header = parseUserScriptHeader(code);
  const providedName = typeof raw.name === "string" ? raw.name.trim() : "";
  const name = (providedName || header.name || copy.fallbackName).slice(0, MAX_USERSCRIPT_NAME_LENGTH);
  const matches = normalizeUserScriptPatterns(raw.matches);
  const excludes = normalizeUserScriptPatterns(raw.excludes);
  const runAt = isUserScriptRunAt(raw.runAt) ? raw.runAt : (header.runAt ?? "document-idle");
  const enabled = raw.enabled !== false;

  const existingId = typeof raw.id === "string" && raw.id
    ? userScriptEntries.find((script) => script.id === raw.id)?.id ?? null
    : null;

  if (existingId) {
    const existing = userScriptEntries.find((script) => script.id === existingId);
    if (!existing) {
      return { ok: false, message: copy.invalid };
    }
    const updated: UserScript = {
      ...existing,
      name,
      enabled,
      matches,
      excludes,
      runAt,
      code,
      updatedAt: new Date().toISOString(),
    };
    userScriptEntries = userScriptEntries.map((script) => script.id === existingId ? updated : script);
    await saveUserScripts();
    return { ok: true, message: copy.saved, script: updated };
  }

  if (userScriptEntries.length >= MAX_USERSCRIPT_ITEMS) {
    return { ok: false, message: copy.tooMany };
  }

  const created: UserScript = {
    id: createUserscriptId(),
    name,
    enabled,
    matches,
    excludes,
    runAt,
    code,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  userScriptEntries = [...userScriptEntries, created];
  await saveUserScripts();
  return { ok: true, message: copy.saved, script: created };
};

const toggleUserScript = async (id: unknown, enabled: unknown): Promise<boolean> => {
  if (typeof id !== "string" || typeof enabled !== "boolean") {
    return false;
  }

  const existing = userScriptEntries.find((script) => script.id === id);
  if (!existing) {
    return false;
  }

  const updated: UserScript = {
    ...existing,
    enabled,
    updatedAt: new Date().toISOString(),
  };
  userScriptEntries = userScriptEntries.map((script) => script.id === id ? updated : script);
  await saveUserScripts();
  return true;
};

const removeUserScript = async (id: unknown): Promise<boolean> => {
  if (typeof id !== "string") {
    return false;
  }

  const next = userScriptEntries.filter((script) => script.id !== id);
  if (next.length === userScriptEntries.length) {
    return false;
  }

  userScriptEntries = next;
  await saveUserScripts();
  return true;
};

const importUserScriptFromFile = async (): Promise<UserScriptImportResult> => {
  const copy = appLanguage === "pl"
    ? {
      title: "Importuj skrypt użytkownika",
      readFailed: "Nie udało się odczytać pliku.",
      codeTooLong: "Kod skryptu jest za długi.",
      imported: "Skrypt wczytany — sprawdź szczegóły i zapisz.",
    }
    : {
      title: "Import a user script",
      readFailed: "The file could not be read.",
      codeTooLong: "Script code is too long.",
      imported: "Script loaded — review the details and save.",
    };

  const parent = mainWindow;
  if (!parent || parent.isDestroyed()) {
    return { ok: false, message: copy.readFailed, draft: null };
  }

  const picked = await dialog.showOpenDialog(parent, {
    title: copy.title,
    properties: ["openFile"],
    filters: [
      { name: appLanguage === "pl" ? "Skrypty użytkownika" : "User scripts", extensions: ["user.js", "js"] },
      { name: appLanguage === "pl" ? "Wszystkie pliki" : "All files", extensions: ["*"] },
    ],
  });

  if (picked.canceled || picked.filePaths.length === 0) {
    return { ok: true, message: "", draft: null };
  }

  try {
    const code = await fs.readFile(picked.filePaths[0], "utf8");
    if (code.length > MAX_USERSCRIPT_CODE_LENGTH) {
      return { ok: false, message: copy.codeTooLong, draft: null };
    }

    const header = parseUserScriptHeader(code);
    const baseName = path.basename(picked.filePaths[0]).replace(/\.user\.js$|\.js$/i, "");
    const draft: UserScriptDraft = {
      id: null,
      name: (header.name || baseName).slice(0, MAX_USERSCRIPT_NAME_LENGTH),
      enabled: true,
      matches: header.matches.join("\n"),
      excludes: header.excludes.join("\n"),
      runAt: header.runAt ?? "document-idle",
      code,
    };
    return { ok: true, message: copy.imported, draft };
  } catch {
    return { ok: false, message: copy.readFailed, draft: null };
  }
};

// Potwierdzenie wewnątrz strony (zamiast natywnego confirm()): <dialog> + window.mbConfirm(tekst) → Promise<boolean>.
const INTERNAL_CONFIRM_STYLES = `
  #mb-confirm { width:min(460px,calc(100vw - 30px)); border:3px solid var(--black); border-radius:0; padding:0; background:var(--white); color:var(--black); font:inherit; }
  #mb-confirm::backdrop { background:color-mix(in srgb, var(--black) 65%, transparent); }
  #mb-confirm form { margin:0; padding:18px; display:grid; gap:16px; }
  #mb-confirm p { margin:0; font-size:13px; line-height:1.45; overflow-wrap:anywhere; }
  #mb-confirm .mb-actions { display:flex; justify-content:flex-end; gap:8px; }
  #mb-confirm button { border:2px solid var(--black); border-radius:0; padding:8px 11px; font:inherit; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; background:var(--white); color:var(--black); }
  #mb-confirm button[value="ok"] { background:var(--black); color:var(--white); }
  #mb-confirm button:hover, #mb-confirm button:focus-visible { background:var(--accent); color:var(--mb-on-accent); outline:0; }
`;

const renderInternalConfirmMarkup = (): string => {
  const pl = appLanguage === "pl";
  return `<dialog id="mb-confirm"><form method="dialog"><p id="mb-confirm-text"></p><div class="mb-actions"><button value="cancel">${pl ? "Anuluj" : "Cancel"}</button><button value="ok">${pl ? "Potwierdź" : "Confirm"}</button></div></form></dialog>
<script>window.mbConfirm = (text) => new Promise((resolve) => {
  const dialog = document.getElementById('mb-confirm');
  document.getElementById('mb-confirm-text').textContent = text;
  dialog.returnValue = 'cancel';
  dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
  dialog.showModal();
});</script>`;
};

const INTERNAL_WINDOW_STYLES = `
  ${UI_BASE_START_CSS}
  :root { ${LEGACY_ALIAS_CSS} font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; }
  * { box-sizing: border-box; }
  body { min-height:100vh; margin:0; background:var(--white); color:var(--black); }
  body::after { content:""; position:fixed; inset:0; z-index:20; pointer-events:none; opacity:.03; background:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  header { position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 18px; border-bottom:3px solid var(--black); background:var(--black); color:var(--white); }
  h1 { margin:0; font-size:14px; letter-spacing:.12em; text-transform:uppercase; }
  button, input { font: inherit; }
  button { border:2px solid var(--black); background:var(--black); color:var(--white); border-radius:0; padding:8px 11px; font-size:11px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; }
  header button { border-color:var(--white); background:var(--white); color:var(--black); }
  button:hover:not(:disabled) { background:var(--accent); color:var(--mb-on-accent); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.danger, button.secondary { border-color:var(--black); background:var(--white); color:var(--black); }
  button.secondary:hover:not(:disabled) { background:var(--accent); color:var(--mb-on-accent); }
  header button.danger { border-color:var(--white); }
  main { padding: 14px 18px; }
  .empty, .muted { color:var(--grey); }
  .empty { padding: 30px 12px; text-align: center; }
  .status-message { margin:10px 0; padding:10px 12px; border:2px solid var(--black); border-radius:0; background:var(--white); font-size:12px; }
  ${INTERNAL_CONFIRM_STYLES}
`;

const renderDownloadsPageHtml = (): string => {
  const copy = appLanguage === "pl" ? {
    title: "MonoBrowser — Pobieranie", heading: "Pobieranie", clearHistory: "Wyczyść historię pobrań",
    statuses: { "in-progress": "Pobieranie", completed: "Ukończono", cancelled: "Anulowano", interrupted: "Przerwano", failed: "Błąd" },
    empty: "Brak pobrań.", unknownSource: "Nieznane źródło", cancel: "Anuluj", openFile: "Otwórz plik", showInFolder: "Pokaż w folderze",
    cancelFailed: "Nie udało się anulować pobierania.", openFailed: "Plik nie istnieje lub nie można go otworzyć.",
    showFailed: "Plik nie istnieje lub nie można go pokazać.", clearConfirm: "Wyczyścić historię pobrań? Pobrane pliki pozostaną na dysku.",
    clearFailed: "Nie udało się wyczyścić historii pobrań.", loadFailed: "Nie udało się wczytać historii pobrań.",
    connectionInterrupted: "Połączenie zostało chwilowo przerwane.", downloadInterrupted: "Pobieranie zostało przerwane przez błąd sieci lub zapisu.",
    cancelledMessage: "Pobieranie zostało anulowane.", failedMessage: "Pobieranie nie powiodło się.", locale: "pl-PL",
  } : {
    title: "MonoBrowser — Downloads", heading: "Downloads", clearHistory: "Clear download history",
    statuses: { "in-progress": "Downloading", completed: "Completed", cancelled: "Cancelled", interrupted: "Interrupted", failed: "Failed" },
    empty: "No downloads yet.", unknownSource: "Unknown source", cancel: "Cancel", openFile: "Open file", showInFolder: "Show in folder",
    cancelFailed: "The download could not be cancelled.", openFailed: "The file does not exist or could not be opened.",
    showFailed: "The file does not exist or could not be shown.", clearConfirm: "Clear download history? Downloaded files will remain on disk.",
    clearFailed: "Download history could not be cleared.", loadFailed: "Download history could not be loaded.",
    connectionInterrupted: "The connection was temporarily interrupted.", downloadInterrupted: "The download was interrupted by a network or disk error.",
    cancelledMessage: "The download was cancelled.", failedMessage: "The download failed.", locale: "en-US",
  };
  const copyJson = JSON.stringify(copy).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${copy.title}</title><style>${INTERNAL_WINDOW_STYLES}
  .downloads { display: grid; gap: 10px; }
  .download { background:var(--white); border:2px solid var(--black); border-radius:0; padding:13px; display:grid; gap:9px; }
  .download-top { display: flex; justify-content: space-between; align-items: start; gap: 12px; }
  .name { font-weight: 600; overflow-wrap: anywhere; }
  .status { font-size:11px; border:1px solid var(--black); border-radius:0; padding:4px 7px; background:var(--black); color:var(--white); text-transform:uppercase; white-space:nowrap; }
  .status.cancelled,.status.interrupted { opacity:.7; } .status.failed { background:var(--white); color:var(--mb-danger); border-color:var(--mb-danger); }
  .details { display:grid; gap:3px; color:var(--grey); font-size:11px; }
  .path { overflow-wrap: anywhere; }
  .progress-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
  progress { flex:1; height:10px; accent-color:var(--black); }
  .actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .error { color:var(--mb-danger); font-size:11px; }
${UI_BASE_END_CSS}
</style></head><body>
<header><h1>${copy.heading}</h1><button id="clear">${copy.clearHistory}</button></header>
<main><div id="message" hidden class="status-message"></div><div id="list" class="downloads"></div></main>
<script>
(() => {
  const copy = ${copyJson};
  const list = document.getElementById('list');
  const clearButton = document.getElementById('clear');
  const message = document.getElementById('message');
  const labels = copy.statuses;
  const bytes = value => {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B','KB','MB','GB','TB']; let size = value; let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit++; }
    return (unit === 0 ? Math.round(size) : size.toFixed(size >= 10 ? 1 : 2)) + ' ' + units[unit];
  };
  const showMessage = text => { message.textContent = text; message.hidden = false; };
  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const action = (label, handler, danger) => { const button = make('button', danger ? 'danger' : '', label); button.addEventListener('click', handler); return button; };
  const render = records => {
    list.replaceChildren(); clearButton.disabled = records.length === 0;
    if (!records.length) { list.append(make('div','empty',copy.empty)); return; }
    for (const record of records) {
      const card = make('article','download');
      const top = make('div','download-top'); top.append(make('div','name',record.fileName), make('span','status ' + record.status,labels[record.status] || record.status));
      const details = make('div','details');
      const source = !record.sourceOrigin || record.sourceOrigin === 'Nieznane źródło' ? copy.unknownSource : record.sourceOrigin;
      details.append(make('div','',source), make('div','path',record.savePath), make('div','',new Date(record.startedAt).toLocaleString(copy.locale) + ' · ' + bytes(record.totalBytes || record.receivedBytes)));
      card.append(top, details);
      if (record.status === 'in-progress') {
        const row = make('div','progress-row'); const progress = document.createElement('progress');
        if (record.totalBytes > 0) { progress.max = record.totalBytes; progress.value = record.receivedBytes; }
        const percent = record.totalBytes > 0 ? Math.min(100, Math.round(record.receivedBytes / record.totalBytes * 100)) + '% · ' : '';
        row.append(progress, make('span','',percent + bytes(record.receivedBytes))); card.append(row);
      }
      if (record.error) { const errors = { 'in-progress':copy.connectionInterrupted, interrupted:copy.downloadInterrupted, cancelled:copy.cancelledMessage, failed:copy.failedMessage }; card.append(make('div','error',errors[record.status] || copy.failedMessage)); }
      const actions = make('div','actions');
      if (record.status === 'in-progress') actions.append(action(copy.cancel, async () => { if (!await window.browserApi.cancelDownload(record.id)) showMessage(copy.cancelFailed); }, true));
      if (record.status === 'completed' && record.kind !== 'update') {
        actions.append(action(copy.openFile, async () => { if (!await window.browserApi.openDownloadedFile(record.id)) showMessage(copy.openFailed); }));
        actions.append(action(copy.showInFolder, async () => { if (!await window.browserApi.showDownloadInFolder(record.id)) showMessage(copy.showFailed); }));
      }
      if (actions.childElementCount) card.append(actions); list.append(card);
    }
  };
  clearButton.addEventListener('click', async () => {
    if (!await window.mbConfirm(copy.clearConfirm)) return;
    if (!await window.browserApi.clearDownloadsHistory()) showMessage(copy.clearFailed);
  });
  window.browserApi.onDownloadsUpdated(payload => render(payload.downloads));
  window.browserApi.getDownloads().then(render).catch(() => showMessage(copy.loadFailed));
})();
</script>${renderInternalConfirmMarkup()}</body></html>`;
};

const renderSiteDataPageHtml = (): string => {
  const copy = appLanguage === "pl" ? {
    title: "MonoBrowser — Dane witryn", heading: "Dane witryn", refresh: "Odśwież", filter: "Filtruj witryny…",
    allSites: "Wszystkie witryny", globalNote: "Globalne czyszczenie nie usuwa pobranych plików ani historii pobrań.",
    clearHistory: "Wyczyść historię", clearCookies: "Usuń wszystkie pliki cookie", clearCache: "Wyczyść całą pamięć podręczną",
    warning: "Uwaga: usunięcie plików cookie może objąć całą domenę rejestrowalną i jej subdomeny, zgodnie z regułami Chromium.",
    cancel: "Anuluj", clearData: "Wyczyść dane", noMatches: "Brak pasujących witryn.", noOrigins: "Brak znanych witryn.",
    origin: "Witryna", lastActivity: "Ostatnia aktywność", cookies: "Pliki cookie", cookieOnly: "Tylko plik cookie", loadFailed: "Nie udało się wczytać danych witryn.",
    cookieType: "Pliki cookie", localStorageType: "Pamięć lokalna", indexedDbType: "Baza IndexedDB", cacheType: "Pamięć podręczna", serviceWorkersType: "Skrypty service worker",
    clearTitle: "Wyczyść dane: ", confirmHistory: "Czy na pewno usunąć całą historię przeglądania?",
    confirmCookies: "Czy na pewno usunąć pliki cookie wszystkich witryn? Może to wylogować ze stron.",
    confirmCache: "Czy na pewno wyczyścić pamięć podręczną wszystkich witryn?", locale: "pl-PL",
  } : {
    title: "MonoBrowser — Site data", heading: "Site data", refresh: "Refresh", filter: "Filter origins…",
    allSites: "All sites", globalNote: "Global clearing does not remove downloaded files or download history.",
    clearHistory: "Clear history", clearCookies: "Clear all cookies", clearCache: "Clear all cache",
    warning: "Warning: clearing cookies may affect the entire registrable domain and its subdomains, according to Chromium rules.",
    cancel: "Cancel", clearData: "Clear data", noMatches: "No matching origins.", noOrigins: "No known origins.",
    origin: "Origin", lastActivity: "Last activity", cookies: "Cookies", cookieOnly: "Cookie only", loadFailed: "Site data could not be loaded.",
    cookieType: "Cookies", localStorageType: "Local Storage", indexedDbType: "IndexedDB", cacheType: "Cache", serviceWorkersType: "Service Workers",
    clearTitle: "Clear data: ", confirmHistory: "Are you sure you want to clear all browsing history?",
    confirmCookies: "Are you sure you want to clear cookies for all sites? This may sign you out.",
    confirmCache: "Are you sure you want to clear the cache for all sites?", locale: "en-US",
  };
  const copyJson = JSON.stringify(copy).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${copy.title}</title><style>${INTERNAL_WINDOW_STYLES}
  header { align-items: stretch; flex-direction: column; }
  .heading { display:flex; align-items:center; justify-content:space-between; }
  #filter { width:100%; border:2px solid var(--black); background:var(--white); color:var(--black); border-radius:0; padding:10px 11px; outline:none; }
  #filter:focus { box-shadow:4px 4px 0 var(--accent); }
  table { width:100%; border-collapse:collapse; background:var(--white); border:2px solid var(--black); }
  th,td { padding:11px 12px; border-bottom:1px solid var(--black); text-align:left; font-size:12px; }
  th { color:var(--grey); font-size:11px; letter-spacing:.08em; text-transform:uppercase; } td:first-child { overflow-wrap:anywhere; }
  th:last-child, td:last-child { width:1%; white-space:nowrap; text-align:right; }
  /* Per-row destructive action: secondary outline in the danger color (not a filled primary). */
  button.row-danger { background:transparent; border-color:var(--mb-danger); color:var(--mb-danger); }
  button.row-danger:hover:not(:disabled), button.row-danger:focus-visible { background:var(--mb-danger); border-color:var(--mb-danger); color:var(--mb-bg); }
  footer { margin-top:16px; padding:15px; background:var(--white); border:2px solid var(--black); border-radius:0; }
  footer h2 { margin:0 0 6px; font-size:12px; letter-spacing:.1em; text-transform:uppercase; } footer .muted { font-size:12px; } .global-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  dialog { width:min(520px,calc(100vw - 30px)); border:3px solid var(--black); border-radius:0; padding:0; background:var(--white); color:var(--black); }
  dialog::backdrop { background:color-mix(in srgb, var(--black) 65%, transparent); } .modal-body { padding:18px; } .modal-body h2 { margin:0 0 7px; font-size:16px; overflow-wrap:anywhere; }
  .warning { color:var(--mb-danger); font-size:12px; line-height:1.45; } .choices { display:grid; gap:9px; margin:16px 0; } label { display:flex; align-items:center; gap:9px; } input[type=checkbox] { accent-color:var(--black); }
  .modal-actions { display:flex; justify-content:flex-end; gap:8px; }
  @media(max-width:720px) { th:nth-child(2),td:nth-child(2) { display:none; } }
${UI_BASE_END_CSS}
</style></head><body>
<header><div class="heading"><h1>${copy.heading}</h1><button id="refresh">${copy.refresh}</button></div><input id="filter" type="text" placeholder="${copy.filter}" autocomplete="off"></header>
<main><div id="message" hidden class="status-message"></div><div id="content"></div>
<footer><h2>${copy.allSites}</h2><div class="muted">${copy.globalNote}</div><div class="global-actions"><button id="clear-history" class="secondary">${copy.clearHistory}</button><button id="clear-cookies" class="secondary">${copy.clearCookies}</button><button id="clear-cache" class="secondary">${copy.clearCache}</button></div></footer></main>
<dialog id="dialog"><form method="dialog" class="modal-body"><h2 id="modal-title"></h2><p class="warning">${copy.warning}</p><div class="choices">
  <label><input type="checkbox" value="cookies" checked> ${copy.cookieType}</label><label><input type="checkbox" value="localStorage" checked> ${copy.localStorageType}</label><label><input type="checkbox" value="indexedDB" checked> ${copy.indexedDbType}</label><label><input type="checkbox" value="cache" checked> ${copy.cacheType}</label><label><input type="checkbox" value="serviceWorkers" checked> ${copy.serviceWorkersType}</label>
</div><div class="modal-actions"><button value="cancel">${copy.cancel}</button><button id="confirm" value="default" class="danger">${copy.clearData}</button></div></form></dialog>
<script>
(() => {
  const copy = ${copyJson};
  let entries = []; let selectedOrigin = null;
  const content = document.getElementById('content'), filter = document.getElementById('filter'), dialog = document.getElementById('dialog'), confirmButton = document.getElementById('confirm'), message = document.getElementById('message');
  const showMessage = (text, ok) => { message.textContent = text; message.style.borderColor = ok ? 'var(--mb-fg)' : 'var(--mb-danger)'; message.hidden = false; };
  const render = () => {
    const query = filter.value.trim().toLowerCase(); const visible = entries.filter(entry => entry.origin.toLowerCase().includes(query)); content.replaceChildren();
    if (!visible.length) { const empty=document.createElement('div'); empty.className='empty'; empty.textContent=query?copy.noMatches:copy.noOrigins; content.append(empty); return; }
    const table=document.createElement('table'), head=document.createElement('thead'), body=document.createElement('tbody'); head.innerHTML='<tr><th>'+copy.origin+'</th><th>'+copy.lastActivity+'</th><th>'+copy.cookies+'</th><th></th></tr>';
    for (const entry of visible) { const row=document.createElement('tr'); const origin=document.createElement('td'); origin.textContent=entry.origin; const seen=document.createElement('td'); seen.textContent=entry.lastSeenAt?new Date(entry.lastSeenAt).toLocaleString(copy.locale):copy.cookieOnly; const count=document.createElement('td'); count.textContent=String(entry.cookieCount); const action=document.createElement('td'); const button=document.createElement('button'); button.className='row-danger'; button.textContent=copy.clearData; button.addEventListener('click',()=>openModal(entry.origin)); action.append(button); row.append(origin,seen,count,action); body.append(row); }
    table.append(head,body); content.append(table);
  };
  const load = async () => { try { entries=await window.browserApi.listSiteData(); render(); } catch { showMessage(copy.loadFailed,false); } };
  const openModal = origin => { selectedOrigin=origin; document.getElementById('modal-title').textContent=copy.clearTitle+origin; dialog.querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=true); updateConfirm(); dialog.showModal(); };
  const updateConfirm = () => { confirmButton.disabled=!dialog.querySelector('input[type=checkbox]:checked'); };
  dialog.querySelectorAll('input[type=checkbox]').forEach(input=>input.addEventListener('change',updateConfirm));
  dialog.addEventListener('close', async () => { if (dialog.returnValue!=='default'||!selectedOrigin) return; const types=[...dialog.querySelectorAll('input[type=checkbox]:checked')].map(input=>input.value); const result=await window.browserApi.clearSiteData(selectedOrigin,types); showMessage(result.message,result.ok); selectedOrigin=null; await load(); });
  filter.addEventListener('input',render); document.getElementById('refresh').addEventListener('click',load);
  document.getElementById('clear-history').addEventListener('click',async()=>{ if(!await window.mbConfirm(copy.confirmHistory))return; const result=await window.browserApi.clearGlobalHistory(); showMessage(result.message,result.ok); });
  document.getElementById('clear-cookies').addEventListener('click',async()=>{ if(!await window.mbConfirm(copy.confirmCookies))return; const result=await window.browserApi.clearGlobalSiteData(['cookies']); showMessage(result.message,result.ok); await load(); });
  document.getElementById('clear-cache').addEventListener('click',async()=>{ if(!await window.mbConfirm(copy.confirmCache))return; const result=await window.browserApi.clearGlobalSiteData(['cache']); showMessage(result.message,result.ok); await load(); });
  load();
})();
</script>${renderInternalConfirmMarkup()}</body></html>`;
};


const renderSettingsPageHtml = (): string => {
  const copy = appLanguage === "pl" ? {
    title: "MonoBrowser — Ustawienia", heading: "Ustawienia", searchHeading: "Domyślna wyszukiwarka",
    searchDescription: "Wybierz usługę używaną przez pasek adresu i stronę startową.",
    googleDescription: "Szybkie wyniki wyszukiwania Google.", duckDescription: "Wyszukiwanie z naciskiem na prywatność.",
    custom: "Własna", customDescription: "Użyj dowolnego adresu wyszukiwania HTTP(S).",
    customLabel: "Adres wyszukiwania", customHint: "Wstaw {query} w miejscu wyszukiwanego tekstu.",
    save: "Zapisz ustawienia", blockerHeading: "Blokowanie treści", blockerDescription: "Wbudowana ochrona przed reklamami i modułami śledzącymi (EasyList, EasyPrivacy, EasyList Polish, annoyances).",
    blockerEngine: "Ghostery adblocker — uBlock/EasyList", blockerOn: "Włączone", blockerOff: "Wyłączone", blockerLoading: "Ładowanie list…",
    blockerError: "Blokowanie niedostępne", exceptionsHeading: "Wyjątki blokowania", exceptionsDescription: "Na tych witrynach (i ich subdomenach) treści nie są blokowane.", exceptionsEmpty: "Brak wyjątków.", exceptionsAdd: "Dodaj", exceptionsRemove: "Usuń", exceptionsPlaceholder: "example.com", exceptionsInvalid: "Nieprawidłowa nazwa domeny.", blockedTotalLabel: "Zablokowane w tej sesji:", blockedValueSuffix: "żądań",
    active: "Aktywny", unavailable: "Niedostępny", loading: "Wczytywanie ustawień…", loadFailed: "Nie udało się wczytać ustawień.",
    searchTab: "Wyszukiwanie", browsingTab: "Przeglądanie", workspacesTab: "Przestrzenie", wsHeading: "Przestrzenie", wsDescription: "Przestrzenie to osobne zestawy kart (jak w Arc/Zen). Zmień nazwę, ikonę (litera, symbol lub emoji) i kolor, ustaw kolejność albo usuń przestrzeń. Przestrzeń Główna nie może być usunięta.", wsIcon: "Ikona", wsName: "Nazwa", wsColor: "Kolor", wsNoColor: "Bez koloru", wsUp: "Wyżej", wsDown: "Niżej", wsDelete: "Usuń", wsAdd: "Nowa przestrzeń", wsTabs: "Kart:", themeTab: "Motyw", themeHeading: "Motyw", themeDescription: "Jeden motyw dla całej przeglądarki: pasek kart, strona startowa, ustawienia, menu i okna. Zmiany działają od razu.", themeDefault: "Domyślny", themeDefaultHint: "auto: jasny lub ciemny jak system", themeCustom: "Własny", themeCustomHint: "edytor poniżej", themeCustomHeading: "Motyw własny", themeCustomDescription: "Pola są wypełnione kolorami wybranego motywu. Zmiana dowolnego koloru przełącza na motyw własny oparty na nim.", themeReset: "Przywróć domyślny", themeSaved: "Motyw zapisany.", themeLoadFailed: "Nie udało się wczytać motywu.", previewTab: "Karta", previewActive: "Aktywna", previewAddress: "Szukaj lub wpisz adres", previewHeading: "Podgląd", previewText: "Tekst pomocniczy i ramka.", previewAccent: "Akcent", previewDanger: "Błąd", tokenNames: { bg: "Tło", surface: "Powierzchnia (paski)", surface2: "Powierzchnia 2 (najechanie)", fg: "Tekst", muted: "Tekst pomocniczy", accent: "Akcent", onAccent: "Tekst na akcencie", border: "Ramka", danger: "Błąd / ostrzeżenie" }, experimentalTab: "Eksperymentalne", experimentalHeading: "Funkcje eksperymentalne", experimentalWarning: "Uwaga: to funkcje eksperymentalne. Mogą działać niestabilnie, różnić się między systemami i zostać zmienione lub usunięte.",
    ramHeading: "Ogranicznik RAM", ramDescription: "Gdy łączne zużycie pamięci przez przeglądarkę przekroczy limit, najdawniej używane karty w tle są usypiane (aktywna karta, karty wewnętrzne i Glance są pomijane; przypięte i odtwarzające dźwięk w ostatniej kolejności).",
    ramEnable: "Ogranicznik RAM", ramSystem: "Pamięć systemu", ramCurrent: "Obecnie", ramLimitLabel: "Limit pamięci", ramSoft: "Limit miękki: karty są usypiane co ok. 5 s, gdy zużycie przekracza limit; procesy bazowe przeglądarki nie są ograniczane.",
    ramHard: "Twardy limit (wymaga restartu)", ramHardHint: "Linux: przy następnym starcie aplikacja uruchomi się w zakresie systemd (MemoryMax, bez swapu); system może zabić proces po przekroczeniu limitu.", ramHardPending: "Zostanie zastosowany po restarcie aplikacji.", ramHardActive: "Aktywny w tej sesji", ramHardFailed: "Nie udało się uruchomić w zakresie systemd - aplikacja działa bez twardego limitu", ramSlept: "Uśpione kart przez ogranicznik",
    cpuHeading: "Ogranicznik CPU", cpuDescription: "Ogranicza przeglądarkę do wybranej liczby wątków procesora (powinowactwo procesora dla procesu głównego i wszystkich procesów potomnych).",
    cpuEnable: "Ogranicznik CPU", cpuThreadsDetected: "Wątki procesora", cpuThreadsLabel: "Dozwolone wątki", cpuLowPriority: "Niższy priorytet kart w tle",
    cpuStatusOff: "Wyłączony.", cpuStatusActive: "Aktywny — procesy ograniczone:", cpuStatusUnsupported: "Niedostępne na tym systemie.", cpuStatusNoTaskset: "Niedostępne: brak polecenia taskset (util-linux).", cpuStatusNoPowershell: "Niedostępne: brak PowerShell.", cpuStatusError: "Nie udało się ustawić powinowactwa procesora.",
    prioActive: "Priorytet kart w tle: obniżony dla procesów:", prioUnsupported: "Priorytet kart w tle niedostępny na tym systemie.", prioNeedsRlimit: "Priorytet kart w tle niedostępny: system nie pozwala przywrócić normalnego priorytetu (RLIMIT_NICE).", prioError: "Nie udało się zmienić priorytetu kart.", userscriptsTab: "Skrypty użytkownika",
    userscriptsHeading: "Skrypty użytkownika", userscriptsDescription: "Własne skrypty JavaScript uruchamiane na stronach zgodnych ze wzorcami adresów.",
    addScript: "+ Dodaj skrypt", importScript: "Importuj z pliku…", noScripts: "Brak skryptów użytkownika.",
    edit: "Edytuj", remove: "Usuń", enable: "Włącz", disable: "Wyłącz", off: "Wyłączony",
    allSites: "Wszystkie strony http(s)/file", scriptCountSuffix: "skrypty",
    editorTitleNew: "Nowy skrypt", editorTitleEdit: "Edytuj skrypt",
    nameLabel: "Nazwa", matchesLabel: "Wzorce adresów (jeden na linię)",
    matchesHint: "Np. *://example.com/* — pusta lista oznacza wszystkie strony http(s)/file.",
    excludesLabel: "Wyjątki (jeden na linię)", runAtLabel: "Moment uruchomienia",
    codeLabel: "Kod skryptu", enabledLabel: "Skrypt włączony",
    saveScript: "Zapisz skrypt", cancel: "Anuluj",
    scriptSaved: "Skrypt zapisany.", scriptRemoved: "Skrypt usunięty.",
    removeConfirm: "Usunąć ten skrypt?", loadedCountPrefix: "Wczytane skrypty:",
    layoutHeading: "Układ paska kart", layoutDescription: "Wybierz, czy karty mają być w jednym poziomym pasku u góry, czy w panelu bocznym. Zmiana działa od razu.",
    layoutHorizontal: "Poziomy", layoutHorizontalDescription: "Kompaktowy pasek z nawigacją, adresem i kartami w jednym rzędzie.",
    layoutVertical: "Pionowy", layoutVerticalDescription: "Panel boczny z adresem, przypiętymi kartami i listą kart.",
    compactEnable: "Tryb kompaktowy", compactHint: "Ukrywa pasek (lub panel boczny), a strona wypełnia okno. Najedź kursorem na górną (lub lewą) krawędź, aby go pokazać. Skrót: Ctrl+Shift+C.",
    glanceHeading: "Glance", glanceDescription: "Szybki podgląd linków bez otwierania ich w nowej karcie", glanceEnable: "Włącz Glance",
    glanceTriggerLabel: "Sposób wywołania", glanceAlt: "Alt + klik", glanceCtrl: "Ctrl + klik", glanceShift: "Shift + klik", glanceLongPress: "Długie przytrzymanie",
    animHeading: "Animacje", animDescription: "Płynne przejścia menu, kart i paneli. Wyłączane też automatycznie, gdy system prosi o ograniczenie ruchu.", animOn: "Włączone", animOff: "Wyłączone", animOnHint: "Płynne przejścia menu i kart.", animOffHint: "Zmiany natychmiast, bez ruchu.",
    startupHeading: "Przy starcie", startupDescription: "Wybierz, co ma się otworzyć po uruchomieniu przeglądarki. Zmiana działa od razu.",
    startupRestore: "Przywróć poprzednią sesję", startupRestoreDescription: "Otwiera karty z ostatniego uruchomienia; karty prywatne nigdy nie są zapisywane.",
    startupNewTab: "Otwórz nową kartę", startupNewTabDescription: "Zaczyna od pustej karty startowej.",
  } : {
    title: "MonoBrowser — Settings", heading: "Settings", searchHeading: "Default search engine",
    searchDescription: "Choose the service used by the address bar and start page.",
    googleDescription: "Fast results powered by Google Search.", duckDescription: "Search with a focus on privacy.",
    custom: "Custom", customDescription: "Use any HTTP(S) search URL.",
    customLabel: "Search URL", customHint: "Place {query} where the search text should appear.",
    save: "Save settings", blockerHeading: "Content blocking", blockerDescription: "Built-in protection against ads and trackers (EasyList, EasyPrivacy, EasyList Polish, annoyances).",
    blockerEngine: "Ghostery adblocker — uBlock/EasyList", blockerOn: "On", blockerOff: "Off", blockerLoading: "Loading lists…",
    blockerError: "Blocking unavailable", exceptionsHeading: "Blocking exceptions", exceptionsDescription: "Content is not blocked on these sites (or their subdomains).", exceptionsEmpty: "No exceptions.", exceptionsAdd: "Add", exceptionsRemove: "Remove", exceptionsPlaceholder: "example.com", exceptionsInvalid: "Invalid domain name.", blockedTotalLabel: "Blocked this session:", blockedValueSuffix: "requests",
    active: "Active", unavailable: "Unavailable", loading: "Loading settings…", loadFailed: "Settings could not be loaded.",
    searchTab: "Search", browsingTab: "Browsing", workspacesTab: "Spaces", wsHeading: "Spaces", wsDescription: "Spaces are separate sets of tabs (like Arc/Zen). Rename a space, pick its icon (letter, symbol or emoji) and color, reorder or delete it. The Main space cannot be deleted.", wsIcon: "Icon", wsName: "Name", wsColor: "Color", wsNoColor: "No color", wsUp: "Up", wsDown: "Down", wsDelete: "Delete", wsAdd: "New space", wsTabs: "Tabs:", themeTab: "Theme", themeHeading: "Theme", themeDescription: "One theme for the whole browser: tab bar, start page, settings, menus and overlays. Changes apply instantly.", themeDefault: "Default", themeDefaultHint: "auto: light or dark like the system", themeCustom: "Custom", themeCustomHint: "editor below", themeCustomHeading: "Custom theme", themeCustomDescription: "The fields are prefilled from the selected theme. Changing any color switches to a custom theme based on it.", themeReset: "Reset to default", themeSaved: "Theme saved.", themeLoadFailed: "The theme could not be loaded.", previewTab: "Tab", previewActive: "Active", previewAddress: "Search or enter address", previewHeading: "Preview", previewText: "Muted text and border.", previewAccent: "Accent", previewDanger: "Error", tokenNames: { bg: "Background", surface: "Surface (bars)", surface2: "Surface 2 (hover)", fg: "Text", muted: "Muted text", accent: "Accent", onAccent: "Text on accent", border: "Border", danger: "Error / warning" }, experimentalTab: "Experimental", experimentalHeading: "Experimental features", experimentalWarning: "Warning: these features are experimental. They may be unstable, behave differently across systems, and may change or be removed.",
    ramHeading: "RAM limiter", ramDescription: "When the browser's total memory use exceeds the limit, the least recently used background tabs are put to sleep (the active tab, internal pages and Glance are skipped; pinned tabs and tabs playing audio go last).",
    ramEnable: "RAM limiter", ramSystem: "System memory", ramCurrent: "Currently", ramLimitLabel: "Memory limit", ramSoft: "Soft limit: tabs are put to sleep every ~5 s while usage is above the limit; the browser's base processes are not restricted.",
    ramHard: "Hard limit (requires restart)", ramHardHint: "Linux: on the next start the app launches inside a systemd scope (MemoryMax, no swap); the system may kill a process that exceeds the limit.", ramHardPending: "Will be applied after the app restarts.", ramHardActive: "Active in this session", ramHardFailed: "Could not start inside a systemd scope - running without the hard limit", ramSlept: "Tabs put to sleep by the limiter",
    cpuHeading: "CPU limiter", cpuDescription: "Restricts the browser to the chosen number of CPU threads (CPU affinity for the main process and all child processes).",
    cpuEnable: "CPU limiter", cpuThreadsDetected: "CPU threads", cpuThreadsLabel: "Allowed threads", cpuLowPriority: "Lower priority of background tabs",
    cpuStatusOff: "Off.", cpuStatusActive: "Active — processes limited:", cpuStatusUnsupported: "Not available on this system.", cpuStatusNoTaskset: "Unavailable: the taskset command (util-linux) was not found.", cpuStatusNoPowershell: "Unavailable: PowerShell was not found.", cpuStatusError: "Could not set CPU affinity.",
    prioActive: "Background tab priority: lowered for processes:", prioUnsupported: "Background tab priority is not available on this system.", prioNeedsRlimit: "Background tab priority unavailable: the system does not allow restoring normal priority (RLIMIT_NICE).", prioError: "Could not change tab priority.", userscriptsTab: "User scripts",
    userscriptsHeading: "User scripts", userscriptsDescription: "Custom JavaScript snippets injected into pages that match URL patterns.",
    addScript: "+ Add script", importScript: "Import from file…", noScripts: "No user scripts yet.",
    edit: "Edit", remove: "Remove", enable: "Enable", disable: "Disable", off: "Off",
    allSites: "All http(s)/file pages", scriptCountSuffix: "scripts",
    editorTitleNew: "New script", editorTitleEdit: "Edit script",
    nameLabel: "Name", matchesLabel: "URL patterns (one per line)",
    matchesHint: "e.g. *://example.com/* — an empty list means all http(s)/file pages.",
    excludesLabel: "Excludes (one per line)", runAtLabel: "Run at",
    codeLabel: "Script code", enabledLabel: "Script enabled",
    saveScript: "Save script", cancel: "Cancel",
    scriptSaved: "Script saved.", scriptRemoved: "Script removed.",
    removeConfirm: "Remove this script?", loadedCountPrefix: "Loaded scripts:",
    layoutHeading: "Tab bar layout", layoutDescription: "Choose whether tabs live in a single horizontal bar at the top or in a side panel. The change applies immediately.",
    layoutHorizontal: "Horizontal", layoutHorizontalDescription: "Compact bar with navigation, address and tabs in one row.",
    layoutVertical: "Vertical", layoutVerticalDescription: "Side panel with the address bar, pinned tabs and a tab list.",
    compactEnable: "Compact mode", compactHint: "Hides the toolbar (or sidebar) so the page fills the window. Move the pointer to the top (or left) edge to reveal it. Shortcut: Ctrl+Shift+C.",
    glanceHeading: "Glance", glanceDescription: "Get a quick overview of your links without opening them in a new tab", glanceEnable: "Enable Glance",
    glanceTriggerLabel: "Trigger method", glanceAlt: "Alt + click", glanceCtrl: "Ctrl + click", glanceShift: "Shift + click", glanceLongPress: "Long press",
    animHeading: "Animations", animDescription: "Smooth transitions for menus, tabs and panels. Also turned off automatically when the system asks for reduced motion.", animOn: "On", animOff: "Off", animOnHint: "Smooth menu and tab transitions.", animOffHint: "Instant changes, no motion.",
    startupHeading: "On startup", startupDescription: "Choose what opens when the browser starts. Changes apply immediately.",
    startupRestore: "Restore the previous session", startupRestoreDescription: "Reopens the tabs from the last run; private tabs are never saved.",
    startupNewTab: "Open a new tab", startupNewTabDescription: "Starts with an empty start page.",
  };
  const copyJson = JSON.stringify(copy).replace(/</g, "\\u003c");
  const scriptStub = [
    "// ==UserScript==",
    "// @match *://*/*",
    "// ==/UserScript==",
    "",
    "",
  ].join("\n");
  const scriptStubLiteral = JSON.stringify(scriptStub);
  return `<!doctype html>
<html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${copy.title}</title><style>${INTERNAL_WINDOW_STYLES}
  :root { ${LEGACY_ALIAS_CSS} font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; }
  body { min-height:100vh; background:var(--white); color:var(--black); }
  body::after { content:""; position:fixed; inset:0; pointer-events:none; opacity:.03; background:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  header { padding:15px 18px; border-bottom:2px solid var(--black); }
  /* Same page header as About / History / Downloads: 13px bold, tracked capitals. */
  header h1 { font-size:13px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  .tabs { width:min(760px,100%); margin:0 auto; padding:16px 24px 0; display:flex; flex-wrap:wrap; row-gap:8px; }
  .tab { border:2px solid var(--black); border-radius:0; background:var(--white); color:var(--black); padding:10px 18px; font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; margin-right:-2px; }
  .tab.active { background:var(--black); color:var(--white); }
  .tab:hover:not(.active) { background:var(--accent); color:var(--mb-on-accent); }
  main { width:min(760px,100%); margin:0 auto; padding:24px; display:grid; gap:16px; }
  .panel[hidden] { display:none; }
  .card { border:3px solid var(--black); border-radius:0; background:var(--white); padding:20px; box-shadow:none; }
  h2 { margin:0 0 5px; font-family:Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif; font-size:22px; letter-spacing:.05em; text-transform:uppercase; } .description { margin:0 0 16px; color:var(--grey); font-size:12px; line-height:1.6; }
  .engines { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; }
  .engine { position:relative; display:block; min-width:0; }
  .engine input { position:absolute; opacity:0; pointer-events:none; }
  .engine-body { height:100%; min-height:94px; padding:13px; border:2px solid var(--line); border-radius:0; background:var(--surface); cursor:pointer; display:block; transition:background var(--mb-dur,120ms),border-color var(--mb-dur,120ms),box-shadow var(--mb-dur,120ms); }
  .engine-body:hover { background:var(--surface-2); }
  .engine input:checked + .engine-body { border-color:var(--black); background:var(--surface-2); }
  .engine input:focus-visible + .engine-body, .runat input:focus-visible + .runat-body { outline:2px solid var(--accent); outline-offset:2px; }
  .engine-name { display:flex; align-items:center; gap:8px; margin-bottom:7px; font-size:13px; font-weight:650; }
  .engine-mark { width:9px; height:9px; border:1px solid currentColor; border-radius:0; background:transparent; }
  input:checked + .engine-body .engine-mark { background:var(--black); }
  .engine-copy { display:block; color:var(--grey); font-size:11px; line-height:1.5; } 
  .custom-field { margin-top:14px; display:grid; gap:7px; }
  .custom-field label { color:var(--black); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  #custom-url { width:100%; padding:11px; border:2px solid var(--black); border-radius:0; outline:0; background:var(--white); color:var(--black); font:inherit; font-size:12px; }
  #custom-url:focus { box-shadow:4px 4px 0 var(--accent); } #custom-url:disabled { opacity:.42; }
  .hint { color:var(--grey); font-size:11px; } code { color:var(--black); font-weight:700; }
  .actions { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:17px; }
  #message, #scripts-message { min-height:18px; color:var(--black); font-size:11px; } #message.error, #scripts-message.error { color:var(--mb-danger); }
  #save { border:2px solid var(--black); border-radius:0; background:var(--black); color:var(--white); font-weight:700; text-transform:uppercase; letter-spacing:.12em; }
  #save:hover { background:var(--accent); color:var(--mb-on-accent); }
  .blocker-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .blocker-copy { display:grid; gap:4px; } .blocker-name { font-size:11px; font-weight:700; }
  .badge { display:inline-flex; align-items:center; gap:7px; padding:7px 10px; border:2px solid var(--black); border-radius:0; color:var(--white); background:var(--black); font-size:11px; text-transform:uppercase; letter-spacing:.1em; white-space:nowrap; }
  .badge::before { content:""; width:7px; height:7px; background:var(--accent); }
  .badge.off::before { background:transparent; box-shadow:inset 0 0 0 1px var(--white); }
  .scripts-toolbar { display:flex; align-items:center; gap:9px; flex-wrap:wrap; margin-bottom:15px; }
  button.secondary { border:2px solid var(--black); background:var(--white); color:var(--black); }
  button.secondary:hover { background:var(--accent); color:var(--mb-on-accent); }
  .scripts-toolbar #scripts-message { margin-left:auto; }
  .script-row { padding:12px 0; border-bottom:2px solid var(--black); display:grid; gap:7px; }
  .script-row:last-child { border-bottom:none; padding-bottom:2px; }
  .script-top { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .script-name { font-size:13px; font-weight:700; overflow-wrap:anywhere; }
  .script-patterns { color:var(--grey); font-size:11px; overflow-wrap:anywhere; }
  .script-actions { display:flex; gap:7px; flex-wrap:wrap; }
  .field { display:grid; gap:6px; margin-bottom:13px; }
  .limit-row { display:grid; grid-template-columns:minmax(0,1fr) 110px 72px; gap:10px; align-items:center; }
  .limit-row input[type=range] { width:100%; min-width:0; margin:0; accent-color:var(--black); }
  .limit-row input[type=number], .limit-row select { width:100%; min-width:0; height:38px; padding:0 9px; border:2px solid var(--black); border-radius:0; outline:0; background:var(--white); color:var(--black); font:inherit; font-size:12px; }
  .limit-row input[type=number]:focus, .limit-row select:focus { box-shadow:4px 4px 0 var(--accent); }
  .field .hint, #cpu-status, #cpu-info, #ram-info { line-height:1.6; }
  .field > label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  .field input[type=text], .field textarea { width:100%; padding:10px; border:2px solid var(--black); border-radius:0; outline:0; background:var(--white); color:var(--black); font:inherit; font-size:12px; }
  .field textarea { resize:vertical; }
  .field input:focus, .field textarea:focus { box-shadow:4px 4px 0 var(--accent); }
  #script-code { min-height:220px; }
  .runat-row { display:flex; gap:9px; flex-wrap:wrap; }
  .runat { position:relative; display:block; }
  .runat input { position:absolute; opacity:0; pointer-events:none; }
  .runat-body { display:block; padding:8px 12px; border:2px solid var(--line); background:var(--surface); border-radius:0; cursor:pointer; font-size:11px; font-weight:700; }
  .runat input:checked + .runat-body { border-color:var(--black); box-shadow:4px 4px 0 var(--accent); }
  .checkbox-row { display:flex; align-items:center; gap:9px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; cursor:pointer; }
  .checkbox-row input { width:15px; height:15px; accent-color:var(--black); }
  .checkbox-row:has(input:disabled) { color:var(--grey); opacity:.55; cursor:not-allowed; } .checkbox-row input:disabled { cursor:not-allowed; }
  #glance-trigger { width:100%; max-width:320px; padding:10px; border:2px solid var(--black); border-radius:0; outline:0; background:var(--white); color:var(--black); font:inherit; font-size:12px; }
  #glance-trigger:focus { box-shadow:4px 4px 0 var(--accent); } #glance-trigger:disabled { opacity:.42; }
  .editor-actions { display:flex; justify-content:flex-end; gap:9px; margin-top:16px; }
  .editor-actions button.primary { border:2px solid var(--black); background:var(--black); color:var(--white); font-weight:700; text-transform:uppercase; letter-spacing:.1em; }
  .editor-actions button.primary:hover { background:var(--accent); color:var(--mb-on-accent); }
  .color-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(230px,1fr)); gap:9px; margin-bottom:4px; }
  .color-item { display:flex; align-items:center; gap:9px; padding:8px; border:2px solid var(--black); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
  .color-item input[type=color] { width:34px; height:26px; padding:0; border:2px solid var(--black); border-radius:0; background:transparent; cursor:pointer; flex:none; }
  .color-item input[type=color]::-webkit-color-swatch-wrapper { padding:0; } .color-item input[type=color]::-webkit-color-swatch { border:0; }
  .color-item .color-state { margin-left:auto; color:var(--grey); font-weight:400; text-transform:none; letter-spacing:0; }
  .theme-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(168px,1fr)); gap:10px; align-items:stretch; }
  .theme-btn { position:relative; min-width:0; height:100%; display:flex; flex-direction:column; align-items:stretch; gap:6px; padding:8px; border:2px solid var(--line); border-radius:0; background:var(--surface); color:var(--black); font:inherit; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; text-align:left; cursor:pointer; transition:background var(--mb-dur,120ms),border-color var(--mb-dur,120ms),box-shadow var(--mb-dur,120ms); }
  .theme-btn .theme-name { padding-right:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .theme-btn:hover:not(:disabled) { background:var(--surface-2); color:var(--black); }
  .theme-btn:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .theme-btn.selected { border-color:var(--black); background:var(--surface-2); }
  .theme-btn.selected::after { content:"\\2713"; position:absolute; top:6px; right:8px; font-size:13px; line-height:1; }
  .theme-btn { min-height:76px; }
  #animations-card .engine-body { min-height:76px; }
  .theme-btn .theme-hint { color:var(--grey); font-weight:400; text-transform:none; letter-spacing:0; display:-webkit-box; -webkit-box-orient:vertical; -webkit-line-clamp:2; overflow:hidden; white-space:normal; line-height:1.35; }
  .theme-swatches { display:flex; flex:none; height:18px; margin-top:auto; border:1px solid var(--line); } .theme-swatches span { flex:1 1 0; min-width:0; }
  .theme-preview { margin:0 0 14px; border:2px solid var(--mb-border); background:var(--mb-bg); color:var(--mb-fg); font-size:11px; }
  .theme-preview .pv-bar { display:flex; align-items:center; gap:6px; padding:7px; background:var(--mb-surface); border-bottom:1px solid var(--mb-border); }
  .theme-preview .pv-tab { padding:4px 9px; color:var(--mb-fg); border:1px solid var(--mb-border); } .theme-preview .pv-tab.act { background:var(--mb-surface-2); color:var(--mb-fg); border-color:var(--mb-fg); }
  .theme-preview .pv-addr { flex:1; padding:4px 9px; background:var(--mb-bg); color:var(--mb-fg); border:1px solid var(--mb-border); }
  .theme-preview .pv-page { display:grid; gap:7px; padding:12px; } .theme-preview .pv-muted { color:var(--mb-muted); }
  .theme-preview .pv-row { display:flex; gap:8px; align-items:center; } .theme-preview .pv-btn { padding:4px 9px; background:var(--mb-accent); color:var(--mb-on-accent); } .theme-preview .pv-danger { color:var(--mb-danger); font-weight:700; }
  #ram-hard-hint { display:block; margin-top:6px; }
  @media(max-width:640px) { .engines { grid-template-columns:1fr; } .engine-body { min-height:0; } .blocker-row { align-items:flex-start; flex-direction:column; } }
${UI_BASE_END_CSS}
</style></head><body>
<header><h1>${copy.heading}</h1></header>
<nav class="tabs" aria-label="${copy.heading}">
  <button type="button" class="tab active" data-tab="search">${copy.searchTab}</button>
  <button type="button" class="tab" data-tab="browsing">${copy.browsingTab}</button>
  <button type="button" class="tab" data-tab="workspaces">${copy.workspacesTab}</button>
  <button type="button" class="tab" data-tab="theme">${copy.themeTab}</button>
  <button type="button" class="tab" data-tab="experimental">${copy.experimentalTab}</button>
</nav>
<main>
  <section id="panel-search" class="panel">
    ${getPortableInfo() ? renderPortableSettingsCard(appLanguage === "pl" ? "pl" : "en", getUpdateMode() === "electron-updater") : ""}
    <form id="settings-form" class="card">
      <h2>${copy.searchHeading}</h2><p class="description">${copy.searchDescription}</p>
      <div class="engines">
        <label class="engine"><input type="radio" name="engine" value="google"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>Google</span><span class="engine-copy">${copy.googleDescription}</span></span></label>
        <label class="engine"><input type="radio" name="engine" value="duckduckgo"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>DuckDuckGo</span><span class="engine-copy">${copy.duckDescription}</span></span></label>
        <label class="engine"><input type="radio" name="engine" value="custom"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>${copy.custom}</span><span class="engine-copy">${copy.customDescription}</span></span></label>
      </div>
      <div class="custom-field"><label for="custom-url">${copy.customLabel}</label><input id="custom-url" type="url" maxlength="2048" spellcheck="false"><span class="hint">${copy.customHint.replace("{query}", "<code>{query}</code>")}</span></div>
      <div class="actions"><span id="message">${copy.loading}</span><button id="save" type="submit">${copy.save}</button></div>
    </form>
    <section class="card blocker-row"><div class="blocker-copy"><h2>${copy.blockerHeading}</h2><p class="description">${copy.blockerDescription}</p><span id="blocker-name" class="blocker-name">${copy.blockerEngine}</span><span id="blocker-total" class="description" style="margin:0"></span></div><button type="button" id="blocker-toggle" class="badge" style="cursor:pointer">${copy.blockerOn}</button></section>
    <section class="card" id="exceptions-card"><h2>${copy.exceptionsHeading}</h2><p class="description">${copy.exceptionsDescription}</p>
      <div id="exceptions-list"></div>
      <form id="exceptions-form" class="custom-field" style="display:flex;gap:8px;align-items:center"><input id="exceptions-input" type="text" maxlength="253" spellcheck="false" autocomplete="off" placeholder="${copy.exceptionsPlaceholder}" style="flex:1"><button type="submit" class="secondary">${copy.exceptionsAdd}</button></form>
      <span id="exceptions-message" class="hint" role="status"></span></section>
  </section>
  <section id="panel-browsing" class="panel" hidden>
    <section class="card" id="layout-card">
      <h2>${copy.layoutHeading}</h2><p class="description">${copy.layoutDescription}</p>
      <div class="engines" style="grid-template-columns:repeat(2,1fr)">
        <label class="engine"><input type="radio" name="tab-bar-layout" value="horizontal"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>${copy.layoutHorizontal}</span><span class="engine-copy">${copy.layoutHorizontalDescription}</span></span></label>
        <label class="engine"><input type="radio" name="tab-bar-layout" value="vertical"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>${copy.layoutVertical}</span><span class="engine-copy">${copy.layoutVerticalDescription}</span></span></label>
      </div>
      <div class="field" style="margin-top:12px"><label class="checkbox-row" for="compact-mode"><input id="compact-mode" type="checkbox">${copy.compactEnable}</label><span class="hint">${copy.compactHint}</span></div>
    </section>
    <section class="card" id="glance-card">
      <h2>${copy.glanceHeading}</h2><p class="description">${copy.glanceDescription}</p>
      <div class="field"><label class="checkbox-row" for="glance-enabled"><input id="glance-enabled" type="checkbox" checked>${copy.glanceEnable}</label></div>
      <div class="field"><label for="glance-trigger">${copy.glanceTriggerLabel}</label>
        <select id="glance-trigger"><option value="alt">${copy.glanceAlt}</option><option value="ctrl">${copy.glanceCtrl}</option><option value="shift">${copy.glanceShift}</option><option value="longpress">${copy.glanceLongPress}</option></select></div>
    </section>
    <section class="card" id="startup-card">
      <h2>${copy.startupHeading}</h2><p class="description">${copy.startupDescription}</p>
      <div class="engines" style="grid-template-columns:repeat(2,1fr)">
        <label class="engine"><input type="radio" name="startup-mode" value="restore"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>${copy.startupRestore}</span><span class="engine-copy">${copy.startupRestoreDescription}</span></span></label>
        <label class="engine"><input type="radio" name="startup-mode" value="newtab"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>${copy.startupNewTab}</span><span class="engine-copy">${copy.startupNewTabDescription}</span></span></label>
      </div>
    </section>
  </section>
  <section id="panel-experimental" class="panel" hidden>
    <section class="card exp-warning"><h2>${copy.experimentalHeading}</h2><p class="description" style="margin:0">${copy.experimentalWarning}</p></section>
    <section class="card" id="ram-card">
      <h2>${copy.ramHeading}</h2><p class="description">${copy.ramDescription}</p>
      <div class="field"><label class="checkbox-row" for="ram-enabled"><input id="ram-enabled" type="checkbox">${copy.ramEnable}</label></div>
      <p class="description" id="ram-info" style="margin:0 0 12px"></p>
      <div class="field"><label for="ram-range">${copy.ramLimitLabel}</label>
        <div class="limit-row"><input id="ram-range" type="range" min="512" max="16384" step="256" value="4096"><input id="ram-value" type="number" min="0" step="any" inputmode="decimal"><select id="ram-unit"><option value="MB">MB</option><option value="GB">GB</option></select></div></div>
      <p class="description" style="margin:0">${copy.ramSoft}</p>
      <div class="field" id="ram-hard-field" hidden style="margin-top:12px"><label class="checkbox-row" for="ram-hard"><input id="ram-hard" type="checkbox">${copy.ramHard}</label><span class="hint" id="ram-hard-hint">${copy.ramHardHint}</span></div>
    </section>
    <section class="card" id="cpu-card">
      <h2>${copy.cpuHeading}</h2><p class="description">${copy.cpuDescription}</p>
      <div class="field"><label class="checkbox-row" for="cpu-enabled"><input id="cpu-enabled" type="checkbox">${copy.cpuEnable}</label></div>
      <p class="description" id="cpu-info" style="margin:0 0 12px"></p>
      <div class="field"><label for="cpu-range">${copy.cpuThreadsLabel}</label>
        <div class="limit-row"><input id="cpu-range" type="range" min="1" max="8" step="1" value="4"><input id="cpu-value" type="number" min="1" step="1" inputmode="numeric"></div></div>
      <div class="field"><label class="checkbox-row" for="cpu-lowprio"><input id="cpu-lowprio" type="checkbox">${copy.cpuLowPriority}</label></div>
      <p class="description" id="cpu-status" style="margin:0"></p>
    </section>
    <div id="panel-userscripts" style="display:grid;gap:16px">
    <section id="scripts-list-card" class="card">
      <div class="blocker-row">
        <div><h2>${copy.userscriptsHeading} <span id="scripts-count" style="font-size:12px;color:var(--grey)"></span></h2>
        <p class="description">${copy.userscriptsDescription}</p></div>
      </div>
      <div class="scripts-toolbar">
        <button type="button" id="script-add" class="secondary">${copy.addScript}</button>
        <button type="button" id="script-import" class="secondary">${copy.importScript}</button>
        <span id="scripts-message"></span>
      </div>
      <div id="scripts-list"></div>
    </section>
    <section id="script-editor-card" class="card" hidden>
      <h2 id="script-editor-title">${copy.editorTitleNew}</h2><p class="description">${copy.matchesHint}</p>
      <div class="field"><label for="script-name">${copy.nameLabel}</label><input id="script-name" type="text" maxlength="200" spellcheck="false"></div>
      <div class="field"><label for="script-matches">${copy.matchesLabel}</label><textarea id="script-matches" rows="3" spellcheck="false"></textarea><span class="hint">${copy.matchesHint}</span></div>
      <div class="field"><label for="script-excludes">${copy.excludesLabel}</label><textarea id="script-excludes" rows="2" spellcheck="false"></textarea></div>
      <div class="field"><label>${copy.runAtLabel}</label><div class="runat-row">
        <label class="runat"><input type="radio" name="script-runat" value="document-start"><span class="runat-body">document-start</span></label>
        <label class="runat"><input type="radio" name="script-runat" value="document-idle" checked><span class="runat-body">document-idle</span></label>
      </div></div>
      <div class="field"><label class="checkbox-row" for="script-enabled"><input id="script-enabled" type="checkbox" checked>${copy.enabledLabel}</label></div>
      <div class="field"><label for="script-code">${copy.codeLabel}</label><textarea id="script-code" rows="12" spellcheck="false"></textarea></div>
      <div class="editor-actions">
        <button type="button" id="script-cancel" class="danger">${copy.cancel}</button>
        <button type="button" id="script-save" class="primary">${copy.saveScript}</button>
      </div>
    </section>
    </div>
  </section>
  <section id="panel-workspaces" class="panel" hidden>
    <section class="card"><h2>${copy.wsHeading}</h2><p class="description">${copy.wsDescription}</p>
      <div id="ws-rows"></div>
      <div class="actions" style="margin-top:14px"><button type="button" id="ws-create" class="secondary">+ ${copy.wsAdd}</button></div>
    </section>
  </section>
  <section id="panel-theme" class="panel" hidden>
    <section class="card"><h2>${copy.themeHeading}</h2><p class="description">${copy.themeDescription}</p><div id="theme-grid" class="theme-grid"></div><div class="actions"><span id="theme-message" class="hint" role="status"></span><button type="button" class="secondary" id="theme-reset">${copy.themeReset}</button></div></section>
    <section class="card" id="animations-card">
      <h2>${copy.animHeading}</h2><p class="description">${copy.animDescription}</p>
      <div class="engines" style="grid-template-columns:repeat(2,1fr)">
        <label class="engine"><input type="radio" name="animations" value="on"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>${copy.animOn}</span><span class="engine-copy">${copy.animOnHint}</span></span></label>
        <label class="engine"><input type="radio" name="animations" value="off"><span class="engine-body"><span class="engine-name"><i class="engine-mark"></i>${copy.animOff}</span><span class="engine-copy">${copy.animOffHint}</span></span></label>
      </div>
    </section>
    <section class="card"><h2>${copy.themeCustomHeading}</h2><p class="description">${copy.themeCustomDescription}</p>
      <div id="theme-preview" class="theme-preview" aria-hidden="true"><div class="pv-bar"><span class="pv-tab">${copy.previewTab}</span><span class="pv-tab act">${copy.previewActive}</span><span class="pv-addr">${copy.previewAddress}</span></div><div class="pv-page"><b>${copy.previewHeading}</b><span class="pv-muted">${copy.previewText}</span><span class="pv-row"><span class="pv-btn">${copy.previewAccent}</span><span class="pv-danger">${copy.previewDanger}</span></span></div></div>
      <div id="theme-editor" class="color-grid"></div></section>
  </section>
</main>
<script>
(() => {
  const copy = ${copyJson};
  // Experimental must always be the last tab, whatever other tabs get added.
  const experimentalTabButton = document.querySelector('.tab[data-tab=experimental]');
  if (experimentalTabButton && experimentalTabButton.parentElement) experimentalTabButton.parentElement.appendChild(experimentalTabButton);
  const tabs = Array.from(document.querySelectorAll('.tab'));
  const panels = {
    search: document.getElementById('panel-search'),
    browsing: document.getElementById('panel-browsing'),
    experimental: document.getElementById('panel-experimental'),
    theme: document.getElementById('panel-theme'),
    workspaces: document.getElementById('panel-workspaces'),
  };
  const activate = (name) => {
    tabs.forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    Object.keys(panels).forEach((key) => { panels[key].hidden = key !== name; });
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => activate(tab.dataset.tab)));

  // Workspaces: rename / icon / color / reorder / delete (deleting asks in a window popup).
  const wsRows = document.getElementById('ws-rows');
  const wsColorNames = ${JSON.stringify({ pl: { accent: "Akcent", fg: "Tekst", muted: "Przygaszony", danger: "Ostrzeżenie", "#c8553d": "Ceglasty", "#d9a441": "Bursztynowy", "#5b9a6a": "Zielony", "#3f88c5": "Niebieski", "#7b6cc4": "Fioletowy", "#c26a9b": "Różowy" }, en: { accent: "Accent", fg: "Text", muted: "Muted", danger: "Warning", "#c8553d": "Brick", "#d9a441": "Amber", "#5b9a6a": "Green", "#3f88c5": "Blue", "#7b6cc4": "Violet", "#c26a9b": "Pink" } })}[document.documentElement.lang === 'en' ? 'en' : 'pl'];
  const wsColorCss = { accent: 'var(--mb-accent)', fg: 'var(--mb-fg)', muted: 'var(--mb-muted)', danger: 'var(--mb-danger)' };
  const wsColorOptions = [['', copy.wsNoColor, '']].concat(${JSON.stringify([...WORKSPACE_COLOR_TOKENS, ...WORKSPACE_COLOR_PALETTE])}.map((value) => [value, '\u25A0 ' + (wsColorNames[value] || value), wsColorCss[value] || value]));
  const reloadWs = () => window.browserApi.getWorkspaces().then(renderWorkspaceRows).catch(() => {});
  const renderWorkspaceRows = (payload) => {
    if (!payload || !payload.workspaces) return;
    wsRows.replaceChildren();
    payload.workspaces.forEach((ws, index) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:56px minmax(0,1fr) 150px 230px;gap:8px;align-items:center;padding:8px 0;border-bottom:1px solid var(--black)';
      const icon = document.createElement('input');
      icon.type = 'text'; icon.maxLength = 8; icon.value = ws.icon; icon.title = copy.wsIcon; icon.setAttribute('aria-label', copy.wsIcon);
      icon.style.cssText = 'height:34px;text-align:center;border:2px solid var(--black);background:var(--white);color:var(--black);border-radius:0';
      icon.addEventListener('change', () => { window.browserApi.updateWorkspace(ws.id, { icon: icon.value }).then(reloadWs); });
      const name = document.createElement('input');
      name.type = 'text'; name.maxLength = 40; name.value = ws.name; name.title = copy.wsName; name.setAttribute('aria-label', copy.wsName);
      name.style.cssText = 'height:34px;padding:0 9px;border:2px solid var(--black);background:var(--white);color:var(--black);border-radius:0';
      name.addEventListener('change', () => { if (name.value.trim() && name.value !== ws.name) window.browserApi.updateWorkspace(ws.id, { name: name.value }).then(reloadWs); else name.value = ws.name; });
      const color = document.createElement('select');
      color.title = copy.wsColor; color.setAttribute('aria-label', copy.wsColor);
      color.style.cssText = 'padding-right:6px';
      wsColorOptions.forEach(([value, label, css]) => { const option = document.createElement('option'); option.value = value; option.textContent = label; if (css) option.style.color = css; if (value === (ws.color || '')) option.selected = true; color.append(option); });
      const tint = () => { const opt = color.selectedOptions[0]; color.style.color = opt && opt.style.color ? opt.style.color : ''; }; tint();
      color.addEventListener('change', () => { tint(); window.browserApi.updateWorkspace(ws.id, { color: color.value || null }).then(reloadWs); });
      const actions = document.createElement('div');
      actions.style.cssText = 'display:flex;gap:4px;align-items:center;justify-content:flex-end';
      const count = document.createElement('span'); count.className = 'hint'; count.textContent = copy.wsTabs + ' ' + ws.count; count.style.marginRight = '6px';
      const up = document.createElement('button'); up.type = 'button'; up.className = 'secondary'; up.textContent = '↑'; up.title = copy.wsUp; up.setAttribute('aria-label', copy.wsUp); up.disabled = index === 0;
      up.addEventListener('click', () => { window.browserApi.moveWorkspace(ws.id, -1).then(reloadWs); });
      const down = document.createElement('button'); down.type = 'button'; down.className = 'secondary'; down.textContent = '↓'; down.title = copy.wsDown; down.setAttribute('aria-label', copy.wsDown); down.disabled = index === payload.workspaces.length - 1;
      down.addEventListener('click', () => { window.browserApi.moveWorkspace(ws.id, 1).then(reloadWs); });
      actions.append(count, up, down);
      if (ws.id !== 'main') {
        const del = document.createElement('button'); del.type = 'button'; del.className = 'danger'; del.textContent = copy.wsDelete;
        del.addEventListener('click', () => { window.browserApi.deleteWorkspace(ws.id); });
        actions.append(del);
      }
      row.append(icon, name, color, actions);
      wsRows.append(row);
    });
  };
  document.getElementById('ws-create').addEventListener('click', () => { window.browserApi.createWorkspace().then(reloadWs); });
  // Changes made elsewhere (deleting in a popup, tab counts) arrive as "workspaces" pushes; never rebuild a row being edited.
  const wsEditing = () => document.activeElement && wsRows.contains(document.activeElement) && /^(INPUT|SELECT)$/.test(document.activeElement.tagName);
  reloadWs();

  const form = document.getElementById('settings-form');
  const customUrl = document.getElementById('custom-url');
  const message = document.getElementById('message');
  const blockerToggle = document.getElementById('blocker-toggle');
  const blockerTotal = document.getElementById('blocker-total');
  const selectedEngine = () => form.querySelector('input[name=engine]:checked')?.value || 'google';
  const syncCustomState = () => { customUrl.disabled = selectedEngine() !== 'custom'; };
  form.querySelectorAll('input[name=engine]').forEach(input => input.addEventListener('change', syncCustomState));
  form.addEventListener('submit', async event => {
    event.preventDefault(); message.className = ''; message.textContent = '';
    const result = await window.browserApi.setSearchSettings({ engine:selectedEngine(), customUrl:customUrl.value });
    message.textContent = result.message; message.className = result.ok ? '' : 'error';
  });
  blockerToggle.addEventListener('click', async () => {
    blockerToggle.disabled = true;
    try { renderBlocker(await window.browserApi.toggleAdblock()); }
    finally { blockerToggle.disabled = false; }
  });
  const renderBlocker = (blocker) => {
    blockerToggle.textContent = blocker.enabled ? copy.blockerOn : copy.blockerOff;
    blockerToggle.classList.toggle('off', !blocker.enabled);
    blockerToggle.title = blocker.enabled ? copy.blockerOff : copy.blockerOn;
    if (!blocker.enabled) { blockerTotal.textContent = ''; return; }
    if (blocker.error && !blocker.ready) { blockerTotal.textContent = copy.blockerError; return; }
    blockerTotal.textContent = blocker.ready
      ? copy.blockedTotalLabel + ' ' + blocker.blockedTotal + ' ' + copy.blockedValueSuffix
      : copy.blockerLoading;
  };
  Promise.all([window.browserApi.getSearchSettings(), window.browserApi.getAdblockStatus()]).then(([settings, blocker]) => {
    const option = form.querySelector('input[value="' + settings.engine + '"]'); if (option) option.checked = true;
    customUrl.value = settings.customUrl; syncCustomState(); message.textContent = '';
    renderBlocker(blocker);
  }).catch(() => { message.textContent = copy.loadFailed; message.className = 'error'; });

  const make = (tag, className, text) => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = text; return el; };
  const action = (label, handler, danger) => { const button = make('button', danger ? 'danger' : 'secondary', label); button.type = 'button'; button.addEventListener('click', handler); return button; };

  const exceptionsList = document.getElementById('exceptions-list');
  const exceptionsInput = document.getElementById('exceptions-input');
  const exceptionsMessage = document.getElementById('exceptions-message');
  const renderExceptions = (hosts) => {
    exceptionsList.replaceChildren();
    if (!hosts.length) { exceptionsList.append(make('p', 'description', copy.exceptionsEmpty)); return; }
    hosts.forEach((host) => {
      const row = make('div', 'exception-row');
      row.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--black)';
      row.append(make('span', '', host), action(copy.exceptionsRemove, async () => renderExceptions((await window.browserApi.removeAdblockException(host)).hosts)));
      exceptionsList.append(row);
    });
  };
  document.getElementById('exceptions-form').addEventListener('submit', async (event) => {
    event.preventDefault(); exceptionsMessage.textContent = '';
    const result = await window.browserApi.addAdblockException(exceptionsInput.value);
    if (!result.ok) { exceptionsMessage.textContent = copy.exceptionsInvalid; return; }
    exceptionsInput.value = ''; renderExceptions(result.hosts);
  });
  window.browserApi.listAdblockExceptions().then(renderExceptions).catch(() => undefined);
  window.browserApi.onSettingsDataChanged((topic, data) => {
    if (topic === 'adblock-exceptions' && Array.isArray(data)) renderExceptions(data);
    else if (topic === 'adblock-status' && data) renderBlocker(data);
    else if (topic === 'workspaces' && !wsEditing()) renderWorkspaceRows(data);
  });

  const layoutInputs = Array.from(document.querySelectorAll('input[name=tab-bar-layout]'));
  const showLayout = (value) => layoutInputs.forEach((input) => { input.checked = input.value === value; });
  layoutInputs.forEach((input) => input.addEventListener('change', async () => {
    if (input.checked) showLayout((await window.browserApi.setLayoutSettings({ tabBarLayout: input.value })).tabBarLayout);
  }));
  const compactInput = document.getElementById('compact-mode');
  const showCompact = (layout) => { compactInput.checked = layout.compactMode === true; };
  compactInput.addEventListener('change', async () => {
    showCompact(await window.browserApi.setLayoutSettings({ compactMode: compactInput.checked }));
  });
  window.browserApi.getLayoutSettings().then((layout) => { showLayout(layout.tabBarLayout); showCompact(layout); }).catch(() => undefined);
  window.browserApi.onLayoutChanged((layout) => { showLayout(layout.tabBarLayout); showCompact(layout); });

  const animInputs = Array.from(document.querySelectorAll('input[name=animations]'));
  const showAnim = (enabled) => animInputs.forEach((input) => { input.checked = (input.value === 'on') === enabled; });
  animInputs.forEach((input) => input.addEventListener('change', async () => {
    if (input.checked) showAnim((await window.browserApi.setAnimationSettings({ enabled: input.value === 'on' })).enabled);
  }));
  window.browserApi.getAnimationSettings().then((settings) => showAnim(settings.enabled)).catch(() => undefined);

  const startupInputs = Array.from(document.querySelectorAll('input[name=startup-mode]'));
  const showStartup = (value) => startupInputs.forEach((input) => { input.checked = input.value === value; });
  startupInputs.forEach((input) => input.addEventListener('change', async () => {
    if (input.checked) showStartup((await window.browserApi.setStartupSettings({ startupMode: input.value })).startupMode);
  }));
  window.browserApi.getStartupSettings().then((settings) => showStartup(settings.startupMode)).catch(() => undefined);

  const glanceEnabled = document.getElementById('glance-enabled');
  const glanceTrigger = document.getElementById('glance-trigger');
  const showGlance = (settings) => { glanceEnabled.checked = settings.enabled; glanceTrigger.value = settings.trigger; glanceTrigger.disabled = !settings.enabled; };
  glanceEnabled.addEventListener('change', async () => { showGlance(await window.browserApi.setGlanceSettings({ enabled: glanceEnabled.checked })); });
  glanceTrigger.addEventListener('change', async () => { showGlance(await window.browserApi.setGlanceSettings({ trigger: glanceTrigger.value })); });
  window.browserApi.getGlanceSettings().then(showGlance).catch(() => undefined);
  window.browserApi.onGlanceSettingsChanged(showGlance);

  const listCard = document.getElementById('scripts-list-card');
  const editorCard = document.getElementById('script-editor-card');
  const listEl = document.getElementById('scripts-list');
  const countEl = document.getElementById('scripts-count');
  const scriptsMessage = document.getElementById('scripts-message');
  const editorTitle = document.getElementById('script-editor-title');
  const nameInput = document.getElementById('script-name');
  const matchesInput = document.getElementById('script-matches');
  const excludesInput = document.getElementById('script-excludes');
  const enabledInput = document.getElementById('script-enabled');
  const codeInput = document.getElementById('script-code');
  let scripts = [];
  let editingDraft = null;

  const showScriptsMessage = (text, error) => { scriptsMessage.textContent = text; scriptsMessage.className = error ? 'error' : ''; };
  const patternSummary = (script) => {
    if (!script.matches.length) return copy.allSites;
    const head = script.matches.slice(0, 2).join(', ');
    return script.matches.length > 2 ? head + ' +' + (script.matches.length - 2) : head;
  };
  const toDraft = (script) => ({
    id: script.id,
    name: script.name,
    enabled: script.enabled,
    matches: script.matches.join('\\n'),
    excludes: script.excludes.join('\\n'),
    runAt: script.runAt,
    code: script.code,
  });
  const refresh = async () => {
    scripts = await window.browserApi.listUserScripts();
    countEl.textContent = '(' + scripts.length + ')';
    renderList();
  };
  const renderList = () => {
    listEl.replaceChildren();
    if (!scripts.length) { listEl.append(make('div', 'empty', copy.noScripts)); return; }
    for (const script of scripts) {
      const row = make('div', 'script-row');
      const top = make('div', 'script-top');
      const nameWrap = make('div');
      nameWrap.append(make('span', 'script-name', script.name));
      const badge = make('span', 'badge' + (script.enabled ? '' : ' off'), script.enabled ? copy.active : copy.off);
      top.append(nameWrap, badge);
      row.append(top, make('div', 'script-patterns', patternSummary(script)));
      const actions = make('div', 'script-actions');
      actions.append(action(copy.edit, () => openEditor(toDraft(script))));
      actions.append(action(script.enabled ? copy.disable : copy.enable, async () => {
        await window.browserApi.toggleUserScript(script.id, !script.enabled);
        await refresh();
      }));
      actions.append(action(copy.remove, async () => {
        if (!await window.mbConfirm(copy.removeConfirm)) return;
        if (await window.browserApi.removeUserScript(script.id)) { showScriptsMessage(copy.scriptRemoved); await refresh(); }
      }, true));
      row.append(actions);
      listEl.append(row);
    }
  };
  const openEditor = (draft) => {
    editingDraft = draft;
    editorTitle.textContent = draft.id ? copy.editorTitleEdit : copy.editorTitleNew;
    nameInput.value = draft.name;
    matchesInput.value = draft.matches;
    excludesInput.value = draft.excludes;
    enabledInput.checked = draft.enabled;
    codeInput.value = draft.code;
    const runAt = formlessRunAt(draft.runAt);
    editorCard.hidden = false;
    listCard.hidden = true;
    runAt.checked = true;
    activate('experimental');
  };
  const formlessRunAt = (value) => {
    const input = document.querySelector('input[name=script-runat][value="' + value + '"]');
    return input || document.querySelector('input[name=script-runat][value="document-idle"]');
  };
  const closeEditor = () => { editingDraft = null; editorCard.hidden = true; listCard.hidden = false; };
  const draftFromForm = () => ({
    id: editingDraft ? editingDraft.id : null,
    name: nameInput.value,
    enabled: enabledInput.checked,
    matches: matchesInput.value,
    excludes: excludesInput.value,
    runAt: (document.querySelector('input[name=script-runat]:checked') || {}).value || 'document-idle',
    code: codeInput.value,
  });
  document.getElementById('script-add').addEventListener('click', () => {
    openEditor({ id: null, name: '', enabled: true, matches: '', excludes: '', runAt: 'document-idle', code: ${scriptStubLiteral} });
  });
  document.getElementById('script-import').addEventListener('click', async () => {
    const result = await window.browserApi.importUserScriptFromFile();
    if (!result.ok) { showScriptsMessage(result.message, true); return; }
    if (result.draft) { openEditor(result.draft); showScriptsMessage(result.message); }
  });
  document.getElementById('script-cancel').addEventListener('click', closeEditor);
  document.getElementById('script-save').addEventListener('click', async () => {
    const result = await window.browserApi.saveUserScript(draftFromForm());
    if (result.ok) { closeEditor(); showScriptsMessage(result.message); await refresh(); }
    else showScriptsMessage(result.message, true);
  });
  refresh().catch(() => showScriptsMessage(copy.loadFailed, true));

  // ── Experimental: RAM / CPU limiters ─────────────────────────────────────
  const $ = (id) => document.getElementById(id);
  const ramEnabled = $('ram-enabled'), ramRange = $('ram-range'), ramValue = $('ram-value'), ramUnit = $('ram-unit'), ramInfo = $('ram-info');
  const ramHard = $('ram-hard'), ramHardField = $('ram-hard-field'), ramHardHint = $('ram-hard-hint');
  const cpuEnabled = $('cpu-enabled'), cpuRange = $('cpu-range'), cpuValue = $('cpu-value'), cpuLowprio = $('cpu-lowprio'), cpuInfo = $('cpu-info'), cpuStatus = $('cpu-status');
  const lang = document.documentElement.lang;
  const fmtMb = (mb) => mb >= 1024 ? (Math.round(mb / 102.4) / 10).toLocaleString(lang) + ' GB' : Math.round(mb) + ' MB';
  let exp = null;
  const showRamValue = (mb) => {
    ramRange.value = String(mb);
    ramValue.value = ramUnit.value === 'GB' ? String(Math.round(mb / 256) / 4) : String(mb);
  };
  const renderExpStatus = () => {
    if (!exp) return;
    const { system, status, settings } = exp;
    ramInfo.textContent = copy.ramSystem + ': ' + fmtMb(system.totalMemMb) + ' · ' + copy.ramCurrent + ': ' + fmtMb(status.ramUsageMb)
      + (status.ramSleptTotal ? ' · ' + copy.ramSlept + ': ' + status.ramSleptTotal : '');
    cpuInfo.textContent = copy.cpuThreadsDetected + ': ' + system.maxThreads;
    const lines = [];
    if (settings.cpuLimiterEnabled) {
      const map = { active: copy.cpuStatusActive + ' ' + status.cpuProcesses, unsupported: copy.cpuStatusUnsupported, 'no-taskset': copy.cpuStatusNoTaskset, 'no-powershell': copy.cpuStatusNoPowershell, error: copy.cpuStatusError, off: copy.cpuStatusOff };
      lines.push(map[status.cpuState] || '');
    }
    if (settings.cpuLowerBackgroundPriority) {
      const map = { active: copy.prioActive + ' ' + status.priorityLowered, unsupported: copy.prioUnsupported, 'needs-rlimit': copy.prioNeedsRlimit, error: copy.prioError };
      if (map[status.priorityState]) lines.push(map[status.priorityState]);
    }
    cpuStatus.textContent = lines.join(' ');
    ramHardField.hidden = !system.hardLimitSupported;
    const notes = [copy.ramHardHint];
    if (system.hardLimitFailure && settings.ramHardLimit && !system.activeHardLimitMb) notes.push(copy.ramHardFailed + '.');
    if (system.activeHardLimitMb) notes.push(copy.ramHardActive + ': ' + fmtMb(system.activeHardLimitMb) + '.');
    else if (settings.ramHardLimit && settings.ramLimiterEnabled) notes.push(copy.ramHardPending);
    ramHardHint.textContent = notes.join(' ');
  };
  const renderExpControls = () => {
    if (!exp) return;
    const { system, settings } = exp;
    ramRange.min = String(Math.min(512, system.totalMemMb)); ramRange.max = String(system.totalMemMb);
    cpuRange.max = String(system.maxThreads); cpuValue.max = String(system.maxThreads);
    ramEnabled.checked = settings.ramLimiterEnabled;
    showRamValue(settings.ramLimitMb);
    ramRange.disabled = ramValue.disabled = ramUnit.disabled = !settings.ramLimiterEnabled;
    ramHard.checked = settings.ramHardLimit; ramHard.disabled = !settings.ramLimiterEnabled;
    cpuEnabled.checked = settings.cpuLimiterEnabled;
    cpuRange.value = cpuValue.value = String(settings.cpuThreads);
    cpuRange.disabled = cpuValue.disabled = !settings.cpuLimiterEnabled;
    cpuLowprio.checked = settings.cpuLowerBackgroundPriority;
    renderExpStatus();
  };
  const saveExp = async (patch) => {
    try { exp = await window.browserApi.setExperimentalSettings(patch); } catch (error) { /* keep previous state */ }
    renderExpControls();
  };
  const loadExp = async () => {
    try { exp = await window.browserApi.getExperimentalSettings(); renderExpControls(); } catch (error) { /* ignore */ }
  };
  ramEnabled.addEventListener('change', () => saveExp({ ramLimiterEnabled: ramEnabled.checked }));
  ramRange.addEventListener('input', () => { ramValue.value = ramUnit.value === 'GB' ? String(Math.round(Number(ramRange.value) / 256) / 4) : ramRange.value; });
  ramRange.addEventListener('change', () => saveExp({ ramLimitMb: Number(ramRange.value) }));
  ramValue.addEventListener('change', () => {
    const typed = Number(ramValue.value.replace(',', '.'));
    if (Number.isFinite(typed) && typed > 0) saveExp({ ramLimitMb: ramUnit.value === 'GB' ? typed * 1024 : typed });
    else renderExpControls();
  });
  ramUnit.addEventListener('change', () => showRamValue(Number(ramRange.value)));
  ramHard.addEventListener('change', () => saveExp({ ramHardLimit: ramHard.checked }));
  cpuEnabled.addEventListener('change', () => saveExp({ cpuLimiterEnabled: cpuEnabled.checked }));
  cpuRange.addEventListener('input', () => { cpuValue.value = cpuRange.value; });
  cpuRange.addEventListener('change', () => saveExp({ cpuThreads: Number(cpuRange.value) }));
  cpuValue.addEventListener('change', () => saveExp({ cpuThreads: Number(cpuValue.value) }));
  cpuLowprio.addEventListener('change', () => saveExp({ cpuLowerBackgroundPriority: cpuLowprio.checked }));
  loadExp();
  setInterval(async () => {
    if (panels.experimental.hidden || document.visibilityState === 'hidden') return;
    try { const fresh = await window.browserApi.getExperimentalSettings(); exp = { ...exp, status: fresh.status, system: fresh.system }; renderExpStatus(); } catch (error) { /* ignore */ }
  }, 2000);

  const THEME_PRESETS = ${JSON.stringify(COLOR_THEMES)};
  const THEME_DEFAULTS = ${JSON.stringify({ light: DEFAULT_LIGHT, dark: DEFAULT_DARK })};
  const TOKEN_KEYS = ['bg','surface','surface2','fg','muted','accent','onAccent','border','danger'];
  const themeGrid = document.getElementById('theme-grid');
  const themeEditor = document.getElementById('theme-editor');
  const themePreview = document.getElementById('theme-preview');
  const themeMessage = document.getElementById('theme-message');
  const pick = (tokens) => { const out = {}; for (const key of TOKEN_KEYS) out[key] = tokens[key]; return out; };
  let themeState = null;
  let saveTimer = null;
  const swatchStrip = (tokens) => {
    const strip = make('span', 'theme-swatches');
    for (const key of ['bg', 'surface', 'surface2', 'fg', 'accent']) { const swatch = make('span'); swatch.style.background = tokens[key]; strip.append(swatch); }
    return strip;
  };
  const cards = [];
  const addCard = (id, name, hint, tokens, onPick) => {
    const button = make('button', 'theme-btn'); button.type = 'button'; button.dataset.id = id;
    const label = make('span', 'theme-name', name);
    button.append(label);
    if (hint) { button.append(make('span', 'theme-hint', hint)); button.title = name + ' — ' + hint; }
    const strip = swatchStrip(tokens);
    button.append(strip);
    button.addEventListener('click', onPick);
    themeGrid.append(button);
    cards.push({ id, button, strip, tokens });
    return button;
  };
  const sendTheme = async (settings) => {
    try {
      themeState = await window.browserApi.setTheme(settings);
      themeMessage.textContent = copy.themeSaved;
      syncTheme();
    } catch (error) { themeMessage.textContent = copy.themeLoadFailed; }
  };
  const systemDefault = () => (themeState && themeState.systemDark ? THEME_DEFAULTS.dark : THEME_DEFAULTS.light);
  addCard('default', copy.themeDefault, copy.themeDefaultHint, THEME_DEFAULTS.light, () => sendTheme({ id: 'default' }));
  for (const preset of THEME_PRESETS) addCard(preset.id, preset.name, '', preset.tokens, () => sendTheme({ id: preset.id }));
  const customCard = addCard('custom', copy.themeCustom, copy.themeCustomHint, THEME_DEFAULTS.light, () => {
    sendTheme({ id: 'custom', custom: pick(themeState ? themeState.tokens : systemDefault()) });
  });
  const inputs = {};
  for (const key of TOKEN_KEYS) {
    const item = make('label', 'color-item');
    const input = make('input'); input.type = 'color'; input.value = THEME_DEFAULTS.light[key];
    const state = make('span', 'color-state', input.value);
    input.addEventListener('input', () => {
      state.textContent = input.value;
      const draft = {}; for (const k of TOKEN_KEYS) draft[k] = inputs[k].input.value;
      paintPreview(draft);
      clearTimeout(saveTimer);
      saveTimer = setTimeout(() => sendTheme({ id: 'custom', custom: draft }), 90);
    });
    item.append(input, make('span', '', copy.tokenNames[key]), state);
    themeEditor.append(item);
    inputs[key] = { input, state };
  }
  const paintPreview = (tokens) => {
    const vars = { bg: '--mb-bg', surface: '--mb-surface', surface2: '--mb-surface-2', fg: '--mb-fg', muted: '--mb-muted', accent: '--mb-accent', onAccent: '--mb-on-accent', border: '--mb-border', danger: '--mb-danger' };
    for (const key of TOKEN_KEYS) themePreview.style.setProperty(vars[key], tokens[key]);
  };
  const syncTheme = () => {
    if (!themeState) return;
    const selected = themeState.settings.id;
    for (const card of cards) {
      card.button.classList.toggle('selected', card.id === selected);
      card.button.setAttribute('aria-pressed', card.id === selected ? 'true' : 'false');
    }
    const defaultCard = cards[0];
    const liveDefault = systemDefault();
    Array.from(defaultCard.strip.children).forEach((swatch, index) => { swatch.style.background = liveDefault[['bg', 'surface', 'surface2', 'fg', 'accent'][index]]; });
    const custom = themeState.settings.custom || themeState.tokens;
    Array.from(customCard.querySelector('.theme-swatches').children).forEach((swatch, index) => { swatch.style.background = custom[['bg', 'surface', 'surface2', 'fg', 'accent'][index]]; });
    for (const key of TOKEN_KEYS) {
      const { input, state } = inputs[key];
      const value = themeState.tokens[key];
      if (input.value !== value) input.value = value;
      state.textContent = value;
    }
    paintPreview(themeState.tokens);
  };
  document.getElementById('theme-reset').addEventListener('click', () => sendTheme({ id: 'default' }));
  window.browserApi.getTheme().then((state) => { themeState = state; syncTheme(); }).catch(() => { themeMessage.textContent = copy.themeLoadFailed; });
  window.browserApi.onThemeChanged((state) => { themeState = state; syncTheme(); });
})();
</script>${renderInternalConfirmMarkup()}</body></html>`;
};

// ── Strony wewnętrzne (karty) ───────────────────────────────────────────────
// Ustawienia, historia, pobieranie, dane witryn i statystyki to zwykłe karty z
// adresem monobrowser://<rodzaj> i treścią data:text/html; tylko one dostają
// preload, po jednej instancji na rodzaj.
const INTERNAL_PAGE_TITLES: Record<InternalKind, { pl: string; en: string }> = {
  settings: { pl: "Ustawienia", en: "Settings" },
  history: { pl: "Historia", en: "History" },
  downloads: { pl: "Pobieranie", en: "Downloads" },
  "site-data": { pl: "Dane witryn", en: "Site data" },
  stats: { pl: "Statystyki", en: "Statistics" },
  about: { pl: "O programie", en: "About" },
  onboarding: { pl: "Witaj", en: "Welcome" },
};

const isInternalKind = (value: unknown): value is InternalKind =>
  typeof value === "string" && (INTERNAL_KINDS as readonly string[]).includes(value);

const internalPageUrl = (kind: InternalKind): string => `monobrowser://${kind}`;

const internalPageTitle = (kind: InternalKind): string => INTERNAL_PAGE_TITLES[kind][appLanguage === "pl" ? "pl" : "en"];

// Ikona karty: znacznik rozpoznawany przez powłokę, która rysuje monochromatyczne SVG w kolorze karty.
const internalPageIcon = (kind: InternalKind): string => `mb-icon:${kind}`;

const parseInternalPageUrl = (value: string): InternalKind | null => {
  const match = /^monobrowser:\/\/([a-z-]+)\/?$/i.exec(value.trim());
  const kind = match?.[1].toLowerCase();
  return isInternalKind(kind) ? kind : null;
};

// ── Onboarding (pierwsze uruchomienie) ──────────────────────────────────────
let onboardingFilePath = "";
let onboardingStep = 0;
let onboardingAutoShow = false;

const detectOnboarding = async (): Promise<void> => {
  onboardingAutoShow = false;
  if (process.env.MB_SKIP_ONBOARDING === "1") return;
  try {
    const dir = app.getPath("userData");
    let flag = null;
    try { flag = normalizeOnboardingFlag(JSON.parse(await fs.readFile(path.join(dir, ONBOARDING_FILE), "utf8"))); } catch { /* brak pliku */ }
    const existingFiles = await fs.readdir(dir).catch(() => [] as string[]);
    onboardingAutoShow = shouldAutoShowOnboarding({ flag, existingFiles, skipEnv: false });
  } catch {
    onboardingAutoShow = false;
  }
};

const renderOnboardingPage = (): string => renderOnboardingPageHtml({
  language: appLanguage === "pl" ? "pl" : "en",
  step: onboardingStep,
  presets: COLOR_THEMES.map((preset) => ({ id: preset.id, name: preset.name, colors: stripScheme(preset.tokens) })),
  defaultColors: stripScheme(defaultTokens(nativeTheme.shouldUseDarkColors)),
  fontDataUrl: getBebasNeueFontDataUrl(),
});

const finishOnboarding = async (): Promise<boolean> => {
  await writeJsonAtomically(onboardingFilePath, { done: true });
  setTimeout(() => {
    for (const tab of getInternalTabs("onboarding")) closeTab(tab.id);
    if (activeTabId === null || !tabs.has(activeTabId)) createTab(DEFAULT_URL, true);
  }, 0);
  return true;
};

const renderAboutPage = (): string => renderAboutPageHtml({
  language: appLanguage,
  info: {
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    portable: isPortableMode(),
  },
  status: updateStatus,
  fontDataUrl: getBebasNeueFontDataUrl(),
});

const getAboutUpdatePayload = () => ({
  status: { ...updateStatus },
  text: describeUpdateStatus(updateStatus, appLanguage, localeForLanguage()),
});

/** http(s) links that appear in the license file the About page rendered: they may be opened from there. */
let licenseLinkAllowList = new Set<string>();
const normalizeLinkHref = (value: string): string => {
  try { return new URL(value).href; } catch { return value; }
};

const readLicensesText = async (): Promise<string> => {
  const candidates = [
    path.join(app.getAppPath(), "THIRD-PARTY-NOTICES.md"),
    path.join(process.resourcesPath, "THIRD-PARTY-NOTICES.md"),
    path.join(__dirname, "..", "..", "THIRD-PARTY-NOTICES.md"),
  ];
  for (const candidate of candidates) {
    try {
      return (await fs.readFile(candidate, "utf8")).slice(0, 200_000);
    } catch {
      continue;
    }
  }
  return "";
};

const renderInternalPageHtml = (kind: InternalKind): string => {
  switch (kind) {
    case "history": return renderHistoryPageHtml(historyEntries);
    case "downloads": return renderDownloadsPageHtml();
    case "site-data": return renderSiteDataPageHtml();
    case "stats": return renderStatsPageHtml();
    case "about": return renderAboutPage();
    case "onboarding": return renderOnboardingPage();
    default: return renderSettingsPageHtml();
  }
};

const internalPageDataUrl = (kind: InternalKind): string =>
  `data:text/html;charset=utf-8,${encodeURIComponent(injectTheme(renderInternalPageHtml(kind)))}`;

const getInternalTabs = (kind: InternalKind): TabRecord[] =>
  Array.from(tabs.values()).filter((tab) => tab.internalKind === kind);

/** The internal tab of this kind in the given workspace (default: the current one); none when it has no such tab. */
const getInternalTab = (kind: InternalKind, workspaceId: string = currentWorkspaceId): TabRecord | null =>
  getInternalTabs(kind).find((tab) => tab.workspaceId === workspaceId) ?? null;

/** Pushes a data change to the open Settings tab (no reload), so its lists never go stale. */
const notifySettingsPage = (topic: "adblock-exceptions" | "adblock-status" | "workspaces", data: unknown): void => {
  for (const tab of getInternalTabs("settings")) {
    const contents = getTabContents(tab);
    if (contents && !contents.isDestroyed()) contents.send("settings:data-changed", topic, data);
  }
};

const loadInternalPageContent = async (kind: InternalKind): Promise<void> => {
  await Promise.all(getInternalTabs(kind).map(async (tab) => {
    const contents = getTabContents(tab);
    if (contents && !contents.isDestroyed()) await contents.loadURL(internalPageDataUrl(kind));
  }));
};

const openInternalPage = async (kind: InternalKind): Promise<void> => {
  const existing = getInternalTab(kind);
  if (existing) {
    setActiveTab(existing.id);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.focus();
    // Statystyki to migawka – przy ponownym otwarciu odśwież.
    if (kind === "stats") await loadInternalPageContent(kind);
    return;
  }
  createTab(internalPageUrl(kind), true, false, kind);
};

const openSettingsWindow = (): Promise<void> => openInternalPage("settings");

const openOnboarding = async (): Promise<void> => {
  if (!getInternalTab("onboarding")) onboardingStep = 0;
  await openInternalPage("onboarding");
};

const refreshLocalizedWindows = async (): Promise<void> => {
  // Reloading internal/start pages (some of them hidden) must not move keyboard focus away from the page the user is in.
  const focusedBefore = webContents.getFocusedWebContents();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("language:changed", appLanguage);
  }
  compactChrome?.getContents()?.send("language:changed", appLanguage);
  applyActiveViewBounds();
  if (findView && !findView.webContents.isDestroyed()) {
    findView.webContents.send("language:changed", appLanguage);
  }
  if (paletteView && !paletteView.webContents.isDestroyed()) {
    paletteView.webContents.send("language:changed", appLanguage);
  }
  if (notesView && !notesView.webContents.isDestroyed()) {
    notesView.webContents.send("language:changed", appLanguage);
  }
  broadcastDownloadProgress();
  for (const kind of INTERNAL_KINDS) {
    await loadInternalPageContent(kind);
  }
  await refreshStartPages();
  if (focusedBefore && !focusedBefore.isDestroyed() && !focusedBefore.isFocused()
    && Array.from(tabs.values()).some((tab) => tab.view?.webContents === focusedBefore)) {
    focusedBefore.focus();
  }
};

// Słownik pisowni zgodny z językiem interfejsu (pl / en-US); dotyczy sesji zwykłej i prywatnej.
const applySpellcheckLanguages = (): void => {
  const sessions = [session.defaultSession, ...(privateSessionConfigured ? [session.fromPartition(PRIVATE_PARTITION)] : [])];
  for (const target of sessions) {
    try {
      const languages = spellcheckLanguagesFor(appLanguage, target.availableSpellCheckerLanguages);
      if (languages.length > 0) target.setSpellCheckerLanguages(languages);
    } catch (error) {
      console.error("Failed to set spellchecker languages:", error);
    }
  }
};

const setApplicationLanguage = async (language: AppLanguage): Promise<boolean> => {
  if (language === appLanguage) {
    return true;
  }
  appLanguage = language;
  applySpellcheckLanguages();
  await saveLanguage();
  setupApplicationMenu();
  await refreshLocalizedWindows();
  return true;
};

type PopupAnchor = { x: number; y: number; rect?: PopupRect; placement?: PopupPlacement };

const finiteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const getMenuAnchor = (anchor: unknown): PopupAnchor | null => {
  if (typeof anchor !== "object" || anchor === null) {
    return null;
  }

  const raw = anchor as { x?: unknown; y?: unknown; rect?: unknown; placement?: unknown };
  if (typeof raw.x !== "number" || typeof raw.y !== "number" || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
    return null;
  }

  const result: PopupAnchor = {
    x: Math.max(0, Math.floor(raw.x)),
    y: Math.max(0, Math.floor(raw.y)),
  };
  const rect = raw.rect as Partial<PopupRect> | undefined;
  if (typeof rect === "object" && rect !== null && finiteNumber(rect.x) && finiteNumber(rect.y) && finiteNumber(rect.width) && finiteNumber(rect.height)) {
    result.rect = { x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.max(0, Math.floor(rect.width)), height: Math.max(0, Math.floor(rect.height)) };
  }
  if (raw.placement === "below" || raw.placement === "above" || raw.placement === "right") result.placement = raw.placement;
  return result;
};

const getBookmarkableUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
};

const saveBookmarks = async (): Promise<void> => {
  bookmarkEntries = bookmarkEntries.slice(0, MAX_BOOKMARK_ITEMS);
  await writeJsonAtomically(bookmarksFilePath, bookmarkEntries);
};

const loadBookmarks = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(bookmarksFilePath, "utf8");
    const parsed = JSON.parse(raw) as BookmarkEntry[];
    if (!Array.isArray(parsed)) {
      bookmarkEntries = [];
      return;
    }

    bookmarkEntries = parsed
      .filter((entry) => (
        typeof entry?.id === "string" &&
        typeof entry?.title === "string" &&
        typeof entry?.createdAt === "string" &&
        getBookmarkableUrl(entry?.url) === entry.url
      ))
      .slice(0, MAX_BOOKMARK_ITEMS);
  } catch {
    bookmarkEntries = [];
  }
};

const findBookmarkByUrl = (url: string): BookmarkEntry | undefined =>
  bookmarkEntries.find((bookmark) => bookmark.url === url);

const toggleActiveBookmark = async (): Promise<boolean> => {
  const tab = getActiveTab();
  if (!tab) {
    return false;
  }

  const url = getBookmarkableUrl(tab.url);
  if (!url) {
    return false;
  }

  const existing = findBookmarkByUrl(url);
  if (existing) {
    bookmarkEntries = bookmarkEntries.filter((bookmark) => bookmark.id !== existing.id);
  } else {
    bookmarkEntries = [{
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      url,
      title: tab.title.trim() || url,
      createdAt: new Date().toISOString(),
    }, ...bookmarkEntries].slice(0, MAX_BOOKMARK_ITEMS);
  }

  await saveBookmarks();
  return true;
};

const removeBookmark = async (id: string): Promise<void> => {
  const nextEntries = bookmarkEntries.filter((bookmark) => bookmark.id !== id);
  if (nextEntries.length === bookmarkEntries.length) {
    return;
  }

  bookmarkEntries = nextEntries;
  await saveBookmarks();
};

const clearBookmarks = async (): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed() || bookmarkEntries.length === 0) {
    return;
  }

  const pl = appLanguage === "pl";
  await openMessagePopup(
    pl ? "Wyczyść zakładki" : "Clear bookmarks",
    pl ? "Czy na pewno usunąć wszystkie zakładki?" : "Are you sure you want to remove all bookmarks?",
    {
      label: pl ? "Usuń wszystkie" : "Remove all",
      dismissLabel: pl ? "Anuluj" : "Cancel",
      onConfirm: async () => {
        bookmarkEntries = [];
        await saveBookmarks();
      },
    },
  );
};

const MAX_BOOKMARK_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

const importBookmarksFromFile = async (): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const pl = appLanguage === "pl";
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: pl ? "Importuj zakładki" : "Import bookmarks",
    properties: ["openFile"],
    filters: [
      { name: pl ? "Zakładki (HTML, JSON)" : "Bookmarks (HTML, JSON)", extensions: ["html", "htm", "json"] },
    ],
  });
  if (selection.canceled || selection.filePaths.length === 0) {
    return;
  }

  let message: string;
  try {
    const filePath = selection.filePaths[0];
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_BOOKMARK_IMPORT_FILE_BYTES) {
      throw new Error(pl ? "Plik jest zbyt duży." : "The file is too large.");
    }
    const imported = parseBookmarksImport(await fs.readFile(filePath, "utf8"));
    const knownUrls = new Set(bookmarkEntries.map((bookmark) => bookmark.url));
    const additions: BookmarkEntry[] = [];
    for (const item of imported) {
      const url = getBookmarkableUrl(item.url);
      if (!url || knownUrls.has(url) || bookmarkEntries.length + additions.length >= MAX_BOOKMARK_ITEMS) {
        continue;
      }
      knownUrls.add(url);
      additions.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        url,
        title: item.title.trim() || url,
        createdAt: item.createdAt ?? new Date().toISOString(),
      });
    }
    bookmarkEntries = [...bookmarkEntries, ...additions];
    await saveBookmarks();
    message = pl
      ? `Zaimportowano ${additions.length} z ${imported.length} zakładek.`
      : `Imported ${additions.length} of ${imported.length} bookmarks.`;
    if (bookmarkEntries.length >= MAX_BOOKMARK_ITEMS && additions.length < imported.length) {
      message += pl ? ` Limit to ${MAX_BOOKMARK_ITEMS} zakładek.` : ` The limit is ${MAX_BOOKMARK_ITEMS} bookmarks.`;
    }
  } catch (error) {
    message = pl
      ? `Nie udało się zaimportować zakładek: ${error instanceof Error ? error.message : "nieznany błąd"}`
      : `Could not import bookmarks: ${error instanceof Error ? error.message : "unknown error"}`;
  }

  await openMessagePopup(pl ? "Importuj zakładki" : "Import bookmarks", message);
};

const exportBookmarksToFile = async (): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const pl = appLanguage === "pl";
  if (bookmarkEntries.length === 0) {
    await openMessagePopup(
      pl ? "Eksportuj zakładki" : "Export bookmarks",
      pl ? "Brak zakładek do wyeksportowania." : "There are no bookmarks to export.",
    );
    return;
  }

  const target = await dialog.showSaveDialog(mainWindow, {
    title: pl ? "Eksportuj zakładki" : "Export bookmarks",
    defaultPath: path.join(app.getPath("documents"), "monobrowser-bookmarks.html"),
    filters: [
      { name: "HTML", extensions: ["html"] },
      { name: "JSON", extensions: ["json"] },
    ],
  });
  if (target.canceled || !target.filePath) {
    return;
  }

  try {
    const content = target.filePath.toLowerCase().endsWith(".json")
      ? exportBookmarksJson(bookmarkEntries)
      : exportBookmarksHtml(bookmarkEntries);
    await fs.writeFile(target.filePath, content, "utf8");
    await openMessagePopup(
      pl ? "Eksportuj zakładki" : "Export bookmarks",
      pl ? `Wyeksportowano ${bookmarkEntries.length} zakładek.` : `Exported ${bookmarkEntries.length} bookmarks.`,
    );
  } catch (error) {
    await openMessagePopup(
      pl ? "Eksportuj zakładki" : "Export bookmarks",
      pl
        ? `Nie udało się zapisać pliku: ${error instanceof Error ? error.message : "nieznany błąd"}`
        : `Could not write the file: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
};

const getBookmarkMenuLabel = (bookmark: BookmarkEntry): string => {
  let hostname = "";
  try {
    hostname = new URL(bookmark.url).hostname;
  } catch {
    hostname = "";
  }
  const title = bookmark.title.trim() || bookmark.url;
  const label = hostname && !title.toLowerCase().includes(hostname.toLowerCase())
    ? `${title} — ${hostname}`
    : title;
  return label.length > 80 ? `${label.slice(0, 77)}…` : label;
};

const POPUP_MENU_STYLES = `
  ${UI_BASE_START_CSS}
  :root { ${LEGACY_ALIAS_CSS} font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; }
  * { box-sizing:border-box; }
  button,input,select,textarea { font:inherit; }
  html,body { width:100%; height:100%; margin:0; overflow:hidden; background:transparent; }
  body { padding:7px 9px 9px 7px; color:var(--black); }
  .popup { width:100%; height:100%; overflow:auto; scrollbar-width:thin; border:3px solid var(--black); border-radius:0; background:var(--white); box-shadow:5px 5px 0 var(--accent); }
  .nav-popup { height:auto; max-height:calc(100vh - 16px); overflow:hidden; }
  .nav-popup.height-limited { overflow:auto; }
  .popup::after { content:""; position:fixed; inset:7px 9px 9px 7px; pointer-events:none; opacity:.025; background:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  a,summary { position:relative; z-index:1; color:var(--black); text-decoration:none; }
  .menu-item,summary { min-height:44px; padding:0 14px; display:flex; align-items:center; gap:10px; border:0; border-bottom:1px solid var(--black); background:var(--white); font-size:12px; font-weight:700; letter-spacing:.04em; cursor:pointer; user-select:none; }
  .menu-item:hover,.menu-item:focus-visible,summary:hover,summary:focus-visible { outline:0; background:var(--black); color:var(--white); }
  .menu-item.disabled { color:var(--grey); cursor:not-allowed; }
  .menu-item.disabled:hover { background:var(--white); color:var(--grey); }
  .shortcut { margin-left:auto; color:var(--grey); font-size:11px; font-weight:400; }
  .menu-item:hover .shortcut,.menu-item:focus-visible .shortcut { color:var(--white); }
  .menu-heading { position:relative; z-index:1; padding:9px 14px 6px; color:var(--grey); font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; background:var(--white); border-bottom:1px solid var(--black); }
  .menu-separator { height:7px; border-bottom:2px solid var(--black); background:var(--mb-surface-2); }
  details { border:0; }
  summary { list-style:none; }
  summary::-webkit-details-marker { display:none; }
  summary::after { content:""; flex:0 0 auto; width:6px; height:6px; margin:-3px 3px 0 auto; border-right:2px solid currentColor; border-bottom:2px solid currentColor; transform:rotate(-45deg); transition:transform var(--mb-dur,160ms) var(--mb-ease,ease); }
  summary:has(.summary-count)::after { margin-left:0; }
  .summary-count { margin-left:auto; color:inherit; font-size:11px; font-weight:700; font-variant-numeric:tabular-nums; opacity:.75; }
  details[open] > summary { background:var(--mb-surface-2); color:var(--black); border-bottom-color:transparent; }
  details[open] > summary:hover,details[open] > summary:focus-visible { background:var(--black); color:var(--white); }
  details[open] > summary::after { transform:rotate(45deg); }
  .submenu { border-bottom:1px solid var(--black); background:var(--mb-surface); padding:0 0 4px; display:grid; gap:0; }
  .submenu .menu-item { min-height:36px; border:0; border-left:3px solid var(--accent); background:transparent; color:var(--black); padding:0 14px 0 18px; font-size:12px; font-weight:600; }
  .submenu .menu-item .menu-label { color:inherit; }
  .submenu .menu-item:hover,.submenu .menu-item:focus-visible { background:var(--black); color:var(--white); }
  .bookmark-list { max-height:190px; overflow:auto; display:grid; gap:5px; }
  .bookmark-row { display:grid; grid-template-columns:minmax(0,1fr) 36px; }
  .bookmark-row .menu-item { min-width:0; border-right:0; }
  .bookmark-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .remove { justify-content:center; padding:0; font-size:15px!important; }
  .danger { background:var(--black)!important; color:var(--white)!important; }
  .danger:hover { background:var(--accent)!important; color:var(--mb-on-accent)!important; }
  .selected::before { content:"■"; font-size:8px; }
  .popup-title { position:relative; z-index:1; margin:0; padding:15px 16px 13px; border-bottom:3px solid var(--black); background:var(--mb-surface); color:var(--black); font-size:13px; letter-spacing:.12em; text-transform:uppercase; }
  .info-body { position:relative; z-index:1; padding:12px; display:grid; gap:10px; }
  .popup-sub { display:block; margin-top:5px; color:var(--grey); font-size:11px; font-weight:400; letter-spacing:0; text-transform:none; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .menu-label { min-width:0; flex:1 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .site-popup { overflow:hidden; }
  .site-popup .popup-title { padding:12px 14px 10px; font-size:12px; }
  .site-popup .info-body { padding:10px 12px 12px; gap:8px; }
  /* One box style for every block of the popup: 2px frame, no offset shadow; the connection state is a left stripe. */
  .security { border:2px solid var(--black); padding:12px; background:var(--white); display:grid; gap:5px; }
  .site-popup .security { padding:8px 10px; gap:4px; }
  .site-popup .info-row { min-height:31px; padding:5px 8px; }
  .site-popup .notice { padding:6px 8px; }
  .site-popup .info-action { min-height:36px; letter-spacing:.04em; padding:0 8px; text-align:center; }

  .security strong { font-size:12px; text-transform:uppercase; letter-spacing:.06em; }
  .security.secure,.security.internal { border-left:8px solid var(--accent); }
  .security.insecure { border-left:8px solid var(--mb-danger); }
  .host { color:var(--grey); font-size:12px; overflow-wrap:anywhere; }
  .info-grid { border:2px solid var(--black); }
  .info-row { min-height:39px; padding:8px 10px; display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:12px; border-bottom:1px solid var(--black); font-size:12px; }
  .info-row:last-child { border-bottom:0; }
  .info-row span { color:var(--grey); }
  .info-row strong { text-align:right; font-size:12px; }
  .notice { border:2px solid var(--black); padding:9px 10px; background:var(--mb-surface-2); color:var(--black); font-size:11px; line-height:1.45; }
  .info-action { min-height:42px; border:2px solid var(--black); display:flex; align-items:center; justify-content:center; background:var(--black); color:var(--white); font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; }
  .info-action:hover,.info-action:focus-visible { outline:0; background:var(--accent); color:var(--mb-on-accent); }
  .context-popup { overflow:hidden; }
  .context-groups { padding:8px; display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); align-items:start; gap:8px; }
  .context-group { min-width:0; border:2px solid var(--black); background:var(--white); }
  .context-group h2 { margin:0; min-height:30px; padding:8px 9px 6px; background:var(--mb-surface); color:var(--black); border-bottom:2px solid var(--black); font-size:11px; letter-spacing:.1em; text-transform:uppercase; }
  .context-group .menu-item { min-height:34px; padding:5px 9px; font-size:12px; line-height:1.25; }
  .context-group .menu-item:last-child { border-bottom:0; }
  @media(max-width:700px) { .context-groups { grid-template-columns:repeat(2,minmax(0,1fr)); } }
  /* Show/hide animation: the main process adds mb-in right after the view becomes visible and mb-out before hiding it. */
  @keyframes mb-popup-in { from { opacity:0; transform:translateY(-4px) scale(.98); } }
  body:not(.mb-in) .popup { opacity:0; }
  body.mb-in .popup { animation:mb-popup-in var(--mb-dur,160ms) var(--mb-ease,ease) backwards; transform-origin:top center; }
  body.mb-out .popup { opacity:0; transform:translateY(-4px) scale(.98); transition:opacity var(--mb-dur,160ms) var(--mb-ease,ease), transform var(--mb-dur,160ms) var(--mb-ease,ease); }
  .menu-item, .info-action { transition:background-color var(--mb-dur,160ms) var(--mb-ease,ease), color var(--mb-dur,160ms) var(--mb-ease,ease), transform var(--mb-dur,160ms) var(--mb-ease,ease); }
`;

/** Reports the real content height of a `.nav-popup` page so the popup is sized to its content (no empty band). */
const POPUP_HEIGHT_REPORT_SCRIPT = `<script>
(() => {
  const popup = document.querySelector('.nav-popup');
  if (!popup) return;
  const reportHeight = () => {
    const popupBorderHeight = popup.getBoundingClientRect().height - popup.clientHeight;
    const windowPaddingHeight = window.innerHeight - popup.getBoundingClientRect().height;
    const height = Math.ceil(popup.scrollHeight + popupBorderHeight + windowPaddingHeight + 1);
    location.href = 'monobrowser-menu://resize?height=' + height;
  };
  document.querySelectorAll('details').forEach(details => details.addEventListener('toggle', () => requestAnimationFrame(reportHeight)));
  // Report on load, after the initial data: URL has settled: a resize navigation fired during loadURL would abort it.
  window.addEventListener('load', () => setTimeout(() => requestAnimationFrame(reportHeight), 30));
})();
</script>`;

type PopupKind = "navigation" | "site-info" | "context" | "message" | "workspaces";

interface ActivePopup {
  kind: PopupKind;
  token: number;
  bounds: Electron.Rectangle;
  fixedEdge: "top" | "bottom";
  edgeY: number;
  preferredHeight: number;
  // Only a popup that is on screen can be dismissed by focus loss: the hidden
  // view emits stray focus/blur events while it loads, which used to dismiss
  // a menu in the same moment it was shown.
  shown: boolean;
  shownAt: number;
  // Where focus returns when the popup closes by Escape or a chosen action
  // (default: the active tab).
  restoreFocusTo?: () => WebContents | null;
}

const POPUP_TOGGLE_GUARD_MS = 400;
const POPUP_OUTSIDE_GRACE_MS = 250;
let popupToken = 0;
let activePopup: ActivePopup | null = null;
let lastPopupDismissal: { kind: PopupKind; at: number } | null = null;
let popupActionHandler: ((actionUrl: URL) => void | Promise<void>) | null = null;

const isPopupVisible = (): boolean => activePopup !== null;

// Hides the popup overlay (the view itself is kept, attached and reused).
// restoreFocus is true for Escape / chosen action, false when the user moved
// focus elsewhere (outside click) or another overlay took over.
const POPUP_FADE_OUT_MS = 120;
/** Fades an overlay view out (class mb-out), then runs `remove`. Without animations `remove` runs at once. */
const retireOverlayView = (view: WebContentsView, remove: () => void): void => {
  if (!areAnimationsEffective() || view.webContents.isDestroyed()) { remove(); return; }
  view.webContents.executeJavaScript("document.body.classList.add('mb-out')", true).catch(() => undefined);
  setTimeout(remove, POPUP_FADE_OUT_MS);
};
const closePopup = (restoreFocus = false, animate = true): void => {
  const active = activePopup;
  activePopup = null;
  popupToken += 1;
  if (!active) return;
  if (popupView && !popupView.webContents.isDestroyed()) {
    const hideNow = (): void => {
      if (!popupView || popupView.webContents.isDestroyed()) return;
      popupView.setVisible(false);
      popupView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    };
    // Fade out first; a newer popup (token bump) or an instant replace cancels the delayed hide.
    if (animate && active.shown && areAnimationsEffective()) {
      const hideToken = popupToken;
      popupView.webContents.executeJavaScript("document.body.classList.add('mb-out')", true).catch(() => undefined);
      setTimeout(() => { if (activePopup === null && popupToken === hideToken) hideNow(); }, POPUP_FADE_OUT_MS);
    } else {
      hideNow();
    }
  }
  if (restoreFocus && mainWindow && !mainWindow.isDestroyed()) {
    programmaticFocusUntil = Date.now() + 400;
    if (!mainWindow.isFocused()) mainWindow.focus();
    const target = active.restoreFocusTo?.() ?? getTabContents(getActiveTab());
    if (target && !target.isDestroyed()) target.focus();
    else mainWindow.webContents.focus();
  }
};

// After an in-place action (keep=1) the page behind reloads and grabs focus; that must not dismiss the popup.
let popupKeepUntil = 0;

const dismissPopupFromOutside = (token: number): void => {
  const active = activePopup;
  if (!active || active.token !== token || !active.shown) return;
  if (Date.now() < popupKeepUntil) {
    if (popupView && !popupView.webContents.isDestroyed()) popupView.webContents.focus();
    return;
  }
  // A press on the button that opened the popup first dismisses it here
  // (focus moved to the shell); remember that so the button's own open request
  // acts as a toggle-close. Presses on the page do not count.
  const focusMovedToShell = Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents.isFocused());
  lastPopupDismissal = focusMovedToShell ? { kind: active.kind, at: Date.now() } : null;
  closePopup(false);
};

// Focus landed on the shell or a tab: the user clicked outside the popup.
// Backup for the popup's own blur event, which does not fire if the popup
// never managed to take focus.
const dismissPopupOnForeignFocus = (): void => {
  const active = activePopup;
  if (!active || !active.shown || Date.now() - active.shownAt < POPUP_OUTSIDE_GRACE_MS) return;
  if (popupView && !popupView.webContents.isDestroyed() && popupView.webContents.isFocused()) return;
  dismissPopupFromOutside(active.token);
};

const attachPopupViewOnTop = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !popupView || popupView.webContents.isDestroyed()) return;
  mainWindow.contentView.addChildView(popupView);
};

// Menu items act on mouse-down (like native menus), so the first press always
// counts even while the popup is still taking focus. The click that follows
// lands on whatever is below the already hidden popup, never on the popup.
const POPUP_MOUSEDOWN_SCRIPT = `<script>
setTimeout(() => document.body && document.body.classList.add('mb-in'), 1500);
document.addEventListener('mousedown', (event) => {
  if (event.button !== 0) return;
  const link = event.target instanceof Element ? event.target.closest('a[href^="monobrowser-menu://"]') : null;
  if (!link) return;
  event.preventDefault();
  location.href = link.href;
}, true);
// The mouse press already ran the action; the click that follows must not run it a second time (keyboard activation has detail 0).
document.addEventListener('click', (event) => {
  if (event.detail > 0 && event.target instanceof Element && event.target.closest('a[href^="monobrowser-menu://"]')) event.preventDefault();
}, true);
</script>`;

const withPopupMouseDownActions = (html: string): string =>
  html.includes("</body>") ? html.replace("</body>", `${POPUP_MOUSEDOWN_SCRIPT}</body>`) : html + POPUP_MOUSEDOWN_SCRIPT;

const ensurePopupView = (): WebContentsView | null => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (popupView && !popupView.webContents.isDestroyed()) return popupView;

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  view.setBackgroundColor("#00000000");
  trackThemedContents(view.webContents);
  view.setVisible(false);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  popupView = view;
  mainWindow.contentView.addChildView(view);

  const contents = view.webContents;
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, targetUrl) => {
    if (!targetUrl.startsWith("monobrowser-menu://")) {
      return;
    }
    event.preventDefault();
    const active = activePopup;
    if (!active) return;
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return;
    }
    if (parsed.hostname === "resize") {
      const requestedHeight = Number(parsed.searchParams.get("height"));
      if (Number.isFinite(requestedHeight) && mainWindow && !mainWindow.isDestroyed()) {
        const resized = resizePopupBounds(active.bounds, active.fixedEdge, active.edgeY, requestedHeight, mainWindow.getContentSize()[1]);
        const heightLimited = resized.heightLimited;
        active.bounds = resized.bounds;
        view.setBounds(active.bounds);
        void contents.executeJavaScript(
          `document.querySelector('.nav-popup')?.classList.toggle('height-limited', ${heightLimited});`,
          true,
        ).catch(() => undefined);
      }
      return;
    }
    const handler = popupActionHandler;
    // keep=1: the action changes something in place and the popup stays open (it updates itself).
    if (parsed.searchParams.get("keep") !== "1") closePopup(true);
    else popupKeepUntil = Date.now() + 3000;
    if (handler) void handler(parsed);
  });
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") {
      event.preventDefault();
      closePopup(true);
    }
  });
  contents.on("blur", () => {
    const active = activePopup;
    if (!active || !active.shown) return;
    const token = active.token;
    // Focus can bounce (blur, focus) while the compositor settles; only
    // dismiss when the popup is still unfocused after a short delay.
    setTimeout(() => {
      if (activePopup?.token !== token || contents.isDestroyed() || contents.isFocused()) return;
      dismissPopupFromOutside(token);
    }, 80);
  });
  return view;
};

const openStyledPopup = async (
  kind: PopupKind,
  anchor: PopupAnchor,
  width: number,
  preferredHeight: number,
  html: string,
  onAction: (actionUrl: URL) => void | Promise<void>,
  restoreFocusTo?: () => WebContents | null,
): Promise<boolean> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false;
  }

  // Toggle: the button that opened this popup closes it when pressed again
  // (the mouse-down already dismissed it through blur, so honour that too).
  const dismissedJustNow = lastPopupDismissal !== null
    && lastPopupDismissal.kind === kind
    && Date.now() - lastPopupDismissal.at < POPUP_TOGGLE_GUARD_MS;
  const wasSameKindOpen = activePopup?.kind === kind;
  lastPopupDismissal = null;
  if (kind !== "context" && kind !== "message" && (wasSameKindOpen || dismissedJustNow)) {
    closePopup(true);
    return true;
  }

  closePopup(false, false);
  const view = ensurePopupView();
  if (!view) return false;
  view.setVisible(false); // a previous popup may still be fading out

  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const geometry = computePopupGeometry({
    anchor, rect: anchor.rect, placement: anchor.placement, width, preferredHeight, contentWidth, contentHeight,
    // Context popups opened by a control (they bring a rect) follow the placement logic; the rest hang from the pointer.
    clampInside: kind === "context" && !anchor.rect,
  });

  const token = ++popupToken;
  const bounds = geometry.bounds;
  popupActionHandler = onAction;
  // Claim the slot synchronously so a quickly repeated open toggles/replaces
  // instead of racing the async load below. The view stays hidden until loaded.
  activePopup = { kind, token, bounds, fixedEdge: geometry.fixedEdge, edgeY: geometry.edgeY, preferredHeight, shown: false, shownAt: 0, restoreFocusTo };
  view.setBounds(bounds);

  try {
    // Never let a stuck load leave the popup invisible forever.
    await Promise.race([
      view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(withPopupMouseDownActions(html))}`),
      new Promise<void>((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch (error) {
    // The height-report navigation (monobrowser-menu://resize) can abort the
    // pending data: URL load; the popup itself is fine in that case.
    if ((error as NodeJS.ErrnoException)?.code !== "ERR_ABORTED") {
      if (activePopup?.token === token) closePopup(false);
      throw error;
    }
  }
  if (activePopup?.token !== token || view.webContents.isDestroyed()) {
    return true; // closed or replaced while loading
  }
  activePopup.shown = true;
  activePopup.shownAt = Date.now();
  view.setBounds(activePopup.bounds);
  attachPopupViewOnTop();
  view.setVisible(true);
  // A fade-out script queued by closePopup for the previous popup page can land in this new page: clear it.
  view.webContents.executeJavaScript("document.body.classList.remove('mb-out');document.body.classList.add('mb-in')", true).catch(() => undefined);
  view.webContents.invalidate();
  view.webContents.focus();
  return true;
};

// Komunikat/potwierdzenie w oknie (zamiast natywnego okna dialogowego): nakładka popup na środku u góry.
// Zamknięcie (Esc, kliknięcie obok, „Zamknij”) = anulowanie; onConfirm wykonuje się tylko po przycisku akcji.
const openMessagePopup = async (
  title: string,
  message: string,
  action?: { label: string; onConfirm: () => void | Promise<void>; dismissLabel: string },
): Promise<void> => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const width = 400;
  const lines = message.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 40)), 0);
  const height = 50 + 24 + (lines * 19 + 28) + (action ? 2 : 1) * 52 + 20;
  const html = `<!doctype html><html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escapeHtml(title)}</title><style id="mb-theme">${themeCss(getThemeTokens())}</style><style>${POPUP_MENU_STYLES}
  .message-text { position:relative; z-index:1; border:2px solid var(--black); padding:12px; font-size:12px; line-height:1.5; overflow-wrap:anywhere; white-space:pre-wrap; }
  .info-action.secondary { background:var(--white); color:var(--black); }
  .info-action.secondary:hover, .info-action.secondary:focus-visible { background:var(--accent); }
</style></head><body>
<section class="popup"><h1 class="popup-title">${escapeHtml(title)}</h1><div class="info-body">
  <div class="message-text">${escapeHtml(message)}</div>
  ${action ? `<a class="info-action" href="monobrowser-menu://confirm">${escapeHtml(action.label)}</a>` : ""}
  <a class="info-action${action ? " secondary" : ""}" href="monobrowser-menu://close">${escapeHtml(action ? action.dismissLabel : "OK")}</a>
</div></section></body></html>`;
  const [contentWidth] = mainWindow.getContentSize();
  await openStyledPopup("message", { x: Math.round((contentWidth - width) / 2), y: 72 }, width, height, html, async (actionUrl) => {
    if (action && actionUrl.hostname === "confirm") await action.onConfirm();
  });
};

const openNavigationMenu = async (anchor: unknown): Promise<boolean> => {
  const position = getMenuAnchor(anchor);
  if (!mainWindow || mainWindow.isDestroyed() || !position) {
    return false;
  }

  const copy = appLanguage === "pl" ? {
    title: "Menu", settings: "Ustawienia", newPrivateTab: "Nowa karta prywatna", devTools: "Narzędzia deweloperskie", bookmarks: "Zakładki", addBookmark: "Dodaj bieżącą stronę", removeCurrentBookmark: "Usuń bieżącą zakładkę",
    noBookmarks: "Brak zapisanych zakładek", clearBookmarks: "Wyczyść wszystkie zakładki", importBookmarks: "Importuj zakładki…", exportBookmarks: "Eksportuj zakładki…", history: "Historia", downloads: "Pobieranie",
    siteData: "Dane witryn", language: "Język", polish: "Polski", english: "Angielski", remove: "Usuń",
    welcome: "Pokaż powitanie", about: "O programie", notes: "Notatki", stats: "Statystyki", adblock: "Blokowanie treści (globalnie)", on: "Włączone", off: "Wyłączone",
    compact: "Tryb kompaktowy", splitClose: "Zamknij podzielony widok",
  } : {
    title: "Menu", settings: "Settings", newPrivateTab: "New private tab", devTools: "Developer tools", bookmarks: "Bookmarks", addBookmark: "Bookmark current page", removeCurrentBookmark: "Remove current bookmark",
    noBookmarks: "No saved bookmarks", clearBookmarks: "Clear all bookmarks", importBookmarks: "Import bookmarks…", exportBookmarks: "Export bookmarks…", history: "History", downloads: "Downloads",
    siteData: "Site data", language: "Language", polish: "Polish", english: "English", remove: "Remove",
    welcome: "Show welcome", about: "About", notes: "Notes", stats: "Statistics", adblock: "Content blocking (global)", on: "On", off: "Off",
    compact: "Compact mode", splitClose: "Close split view",
  };
  // One "Split with…" submenu: "New tab" first, then the other tabs of the space (same as the tab menu).
  const splitMenuRows = activeTabId !== null && splitRegistry.groupOf(activeTabId)
    ? `<a class="menu-item" href="monobrowser-menu://split-toggle">${copy.splitClose}</a>`
    : activeTabId !== null ? buildSplitWithSubmenu(activeTabId) : "";
  const splitBaseTabId = activeTabId;
  const activeUrl = getBookmarkableUrl(getActiveTab()?.url ?? "");
  const currentBookmark = activeUrl ? findBookmarkByUrl(activeUrl) : undefined;
  const bookmarkRows = bookmarkEntries.map((bookmark) => `
    <div class="bookmark-row">
      <a class="menu-item" href="monobrowser-menu://bookmark-open?id=${encodeURIComponent(bookmark.id)}" title="${escapeHtml(bookmark.url)}"><span class="bookmark-title">${escapeHtml(getBookmarkMenuLabel(bookmark))}</span></a>
      <a class="menu-item remove" href="monobrowser-menu://bookmark-remove?id=${encodeURIComponent(bookmark.id)}" title="${copy.remove}" aria-label="${copy.remove}">×</a>
    </div>`).join("");
  const bookmarkToggle = activeUrl
    ? `<a class="menu-item" href="monobrowser-menu://bookmark-toggle">${currentBookmark ? copy.removeCurrentBookmark : copy.addBookmark}</a>`
    : `<span class="menu-item disabled">${copy.addBookmark}</span>`;
  const bookmarksContent = bookmarkEntries.length > 0
    ? `<div class="bookmark-list">${bookmarkRows}</div><a class="menu-item danger" href="monobrowser-menu://bookmarks-clear">${copy.clearBookmarks}</a>`
    : `<span class="menu-item disabled">${copy.noBookmarks}</span>`;
  const bookmarkTransfer = `<a class="menu-item" href="monobrowser-menu://bookmarks-import">${copy.importBookmarks}</a>`
    + (bookmarkEntries.length > 0 ? `<a class="menu-item" href="monobrowser-menu://bookmarks-export">${copy.exportBookmarks}</a>` : "");
  const html = `<!doctype html><html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${copy.title}</title><style id="mb-theme">${themeCss(getThemeTokens())}</style><style>${POPUP_MENU_STYLES}</style></head><body>
<nav class="popup nav-popup" aria-label="${copy.title}">
  <h1 class="popup-title">MonoBrowser / ${copy.title}</h1>
  <a class="menu-item" href="monobrowser-menu://settings">${copy.settings}</a>
  <a class="menu-item" href="monobrowser-menu://new-private-tab">${copy.newPrivateTab}<span class="shortcut">Ctrl+Shift+N</span></a>
  <a class="menu-item" href="monobrowser-menu://dev-tools">${copy.devTools}<span class="shortcut">F12</span></a>
  <details><summary>${copy.bookmarks}<span class="summary-count">${bookmarkEntries.length}</span></summary><div class="submenu">${bookmarkToggle}${bookmarksContent}${bookmarkTransfer}</div></details>
  <a class="menu-item" href="monobrowser-menu://history">${copy.history}</a>
  <a class="menu-item" href="monobrowser-menu://downloads">${copy.downloads}</a>
  <a class="menu-item" href="monobrowser-menu://site-data">${copy.siteData}</a>
  <a class="menu-item" href="monobrowser-menu://stats">${copy.stats}</a>
  <a class="menu-item" href="monobrowser-menu://notes">${copy.notes}<span class="shortcut">Ctrl+Shift+M</span></a>
  <a class="menu-item" href="monobrowser-menu://compact-toggle">${copy.compact}<span class="shortcut">${layoutSettings.compactMode ? copy.on : "Ctrl+Shift+C"}</span></a>
  ${splitMenuRows}
  <a class="menu-item" href="monobrowser-menu://welcome">${copy.welcome}</a>
  <a class="menu-item" href="monobrowser-menu://about">${copy.about}</a>
  <a class="menu-item" href="monobrowser-menu://adblock-toggle">${copy.adblock}<span class="shortcut">${adblockEnabled ? copy.on : copy.off}</span></a>
  <details><summary>${copy.language}</summary><div class="submenu">
    <a class="menu-item${appLanguage === "pl" ? " selected" : ""}" href="monobrowser-menu://language?value=pl">${copy.polish}</a>
    <a class="menu-item${appLanguage === "en" ? " selected" : ""}" href="monobrowser-menu://language?value=en">${copy.english}</a>
  </div></details>
</nav>
${POPUP_HEIGHT_REPORT_SCRIPT}</body></html>`;

  return openStyledPopup("navigation", position, 340, 520, html, async (actionUrl) => {
    const action = actionUrl.hostname;
    if (action === "settings") return openSettingsWindow();
    if (action === "new-private-tab") { openNewPrivateTab(); return; }
    if (action === "dev-tools") return toggleActiveTabDevTools();
    if (action === "history") return openInternalPage("history");
    if (action === "downloads") return openInternalPage("downloads");
    if (action === "site-data") return openInternalPage("site-data");
    if (action === "stats") return openInternalPage("stats");
    if (action === "notes") { toggleNotesView(); return; }
    if (action === "compact-toggle") { toggleCompactMode(); return; }
    if (action === "split-toggle") { toggleSplitForActiveTab(); return; }
    if (handleSplitSubmenuAction(splitBaseTabId, actionUrl)) return;
    if (action === "about") return openInternalPage("about");
    if (action === "welcome") return openOnboarding();
    if (action === "adblock-toggle") { await setAdblockEnabled(!adblockEnabled); return; }
    if (action === "bookmark-toggle") return void await toggleActiveBookmark();
    if (action === "bookmarks-clear") return clearBookmarks();
    if (action === "bookmarks-import") return importBookmarksFromFile();
    if (action === "bookmarks-export") return exportBookmarksToFile();
    if (action === "language") {
      const language = normalizeLanguage(actionUrl.searchParams.get("value"));
      if (language) await setApplicationLanguage(language);
      return;
    }
    const bookmark = bookmarkEntries.find((entry) => entry.id === actionUrl.searchParams.get("id"));
    if (!bookmark) return;
    if (action === "bookmark-open") openNewTab(bookmark.url);
    if (action === "bookmark-remove") await removeBookmark(bookmark.id);
  });
};

const formatMemorySize = (kilobytes: number): string => {
  if (!Number.isFinite(kilobytes) || kilobytes <= 0) {
    return appLanguage === "pl" ? "niedostępne" : "unavailable";
  }
  return `${(kilobytes / 1024).toFixed(kilobytes >= 1024 * 100 ? 0 : 1)} MB`;
};

const openSiteInfoMenu = async (anchor: unknown): Promise<boolean> => {
  const position = getMenuAnchor(anchor);
  const tab = getActiveTab();
  if (!mainWindow || mainWindow.isDestroyed() || !position || !tab || !tab.view || tab.view.webContents.isDestroyed()) {
    return false;
  }

  const contents = tab.view.webContents;
  const url = tab.url;
  let parsedUrl: URL | null = null;
  try {
    parsedUrl = new URL(url);
  } catch {
    parsedUrl = null;
  }

  let cookieCount = 0;
  if (parsedUrl && (parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")) {
    try {
      cookieCount = (await contents.session.cookies.get({ url: parsedUrl.href })).length;
    } catch {
      cookieCount = 0;
    }
  }

  if (!mainWindow || mainWindow.isDestroyed() || contents.isDestroyed() || getActiveTab()?.id !== tab.id) {
    return false;
  }

  const rendererMetric = app.getAppMetrics().find((metric) => metric.pid === contents.getOSProcessId());
  const memoryKilobytes = rendererMetric?.memory.workingSetSize ?? 0;
  const isHttps = parsedUrl?.protocol === "https:";
  const isHttp = parsedUrl?.protocol === "http:";
  const isInternal = url === START_PAGE_URL || parsedUrl?.protocol === "data:" || Boolean(tab.internalKind);
  const copy = appLanguage === "pl" ? {
    title: "Informacje o stronie", internal: "Wewnętrzna strona MonoBrowser", secure: "Bezpieczne połączenie HTTPS", insecure: "Niezabezpieczone połączenie HTTP",
    unknown: "Bezpieczeństwo połączenia nieznane", reputation: "HTTPS chroni połączenie, ale MonoBrowser nie skanuje reputacji ani treści witryny.", host: "Witryna",
    cookies: "Pliki cookie", memory: "RAM karty", blocker: "Blokowanie treści", active: "Aktywne", inactive: "Nieaktywne", sandbox: "Sandbox", enabled: "Aktywny",
    zoom: "Powiększenie", state: "Stan", loading: "Ładowanie", ready: "Gotowa", siteData: "Otwórz dane witryn", version: "Wersja",
    blockerLoading: "Ładowanie list…", blockerOff: "Wyłączone globalnie", blockerSiteOff: "Wyłączone na tej stronie", blockerPaused: "Wstrzymane na karcie",
    blockedOnTab: "Zablokowane na tej karcie", blockedTotal: "Zablokowane łącznie", pauseAction: "Wstrzymaj blokowanie na tej karcie", resumeAction: "Wznów blokowanie na tej karcie",
    toggleAction: "Przełącz blokowanie treści (globalnie)",
    siteBlocking: "Blokowanie treści na tej stronie", siteOn: "Włączone", siteOff: "Wyłączone", siteDisabledNote: "Blokowanie jest wyłączone globalnie.",
  } : {
    title: "Page information", internal: "Internal MonoBrowser page", secure: "Secure HTTPS connection", insecure: "Unsecured HTTP connection",
    unknown: "Connection security unknown", reputation: "HTTPS protects the connection, but MonoBrowser does not scan the site's reputation or content.", host: "Site",
    cookies: "Cookies", memory: "Tab RAM", blocker: "Content blocking", active: "Active", inactive: "Inactive", sandbox: "Sandbox", enabled: "Active",
    zoom: "Zoom", state: "State", loading: "Loading", ready: "Ready", siteData: "Open site data", version: "Version",
    blockerLoading: "Loading lists…", blockerOff: "Disabled globally", blockerSiteOff: "Off on this site", blockerPaused: "Paused for this tab",
    blockedOnTab: "Blocked on this tab", blockedTotal: "Blocked in total", pauseAction: "Pause blocking on this tab", resumeAction: "Resume blocking on this tab",
    toggleAction: "Toggle content blocking (global)",
    siteBlocking: "Content blocking on this site", siteOn: "On", siteOff: "Off", siteDisabledNote: "Blocking is turned off globally.",
  };
  const securityLabel = isInternal ? copy.internal : isHttps ? copy.secure : isHttp ? copy.insecure : copy.unknown;
  const securityClass = isInternal ? "internal" : isHttps ? "secure" : isHttp ? "insecure" : "internal";
  const hostLabel = tab.internalKind
    ? `MonoBrowser / ${tab.internalKind}`
    : parsedUrl?.hostname || (isInternal ? "MonoBrowser / new-tab" : url || "—");
  const exceptionHost = isInternal ? null : getSiteExceptionHost(url);
  const blockerStateFor = (excepted: boolean): string => !adblockEnabled
    ? copy.blockerOff
    : !adblockReady
      ? copy.blockerLoading
      : excepted
        ? copy.blockerSiteOff
        : tab.adblockPaused
          ? copy.blockerPaused
          : copy.active;
  const blockerStateLabel = blockerStateFor(exceptionHost !== null && isHostExcepted(exceptionHost, adblockExceptions));
  const siteExcepted = exceptionHost !== null && isHostExcepted(exceptionHost, adblockExceptions);
  const siteRowLabel = (excepted: boolean): string => `${copy.siteBlocking}: ${excepted ? copy.siteOff : copy.siteOn}`;
  const siteRow = exceptionHost === null ? "" : adblockEnabled
    ? `<a class="info-action" id="site-row" href="monobrowser-menu://adblock-site-toggle?keep=1">${escapeHtml(siteRowLabel(siteExcepted))}</a>`
    : `<div class="notice">${copy.siteBlocking}: ${copy.siteOff}. ${copy.siteDisabledNote}</div>`;
  const blockerActionLabel = tab.adblockPaused ? copy.resumeAction : copy.pauseAction;
  const html = `<!doctype html><html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${copy.title}</title><style id="mb-theme">${themeCss(getThemeTokens())}</style><style>${POPUP_MENU_STYLES}</style></head><body>
<section class="popup site-popup nav-popup"><h1 class="popup-title">${copy.title}</h1><div class="info-body">
  <div class="security ${securityClass}"><strong>${escapeHtml(securityLabel)}</strong><span class="host">${copy.host}: ${escapeHtml(hostLabel)}</span></div>
  ${isInternal ? "" : `<div class="notice">${escapeHtml(copy.reputation)}</div>`}
  <div class="info-grid">
    <div class="info-row"><span>${copy.cookies}</span><strong>${cookieCount}</strong></div>
    <div class="info-row"><span>${copy.memory}</span><strong>${formatMemorySize(memoryKilobytes)}</strong></div>
    <div class="info-row"><span>${copy.blocker}</span><strong id="blocker-state">${escapeHtml(blockerStateLabel)}</strong></div>
    ${isInternal ? "" : `<div class="info-row"><span>${copy.blockedOnTab}</span><strong id="blocked-count">${tab.blockedCount}</strong></div>`}
    <div class="info-row"><span>${copy.blockedTotal}</span><strong id="blocked-total">${statsData.totals.blocked}</strong></div>
    <div class="info-row"><span>${copy.sandbox}</span><strong>${copy.enabled}</strong></div>
    <div class="info-row"><span>${copy.zoom}</span><strong>${Math.round(contents.getZoomFactor() * 100)}%</strong></div>
    <div class="info-row"><span>${copy.state}</span><strong>${contents.isLoading() ? copy.loading : copy.ready}</strong></div>
    <div class="info-row"><span>${copy.version}</span><strong>${app.getVersion()}</strong></div>
  </div>
  ${siteRow}
  ${isInternal ? "" : `<a class="info-action" href="monobrowser-menu://adblock-tab-pause">${escapeHtml(blockerActionLabel)}</a>`}
  <a class="info-action" href="monobrowser-menu://adblock-toggle">${escapeHtml(copy.toggleAction)}</a>
  <a class="info-action" href="monobrowser-menu://site-data">${copy.siteData}</a>
</div></section>${POPUP_HEIGHT_REPORT_SCRIPT}</body></html>`;

  // The toggle keeps the popup open: update the row (state + count) in place, the tab reloads behind it.
  const refreshSiteRow = (token: number): void => {
    if (activePopup?.token !== token || !popupView || popupView.webContents.isDestroyed()) return;
    const excepted = exceptionHost !== null && isHostExcepted(exceptionHost, adblockExceptions);
    void popupView.webContents.executeJavaScript(
      `(() => { const row = document.getElementById('site-row'); if (row) row.textContent = ${JSON.stringify(siteRowLabel(excepted))};
        const state = document.getElementById('blocker-state'); if (state) state.textContent = ${JSON.stringify(blockerStateFor(excepted))};
        const count = document.getElementById('blocked-count'); if (count) count.textContent = ${JSON.stringify(String(tab.blockedCount))};
        const total = document.getElementById('blocked-total'); if (total) total.textContent = ${JSON.stringify(String(statsData.totals.blocked))}; })()`,
      true,
    ).catch(() => undefined);
  };

  return openStyledPopup("site-info", position, 410, isInternal ? 510 : 680, html, async (actionUrl) => {
    if (actionUrl.hostname === "site-data") await openInternalPage("site-data");
    if (actionUrl.hostname === "adblock-toggle") await setAdblockEnabled(!adblockEnabled);
    if (actionUrl.hostname === "adblock-tab-pause") toggleActiveTabAdblockPause();
    if (actionUrl.hostname === "adblock-site-toggle" && exceptionHost) {
      const siteToken = activePopup?.token ?? -1;
      await setAdblockException(exceptionHost, !isHostExcepted(exceptionHost, adblockExceptions));
      tab.blockedCount = 0;
      refreshSiteRow(siteToken);
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.reload();
      // The reloaded page reports its blocked requests a moment later.
      for (const delay of [900, 2500]) setTimeout(() => refreshSiteRow(siteToken), delay);
    }
  });
};

const openPageContextMenu = async (
  tab: TabRecord,
  params: Electron.ContextMenuParams,
): Promise<boolean> => {
  if (!mainWindow || mainWindow.isDestroyed() || !tab.view || tab.view.webContents.isDestroyed()) return false;

  const copy = appLanguage === "pl" ? {
    title: "Menu strony", linkMenu: "Menu linku", imageMenu: "Menu obrazu", link: "Link", image: "Obraz", selection: "Zaznaczenie", editing: "Edycja", page: "Strona", navigation: "Nawigacja",
    openLinkSplit: "Otwórz link w podzielonym widoku",
    openGlance: "Otwórz w Glance", openLinkHere: "Otwórz link w tej karcie", openLink: "Otwórz link w nowej karcie", openLinkBackground: "Otwórz w karcie w tle",
    copyLink: "Kopiuj adres linku", copyLinkText: "Kopiuj tekst linku", saveLink: "Zapisz link jako…",
    openImage: "Otwórz obraz w nowej karcie", copyImage: "Kopiuj adres obrazu", saveImage: "Zapisz obraz jako…",
    searchSelection: "Wyszukaj zaznaczony tekst", copySelection: "Kopiuj zaznaczenie",
    undo: "Cofnij", redo: "Ponów", cut: "Wytnij", copy: "Kopiuj", paste: "Wklej", selectAll: "Zaznacz wszystko",
    addBookmark: "Dodaj stronę do zakładek", removeBookmark: "Usuń stronę z zakładek", copyPageAddress: "Kopiuj adres strony",
    savePage: "Zapisz stronę jako…", print: "Drukuj stronę…", inspect: "Zbadaj element",
    back: "Wstecz", forward: "Dalej", reload: "Odśwież", forceReload: "Odśwież bez pamięci podręcznej",
    savePageTitle: "Zapisz stronę", htmlDocument: "Dokument HTML",
    viewSource: "Pokaż źródło strony", spelling: "Pisownia", addToDictionary: "Dodaj do słownika", noSuggestions: "Brak sugestii",
  } : {
    title: "Page menu", linkMenu: "Link menu", imageMenu: "Image menu", link: "Link", image: "Image", selection: "Selection", editing: "Editing", page: "Page", navigation: "Navigation",
    openLinkSplit: "Open link in split view",
    openGlance: "Open in Glance", openLinkHere: "Open link in this tab", openLink: "Open link in new tab", openLinkBackground: "Open in background tab",
    copyLink: "Copy link address", copyLinkText: "Copy link text", saveLink: "Save link as…",
    openImage: "Open image in new tab", copyImage: "Copy image address", saveImage: "Save image as…",
    searchSelection: "Search selected text", copySelection: "Copy selection",
    undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all",
    addBookmark: "Bookmark this page", removeBookmark: "Remove page bookmark", copyPageAddress: "Copy page address",
    savePage: "Save page as…", print: "Print page…", inspect: "Inspect element",
    back: "Back", forward: "Forward", reload: "Reload", forceReload: "Reload without cache",
    savePageTitle: "Save page", htmlDocument: "HTML document",
    viewSource: "View page source", spelling: "Spelling", addToDictionary: "Add to dictionary", noSuggestions: "No suggestions",
  };
  type ContextGroup = { title: string; items: string[] };
  const action = (name: string, label: string): string =>
    `<a class="menu-item" href="monobrowser-menu://${name}">${escapeHtml(label)}</a>`;
  const groups: ContextGroup[] = [];
  const misspelledWord = params.isEditable ? params.misspelledWord.trim() : "";
  const spellSuggestions = misspelledWord ? params.dictionarySuggestions.slice(0, 5) : [];
  if (misspelledWord) {
    const suggestionItems = spellSuggestions.length
      ? spellSuggestions.map((suggestion, index) => `<a class="menu-item" href="monobrowser-menu://context-spell-replace?i=${index}">${escapeHtml(suggestion)}</a>`)
      : [`<span class="menu-item disabled" aria-disabled="true">${escapeHtml(copy.noSuggestions)}</span>`];
    groups.push({ title: copy.spelling, items: [...suggestionItems, action("context-spell-add", copy.addToDictionary)] });
  }
  const linkUrl = getBookmarkableUrl(params.linkURL);
  if (linkUrl) {
    const items = [
      action("context-open-link-here", copy.openLinkHere),
      ...(glanceSettings.enabled && isHttpUrl(linkUrl) ? [action("context-open-glance", copy.openGlance)] : []),
      action("context-open-link", copy.openLink),
      action("context-open-link-background", copy.openLinkBackground),
      ...(isHttpUrl(linkUrl) ? [action("context-open-link-split", copy.openLinkSplit)] : []),
      action("context-copy-link", copy.copyLink),
    ];
    if (params.linkText.trim()) items.push(action("context-copy-link-text", copy.copyLinkText));
    items.push(action("context-save-link", copy.saveLink));
    groups.push({ title: copy.link, items });
  }

  const imageUrl = params.mediaType === "image" ? getBookmarkableUrl(params.srcURL) : null;
  if (imageUrl) {
    groups.push({ title: copy.image, items: [
      action("context-open-image", copy.openImage),
      action("context-copy-image", copy.copyImage),
      action("context-save-image", copy.saveImage),
    ] });
  }

  const selection = params.selectionText.trim();
  if (selection) {
    groups.push({ title: copy.selection, items: [
      action("context-search-selection", copy.searchSelection),
      action("context-copy-selection", copy.copySelection),
    ] });
  }

  if (params.isEditable) {
    const items: string[] = [];
    if (params.editFlags.canUndo) items.push(action("context-undo", copy.undo));
    if (params.editFlags.canRedo) items.push(action("context-redo", copy.redo));
    if (params.editFlags.canCut) items.push(action("context-cut", copy.cut));
    if (params.editFlags.canCopy) items.push(action("context-copy", copy.copy));
    if (params.editFlags.canPaste) items.push(action("context-paste", copy.paste));
    if (params.editFlags.canSelectAll) items.push(action("context-select-all", copy.selectAll));
    if (items.length) groups.push({ title: copy.editing, items });
  }

  const pageUrl = getBookmarkableUrl(tab.url);
  const pageItems = [action("context-copy-page-address", copy.copyPageAddress)];
  if (pageUrl) pageItems.push(action("context-toggle-bookmark", findBookmarkByUrl(pageUrl) ? copy.removeBookmark : copy.addBookmark));
  pageItems.push(
    action("context-save-page", copy.savePage),
    ...(isHttpUrl(tab.url) ? [action("context-view-source", copy.viewSource)] : []),
    action("context-print", copy.print),
    action("context-inspect", copy.inspect),
  );
  groups.push({ title: copy.page, items: pageItems });

  const navigationItems: string[] = [];
  const contents = tab.view.webContents;
  if (contents.navigationHistory.canGoBack()) navigationItems.push(action("context-back", copy.back));
  if (contents.navigationHistory.canGoForward()) navigationItems.push(action("context-forward", copy.forward));
  navigationItems.push(action("context-reload", copy.reload), action("context-force-reload", copy.forceReload));
  groups.push({ title: copy.navigation, items: navigationItems });

  const columns = Math.min(3, groups.length);
  const rows: ContextGroup[][] = [];
  for (let index = 0; index < groups.length; index += columns) rows.push(groups.slice(index, index + columns));
  const groupsHeight = rows.reduce((height, row) => height + 32 + Math.max(...row.map((group) => group.items.length)) * 34, 0);
  // The header names what was clicked: link menu / image menu with its (shortened) address; plain page menu otherwise.
  const subjectUrl = linkUrl ?? imageUrl ?? "";
  const menuTitle = linkUrl ? copy.linkMenu : imageUrl ? copy.imageMenu : copy.title;
  const subjectText = subjectUrl.length > 90 ? `${subjectUrl.slice(0, 89)}…` : subjectUrl;
  const preferredHeight = 86 + groupsHeight + Math.max(0, rows.length - 1) * 8 + (subjectUrl ? 20 : 0);
  const popupWidth = columns * 260 + 24;
  const groupsHtml = groups.map((group) => `<section class="context-group"><h2>${escapeHtml(group.title)}</h2>${group.items.join("")}</section>`).join("");
  const html = `<!doctype html><html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${menuTitle}</title><style id="mb-theme">${themeCss(getThemeTokens())}</style><style>${POPUP_MENU_STYLES}</style></head><body>
<nav class="popup context-popup" aria-label="${menuTitle}"><h1 class="popup-title">${menuTitle}${subjectUrl ? `<span class="popup-sub" title="${escapeHtml(subjectUrl)}">${escapeHtml(subjectText)}</span>` : ""}</h1><div class="context-groups" style="grid-template-columns:repeat(${columns},minmax(0,1fr))">${groupsHtml}</div></nav></body></html>`;
  // Coordinates are relative to the page view, which is offset in the window (sidebar, second split pane).
  const viewOrigin = tab.view.getBounds();
  const anchor = { x: viewOrigin.x + params.x, y: viewOrigin.y + params.y };

  return openStyledPopup("context", anchor, popupWidth, preferredHeight, html, async (actionUrl) => {
    if (contents.isDestroyed()) return;
    switch (actionUrl.hostname) {
      case "context-open-link-here": await contents.loadURL(linkUrl!); break;
      case "context-open-glance": openGlance(linkUrl!, tab); break;
      case "context-open-link": openNewTab(linkUrl!, tab.isPrivate); break;
      case "context-open-link-background": createTab(linkUrl!, false, tab.isPrivate); break;
      case "context-open-link-split": openSplitWithNewTab(tab.id, linkUrl!); break;
      case "context-copy-link": clipboard.writeText(linkUrl!); break;
      case "context-copy-link-text": clipboard.writeText(params.linkText.trim()); break;
      case "context-save-link": contents.downloadURL(linkUrl!); break;
      case "context-open-image": openNewTab(imageUrl!, tab.isPrivate); break;
      case "context-copy-image": clipboard.writeText(imageUrl!); break;
      case "context-save-image": contents.downloadURL(imageUrl!); break;
      case "context-search-selection": if (!tab.isPrivate) recordSearch(); openNewTab(buildSearchUrl(selection), tab.isPrivate); break;
      case "context-copy-selection": clipboard.writeText(selection); break;
      case "context-undo": contents.undo(); break;
      case "context-redo": contents.redo(); break;
      case "context-cut": contents.cut(); break;
      case "context-copy": contents.copy(); break;
      case "context-paste": contents.paste(); break;
      case "context-select-all": contents.selectAll(); break;
      case "context-copy-page-address": clipboard.writeText(tab.url); break;
      case "context-toggle-bookmark": await toggleActiveBookmark(); break;
      case "context-print": contents.print({}); break;
      case "context-inspect": contents.inspectElement(params.x, params.y); break;
      case "context-back": contents.navigationHistory.goBack(); break;
      case "context-forward": contents.navigationHistory.goForward(); break;
      case "context-reload": contents.reload(); break;
      case "context-force-reload": contents.reloadIgnoringCache(); break;
      case "context-spell-replace": {
        const suggestion = spellSuggestions[Number(actionUrl.searchParams.get("i"))];
        if (suggestion) contents.replaceMisspelling(suggestion);
        break;
      }
      case "context-spell-add": contents.session.addWordToSpellCheckerDictionary(misspelledWord); break;
      case "context-save-page": await savePageAs(tab); break;
      case "context-view-source": viewSourceOfTab(tab); break;
    }
  });
};

// Right-click in an editable field of the shell (the address bar).
const openShellEditContextMenu = async (params: Electron.ContextMenuParams): Promise<boolean> => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  const shell = mainWindow.webContents;
  const copy = appLanguage === "pl" ? {
    title: "Edycja", undo: "Cofnij", redo: "Ponów", cut: "Wytnij", copy: "Kopiuj", paste: "Wklej", selectAll: "Zaznacz wszystko",
  } : {
    title: "Editing", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste", selectAll: "Select all",
  };
  const action = (name: string, label: string): string =>
    `<a class="menu-item" href="monobrowser-menu://${name}">${escapeHtml(label)}</a>`;
  const item = (name: string, label: string, enabled: boolean, shortcut: string): string => enabled
    ? `<a class="menu-item" href="monobrowser-menu://${name}">${escapeHtml(label)}<span class="shortcut">${shortcut}</span></a>`
    : `<span class="menu-item disabled" aria-disabled="true">${escapeHtml(label)}<span class="shortcut">${shortcut}</span></span>`;
  const hasClipboardText = (await clipboard.readText()).length > 0;
  const items: string[] = [
    item("shell-undo", copy.undo, params.editFlags.canUndo, "Ctrl+Z"),
    item("shell-redo", copy.redo, params.editFlags.canRedo, "Ctrl+Shift+Z"),
    item("shell-cut", copy.cut, params.editFlags.canCut, "Ctrl+X"),
    item("shell-copy", copy.copy, params.editFlags.canCopy, "Ctrl+C"),
    item("shell-paste", copy.paste, params.editFlags.canPaste || hasClipboardText, "Ctrl+V"),
    item("shell-select-all", copy.selectAll, params.editFlags.canSelectAll, "Ctrl+A"),
  ];
  const preferredHeight = 66 + items.length * 44;
  const html = `<!doctype html><html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${copy.title}</title><style id="mb-theme">${themeCss(getThemeTokens())}</style><style>${POPUP_MENU_STYLES}</style></head><body>
<nav class="popup context-popup" aria-label="${copy.title}"><h1 class="popup-title">${copy.title}</h1>${items.join("")}</nav></body></html>`;

  return openStyledPopup("context", { x: params.x, y: params.y }, 300, preferredHeight, html, async (actionUrl) => {
    if (shell.isDestroyed()) return;
    // Focus is handed back to the field by closePopup; give it a tick to land.
    await new Promise((resolve) => setTimeout(resolve, 30));
    switch (actionUrl.hostname) {
      case "shell-undo": shell.undo(); break;
      case "shell-redo": shell.redo(); break;
      case "shell-cut": shell.cut(); break;
      case "shell-copy": shell.copy(); break;
      case "shell-paste": shell.paste(); break;
      case "shell-select-all": shell.selectAll(); break;
    }
  }, () => (shell.isDestroyed() ? null : shell));
};

// "Split with…" as ONE submenu (shared by the hamburger and the tab menu): "New tab" first, then the other tabs of the space.
const buildSplitWithSubmenu = (baseTabId: number): string => {
  const pl = appLanguage === "pl";
  const label = pl ? "Podziel widok z…" : "Split with…";
  const newTabLabel = pl ? "Nową kartą" : "New tab";
  const others = getOrderedTabRecords().filter((entry) => entry.id !== baseTabId).slice(0, 14);
  const rows = others.map((entry) => {
    const text = (entry.title || entry.url || "").replace(/\s+/g, " ").trim();
    return `<a class="menu-item" href="monobrowser-menu://split-pick?id=${entry.id}" title="${escapeHtml(text)}"><span class="menu-label">${escapeHtml(text)}</span></a>`;
  }).join("");
  return `<details><summary>${escapeHtml(label)}</summary><div class="submenu"><a class="menu-item" href="monobrowser-menu://split-new">${escapeHtml(newTabLabel)}</a>${rows}</div></details>`;
};

const handleSplitSubmenuAction = (baseTabId: number | null, actionUrl: URL): boolean => {
  if (baseTabId === null) return false;
  if (actionUrl.hostname === "split-new") { openSplitWithNewTab(baseTabId); return true; }
  if (actionUrl.hostname === "split-pick") {
    const otherId = Number(actionUrl.searchParams.get("id"));
    if (Number.isInteger(otherId)) startSplit(baseTabId, otherId);
    return true;
  }
  return false;
};

const openTabContextMenu = async (tabId: number, anchor: unknown): Promise<boolean> => {
  const position = getMenuAnchor(anchor);
  const tab = tabs.get(tabId);
  if (!position || !tab || !mainWindow || mainWindow.isDestroyed()) return false;

  const copy = appLanguage === "pl" ? {
    title: "Menu karty", duplicate: "Duplikuj kartę", pin: "Przypnij kartę", unpin: "Odepnij kartę",
    mute: "Wycisz kartę", unmute: "Włącz dźwięk karty", close: "Zamknij kartę",
    closeOthers: "Zamknij pozostałe karty", closeRight: "Zamknij karty po prawej", reopen: "Przywróć zamkniętą kartę",
    moveToWorkspace: "Przenieś do przestrzeni",
    splitClose: "Zamknij podzielony widok",
  } : {
    title: "Tab menu", duplicate: "Duplicate tab", pin: "Pin tab", unpin: "Unpin tab",
    mute: "Mute tab", unmute: "Unmute tab", close: "Close tab",
    closeOthers: "Close other tabs", closeRight: "Close tabs to the right", reopen: "Reopen closed tab",
    moveToWorkspace: "Move to space",
    splitClose: "Close split view",
  };
  const action = (name: string, label: string): string =>
    `<a class="menu-item" href="monobrowser-menu://${name}">${escapeHtml(label)}</a>`;
  const orderedTabs = getOrderedTabRecords();
  const tabIndex = orderedTabs.findIndex((entry) => entry.id === tab.id);
  const tabsToRight = orderedTabs.slice(tabIndex + 1).filter((entry) => !entry.isPinned);
  const otherClosableTabs = orderedTabs.filter((entry) => entry.id !== tab.id && !entry.isPinned);
  const groups = [
    [
      action("tab-duplicate", copy.duplicate),
      action("tab-toggle-pin", tab.isPinned ? copy.unpin : copy.pin),
      action("tab-toggle-mute", tab.isMuted ? copy.unmute : copy.mute),
    ],
    splitRegistry.groupOf(tab.id)
      ? [action("tab-split-close", copy.splitClose)]
      : [buildSplitWithSubmenu(tab.id)],
    [
      action("tab-close", copy.close),
      ...(otherClosableTabs.length ? [action("tab-close-others", copy.closeOthers)] : []),
      ...(tabsToRight.length ? [action("tab-close-right", copy.closeRight)] : []),
    ],
    ...(workspaces.length > 1 ? [[
      `<div class="menu-heading" role="presentation">${escapeHtml(copy.moveToWorkspace)}</div>`,
      ...workspaces
        .filter((workspace) => workspace.id !== tab.workspaceId)
        .map((workspace) => `<a class="menu-item" href="monobrowser-menu://tab-move-workspace?id=${encodeURIComponent(workspace.id)}">${escapeHtml(`   ${workspace.icon}  ${workspaceDisplayName(workspace, appLanguage)}`)}</a>`),
    ]] : []),
    ...(recentlyClosedTabs.length ? [[action("tab-reopen", copy.reopen)]] : []),
  ];
  const rows = groups.map((group) => group.join("")).join('<div class="menu-separator"></div>');
  const itemCount = groups.reduce((count, group) => count + group.length, 0);
  const preferredHeight = 66 + itemCount * 44 + Math.max(0, groups.length - 1) * 7;
  const html = `<!doctype html><html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${copy.title}</title><style id="mb-theme">${themeCss(getThemeTokens())}</style><style>${POPUP_MENU_STYLES}</style></head><body>
<nav class="popup nav-popup context-popup" aria-label="${copy.title}"><h1 class="popup-title">${copy.title}</h1>${rows}</nav>${POPUP_HEIGHT_REPORT_SCRIPT}</body></html>`;

  return openStyledPopup("context", position, 340, preferredHeight, html, async (actionUrl) => {
    const currentTab = tabs.get(tabId);
    if (handleSplitSubmenuAction(tabId, actionUrl)) return;
    switch (actionUrl.hostname) {
      case "tab-duplicate": if (currentTab) createTab(currentTab.url, true, currentTab.isPrivate); break;
      case "tab-toggle-pin":
        if (currentTab) {
          currentTab.isPinned = !currentTab.isPinned;
          broadcastTabsState();
        }
        break;
      case "tab-toggle-mute":
        if (currentTab) {
          currentTab.isMuted = !currentTab.isMuted;
          const muteContents = getTabContents(currentTab);
          muteContents?.setAudioMuted(currentTab.isMuted);
          broadcastTabsState();
        }
        break;
      case "tab-split-close": closeSplit(tabId); break;
      case "tab-close": requestCloseTab(tabId); break;
      case "tab-close-others":
        if (currentTab) setActiveTab(currentTab.id);
        for (const entry of [...otherClosableTabs]) requestCloseTab(entry.id);
        break;
      case "tab-close-right":
        for (const entry of [...tabsToRight]) requestCloseTab(entry.id);
        break;
      case "tab-reopen": reopenLastClosedTab(); break;
      case "tab-move-workspace": moveTabToWorkspace(tabId, actionUrl.searchParams.get("id")); break;
    }
  });
};

const saveHistory = async (): Promise<void> => {
  await writeJsonAtomically(historyFilePath, historyEntries);
};

const loadHistory = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(historyFilePath, "utf8");
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (Array.isArray(parsed)) {
      historyEntries = parsed;
    }
  } catch {
    historyEntries = [];
  }
};

const appendHistory = async (url: string, title: string): Promise<void> => {
  const origin = normalizeHttpOrigin(url);
  if (!origin) {
    return;
  }

  await registerVisitedOrigin(url);

  if (isDefaultStartPageUrl(url)) {
    return;
  }

  const entry: HistoryEntry = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    url,
    title: title || url,
    visitedAt: new Date().toISOString(),
  };

  historyEntries = [entry, ...historyEntries].slice(0, MAX_HISTORY_ITEMS);
  await saveHistory();
  broadcastHistory();
};

const clearHistory = async (): Promise<void> => {
  historyEntries = [];
  await saveHistory();
  broadcastHistory();
};

const focusAddressBar = (): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const chromeContents = compactChrome?.isEnabled() ? compactChrome.getContents() : null;
  if (compactChrome && chromeContents) {
    // Compact mode: the address bar lives in the revealed overlay.
    compactChrome.reveal();
    focusMainWindowForOverlay();
    chromeContents.focus();
    chromeContents.send("address:focus");
    return;
  }
  mainWindow.webContents.focus();
  mainWindow.webContents.send("address:focus");
};

const clearActiveFindHighlights = async (): Promise<boolean> => {
  const tab = getActiveTab();
  const contents = getTabContents(tab);
  if (!contents) return false;
  try {
    await contents.executeJavaScript(`(() => {
      CSS.highlights?.delete('monobrowser-find-all');
      CSS.highlights?.delete('monobrowser-find-active');
      document.getElementById('monobrowser-find-style')?.remove();
      delete document.documentElement.dataset.monobrowserFindQuery;
      delete document.documentElement.dataset.monobrowserFindIndex;
    })()`, true);
  } catch {
    // The page may have navigated while the find panel was closing.
  }
  return true;
};

const positionFindView = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !findView || findView.webContents.isDestroyed()) return;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const margin = 12;
  // Anchored to the active pane (the whole page area when the view is not split).
  const pane = getActivePaneRect() ?? { x: viewportLeft, y: viewportTop, width: contentWidth - viewportLeft, height: contentHeight - viewportTop };
  const width = Math.min(560, Math.max(320, pane.width - margin * 2));
  const height = 48;
  findView.setBounds({
    x: pane.x + margin,
    y: Math.max(pane.y, pane.y + pane.height - height - margin),
    width,
    height,
  });
};

const hideFindWindow = async (): Promise<void> => {
  findVisible = false;
  positionHudViews();
  const view = findView;
  // Release the slot immediately: a Ctrl+F pressed while the asynchronous
  // cleanup below runs must build a fresh bar instead of finding the old,
  // already hidden one and silently doing nothing.
  findView = null;
  findViewReady = null;
  let findViewRemoved: Promise<void> = Promise.resolve();
  if (view) {
    findViewRemoved = new Promise<void>((resolve) => retireOverlayView(view, () => { detachView(view); resolve(); }));
  }
  const queryPromise = view && !view.webContents.isDestroyed()
    ? view.webContents.executeJavaScript(`document.getElementById('find-input')?.value ?? ""`, true).catch(() => null)
    : Promise.resolve(null);
  await clearActiveFindHighlights();
  // A new bar may have been opened meanwhile; do not steal its focus.
  if (!findVisible) focusActiveTabView();
  if (view && !view.webContents.isDestroyed()) {
    // Stash the query so a recreated find bar can restore it, then destroy:
    // a re-attached WebContentsView can stay composited-hidden (Electron bug
    // family around removeChildView + addChildView), so overlays are never
    // re-attached — they are recreated on the next show.
    try {
      const query = await queryPromise;
      if (typeof query === "string") {
        findBarLastQuery = query;
      }
    } catch {
      // View may already be gone.
    }
    await findViewRemoved;
    if (!view.webContents.isDestroyed()) {
      view.webContents.close();
    }
  }
};

const focusFindBar = (): void => {
  void (async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!findView || findView.webContents.isDestroyed()) {
      const view = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      findView = view;
      view.setBackgroundColor(getThemeTokens().bg);
      trackThemedContents(view.webContents);
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      view.webContents.on("before-input-event", (event, input) => {
        if ((input.type === "keyDown" || input.type === "rawKeyDown") && input.key === "Escape") {
          event.preventDefault();
          void hideFindWindow();
          return;
        }
        handleBeforeInputEvent(event, input);
      });
      // Claim visibility synchronously and let repeated Ctrl+F presses wait
      // for this load instead of attaching a half-loaded view.
      findVisible = true;
      const ready = (async (): Promise<boolean> => {
        try {
          await view.webContents.loadFile(path.join(__dirname, "../renderer/find.html"));
        } catch (error) {
          if (findView === view) {
            findVisible = false;
            findView = null;
          }
          console.error("Failed to load find view:", error);
          return false;
        }
        view.webContents.on("will-navigate", (event) => event.preventDefault());
        return true;
      })();
      findViewReady = ready;
    }
    if (findViewReady && !(await findViewReady)) return;
    if (!findView || findView.webContents.isDestroyed() || !findVisible) {
      return;
    }
    const view = findView;
    positionFindView();
    positionHudViews();
    attachViewOnTop(view);
    focusMainWindowForOverlay();
    view.webContents.focus();
    await view.webContents.executeJavaScript(`(() => {
      document.body.classList.add('mb-in');
      const input = document.getElementById('find-input');
      if (input && !input.value && ${JSON.stringify(findBarLastQuery)}) input.value = ${JSON.stringify(findBarLastQuery)};
      input?.focus();
      input?.select();
      if (input?.value) input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`).catch(() => undefined);
  })();
};

// ── Toast: krótki komunikat w oknie (z opcjonalną akcją) ────────────────────
// Własny, jednorazowy WebContentsView u dołu strony; znika sam po kilku sekundach albo przy zmianie widoków.
const TOAST_WIDTH = 480;
const TOAST_HEIGHT = 66;
const TOAST_DURATION_MS = 7000;
let toastView: WebContentsView | null = null;
let toastTimer: NodeJS.Timeout | null = null;
let toastAction: (() => void) | null = null;

const hideToast = (): void => {
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = null;
  toastAction = null;
  const view = toastView;
  toastView = null;
  if (!view || view.webContents.isDestroyed()) return;
  retireOverlayView(view, () => {
    detachView(view);
    if (!view.webContents.isDestroyed()) view.webContents.close();
  });
};

const positionToast = (): void => {
  if (!toastView || toastView.webContents.isDestroyed()) return;
  const area = getHudPageArea();
  if (!area) return;
  const width = Math.max(200, Math.min(TOAST_WIDTH, area.width - 24));
  toastView.setBounds({
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.max(area.top, Math.round(area.bottom - TOAST_HEIGHT - 14)),
    width,
    height: TOAST_HEIGHT,
  });
};

const showToast = (message: string, action?: { label: string; run: () => void }): void => {
  hideToast();
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  view.setBackgroundColor("#00000000");
  trackThemedContents(view.webContents);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, targetUrl) => {
    event.preventDefault();
    if (toastView !== view) return;
    if (targetUrl.startsWith("monobrowser-menu://toast-action")) {
      const run = toastAction;
      hideToast();
      run?.();
    } else if (targetUrl.startsWith("monobrowser-menu://toast-close")) {
      hideToast();
    }
  });
  const html = `<!doctype html><html lang="${appLanguage}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><title>${escapeHtml(message)}</title><style id="mb-theme">${themeCss(getThemeTokens())}</style><style>
  :root { ${LEGACY_ALIAS_CSS} font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; }
  * { box-sizing:border-box; }
  html,body { width:100%; height:100%; margin:0; overflow:hidden; background:transparent; user-select:none; }
  body { padding:6px 9px 9px 6px; }
  @keyframes toast-in { from { opacity:0; transform:translateY(8px); } }
  .toast { height:100%; display:flex; align-items:center; gap:12px; padding:0 8px 0 14px; border:2px solid var(--black); background:var(--mb-surface,var(--white)); color:var(--black); box-shadow:4px 4px 0 var(--accent); font-size:13px; line-height:1.3; animation:toast-in var(--mb-dur,160ms) var(--mb-ease,ease) backwards; }
  .toast-text { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; }
  .toast a { flex:0 0 auto; color:inherit; text-decoration:none; }
  .toast-action { padding:7px 12px; border:2px solid var(--black); background:var(--black); color:var(--white)!important; font-size:11px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; cursor:pointer; }
  .toast-action:hover,.toast-action:focus-visible { outline:0; background:var(--accent); color:var(--mb-on-accent)!important; }
  .toast-close { width:28px; height:28px; display:grid; place-items:center; font-size:16px; cursor:pointer; }
  .toast-close:hover { background:var(--mb-surface-2); }
</style></head><body><div class="toast" role="status" aria-live="polite"><span class="toast-text" title="${escapeHtml(message)}">${escapeHtml(message)}</span>${action ? `<a class="toast-action" href="monobrowser-menu://toast-action">${escapeHtml(action.label)}</a>` : ""}<a class="toast-close" href="monobrowser-menu://toast-close" aria-label="${appLanguage === "pl" ? "Zamknij" : "Close"}">×</a></div>${POPUP_MOUSEDOWN_SCRIPT}</body></html>`;
  toastView = view;
  toastAction = action?.run ?? null;
  positionToast();
  mainWindow.contentView.addChildView(view);
  view.setVisible(true);
  void view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(logNavigationError);
  toastTimer = setTimeout(hideToast, TOAST_DURATION_MS);
};

// ── HUD: pasek postępu ładowania i podgląd adresu linku ─────────────────────
// Małe nakładki (WebContentsView bez preloadu) nad stroną; nie przesuwają ani nie zmniejszają strony.
const HUD_STATUS_HEIGHT = 22;
const HUD_PROGRESS_HEIGHT = 2;
let hudProgressView: WebContentsView | null = null;
let hudStatusView: WebContentsView | null = null;
let hudProgressVisible = false;
let hudProgressHideTimer: NodeJS.Timeout | null = null;
let hudStatusText = "";
let hudStatusWidth = 0;
let hudStatusToken = 0;

const createHudView = (html: string): WebContentsView => {
  const view = new WebContentsView({
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  view.setBackgroundColor("#00000000");
  trackThemedContents(view.webContents);
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event) => event.preventDefault());
  view.setVisible(false);
  hudLoadPromises.set(view, view.webContents.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).catch(logNavigationError));
  return view;
};

const createHudViews = (): void => {
  hudProgressView = createHudView(PROGRESS_HUD_HTML);
  hudStatusView = createHudView(STATUS_HUD_HTML);
};

const destroyHudViews = (): void => {
  if (hudProgressHideTimer) clearTimeout(hudProgressHideTimer);
  hudProgressHideTimer = null;
  for (const view of [hudProgressView, hudStatusView]) {
    if (isHudViewAlive(view)) view.webContents.close();
  }
  hudProgressView = null;
  hudStatusView = null;
  hudProgressVisible = false;
  hudStatusText = "";
};

const isHudViewAlive = (view: WebContentsView | null): view is WebContentsView =>
  Boolean(view && view.webContents && !view.webContents.isDestroyed());

const hudLoadPromises = new WeakMap<WebContentsView, Promise<unknown>>();

// Ponownie podpięty WebContentsView bywa trwale ukryty w kompozytorze (błąd Electrona),
// więc HUD nigdy nie jest podpinany drugi raz: gdy nie jest już na wierzchu, tworzymy go od nowa.
const ensureHudOnTop = async (kind: "progress" | "status"): Promise<WebContentsView | null> => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  let view = kind === "progress" ? hudProgressView : hudStatusView;
  const children = mainWindow.contentView.children;
  if (isHudViewAlive(view) && children[children.length - 1] === view) {
    view.setVisible(true);
    return view;
  }
  if (isHudViewAlive(view)) {
    detachView(view);
    view.webContents.close();
  }
  view = createHudView(kind === "progress" ? PROGRESS_HUD_HTML : STATUS_HUD_HTML);
  if (kind === "progress") hudProgressView = view; else hudStatusView = view;
  try { await hudLoadPromises.get(view); } catch { /* strona HUD i tak zostanie sprawdzona niżej */ }
  if (!isHudViewAlive(view) || !mainWindow || mainWindow.isDestroyed()) return null;
  if ((kind === "progress" ? hudProgressView : hudStatusView) !== view) return null;
  return view;
};

const showHudView = (view: WebContentsView): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !isHudViewAlive(view)) return;
  const children = mainWindow.contentView.children;
  if (children[children.length - 1] !== view) {
    mainWindow.contentView.addChildView(view);
    if (isPopupVisible()) attachPopupViewOnTop();
  }
  view.setVisible(true);
  setImmediate(() => {
    if (!view.webContents.isDestroyed()) view.webContents.invalidate();
  });
};

const getHudPageArea = (): { x: number; width: number; bottom: number; top: number } | null => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const htmlFullscreen = htmlFullscreenTabId !== null && htmlFullscreenTabId === activeTabId;
  const pane = htmlFullscreen ? null : getActivePaneRect();
  if (pane) return { x: pane.x, width: pane.width, bottom: pane.y + pane.height, top: pane.y };
  const x = htmlFullscreen ? 0 : viewportLeft;
  return { x, width: Math.max(0, contentWidth - x), bottom: contentHeight, top: htmlFullscreen ? 0 : viewportTop };
};

const positionHudViews = (): void => {
  const area = getHudPageArea();
  if (!area) return;
  const htmlFullscreen = htmlFullscreenTabId !== null && htmlFullscreenTabId === activeTabId;
  if (isHudViewAlive(hudProgressView)) {
    hudProgressView.setBounds({
      x: area.x,
      y: area.top,
      width: area.width,
      height: HUD_PROGRESS_HEIGHT,
    });
  }
  if (isHudViewAlive(hudStatusView) && hudStatusText) {
    const margin = 12;
    // Pasek wyszukiwania zajmuje lewy dolny róg – wtedy podgląd adresu przesuwa się na prawo.
    const rightEdge = notesVisible && notesView && !notesView.webContents.isDestroyed()
      ? notesView.getBounds().x
      : area.x + area.width;
    const maxWidth = Math.max(80, Math.min(area.width - 2, Math.round(area.width * (findVisible ? 0.4 : 0.6))));
    const width = Math.max(40, Math.min(hudStatusWidth + 2, maxWidth));
    hudStatusView.setBounds({
      x: findVisible ? Math.max(area.x, rightEdge - width - margin) : area.x,
      y: area.bottom - HUD_STATUS_HEIGHT,
      width,
      height: HUD_STATUS_HEIGHT,
    });
  }
};

let hudProgressToken = 0;
const startLoadProgress = (): void => {
  if (!isHudViewAlive(hudProgressView) || (htmlFullscreenTabId !== null)) return;
  if (hudProgressHideTimer) {
    clearTimeout(hudProgressHideTimer);
    hudProgressHideTimer = null;
  }
  const token = ++hudProgressToken;
  hudProgressVisible = true;
  void ensureHudOnTop("progress").then((view) => {
    if (!view || token !== hudProgressToken || !hudProgressVisible) return;
    positionHudViews();
    showHudView(view);
    void view.webContents.executeJavaScript("window.__start && window.__start()", true).catch(() => undefined);
  });
};

const finishLoadProgress = (): void => {
  const view = hudProgressView;
  if (!isHudViewAlive(view) || !hudProgressVisible) return;
  hudProgressVisible = false;
  hudProgressToken += 1;
  void view.webContents.executeJavaScript("window.__done && window.__done()", true).catch(() => undefined);
  if (hudProgressHideTimer) clearTimeout(hudProgressHideTimer);
  hudProgressHideTimer = setTimeout(() => {
    hudProgressHideTimer = null;
    if (isHudViewAlive(view) && !hudProgressVisible) view.setVisible(false);
  }, 500);
};

const syncLoadProgressForActiveTab = (): void => {
  if (getActiveTab()?.isLoading) startLoadProgress();
  else finishLoadProgress();
};

const setHoverStatusUrl = (url: string): void => {
  const view = hudStatusView;
  if (!isHudViewAlive(view)) return;
  const token = ++hudStatusToken;
  const text = url.length > 600 ? `${url.slice(0, 600)}…` : url;
  if (!text || htmlFullscreenTabId !== null) {
    hudStatusText = "";
    view.setVisible(false);
    return;
  }
  void (async () => {
    const live = await ensureHudOnTop("status");
    if (!live || token !== hudStatusToken) return;
    const width = await live.webContents.executeJavaScript(`window.__set ? window.__set(${JSON.stringify(text)}) : 0`, true);
    if (token !== hudStatusToken || !isHudViewAlive(live)) return;
    hudStatusText = text;
    hudStatusWidth = typeof width === "number" ? width : 0;
    positionHudViews();
    showHudView(live);
  })().catch(() => undefined);
};

const clearHoverStatus = (): void => setHoverStatusUrl("");

// Po zmianie karty widoki strony lądują na wierzchu – HUD trzeba podnieść ponownie.
const raiseHudViews = (): void => {
  if (hudProgressVisible && isHudViewAlive(hudProgressView)) startLoadProgress();
  if (hudStatusText && isHudViewAlive(hudStatusView)) hudStatusView.setVisible(false);
};

// ── Pełny ekran HTML5 (film, gra): strona zajmuje całe okno bez powłoki ─────────
let htmlFullscreenTabId: number | null = null;
let windowWasFullscreenBeforeHtml = false;

const exitHtmlFullscreenInPage = (tab: TabRecord | undefined): void => {
  const contents = getTabContents(tab);
  void contents?.executeJavaScript("document.fullscreenElement && document.exitFullscreen()", true).catch(() => undefined);
};

const enterHtmlFullscreen = (tab: TabRecord): void => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (htmlFullscreenTabId === null) windowWasFullscreenBeforeHtml = mainWindow.isFullScreen();
  htmlFullscreenTabId = tab.id;
  closePopup(false);
  clearHoverStatus();
  finishLoadProgress();
  if (!mainWindow.isFullScreen()) mainWindow.setFullScreen(true);
  applyActiveViewBounds();
};

const leaveHtmlFullscreen = (tabId: number): void => {
  if (htmlFullscreenTabId === null || htmlFullscreenTabId !== tabId) return;
  htmlFullscreenTabId = null;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!windowWasFullscreenBeforeHtml && mainWindow.isFullScreen()) mainWindow.setFullScreen(false);
  applyActiveViewBounds();
  positionHudViews();
};

// ── Command palette (Ctrl+K) ────────────────────────────────────────────────
type PaletteItem = {
  id: string;
  kind: "command" | "tab";
  label: string;
  hint?: string;
  keywords?: string;
  tabId?: number;
};

const positionPaletteView = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !paletteView || paletteView.webContents.isDestroyed()) return;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const margin = 16;
  const areaWidth = contentWidth - viewportLeft;
  const width = Math.min(520, Math.max(300, areaWidth - margin * 2));
  const maxHeight = Math.max(120, contentHeight - viewportTop - margin * 2);
  const height = Math.max(96, Math.min(paletteViewHeight, maxHeight));
  paletteView.setBounds({
    x: Math.max(0, viewportLeft + Math.round((areaWidth - width) / 2)),
    y: viewportTop + margin,
    width,
    height,
  });
};

const hidePalette = (): void => {
  paletteVisible = false;
  const view = paletteView;
  if (view) {
    // Release the slot at once so a quick re-open builds a fresh palette; the old one fades out first.
    paletteView = null;
    retireOverlayView(view, () => {
      detachView(view);
      // A re-attached WebContentsView can stay composited-hidden (Electron bug
      // family around removeChildView + addChildView), so overlays are never
      // re-attached — they are destroyed here and recreated on the next show.
      if (!view.webContents.isDestroyed()) {
        view.webContents.close();
      }
    });
  }
  focusActiveTabView();
};

const focusPalette = (): void => {
  void (async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!paletteView || paletteView.webContents.isDestroyed()) {
      paletteView = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      paletteView.setBackgroundColor(getThemeTokens().bg);
      trackThemedContents(paletteView.webContents);
      paletteView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      paletteView.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" && input.type !== "rawKeyDown") return;
        if ((input.key || "").toLowerCase() === "escape") {
          event.preventDefault();
          hidePalette();
          return;
        }
        // Ctrl+K toggles through handleBeforeInputEvent as well; global
        // shortcuts (Ctrl+T/W/F/R, …) keep working while the palette has focus.
        handleBeforeInputEvent(event, input);
      });
      // Claim visibility synchronously so a quickly repeated Ctrl+K closes
      // instead of reopening after the async load completes.
      paletteVisible = true;
      markOverlayOpening();
      try {
        await paletteView.webContents.loadFile(path.join(__dirname, "../renderer/palette.html"));
      } catch (error) {
        paletteVisible = false;
        console.error("Failed to load palette view:", error);
        return;
      }
      paletteView.webContents.on("will-navigate", (event) => event.preventDefault());
    }
    if (!paletteView || paletteView.webContents.isDestroyed() || !paletteVisible) {
      return;
    }
    positionPaletteView();
    attachViewOnTop(paletteView);
    focusMainWindowForOverlay();
    paletteView.webContents.focus();
    await paletteView.webContents.executeJavaScript(`(() => {
      document.body.classList.add('mb-in');
      const input = document.getElementById('palette-input');
      input?.focus();
      input?.select();
    })()`).catch(() => undefined);
  })();
};

const togglePalette = (): void => {
  if (paletteVisible) {
    hidePalette();
    return;
  }
  focusPalette();
};

const buildPaletteItems = (): PaletteItem[] => {
  const pl = appLanguage === "pl";
  const items: PaletteItem[] = [
    { id: "new-tab", kind: "command", label: pl ? "Nowa karta" : "New tab", hint: "Ctrl+T", keywords: "nowa karta new tab open otworz" },
    { id: "new-private-tab", kind: "command", label: pl ? "Nowa karta prywatna" : "New private tab", hint: "Ctrl+Shift+N", keywords: "prywatna karta incognito private new tab nowa" },
    { id: "close-tab", kind: "command", label: pl ? "Zamknij kartę" : "Close tab", hint: "Ctrl+W", keywords: "zamknij karte close tab" },
    { id: "reload", kind: "command", label: pl ? "Przeładuj stronę" : "Reload page", hint: "Ctrl+R", keywords: "przeladuj reload odswiez refresh" },
    { id: "back", kind: "command", label: pl ? "Wstecz" : "Back", hint: "Alt+Left", keywords: "wstecz back historia" },
    { id: "forward", kind: "command", label: pl ? "Dalej" : "Forward", hint: "Alt+Right", keywords: "dalej forward" },
    { id: "clear-history", kind: "command", label: pl ? "Wyczyść historię przeglądania" : "Clear browsing history", keywords: "wyczysc historie clear history" },
    { id: "language-pl", kind: "command", label: pl ? "Zmień język: Polski" : "Change language: Polish", hint: appLanguage === "pl" ? "✓" : "", keywords: "jezyk language polski polish pl" },
    { id: "language-en", kind: "command", label: pl ? "Zmień język: Angielski" : "Change language: English", hint: appLanguage === "en" ? "✓" : "", keywords: "jezyk language angielski english en" },
    { id: "engine-google", kind: "command", label: pl ? "Wyszukiwarka: Google" : "Search engine: Google", hint: searchSettings.engine === "google" ? "✓" : "", keywords: "wyszukiwarka search engine google" },
    { id: "engine-duckduckgo", kind: "command", label: pl ? "Wyszukiwarka: DuckDuckGo" : "Search engine: DuckDuckGo", hint: searchSettings.engine === "duckduckgo" ? "✓" : "", keywords: "wyszukiwarka search engine duckduckgo ddg" },
    { id: "open-history", kind: "command", label: pl ? "Otwórz: Historia" : "Open: History", keywords: "otworz historia open history" },
    { id: "open-downloads", kind: "command", label: pl ? "Otwórz: Pobieranie" : "Open: Downloads", keywords: "otworz pobieranie open downloads" },
    { id: "open-site-data", kind: "command", label: pl ? "Otwórz: Dane witryn" : "Open: Site data", keywords: "otworz dane witryn open site data cookies" },
    { id: "open-stats", kind: "command", label: pl ? "Otwórz: Statystyki" : "Open: Statistics", keywords: "otworz statystyki stats usage time pobrane zablokowane" },
    { id: "open-settings", kind: "command", label: pl ? "Otwórz: Ustawienia" : "Open: Settings", keywords: "otworz ustawienia open settings preferences" },
    { id: "open-about", kind: "command", label: pl ? "Otwórz: O programie" : "Open: About", keywords: "o programie about wersja version aktualizacje updates skroty shortcuts licencje licenses" },
    { id: "show-onboarding", kind: "command", label: pl ? "Pokaż powitanie" : "Show welcome", keywords: "powitanie witaj onboarding welcome intro start pierwsze uruchomienie first run" },
    { id: "toggle-notes", kind: "command", label: pl ? "Przełącz notatki" : "Toggle notes", hint: "Ctrl+Shift+M", keywords: "notatki notes notatnik" },
    {
      id: "toggle-compact-mode",
      kind: "command",
      label: pl ? "Przełącz tryb kompaktowy" : "Toggle compact mode",
      hint: layoutSettings.compactMode ? (pl ? "włączony" : "on") : "Ctrl+Shift+C",
      keywords: "tryb kompaktowy compact mode zen arc ukryj pasek hide toolbar sidebar",
    },
    { id: "sleep-other-tabs", kind: "command", label: pl ? "Uśpij pozostałe karty" : "Sleep other tabs", keywords: "uspij karty sleep tabs pamiec memory" },
    {
      id: "toggle-content-blocking",
      kind: "command",
      label: adblockEnabled
        ? (pl ? "Wyłącz blokowanie treści" : "Disable content blocking")
        : (pl ? "Włącz blokowanie treści" : "Enable content blocking"),
      hint: adblockEnabled ? (pl ? "włączony" : "enabled") : (pl ? "wyłączony" : "disabled"),
      keywords: "reklamy adblock blokowanie tresci content blocking ads tracker ghostery easylist",
    },
    {
      id: "toggle-content-blocking-tab",
      kind: "command",
      label: getActiveTab()?.adblockPaused
        ? (pl ? "Wznów blokowanie na tej karcie" : "Resume blocking on this tab")
        : (pl ? "Wstrzymaj blokowanie na tej karcie" : "Pause blocking on this tab"),
      keywords: "wstrzymaj wznow pauza karta pause resume blocking tab",
    },
  ];

  items.push({ id: "workspace-new", kind: "command", label: pl ? "Nowa przestrzeń" : "New space", keywords: "nowa przestrzen new space workspace" });
  for (const workspace of workspaces) {
    const name = workspaceDisplayName(workspace, appLanguage);
    items.push({
      id: `workspace:${workspace.id}`,
      kind: "command",
      label: `${pl ? "Przełącz na przestrzeń" : "Switch to space"} ${name}`,
      hint: workspace.id === currentWorkspaceId ? "✓" : `${workspace.icon} ${workspaceTabCount(workspace.id)}`,
      keywords: `przestrzen przelacz space workspace switch ${name}`,
    });
  }

  if (activeTabId !== null && splitRegistry.groupOf(activeTabId)) {
    items.push({ id: "split-close", kind: "command", label: pl ? "Zamknij podzielony widok" : "Close split view", keywords: "podziel widok split view zamknij close" });
  } else if (activeTabId !== null) {
    items.push({ id: "split-new", kind: "command", label: pl ? "Otwórz w podzielonym widoku (nowa karta)" : "Open in split view (new tab)", keywords: "podziel widok split view nowa karta new tab obok side by side" });
    for (const other of getOrderedTabRecords()) {
      if (other.id === activeTabId) continue;
      items.push({
        id: `split-with:${other.id}`,
        kind: "command",
        label: `${pl ? "Podziel widok z" : "Split with"}: ${other.title || other.url}`,
        keywords: `podziel widok split view side by side obok ${other.url}`,
      });
    }
  }

  for (const tab of getAllOrderedTabRecords()) {
    items.push({
      id: `tab:${tab.id}`,
      kind: "tab",
      label: tab.title || tab.url,
      hint: tab.url,
      keywords: "tab karta " + tab.url,
      tabId: tab.id,
    });
  }

  return items;
};

const executePaletteCommand = async (id: string): Promise<void> => {
  if (id.startsWith("tab:")) {
    const tabId = Number.parseInt(id.slice(4), 10);
    if (Number.isInteger(tabId)) setActiveTab(tabId);
    return;
  }
  if (id.startsWith("split-with:")) {
    const otherId = Number.parseInt(id.slice(11), 10);
    if (activeTabId !== null && Number.isInteger(otherId)) startSplit(activeTabId, otherId);
    return;
  }

  if (id.startsWith("workspace:")) {
    switchWorkspace(id.slice("workspace:".length), true);
    return;
  }

  switch (id) {
    case "workspace-new": createWorkspaceAndSwitch(); break;
    case "new-tab": openNewTab(); break;
    case "new-private-tab": openNewPrivateTab(); break;
    case "close-tab": closeCurrentTab(); break;
    case "reload": reloadActiveTabView(); break;
    case "back": {
      const contents = getTabContents(getActiveTab());
      if (contents?.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      break;
    }
    case "forward": {
      const contents = getTabContents(getActiveTab());
      if (contents?.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
      break;
    }
    case "clear-history": await clearHistory(); break;
    case "language-pl": await setApplicationLanguage("pl"); break;
    case "language-en": await setApplicationLanguage("en"); break;
    case "engine-google":
      await setSearchSettings({ engine: "google", customUrl: searchSettings.customUrl });
      break;
    case "engine-duckduckgo":
      await setSearchSettings({ engine: "duckduckgo", customUrl: searchSettings.customUrl });
      break;
    case "open-history": await openInternalPage("history"); break;
    case "open-downloads": await openInternalPage("downloads"); break;
    case "open-site-data": await openInternalPage("site-data"); break;
    case "open-stats": await openInternalPage("stats"); break;
    case "open-settings": await openSettingsWindow(); break;
    case "open-about": await openInternalPage("about"); break;
    case "show-onboarding": await openOnboarding(); break;
    case "toggle-notes": toggleNotesView(); break;
    case "toggle-compact-mode": toggleCompactMode(); break;
    case "split-new": toggleSplitForActiveTab(); break;
    case "split-close": closeSplit(); break;
    case "sleep-other-tabs": sleepOtherTabs(); break;
    case "toggle-content-blocking":
      await setAdblockEnabled(!adblockEnabled);
      break;
    case "toggle-content-blocking-tab":
      toggleActiveTabAdblockPause();
      break;
    default: break;
  }
};

// ── Side notes overlay ──────────────────────────────────────────────────────
const positionNotesView = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !notesView || notesView.webContents.isDestroyed()) return;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const width = Math.min(NOTES_WIDTH, Math.max(240, contentWidth - viewportLeft - 40 - NOTES_SCROLLBAR_INSET));
  const height = Math.max(120, contentHeight - viewportTop);
  notesView.setBounds({
    x: Math.max(0, contentWidth - width - NOTES_SCROLLBAR_INSET),
    y: viewportTop,
    width,
    height,
  });
};

const saveNotesContent = async (value: unknown): Promise<boolean> => {
  if (typeof value !== "string" || value.length > 2_000_000) {
    return false;
  }

  notesContent = value;
  if (!notesFilePath) {
    return true;
  }

  try {
    await fs.mkdir(path.dirname(notesFilePath), { recursive: true });
    await fs.writeFile(notesFilePath, notesContent, "utf8");
    return true;
  } catch (error) {
    console.error("Failed to save notes:", error);
    return false;
  }
};

const loadNotesContent = async (): Promise<void> => {
  if (!notesFilePath) {
    return;
  }

  try {
    notesContent = await fs.readFile(notesFilePath, "utf8");
  } catch {
    notesContent = "";
  }
};

const hideNotesView = (): void => {
  notesVisible = false;
  const view = notesView;
  // Release the slot at once so a quick re-open builds a fresh view; this one fades out below.
  if (view) notesView = null;
  focusActiveTabView();
  if (view && !view.webContents.isDestroyed()) {
    // Flush the editor content before destroying the view so nothing typed
    // inside the debounce window is lost.
    void view.webContents
      .executeJavaScript(`document.getElementById('notes-editor')?.value ?? ""`, true)
      .then(async (value) => {
        if (typeof value === "string") {
          await saveNotesContent(value);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        // Overlays are never re-attached after detaching (WebContentsView can
        // stay composited-hidden), so destroy and recreate on the next show.
        retireOverlayView(view, () => {
          detachView(view);
          if (!view.webContents.isDestroyed()) view.webContents.close();
        });
      });
  } else if (view) {
    detachView(view);
  }
};

const showNotesView = (): void => {
  void (async () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!notesView || notesView.webContents.isDestroyed()) {
      notesView = new WebContentsView({
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      notesView.setBackgroundColor(getThemeTokens().bg);
      trackThemedContents(notesView.webContents);
      notesView.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      notesView.webContents.on("before-input-event", (event, input) => {
        if (input.type !== "keyDown" && input.type !== "rawKeyDown") return;
        if ((input.key || "").toLowerCase() === "escape") {
          event.preventDefault();
          hideNotesView();
          return;
        }
        // Keep global shortcuts (Ctrl+K/T/W/F/R, F5, Alt+arrows, …) working
        // while the notes editor has keyboard focus.
        handleBeforeInputEvent(event, input);
      });
      // Claim visibility synchronously so a quickly repeated toggle closes
      // instead of reopening after the async load completes.
      notesVisible = true;
      markOverlayOpening();
      try {
        await notesView.webContents.loadFile(path.join(__dirname, "../renderer/notes.html"));
      } catch (error) {
        notesVisible = false;
        console.error("Failed to load notes view:", error);
        return;
      }
      notesView.webContents.on("will-navigate", (event) => event.preventDefault());
    }
    if (!notesView || notesView.webContents.isDestroyed() || !notesVisible) {
      notesVisible = false;
      return;
    }
    positionNotesView();
    attachViewOnTop(notesView);
    focusMainWindowForOverlay();
    notesView.webContents.focus();
    void notesView.webContents.executeJavaScript(`(() => {
      document.body.classList.add('mb-in');
      document.getElementById('notes-editor')?.focus();
    })()`).catch(() => undefined);
  })();
};

const toggleNotesView = (): void => {
  if (notesVisible) {
    hideNotesView();
    return;
  }
  showNotesView();
};

const cycleActiveTab = (direction: 1 | -1): void => {
  const tabIds = getOrderedTabRecords().map((tab) => tab.id);
  if (tabIds.length < 2) return;
  const currentIndex = activeTabId === null ? 0 : Math.max(0, tabIds.indexOf(activeTabId));
  const nextIndex = (currentIndex + direction + tabIds.length) % tabIds.length;
  if (setActiveTab(tabIds[nextIndex])) focusActiveTabView();
};

// ── Glance (quick link preview overlay) ─────────────────────────────────────
// Two child views of the main window: a trusted transparent "shell" (dim backdrop,
// rectangular frame and control bar) and, on top of it, the previewed page as a
// plain web view (same session as the source tab, no preload).
const GLANCE_BAR_HEIGHT = 42;
const GLANCE_FRAME_BORDER = 3;

const computeGlanceLayout = (): { area: Electron.Rectangle; frame: Electron.Rectangle } | null => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const [contentWidth, contentHeight] = mainWindow.getContentSize();
  const pane = getActivePaneRect();
  const x = pane ? pane.x : Math.max(0, Math.min(viewportLeft, contentWidth));
  const y = pane ? pane.y : Math.max(0, Math.min(viewportTop, contentHeight));
  const area = pane
    ? { ...pane }
    : { x, y, width: Math.max(0, contentWidth - x), height: Math.max(0, contentHeight - y) };
  const width = Math.min(area.width, Math.max(320, Math.round(area.width * 0.85)));
  const height = Math.min(area.height, Math.max(240, Math.round(area.height * 0.85)));
  const frame = {
    x: Math.round((area.width - width) / 2),
    y: Math.round((area.height - height) / 2),
    width,
    height,
  };
  return { area, frame };
};

const buildGlanceViewState = (record: GlanceRecord) => {
  const pl = appLanguage === "pl";
  const contents = record.view.webContents;
  const layout = computeGlanceLayout();
  const destroyed = contents.isDestroyed();
  return {
    title: destroyed ? "" : contents.getTitle(),
    url: destroyed ? record.requestedUrl : contents.getURL() || record.requestedUrl,
    loading: destroyed ? false : contents.isLoading(),
    frame: layout?.frame ?? { x: 0, y: 0, width: 0, height: 0 },
    barHeight: GLANCE_BAR_HEIGHT,
    labels: pl
      ? { close: "Zamknij (Esc)", expand: "Otwórz w karcie", background: "Otwórz w tle", loading: "Ładowanie…" }
      : { close: "Close (Esc)", expand: "Open as tab", background: "Open in background", loading: "Loading…" },
  };
};

const sendGlanceState = (record: GlanceRecord): void => {
  if (!record.shellReady || record.shell.webContents.isDestroyed()) return;
  record.shell.webContents.send("glance:state", buildGlanceViewState(record));
};

function positionGlance(): void {
  const record = glance;
  const layout = computeGlanceLayout();
  if (!record || !layout) return;
  const { area, frame } = layout;
  record.shell.setBounds(area);
  const inset = GLANCE_FRAME_BORDER;
  record.view.setBounds({
    x: area.x + frame.x + inset,
    y: area.y + frame.y + inset + GLANCE_BAR_HEIGHT,
    width: Math.max(0, frame.width - inset * 2),
    height: Math.max(0, frame.height - inset * 2 - GLANCE_BAR_HEIGHT),
  });
  sendGlanceState(record);
}

function closeGlance(restoreFocus: boolean = true): void {
  const record = glance;
  if (!record) return;
  glance = null;
  detachView(record.view);
  if (!record.view.webContents.isDestroyed()) record.view.webContents.close();
  retireOverlayView(record.shell, () => {
    detachView(record.shell);
    if (!record.shell.webContents.isDestroyed()) record.shell.webContents.close();
  });
  if (restoreFocus) focusActiveTabView();
}

function openGlance(url: string, sourceTab: TabRecord): boolean {
  if (!mainWindow || mainWindow.isDestroyed() || !glanceSettings.enabled) return false;
  if (!isHttpUrl(url) || sourceTab.internalKind || sourceTab.id !== activeTabId || !sourceTab.view) return false;

  closeGlance(false);
  const view = createTabView(sourceTab.isPrivate);
  const shell = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  shell.setBackgroundColor("#00000000");
  trackThemedContents(shell.webContents);
  const record: GlanceRecord = {
    view, shell, sourceTabId: sourceTab.id, isPrivate: sourceTab.isPrivate, requestedUrl: url, favicons: [], shellReady: false,
  };
  glance = record;

  // Once expanded into a tab the view's own tab handlers take over (glance !== record).
  const onInput = (event: Electron.Event, input: Electron.Input): void => {
    if (glance !== record) return;
    if ((input.type === "keyDown" || input.type === "rawKeyDown") && (input.key || "").toLowerCase() === "escape") {
      event.preventDefault();
      closeGlance();
      return;
    }
    handleBeforeInputEvent(event, input);
  };
  const refresh = (): void => {
    if (glance === record) sendGlanceState(record);
  };
  const contents = view.webContents;
  contents.on("before-input-event", onInput);
  for (const eventName of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"] as const) {
    contents.on(eventName as "did-navigate", refresh);
  }
  contents.on("page-favicon-updated", (_event, favicons) => {
    record.favicons = favicons;
  });
  contents.on("render-process-gone", () => {
    if (glance === record) closeGlance();
  });
  wireErrorPages(contents, {
    getLanguage: () => appLanguage,
    isPrivate: () => record.isPrivate,
    goBackOrHome: () => { if (glance === record) closeGlance(); },
    onChanged: refresh,
  });
  wireTabUnloadGuard(contents, () => record.sourceTabId, {
    reveal: () => undefined,
    closeNow: () => { if (glance === record) closeGlance(); },
    onStay: () => undefined,
  });

  shell.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  shell.webContents.on("will-navigate", (event) => event.preventDefault());
  shell.webContents.on("before-input-event", onInput);

  void (async () => {
    markOverlayOpening();
    try {
      await shell.webContents.loadFile(path.join(__dirname, "../renderer/glance.html"));
    } catch (error) {
      console.error("Failed to load glance view:", error);
      if (glance === record) closeGlance();
      return;
    }
    if (glance !== record || !mainWindow || mainWindow.isDestroyed()) return;
    record.shellReady = true;
    positionGlance();
    attachViewOnTop(shell);
    attachViewOnTop(view);
    promptOverlay?.refresh();
    focusMainWindowForOverlay();
    contents.focus();
    shell.webContents.executeJavaScript("document.body.classList.add('mb-in')", true).catch(() => undefined);
    contents.loadURL(url).catch(logNavigationError);
  })();
  return true;
}

// Turns the previewed page into a real tab, keeping the loaded document.
function expandGlance(activate: boolean): boolean {
  const record = glance;
  if (!record || !mainWindow || mainWindow.isDestroyed()) return false;
  const contents = record.view.webContents;
  if (contents.isDestroyed()) {
    closeGlance();
    return false;
  }
  glance = null;
  detachView(record.shell);
  if (!record.shell.webContents.isDestroyed()) record.shell.webContents.close();

  const url = contents.getURL() || record.requestedUrl;
  if (!activate) record.view.setVisible(false);
  const id = createTab(url, activate, record.isPrivate, undefined, record.view);
  const tab = tabs.get(id);
  if (tab) {
    applyGlanceTriggerToContents(contents);
    if (!contents.isLoading() && !tab.isPrivate) {
      recordVisit(contents.getURL());
      void appendHistory(contents.getURL(), contents.getTitle());
    }
    if (record.favicons.length) void loadTabFavicon(tab, contents, record.favicons);
  }
  if (activate) focusActiveTabView();
  return true;
}

// Ctrl+W closes and Ctrl+R / F5 reloads the Glance page instead of the tab behind it.
const handleGlanceShortcut = (event: Electron.Event, key: string, code: string, input: Electron.Input): boolean => {
  const record = glance;
  if (!record || record.view.webContents.isDestroyed()) return false;
  const commandPressed = Boolean(input.control || input.meta);
  if (commandPressed && !input.alt && !input.shift && (key === "w" || code === "keyw")) {
    event.preventDefault();
    closeGlance();
    return true;
  }
  if ((commandPressed && !input.alt && !input.shift && (key === "r" || code === "keyr")) || (!commandPressed && !input.alt && key === "f5")) {
    event.preventDefault();
    record.view.webContents.reload();
    return true;
  }
  return false;
};

const activateTabByNumber = (number: number): void => {
  const tabIds = getOrderedTabRecords().map((tab) => tab.id);
  const targetId = number === 9 ? tabIds.at(-1) : tabIds[number - 1];
  if (targetId !== undefined && setActiveTab(targetId)) focusActiveTabView();
};

const reopenLastClosedTab = (): void => {
  const closed = recentlyClosedTabs.shift();
  if (!closed) return;
  const id = openNewTab(closed.url);
  if (closed.pinned) {
    const tab = tabs.get(id);
    if (tab) tab.isPinned = true;
  }
  broadcastTabsState();
};

const savePageAs = async (tab: TabRecord | null): Promise<void> => {
  const contents = getTabContents(tab);
  if (!tab || !contents || tab.internalKind || !mainWindow || mainWindow.isDestroyed()) return;
  const pl = appLanguage === "pl";
  const fileName = `${getSafeDownloadFileName(tab.title || "page")}.html`;
  const result = await dialog.showSaveDialog(mainWindow, {
    title: pl ? "Zapisz stronę" : "Save page",
    defaultPath: path.join(app.getPath("downloads"), fileName),
    filters: [{ name: pl ? "Dokument HTML" : "HTML document", extensions: ["html", "htm"] }],
  });
  if (!result.canceled && result.filePath && !contents.isDestroyed()) await contents.savePage(result.filePath, "HTMLComplete");
};

const printActiveTab = (): void => {
  const tab = getActiveTab();
  const contents = getTabContents(tab);
  if (contents && tab && !tab.internalKind) contents.print({});
};

const viewSourceOfTab = (tab: TabRecord | null): void => {
  const contents = getTabContents(tab);
  const sourceUrl = contents ? buildViewSourceUrl(contents.getURL()) : null;
  if (sourceUrl && tab) openNewTab(sourceUrl, tab.isPrivate);
};

const toggleActiveTabDevTools = (): void => {
  const tab = getActiveTab();
  const contents = getTabContents(tab);
  if (!contents) return;
  if (contents.isDevToolsOpened()) {
    contents.closeDevTools();
    contents.focus();
    return;
  }
  contents.openDevTools({
    mode: "detach",
    activate: true,
    title: appLanguage === "pl" ? `Narzędzia deweloperskie — ${tab!.title}` : `Developer Tools — ${tab!.title}`,
  });
};

const changeActiveTabZoom = (change: "in" | "out" | "reset"): void => {
  const tab = getActiveTab();
  const contents = getTabContents(tab);
  if (!tab || !contents) return;
  setTabZoom(tab, change === "reset" ? 1 : stepZoom(contents.getZoomFactor(), change));
};

const reloadActiveTabView = (): void => {
  getTabContents(getActiveTab())?.reload();
};

const handleBeforeInputEvent = (
  event: Electron.Event,
  input: Electron.Input,
): void => {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") return;

  const key = (input.key || "").toLowerCase();
  const code = (input.code || "").toLowerCase();
  const commandPressed = Boolean(input.control || input.meta);

  if (key === "escape" && !commandPressed && !input.alt && !input.shift && promptOverlay?.dismissVisible()) {
    event.preventDefault();
    return;
  }

  if (glance && handleGlanceShortcut(event, key, code, input)) return;

  if (!commandPressed && !input.alt && (key === "f5" || key === "f11" || key === "f12")) {
    event.preventDefault();
    if (key === "f5") reloadActiveTabView();
    if (key === "f11" && mainWindow) {
      if (htmlFullscreenTabId !== null) exitHtmlFullscreenInPage(tabs.get(htmlFullscreenTabId));
      else mainWindow.setFullScreen(!mainWindow.isFullScreen());
    }
    if (key === "f12") toggleActiveTabDevTools();
    return;
  }

  if (!commandPressed && input.alt && (key === "arrowleft" || key === "arrowright")) {
    event.preventDefault();
    const contents = getTabContents(getActiveTab());
    if (!contents) return;
    if (key === "arrowleft" && contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
    if (key === "arrowright" && contents.navigationHistory.canGoForward()) contents.navigationHistory.goForward();
    return;
  }

  // Przestrzenie: Ctrl+Alt+1..9 (po kodzie klawisza, niezależnie od układu) i Ctrl+Alt+PageUp/PageDown.
  if (commandPressed && input.alt && !input.shift) {
    const digit = /^digit([1-9])$/.exec(code);
    if (digit) {
      event.preventDefault();
      switchWorkspaceByNumber(Number(digit[1]));
      return;
    }
    if (key === "pageup" || key === "pagedown") {
      event.preventDefault();
      switchWorkspaceRelative(key === "pageup" ? -1 : 1);
      return;
    }
  }

  if (!commandPressed || input.alt) return;

  if (input.shift && (key === "i" || code === "keyi")) {
    event.preventDefault();
    toggleActiveTabDevTools();
    return;
  }
  if (input.shift && (key === "c" || code === "keyc")) {
    event.preventDefault();
    toggleCompactMode();
    return;
  }
  if (input.shift && (key === "m" || code === "keym")) {
    event.preventDefault();
    toggleNotesView();
    return;
  }
  if (key === "f" || code === "keyf") {
    event.preventDefault();
    focusFindBar();
    return;
  }
  if (input.shift && (key === "n" || code === "keyn")) {
    event.preventDefault();
    openNewPrivateTab();
    return;
  }
  if (key === "t" || code === "keyt") {
    event.preventDefault();
    input.shift ? reopenLastClosedTab() : openNewTab();
    return;
  }
  if (key === "w" || code === "keyw") {
    event.preventDefault();
    closeCurrentTab();
    return;
  }
  if (key === "r" || code === "keyr") {
    event.preventDefault();
    reloadActiveTabView();
    return;
  }
  if (!input.shift && (key === "p" || code === "keyp")) {
    event.preventDefault();
    printActiveTab();
    return;
  }
  if (!input.shift && (key === "s" || code === "keys")) {
    event.preventDefault();
    void savePageAs(getActiveTab());
    return;
  }
  if (!input.shift && (key === "u" || code === "keyu")) {
    event.preventDefault();
    viewSourceOfTab(getActiveTab());
    return;
  }
  if (key === "k" || code === "keyk") {
    event.preventDefault();
    if (paletteVisible) {
      hidePalette();
    } else {
      focusPalette();
    }
    return;
  }
  if (key === "l" || code === "keyl") {
    event.preventDefault();
    focusAddressBar();
    return;
  }
  if (key === "d" || code === "keyd") {
    event.preventDefault();
    void toggleActiveBookmark();
    return;
  }
  if (key === "tab" || key === "pagedown" || key === "pageup") {
    event.preventDefault();
    cycleActiveTab(input.shift || key === "pageup" ? -1 : 1);
    return;
  }
  if (/^[1-9]$/.test(key)) {
    event.preventDefault();
    activateTabByNumber(Number(key));
    return;
  }
  if (key === "+" || key === "=" || code === "numpadadd") {
    event.preventDefault();
    changeActiveTabZoom("in");
    return;
  }
  if (key === "-" || code === "numpadsubtract") {
    event.preventDefault();
    changeActiveTabZoom("out");
    return;
  }
  if (key === "0" || code === "numpad0") {
    event.preventDefault();
    changeActiveTabZoom("reset");
  }
};

const registerWindowShortcuts = (windowRef: BrowserWindow): void => {
  windowRef.webContents.on("before-input-event", handleBeforeInputEvent);
};

// ── Compact mode + split view (layout glue; math lives in split-layout.ts / compact-layout.ts) ──
const isCompactMode = (): boolean => Boolean(compactChrome?.isEnabled());

// In compact mode the page fills the window; the chrome is an overlay and does not take space.
const applyEffectiveViewport = (): void => {
  viewportLeft = isCompactMode() ? 0 : reportedViewportLeft;
  viewportTop = isCompactMode() ? 0 : reportedViewportTop;
};

const relayoutViews = (): void => {
  applyActiveViewBounds();
  positionDownloadProgressView();
  positionFindView();
  positionPaletteView();
  positionNotesView();
  positionGlance();
  positionHudViews();
  positionToast();
  promptOverlay?.refresh();
  compactChrome?.refresh();
};

const getPageArea = (): SplitRect | null => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  const [contentWidth, height] = mainWindow.getContentSize();
  const safeTop = Math.max(0, Math.min(viewportTop, Math.max(0, height - 100)));
  const margin = sidebarDragging && !isCompactMode() ? SIDEBAR_DRAG_MARGIN : 0;
  const safeLeft = Math.max(0, Math.min(viewportLeft + margin, Math.max(0, contentWidth - 200)));
  return { x: safeLeft, y: safeTop, width: Math.max(contentWidth - safeLeft, 0), height: Math.max(height - safeTop, 0) };
};

type ActiveSplit = {
  group: SplitGroup;
  activeSide: SplitSide;
  partnerId: number;
  layout: ReturnType<typeof computeSplitLayout>;
};

/** The split the given tab belongs to, laid out inside `area` (null when the tab is not split or its partner is gone). */
const getSplitFor = (tabId: number | null, area: SplitRect | null): ActiveSplit | null => {
  if (tabId === null || !area || htmlFullscreenTabId !== null) return null;
  const group = splitRegistry.groupOf(tabId);
  if (!group) return null;
  const partnerId = group.left === tabId ? group.right : group.left;
  if (!tabs.has(partnerId)) return null;
  return { group, activeSide: group.left === tabId ? "left" : "right", partnerId, layout: computeSplitLayout(area, group.ratio) };
};

const getSplitLabels = (): { drop: string; reset: string } => appLanguage === "pl"
  ? { drop: "Podziel widok", reset: "Przeciągnij, aby zmienić rozmiar — dwuklik: 50/50" }
  : { drop: "Split view", reset: "Drag to resize — double-click: 50/50" };

const ensureSplitFrame = (): SplitFrame | null => {
  if (!mainWindow || mainWindow.isDestroyed()) return null;
  if (splitFrame) return splitFrame;
  splitFrame = createSplitFrame({
    getMainWindow: () => mainWindow,
    preloadPath: path.join(__dirname, "split-frame-preload.js"),
    htmlPath: path.join(__dirname, "../renderer/split-frame.html"),
    onContentsCreated: trackThemedContents,
    onDragStart: () => {
      splitDividerDragging = true;
      applyActiveViewBounds();
    },
    onDragMove: (x) => {
      const group = activeTabId === null ? null : splitRegistry.groupOf(activeTabId);
      const area = getPageArea();
      if (!group || !area) return;
      splitRegistry.setRatio(group.id, ratioFromPointer({ ...area, x: 0, y: 0 }, x));
      applyActiveViewBounds();
    },
    onDragEnd: () => {
      splitDividerDragging = false;
      applyActiveViewBounds();
      broadcastTabsState();
    },
    onDrop: (zone) => {
      const dragged = splitTabDragId;
      splitTabDragId = null;
      splitDropMode = false;
      if (dragged !== null && activeTabId !== null && dragged !== activeTabId && tabs.has(dragged)) {
        if (zone === "left") startSplit(dragged, activeTabId);
        else startSplit(activeTabId, dragged);
      } else {
        refreshActiveStack();
      }
    },
    onReset: () => {
      const group = activeTabId === null ? null : splitRegistry.groupOf(activeTabId);
      if (!group) return;
      splitRegistry.setRatio(group.id, 0.5);
      applyActiveViewBounds();
      broadcastTabsState();
    },
  });
  return splitFrame;
};

let splitDropMode = false;

/** Positions/paints the frame for the current situation: split panes, tab-drop zones, or nothing. */
const syncSplitFrame = (area: SplitRect | null, split: ActiveSplit | null): void => {
  if (!area) return;
  if (splitDropMode) {
    ensureSplitFrame()?.show(area, { mode: "drop", width: area.width, height: area.height, labels: getSplitLabels() }, true);
    compactChrome?.raise();
    return;
  }
  if (!split) {
    splitFrame?.hide();
    return;
  }
  const local = (rect: SplitRect): SplitRect => ({ ...rect, x: rect.x - area.x, y: rect.y - area.y });
  const state: SplitFrameState = {
    mode: "split",
    width: area.width,
    height: area.height,
    left: local(split.layout.left),
    right: local(split.layout.right),
    divider: local(split.layout.divider),
    active: split.activeSide,
    dragging: splitDividerDragging,
    labels: getSplitLabels(),
  };
  ensureSplitFrame()?.show(area, state, false);
};

/** Rect of the active pane (the page area when not split): where find bar, glance and HUD anchor. */
const getActivePaneRect = (): SplitRect | null => {
  const area = getPageArea();
  const split = getSplitFor(activeTabId, area);
  if (split) return split.activeSide === "left" ? split.layout.left : split.layout.right;
  return area;
};

const isSplitPartnerOfActive = (tabId: number): boolean =>
  activeTabId !== null && splitRegistry.partnerOf(activeTabId) === tabId;

const applyActiveViewBounds = (): void => {
  if (!mainWindow || activeTabId === null) {
    return;
  }

  const activeTab = tabs.get(activeTabId);
  if (!activeTab || !activeTab.view) {
    return;
  }

  const [contentWidth, height] = mainWindow.getContentSize();
  if (htmlFullscreenTabId !== null && htmlFullscreenTabId === activeTabId) {
    // Pełny ekran HTML5: strona zajmuje całe okno, powłoka jest zasłonięta.
    activeTab.view.setBounds({ x: 0, y: 0, width: contentWidth, height });
    return;
  }
  const area = getPageArea();
  if (!area) return;
  const split = getSplitFor(activeTabId, area);
  if (split) {
    const partner = tabs.get(split.partnerId);
    const activeRect = split.activeSide === "left" ? split.layout.left : split.layout.right;
    const partnerRect = split.activeSide === "left" ? split.layout.right : split.layout.left;
    activeTab.view.setBounds(activeRect);
    partner?.view?.setBounds(partnerRect);
  } else {
    activeTab.view.setBounds(area);
  }
  syncSplitFrame(area, split);
};

const getTabContents = (tab: TabRecord | null | undefined): WebContents | null => {
  const contents = tab?.view?.webContents;
  return contents && !contents.isDestroyed() ? contents : null;
};

const focusActiveTabView = (): void => {
  // The focus event this raises comes from the app, not from a click.
  programmaticFocusUntil = Date.now() + 400;
  // Another overlay may already be open (e.g. the palette ran "toggle notes"
  // and hides itself right after): keep keyboard focus there.
  if (notesVisible && notesView && !notesView.webContents.isDestroyed()) {
    notesView.webContents.focus();
    return;
  }
  if (paletteVisible && paletteView && !paletteView.webContents.isDestroyed()) {
    paletteView.webContents.focus();
    return;
  }
  if (glance && !glance.view.webContents.isDestroyed()) {
    glance.view.webContents.focus();
    return;
  }
  getTabContents(getActiveTab())?.focus();
};

const updateTabFromWebContents = (tab: TabRecord): void => {
  const contents = getTabContents(tab);

  if (!contents || !tabs.has(tab.id)) {
    return;
  }

  if (tab.internalKind) {
    const internalState = {
      url: internalPageUrl(tab.internalKind),
      title: internalPageTitle(tab.internalKind),
      favicon: internalPageIcon(tab.internalKind),
      isLoading: contents.isLoading(),
      canGoBack: false,
      canGoForward: false,
    };
    const internalChanged = tab.url !== internalState.url || tab.title !== internalState.title || tab.isLoading !== internalState.isLoading;
    Object.assign(tab, internalState);
    if (internalChanged) broadcastTabsState();
    return;
  }

  // An error page (data: URL) shows up as the URL that failed to load.
  const loadedUrl = getFailedUrlForErrorPage(contents.getURL()) ?? contents.getURL();
  const isStartPage = startPageDataUrls.has(loadedUrl);
  const nextState = {
    url: isStartPage ? START_PAGE_URL : loadedUrl || tab.url,
    title: isStartPage
      ? appLanguage === "pl" ? "Nowa karta" : "New Tab"
      : contents.getTitle() || tab.title,
    isLoading: contents.isLoading(),
    canGoBack: contents.navigationHistory.canGoBack(),
    canGoForward: contents.navigationHistory.canGoForward(),
  };

  const changed =
    tab.url !== nextState.url ||
    tab.title !== nextState.title ||
    tab.isLoading !== nextState.isLoading ||
    tab.canGoBack !== nextState.canGoBack ||
    tab.canGoForward !== nextState.canGoForward;

  Object.assign(tab, nextState);

  if (changed) {
    broadcastTabsState();
  }
};

// Ponownie podpięty WebContentsView potrafi zostać "ukryty" w kompozytorze (czarna strona
// po zmianie karty), więc po podpięciu wymuszamy widoczność i ponowne narysowanie.
const revealTabView = (view: WebContentsView): void => {
  view.setVisible(true);
  setImmediate(() => {
    if (!view.webContents.isDestroyed()) {
      applyActiveViewBounds();
      view.webContents.invalidate();
    }
  });
};

const setActiveTab = (id: number): boolean => {
  if (!mainWindow) {
    return false;
  }

  const tab = tabs.get(id);
  if (!tab) {
    return false;
  }

  if (tab.isSleeping) {
    wakeTab(tab);
  }

  if (!tab.view) {
    return false;
  }

  // Split view: the partner pane is shown together with this tab.
  const splitPartnerId = splitRegistry.partnerOf(id);
  const splitPartner = splitPartnerId === null ? undefined : tabs.get(splitPartnerId);
  if (splitPartner?.isSleeping) {
    wakeTab(splitPartner);
  }

  if (glance && activeTabId !== id) {
    closeGlance(false);
  }

  const previousActiveTab = activeTabId === null ? null : tabs.get(activeTabId);
  if (previousActiveTab && previousActiveTab.id !== id) {
    // Moving between the two panes of one split keeps both visible.
    if (previousActiveTab.view && splitPartnerId !== previousActiveTab.id) {
      // Nie odpinamy widoku: ponownie dodany WebContentsView zostaje czarny (błąd kompozytora),
      // dlatego nieaktywne karty tylko ukrywamy.
      previousActiveTab.view.setVisible(false);
      const previousPartnerId = splitRegistry.partnerOf(previousActiveTab.id);
      if (previousPartnerId !== null && previousPartnerId !== id) tabs.get(previousPartnerId)?.view?.setVisible(false);
    }
    previousActiveTab.lastActiveAt = Date.now();
  }
  // Stack: frame (gaps + divider) below the two panes, the active pane last; or no frame at all.
  const stackArea = getPageArea();
  syncSplitFrame(stackArea, getSplitFor(id, stackArea));
  if (splitPartner?.view && splitRegistry.groupOf(id) && !splitDropMode) {
    attachViewOnTop(splitPartner.view);
    revealTabView(splitPartner.view);
  }
  attachViewOnTop(tab.view);
  revealTabView(tab.view);
  compactChrome?.raise();
  if (downloadProgressVisible) {
    attachDownloadProgressView();
  }
  if (findVisible && findView && !findView.webContents.isDestroyed()) {
    attachViewOnTop(findView);
  }
  if (paletteVisible && paletteView && !paletteView.webContents.isDestroyed()) {
    attachViewOnTop(paletteView);
  }
  if (notesVisible && notesView && !notesView.webContents.isDestroyed()) {
    attachViewOnTop(notesView);
  }
  if (htmlFullscreenTabId !== null && htmlFullscreenTabId !== id) {
    // Pełny ekran HTML5 dotyczy jednej karty – zmiana karty go kończy.
    const fullscreenTab = tabs.get(htmlFullscreenTabId);
    leaveHtmlFullscreen(htmlFullscreenTabId);
    exitHtmlFullscreenInPage(fullscreenTab);
  }
  currentWorkspaceId = tab.workspaceId;
  activeTabId = id;
  tab.lastActiveAt = Date.now();
  promoteTabInMruOrder(id);
  resourceLimiter?.notifyTabsChanged();
  applyActiveViewBounds();
  updateTabFromWebContents(tab);
  clearHoverStatus();
  syncLoadProgressForActiveTab();
  raiseHudViews();
  broadcastTabsState();
  promptOverlay?.refresh();

  return true;
};

// ── Split view operations ───────────────────────────────────────────────────
/** Re-runs the stacking of the active tab (its split partner, the frame, overlays). */
const refreshActiveStack = (): void => {
  if (activeTabId !== null) setActiveTab(activeTabId);
};

// Puts the right tab next to the left one in the tab bar so the pair is shown joined.
const makeSplitAdjacent = (leftId: number, rightId: number): void => {
  const left = tabs.get(leftId);
  const right = tabs.get(rightId);
  if (!left || !right || left.isPinned !== right.isPinned) return;
  const ordered = getOrderedTabRecords().filter((tab) => tab.isPinned === left.isPinned && tab.id !== rightId);
  const index = ordered.findIndex((tab) => tab.id === leftId);
  if (index < 0) return;
  moveTab(rightId, ordered[index + 1]?.id ?? null);
};

const startSplit = (leftId: number, rightId: number, ratio?: number): boolean => {
  const leftTab = tabs.get(leftId);
  const rightTab = tabs.get(rightId);
  // A split lives inside one workspace.
  if (!leftTab || !rightTab || leftId === rightId || leftTab.workspaceId !== rightTab.workspaceId) return false;
  // Partners of groups that get dissolved by this one must leave the screen.
  const formerPartners = [leftId, rightId].flatMap((id) => {
    const partner = splitRegistry.partnerOf(id);
    return partner !== null && partner !== leftId && partner !== rightId ? [partner] : [];
  });
  const wasActive = activeTabId;
  if (!splitRegistry.create(leftId, rightId, ratio, leftTab.workspaceId)) return false;
  for (const id of formerPartners) tabs.get(id)?.view?.setVisible(false);
  makeSplitAdjacent(leftId, rightId);
  splitDropMode = false;
  splitTabDragId = null;
  setActiveTab(wasActive === leftId || wasActive === rightId ? wasActive : rightId);
  focusActiveTabView();
  broadcastTabsState();
  return true;
};

const closeSplit = (tabId: number | null = activeTabId): boolean => {
  if (tabId === null) return false;
  const group = splitRegistry.dissolve(tabId);
  if (!group) return false;
  for (const id of [group.left, group.right]) {
    if (id !== activeTabId) tabs.get(id)?.view?.setVisible(false);
  }
  applyActiveViewBounds();
  broadcastTabsState();
  focusActiveTabView();
  return true;
};

/** Opens a new tab beside `tabId` in a split and shows it. */
const openSplitWithNewTab = (tabId: number, url: string = DEFAULT_URL): number | null => {
  const base = tabs.get(tabId);
  if (!base) return null;
  const newId = createTab(url, false, base.isPrivate);
  if (!startSplit(tabId, newId)) return null;
  setActiveTab(newId);
  focusActiveTabView();
  return newId;
};

const toggleSplitForActiveTab = (): void => {
  if (activeTabId === null) return;
  if (splitRegistry.groupOf(activeTabId)) closeSplit(activeTabId);
  else openSplitWithNewTab(activeTabId);
};

// Pane focus: clicking into the partner pane makes it the active tab (address bar, navigation, find).
const onTabViewFocused = (contents: WebContents): void => {
  if (activeTabId === null || Date.now() < programmaticFocusUntil) return;
  const tab = resolveTabByWebContentsId(contents.id);
  if (!tab || tab.id === activeTabId || !isSplitPartnerOfActive(tab.id)) return;
  setActiveTab(tab.id);
};

// Dragging a tab over the page area offers "drop on the left/right half to split".
const setSplitTabDrag = (tabId: number | null): void => {
  const eligible = tabId !== null && tabId !== activeTabId && tabs.has(tabId) && activeTabId !== null && htmlFullscreenTabId === null;
  splitTabDragId = eligible ? tabId : null;
  const next = eligible;
  if (next === splitDropMode) return;
  splitDropMode = next;
  if (next) {
    applyActiveViewBounds();
  } else {
    refreshActiveStack();
  }
};

// Persistence (split-session.ts): URL pairs, matched against the restored tabs at startup.
let splitFilePath = "";
let splitSaveTimer: NodeJS.Timeout | null = null;
let splitSavingEnabled = false;
let lastSplitJson = "";

const buildCurrentSplits = () => buildStoredSplits(
  splitRegistry.groups(),
  Array.from(tabs.values()).map((tab) => ({ id: tab.id, url: tab.url, isPrivate: tab.isPrivate, internal: Boolean(tab.internalKind) })),
);

const scheduleSplitSave = (): void => {
  if (!splitSavingEnabled || splitSaveTimer || !splitFilePath) return;
  splitSaveTimer = setTimeout(() => {
    splitSaveTimer = null;
    const json = JSON.stringify(buildCurrentSplits());
    if (json === lastSplitJson) return;
    lastSplitJson = json;
    writeJsonAtomically(splitFilePath, JSON.parse(json)).catch(() => { lastSplitJson = ""; });
  }, 900);
};

const flushSplitSync = (): void => {
  if (splitSaveTimer) {
    clearTimeout(splitSaveTimer);
    splitSaveTimer = null;
  }
  if (!splitSavingEnabled || !splitFilePath) return;
  try {
    const temporaryPath = `${splitFilePath}.${process.pid}.tmp`;
    fsSync.mkdirSync(path.dirname(splitFilePath), { recursive: true });
    fsSync.writeFileSync(temporaryPath, JSON.stringify(buildCurrentSplits()), "utf8");
    fsSync.renameSync(temporaryPath, splitFilePath);
  } catch (error) {
    console.error("Failed to flush splits:", error);
  }
};

const restoreSplits = async (): Promise<void> => {
  try {
    if (!splitFilePath) return;
    let stored: ReturnType<typeof normalizeStoredSplits>;
    try {
      stored = normalizeStoredSplits(JSON.parse(await fs.readFile(splitFilePath, "utf8")));
    } catch {
      stored = [];
    }
    const restored = Array.from(tabs.values())
      .filter((tab) => !tab.isPrivate && !tab.internalKind)
      .map((tab) => ({ id: tab.id, url: tab.url, workspaceId: tab.workspaceId }));
    for (const split of matchStoredSplits(stored, restored)) {
      splitRegistry.create(split.left, split.right, split.ratio, split.workspaceId);
    }
    if (splitRegistry.groups().length > 0) refreshActiveStack();
  } finally {
    splitSavingEnabled = true;
    scheduleSplitSave();
  }
};

const closeTab = (id: number): boolean => {
  if (!tabs.has(id)) {
    return false;
  }

  if (glance && glance.sourceTabId === id) {
    closeGlance(false);
  }
  promptOverlay?.cancelForTab(id);
  const wasActive = activeTabId === id;
  const tabToClose = tabs.get(id)!;
  // Closing one pane of a split leaves the other as a plain tab (and keeps it on screen).
  const closedSplit = splitRegistry.dissolve(id);
  const splitPartnerAfterClose = closedSplit ? (closedSplit.left === id ? closedSplit.right : closedSplit.left) : null;
  leaveHtmlFullscreen(id);
  // New-tab pages are recorded too (as in Chrome), so Ctrl+Shift+T restores them whichever way they were closed.
  if (tabToClose.url && !tabToClose.isPrivate && !tabToClose.internalKind) {
    recentlyClosedTabs = pushClosedTab(recentlyClosedTabs, {
      url: tabToClose.url,
      title: tabToClose.title,
      pinned: tabToClose.isPinned,
    });
  }
  if (tabToClose.view) {
    detachView(tabToClose.view);
  }
  tabs.delete(id);
  removeTabFromMruOrder(id);
  if (tabToClose.view && !tabToClose.view.webContents.isDestroyed()) {
    tabToClose.view.webContents.close();
  }

  if (tabToClose.isPrivate && !Array.from(tabs.values()).some((tab) => tab.isPrivate)) {
    void clearPrivateSessionData();
  }

  if (tabs.size === 0) {
    activeTabId = null;
  } else if (wasActive) {
    // Po zamknięciu aktywnej karty zostajemy w jej przestrzeni; pusta przestrzeń pokazuje stronę zastępczą.
    const nextId = splitPartnerAfterClose !== null && tabs.has(splitPartnerAfterClose)
      ? splitPartnerAfterClose
      : getMostRecentTabId(tabToClose.workspaceId);
    if (nextId !== null) {
      setActiveTab(nextId);
    } else {
      activeTabId = null;
    }
  }
  if (activeTabId === null) splitFrame?.hide();
  else if (closedSplit && !wasActive) applyActiveViewBounds();

  broadcastTabsState();
  return true;
};

const FAVICON_MAX_BYTES = 64 * 1024;
const FAVICON_CACHE_LIMIT = 300;
const faviconCache = new Map<string, string | null>();

const fetchFaviconDataUrl = async (contents: WebContents, faviconUrl: string): Promise<string | null> => {
  if (faviconUrl.startsWith("data:image/")) {
    return faviconUrl.length <= FAVICON_MAX_BYTES * 2 ? faviconUrl : null;
  }
  if (!isHttpUrl(faviconUrl)) {
    return null;
  }
  if (faviconCache.has(faviconUrl)) {
    return faviconCache.get(faviconUrl) ?? null;
  }

  let result: string | null = null;
  try {
    const response = await contents.session.fetch(faviconUrl, { signal: AbortSignal.timeout(8000) });
    const type = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const isImage = type.startsWith("image/") || (type === "" && /\.(?:ico|png|svg|gif|jpe?g|webp)(?:[?#]|$)/i.test(faviconUrl));
    if (response.ok && isImage) {
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > 0 && buffer.length <= FAVICON_MAX_BYTES) {
        const mime = type.startsWith("image/") ? type : (faviconUrl.toLowerCase().includes(".ico") ? "image/x-icon" : "image/png");
        result = `data:${mime};base64,${buffer.toString("base64")}`;
      }
    }
  } catch {
    result = null;
  }

  if (faviconCache.size >= FAVICON_CACHE_LIMIT) {
    const oldest = faviconCache.keys().next().value as string | undefined;
    if (oldest) faviconCache.delete(oldest);
  }
  faviconCache.set(faviconUrl, result);
  return result;
};

const loadTabFavicon = async (tab: TabRecord, contents: WebContents, candidates: string[]): Promise<void> => {
  const pageUrl = contents.getURL();
  for (const candidate of candidates.slice(0, 4)) {
    const dataUrl = await fetchFaviconDataUrl(contents, candidate);
    // Strona mogła się zmienić w trakcie pobierania.
    if (contents.isDestroyed() || contents.getURL() !== pageUrl) {
      return;
    }
    if (dataUrl) {
      tab.favicon = dataUrl;
      tab.faviconOrigin = getPermissionOrigin(pageUrl);
      broadcastTabsState();
      return;
    }
  }
};

// Tabs whose close was requested through the page's beforeunload handler (see requestCloseTab).
const closeRequestedTabs = new Set<number>();

// Shows the "Leave site?" prompt for a page with a beforeunload handler (see unload-guard.ts).
const wireTabUnloadGuard = (
  contents: WebContents,
  getTabId: () => number | null,
  callbacks: { reveal: () => void; closeNow: () => void; onStay: () => void },
): void => {
  wireUnloadGuard(contents, {
    getLanguage: () => appLanguage,
    getTabId,
    confirmLeave: async (request) => {
      const overlay = promptOverlay;
      if (!overlay) return false;
      const controller = new AbortController();
      const onDestroyed = (): void => controller.abort();
      contents.once("destroyed", onDestroyed);
      try {
        return (await overlay.request(request, controller.signal)).action === "primary";
      } finally {
        contents.removeListener("destroyed", onDestroyed);
      }
    },
    ...callbacks,
  });
};

// User-initiated tab close: runs the page's beforeunload first and only closes the tab if the page lets go.
const requestCloseTab = (id: number): boolean => {
  const tab = tabs.get(id);
  if (!tab) return false;
  const contents = getTabContents(tab);
  if (!contents || tab.internalKind || tab.isSleeping) return closeTab(id);
  if (closeRequestedTabs.has(id)) return true;
  closeRequestedTabs.add(id);
  recordCloseIntent(contents);
  contents.close({ waitForBeforeUnload: true });
  setTimeout(() => {
    // A page that never answers must not keep the tab alive.
    if (tabs.has(id) && closeRequestedTabs.has(id) && !isUnloadPromptOpen(contents)) {
      closeRequestedTabs.delete(id);
      closeTab(id);
    }
  }, 3000);
  return true;
};

const wireTabEvents = (tab: TabRecord, view: WebContentsView): void => {
  const contents = view.webContents;

  if (tab.internalKind) {
    contents.on("before-input-event", handleBeforeInputEvent);
    contents.on("did-start-loading", () => updateTabFromWebContents(tab));
    contents.on("did-stop-loading", () => updateTabFromWebContents(tab));
    contents.on("did-navigate", () => updateTabFromWebContents(tab));
    contents.on("destroyed", () => {
      if (tab.view === view) tab.view = null;
    });
    return;
  }

  contents.on("dom-ready", () => {
    runBackgroundProbeIfStartPage(contents);
    void injectUserScriptsIntoContents(contents, "document-start");
    applyGlanceTriggerToContents(contents);
  });
  contents.on("console-message", (event) => {
    const url = parseGlanceMessage((event as unknown as { message?: unknown }).message, glanceNonce);
    if (url && glanceSettings.enabled && tab.id === activeTabId) {
      openGlance(url, tab);
    }
  });
  contents.on("before-input-event", handleBeforeInputEvent);
  wireErrorPages(contents, {
    getLanguage: () => appLanguage,
    isPrivate: () => tab.isPrivate,
    goBackOrHome: () => {
      if (contents.isDestroyed()) return;
      if (contents.navigationHistory.canGoBack()) contents.navigationHistory.goBack();
      else contents.loadURL(resolveUrlForLoading(DEFAULT_URL)).catch(logNavigationError);
    },
    onChanged: () => updateTabFromWebContents(tab),
    onShown: () => {
      // A failed page has nothing to type into: let the user fix the address right away (also after "Try again").
      if (tab.id === activeTabId && !glance && !paletteVisible && !findVisible && !notesVisible
        && mainWindow && !mainWindow.isDestroyed() && mainWindow.isFocused()) focusAddressBar();
    },
  });
  wireTabUnloadGuard(contents, () => tab.id, {
    reveal: () => {
      if (tabs.has(tab.id) && activeTabId !== tab.id) setActiveTab(tab.id);
    },
    closeNow: () => {
      closeRequestedTabs.delete(tab.id);
      closeTab(tab.id);
    },
    onStay: () => closeRequestedTabs.delete(tab.id),
  });
  contents.on("context-menu", (_event, params) => {
    void openPageContextMenu(tab, params);
  });
  // The start page's own search box navigates the page itself: count it as a search (not in private tabs).
  contents.on("will-navigate", (_event, targetUrl) => {
    if (tab.isPrivate || !isDefaultStartPageUrl(tab.url) && !startPageDataUrls.has(contents.getURL())) return;
    const prefix = getSearchTemplate().split("{query}")[0];
    if (getSearchTemplate().includes("{query}") && prefix && targetUrl.startsWith(prefix) && targetUrl.length > prefix.length) recordSearch();
  });
  contents.on("did-start-navigation", (details) => {
    // A new page starts with a clean "blocked on this tab" count.
    if (details.isMainFrame && !details.isSameDocument) tab.blockedCount = 0;
  });
  contents.on("did-start-loading", () => {
    updateTabFromWebContents(tab);
    if (tab.id === activeTabId) startLoadProgress();
  });
  contents.on("did-stop-loading", () => {
    updateTabFromWebContents(tab);
    if (tab.id === activeTabId) finishLoadProgress();
  });
  contents.on("page-title-updated", () => updateTabFromWebContents(tab));
  contents.on("page-favicon-updated", (_event, favicons) => {
    void loadTabFavicon(tab, contents, favicons);
  });
  contents.on("update-target-url", (_event, url) => {
    if (tab.id === activeTabId) setHoverStatusUrl(url);
  });
  contents.on("audio-state-changed", (event) => {
    tab.isAudible = Boolean((event as unknown as { audible?: boolean }).audible);
    broadcastTabsState();
  });
  // Ctrl + kółko myszy: Electron tylko zgłasza żądanie, powiększenie wykonujemy sami.
  contents.on("zoom-changed", (_event, direction) => {
    setTabZoom(tab, stepZoom(contents.getZoomFactor(), direction === "in" ? "in" : "out"));
  });
  contents.on("enter-html-full-screen", () => enterHtmlFullscreen(tab));
  contents.on("leave-html-full-screen", () => leaveHtmlFullscreen(tab.id));
  contents.on("dom-ready", () => applyStoredZoom(tab, contents));
  contents.on("did-navigate", () => {
    if (tab.favicon && getPermissionOrigin(contents.getURL()) !== tab.faviconOrigin) {
      tab.favicon = null;
      tab.faviconOrigin = null;
    }
    applyStoredZoom(tab, contents);
    if (tab.id === activeTabId) clearHoverStatus();
    updateTabFromWebContents(tab);
    if (!tab.isPrivate) {
      recordVisit(contents.getURL());
    }
    executedUserScriptKeys.delete(contents);
  });
  contents.on("did-navigate-in-page", () => {
    updateTabFromWebContents(tab);
    void injectUserScriptsIntoContents(contents, "document-idle");
  });
  contents.on("did-finish-load", async () => {
    updateTabFromWebContents(tab);
    void updateStartPageBackgroundFromContents(contents);
    void injectUserScriptsIntoContents(contents, "document-idle");
    if (!tab.isPrivate) {
      await appendHistory(contents.getURL(), contents.getTitle());
    }
  });
  contents.on("destroyed", () => {
    if (tab.view === view) {
      tab.view = null;
    }
    // The page agreed to unload after a close request (see requestCloseTab): finish removing the tab.
    if (closeRequestedTabs.delete(tab.id)) {
      detachView(view);
      closeTab(tab.id);
    }
  });
};

const createTab = (
  initialUrl: string = DEFAULT_URL,
  makeActive: boolean = true,
  isPrivate: boolean = false,
  internalKind?: InternalKind,
  existingView?: WebContentsView,
): number => {
  const id = nextTabId++;
  const normalizedInitialUrl = internalKind ? internalPageUrl(internalKind) : normalizeInputToUrl(initialUrl);
  // existingView: an already loaded view (expanded Glance) that becomes the tab as is.
  const view = existingView ?? createTabView(isPrivate, Boolean(internalKind));

  if (isDefaultStartPageUrl(normalizedInitialUrl)) {
    applyStartPageBackgroundToView(view);
  }

  const tab: TabRecord = {
    id,
    title: internalKind ? internalPageTitle(internalKind) : (appLanguage === "pl" ? "Nowa karta" : "New Tab"),
    url: normalizedInitialUrl,
    internalKind,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isPinned: false,
    isMuted: false,
    isSleeping: false,
    isPrivate,
    isAudible: false,
    zoom: 1,
    favicon: internalKind ? internalPageIcon(internalKind) : null,
    lastActiveAt: Date.now(),
    adblockPaused: false,
    blockedCount: 0,
    workspaceId: currentWorkspaceId,
    view,
  };

  wireTabEvents(tab, view);

  tabs.set(id, tab);
  appendTabToMruOrder(id);

  if (makeActive) {
    setActiveTab(id);
  } else {
    broadcastTabsState();
  }

  if (existingView) {
    updateTabFromWebContents(tab);
    return id;
  }

  const initialLoad = internalKind
    ? internalPageDataUrl(internalKind)
    : resolveUrlForLoading(normalizedInitialUrl);
  view.webContents.loadURL(initialLoad).catch(logNavigationError);

  return id;
};

// Przywrócona karta w tle powstaje jako uśpiona (bez widoku) – ładuje się dopiero po aktywacji.
const createSleepingTab = (entry: { url: string; title: string; pinned: boolean; muted: boolean; workspaceId?: string }): number => {
  const id = nextTabId++;
  tabs.set(id, {
    id,
    title: entry.title || (appLanguage === "pl" ? "Nowa karta" : "New Tab"),
    url: normalizeInputToUrl(entry.url),
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    isPinned: entry.pinned,
    isMuted: entry.muted,
    isSleeping: true,
    isPrivate: false,
    isAudible: false,
    zoom: 1,
    favicon: null,
    lastActiveAt: Date.now(),
    adblockPaused: false,
    blockedCount: 0,
    workspaceId: entry.workspaceId ?? currentWorkspaceId,
    view: null,
  });
  appendTabToMruOrder(id);
  return id;
};

// Zwraca true, gdy przywrócono co najmniej jedną kartę.
const restoreSession = (session: SessionData): boolean => {
  if (session.tabs.length === 0) return false;
  // Bieżąca przestrzeń jest już ustawiona (bootstrap); jej aktywna karta powstaje jako jedyna "żywa".
  const hasCurrentWorkspaceTabs = session.tabs.some((entry) => entry.workspaceId === currentWorkspaceId);
  const restoredIds = new Map<number, number>();
  session.tabs.forEach((entry, index) => {
    if (hasCurrentWorkspaceTabs && index === session.activeIndex) {
      const id = createTab(entry.url, true, false);
      restoredIds.set(index, id);
      const tab = tabs.get(id);
      if (tab) {
        tab.isPinned = entry.pinned;
        if (entry.title) tab.title = entry.title;
        if (entry.muted) {
          tab.isMuted = true;
          getTabContents(tab)?.setAudioMuted(true);
        }
      }
    } else {
      restoredIds.set(index, createSleepingTab(entry));
    }
  });
  if (!hasCurrentWorkspaceTabs) createTab(DEFAULT_URL, true);
  // Aktywne karty pozostałych przestrzeni trafiają na początek listy MRU (przełączenie wraca do nich).
  const liveId = hasCurrentWorkspaceTabs ? restoredIds.get(session.activeIndex) : undefined;
  for (const workspace of session.workspaces) {
    const id = restoredIds.get(workspace.activeIndex);
    if (workspace.id !== currentWorkspaceId && id !== undefined) promoteTabInMruOrder(id);
  }
  if (liveId !== undefined) promoteTabInMruOrder(liveId);
  broadcastTabsState();
  return true;
};

// ── Sleeping tabs ───────────────────────────────────────────────────────────
// Electron has no webContents.discard() (open upstream issue #38278), so a
// sleeping tab is fully destroyed and recreated from its URL on wake-up.
// In-page JS/form state is intentionally lost.
// `force` (RAM limiter only) also allows pinned and audible tabs; never the active tab, internal pages or loading tabs.
const canTabSleep = (tab: TabRecord, force: boolean = false): boolean => {
  if (tab.isSleeping || tab.id === activeTabId || isSplitPartnerOfActive(tab.id) || tab.internalKind || (!force && tab.isPinned)) {
    return false;
  }

  const contents = getTabContents(tab);
  if (!contents) {
    return false;
  }

  if ((!force && contents.isCurrentlyAudible()) || contents.isLoading() || contents.isDevToolsOpened()) {
    return false;
  }

  return true;
};

const sleepTab = (tab: TabRecord, force: boolean = false): boolean => {
  if (!canTabSleep(tab, force) || !tab.view) {
    return false;
  }

  const contents = tab.view.webContents;
  const currentUrl = contents.getURL();
  // Preserve the real URL of data: start pages as the internal scheme so that
  // wakeTab can regenerate a fresh, localized start page.
  if (currentUrl && !currentUrl.startsWith("data:")) {
    tab.url = currentUrl;
  }

  detachView(tab.view);
  contents.close();
  tab.view = null;
  tab.isSleeping = true;
  tab.isAudible = false;
  tab.isLoading = false;
  tab.canGoBack = false;
  tab.canGoForward = false;
  broadcastTabsState();
  return true;
};

const wakeTab = (tab: TabRecord): WebContentsView | null => {
  if (!tab.isSleeping) {
    return tab.view;
  }

  const view = createTabView(tab.isPrivate);
  if (isDefaultStartPageUrl(tab.url)) {
    applyStartPageBackgroundToView(view);
  }
  if (tab.isMuted) {
    view.webContents.setAudioMuted(true);
  }
  wireTabEvents(tab, view);
  tab.view = view;
  tab.isSleeping = false;
  tab.lastActiveAt = Date.now();
  tab.isLoading = true;
  broadcastTabsState();
  view.webContents.loadURL(resolveUrlForLoading(tab.url)).catch(logNavigationError);

  if (tab.id === activeTabId && mainWindow && !mainWindow.isDestroyed()) {
    attachViewOnTop(view);
    applyActiveViewBounds();
  }

  return view;
};

const sleepOtherTabs = (): number => {
  let sleptCount = 0;
  for (const tab of [...tabs.values()]) {
    if (sleepTab(tab)) {
      sleptCount += 1;
    }
  }
  return sleptCount;
};

const sleepIdleTabs = (): void => {
  const now = Date.now();
  for (const tab of [...tabs.values()]) {
    if (!canTabSleep(tab) || now - tab.lastActiveAt < TAB_SLEEP_AFTER_MS) {
      continue;
    }
    sleepTab(tab);
  }
};

const startTabSleepTimer = (): void => {
  setInterval(() => {
    try {
      sleepIdleTabs();
    } catch (error) {
      console.error("Tab sleep sweep failed:", error);
    }
  }, TAB_SLEEP_SWEEP_INTERVAL_MS);
};

// ── Experimental: RAM / CPU limiters (logic: resource-limiter*.ts) ───────────
const getResourceLimiter = (): ResourceLimiter => {
  if (!resourceLimiter) {
    resourceLimiter = new ResourceLimiter({
      getMetrics: () => app.getAppMetrics(),
      getTabSnapshots: (): TabSnapshot[] =>
        [...tabs.values()].map((tab) => {
          const contents = getTabContents(tab);
          const pid = contents ? contents.getOSProcessId() : 0;
          return {
            id: tab.id,
            pid: pid > 0 ? pid : null,
            lastActiveAt: tab.lastActiveAt,
            pinned: tab.isPinned,
            audible: contents ? contents.isCurrentlyAudible() : false,
            sleeping: tab.isSleeping,
            active: tab.id === activeTabId,
            sleepable: canTabSleep(tab, true),
          };
        }),
      getForegroundPids: () => {
        const backgroundIds = new Set<number>();
        for (const tab of tabs.values()) {
          const contents = getTabContents(tab);
          if (contents && tab.id !== activeTabId) backgroundIds.add(contents.id);
        }
        const pids = new Set<number>();
        for (const contents of webContents.getAllWebContents()) {
          if (contents.isDestroyed() || backgroundIds.has(contents.id)) continue;
          const pid = contents.getOSProcessId();
          if (pid > 0) pids.add(pid);
        }
        return pids;
      },
      sleepTab: (id) => {
        const tab = tabs.get(id);
        return tab ? sleepTab(tab, true) : false;
      },
    });
  }
  return resourceLimiter;
};

const loadExperimentalSettings = async (): Promise<void> => {
  try {
    const raw = await fs.readFile(experimentalSettingsFilePath, "utf8");
    experimentalSettings = normalizeExperimentalSettings(JSON.parse(raw), getSystemInfo());
  } catch {
    experimentalSettings = normalizeExperimentalSettings(null, getSystemInfo());
  }
};

const applyExperimentalSettings = (): void => {
  const wanted = experimentalSettings.ramLimiterEnabled || experimentalSettings.cpuLimiterEnabled || experimentalSettings.cpuLowerBackgroundPriority;
  if (!wanted && !resourceLimiter) return;
  getResourceLimiter().apply(experimentalSettings);
};

const getExperimentalPayload = () => {
  const system = getSystemInfo();
  const activeHardLimitMb = getActiveHardLimitMb();
  return {
    settings: { ...experimentalSettings },
    system: {
      ...system,
      platform: process.platform,
      hardLimitSupported: process.platform === "linux" && isSystemdRunAvailable(),
      activeHardLimitMb,
      hardLimitFailure,
    },
    status: resourceLimiter ? resourceLimiter.getStatus() : getResourceLimiter().getStatus(),
  };
};

const setExperimentalSettings = async (patch: unknown) => {
  experimentalSettings = mergeExperimentalSettings(experimentalSettings, patch, getSystemInfo());
  await writeJsonAtomically(experimentalSettingsFilePath, experimentalSettings);
  applyExperimentalSettings();
  return getExperimentalPayload();
};

// Linux only: with the hard limit enabled, restart once inside a systemd scope that enforces MemoryMax.
// Returns true when the process was relaunched and must exit; false falls back to a normal start.
let hardLimitFailure: "failed" | "unavailable" | null = null;
const relaunchWithHardMemoryLimitIfNeeded = async (): Promise<boolean> => {
  try {
    const settings = normalizeExperimentalSettings(
      JSON.parse(fsSync.readFileSync(experimentalSettingsFilePath, "utf8")),
      getSystemInfo(),
    );
    if (!shouldRelaunchUnderScope({
      platform: process.platform,
      enabled: settings.ramLimiterEnabled,
      hard: settings.ramHardLimit,
      env: process.env,
    })) return false;
    const result = await relaunchUnderMemoryScope(
      settings.ramLimitMb,
      () => app.releaseSingleInstanceLock(),
      () => { app.requestSingleInstanceLock(); },
    );
    if (result === "relaunched") return true;
    hardLimitFailure = result;
    return false;
  } catch {
    return false;
  }
};

const openNewTab = (initialUrl?: string, isPrivate: boolean = false): number => {
  const requestedUrl = initialUrl?.trim();
  const internalKind = requestedUrl ? parseInternalPageUrl(requestedUrl) : null;
  if (internalKind) {
    void openInternalPage(internalKind);
    return getInternalTab(internalKind)?.id ?? activeTabId ?? -1;
  }
  return createTab(requestedUrl || DEFAULT_URL, true, isPrivate);
};

const openNewPrivateTab = (): number => openNewTab(undefined, true);

// beforeTabId === null oznacza koniec własnej grupy (przypięte/nieprzypięte).
const moveTab = (tabId: number, beforeTabId: number | null): boolean => {
  const moving = tabs.get(tabId);
  if (!moving || tabId === beforeTabId) {
    return false;
  }

  // Kolejność dotyczy grupy "ta sama przestrzeń + ten sam stan przypięcia".
  const sameGroup = (id: number) => {
    const tab = tabs.get(id);
    return tab !== undefined && tab.workspaceId === moving.workspaceId && tab.isPinned === moving.isPinned;
  };
  const partnerId = splitRegistry.partnerOf(tabId);
  let before = beforeTabId;
  // Never drop a tab between the two halves of another split: land before the pair instead.
  if (before !== null) {
    const beforePartner = splitRegistry.partnerOf(before);
    const keys = Array.from(tabs.keys());
    if (beforePartner !== null && beforePartner !== tabId && keys.indexOf(beforePartner) === keys.indexOf(before) - 1) before = beforePartner;
  }
  if (before !== null && before === partnerId) {
    // Dropping onto its own partner: keep the pair as it is.
    return false;
  }
  let order = reorderTabIds(Array.from(tabs.keys()), tabId, before, sameGroup);
  if (!order) {
    return false;
  }
  // A split member drags its partner along so the pair stays adjacent (left | right).
  if (partnerId !== null && tabs.has(partnerId) && sameGroup(partnerId)) {
    const group = splitRegistry.groupOf(tabId)!;
    const movingIsLeft = group.left === tabId;
    const rest = order.filter((id) => id !== partnerId);
    const at = rest.indexOf(tabId);
    rest.splice(movingIsLeft ? at + 1 : at, 0, partnerId);
    order = rest;
  }
  const reordered = order.map((id) => tabs.get(id)!);
  tabs.clear();
  for (const tab of reordered) {
    tabs.set(tab.id, tab);
  }
  broadcastTabsState();
  return true;
};

const closeCurrentTab = (): boolean => {
  if (activeTabId === null) {
    return false;
  }

  return requestCloseTab(activeTabId);
};

// ── Przestrzenie (workspaces) ───────────────────────────────────────────────
// Karty innych przestrzeni żyją dalej (i zasypiają jak zwykle), ale nie są pokazywane ani układane.
// Logika czysta: workspaces.ts; HTML okienek: workspace-popups.ts.
const getWorkspace = (id: unknown): Workspace | undefined =>
  typeof id === "string" ? workspaces.find((workspace) => workspace.id === id) : undefined;

const workspaceTabCount = (id: string): number => Array.from(tabs.values()).filter((tab) => tab.workspaceId === id).length;

// The untouched start page a new space is given so it is never empty: it carries no content of its own.
const isPlaceholderTab = (tab: TabRecord): boolean => tab.url === START_PAGE_URL && !tab.isPinned && !tab.internalKind;

/** Tabs the user sees in the space; only a lone untouched start page counts as nothing. */
const workspaceContentTabCount = (id: string): number => {
  const own = Array.from(tabs.values()).filter((tab) => tab.workspaceId === id);
  return own.length === 1 && isPlaceholderTab(own[0]) ? 0 : own.length;
};

// Closes the lone auto-created start page of a space without leaving it in "recently closed".
const discardPlaceholderTabs = (workspaceId: string, exceptTabId?: number): void => {
  const own = Array.from(tabs.values()).filter((tab) => tab.workspaceId === workspaceId && tab.id !== exceptTabId);
  if (own.length !== 1 || !isPlaceholderTab(own[0])) return;
  const savedClosed = recentlyClosedTabs;
  closeTab(own[0].id);
  recentlyClosedTabs = savedClosed;
};

// Przestawia kartę na koniec globalnej kolejności (czyli na koniec swojej grupy).
const appendTabToEndOfOrder = (tab: TabRecord): void => {
  tabs.delete(tab.id);
  tabs.set(tab.id, tab);
};

const switchWorkspace = (id: string, focusPage: boolean = false): boolean => {
  if (!mainWindow || mainWindow.isDestroyed() || !getWorkspace(id)) return false;
  const activeInTarget = activeTabId !== null && tabs.get(activeTabId)?.workspaceId === id;
  if (id === currentWorkspaceId && activeInTarget) return true;
  const target = getMostRecentTabId(id);
  let switched = false;
  if (target !== null) {
    switched = setActiveTab(target);
  } else {
    // Pusta przestrzeń dostaje stronę startową.
    currentWorkspaceId = id;
    createTab(DEFAULT_URL, true);
    switched = true;
  }
  broadcastTabsState();
  if (switched && focusPage) focusActiveTabView();
  return switched;
};

const switchWorkspaceRelative = (direction: 1 | -1): void => {
  const next = adjacentWorkspaceId(workspaces, currentWorkspaceId, direction);
  if (next) switchWorkspace(next, true);
};

const switchWorkspaceByNumber = (number: number): void => {
  const id = workspaceIdByNumber(workspaces, number);
  if (id) switchWorkspace(id, true);
};

const createWorkspaceAndSwitch = (draft: WorkspaceDraft = {}): Workspace | null => {
  const result = addWorkspace(workspaces, draft, appLanguage);
  if (!result) return null;
  workspaces = result.list;
  switchWorkspace(result.workspace.id);
  broadcastTabsState();
  return result.workspace;
};

const updateWorkspaceById = (id: unknown, patch: WorkspaceDraft): boolean => {
  if (typeof id !== "string") return false;
  const next = updateWorkspace(workspaces, id, patch);
  if (!next) return false;
  workspaces = next;
  broadcastTabsState();
  return true;
};

const moveWorkspaceById = (id: unknown, delta: number): boolean => {
  if (typeof id !== "string") return false;
  const next = moveWorkspace(workspaces, id, delta);
  if (!next) return false;
  workspaces = next;
  broadcastTabsState();
  return true;
};

// mode "move": karty przechodzą do przestrzeni głównej; "close": karty są zamykane (trafiają do ostatnio zamkniętych).
const deleteWorkspaceById = (id: unknown, mode: "move" | "close"): boolean => {
  if (typeof id !== "string" || !getWorkspace(id) || id === MAIN_WORKSPACE_ID) return false;
  const next = removeWorkspace(workspaces, id);
  if (!next) return false;
  // Splits belong to their workspace: deleting it removes them (the panes stay as plain tabs or close below).
  for (const group of splitRegistry.dissolveWorkspace(id)) {
    for (const tabId of [group.left, group.right]) {
      if (tabId !== activeTabId) tabs.get(tabId)?.view?.setVisible(false);
    }
  }
  if (currentWorkspaceId === id) switchWorkspace(MAIN_WORKSPACE_ID);
  discardPlaceholderTabs(id);
  const doomed = Array.from(tabs.values()).filter((tab) => tab.workspaceId === id);
  for (const tab of doomed) {
    if (mode === "close") {
      closeTab(tab.id);
    } else {
      tab.workspaceId = MAIN_WORKSPACE_ID;
      appendTabToEndOfOrder(tab);
    }
  }
  workspaces = next;
  broadcastTabsState();
  return true;
};

const moveTabToWorkspace = (tabId: unknown, workspaceId: unknown): boolean => {
  if (typeof tabId !== "number" || typeof workspaceId !== "string") return false;
  const tab = tabs.get(tabId);
  if (!tab || !getWorkspace(workspaceId) || tab.workspaceId === workspaceId) return false;
  const wasActive = tab.id === activeTabId;
  const sourceWorkspaceId = tab.workspaceId;
  // Moving one pane away dissolves the split (a split cannot span two workspaces).
  if (splitRegistry.groupOf(tab.id)) closeSplit(tab.id);
  // A space that only holds its auto-created start page gives it up for the first real tab moved in.
  const targetHadOnlyPlaceholders = workspaceContentTabCount(workspaceId) === 0;
  tab.workspaceId = workspaceId;
  appendTabToEndOfOrder(tab);
  if (targetHadOnlyPlaceholders && !isPlaceholderTab(tab)) discardPlaceholderTabs(workspaceId, tab.id);
  if (wasActive && workspaceId !== sourceWorkspaceId) {
    // Zostajemy w przestrzeni źródłowej: aktywna staje się inna jej karta albo nowa strona startowa.
    const fallback = getMostRecentTabId(sourceWorkspaceId);
    if (fallback !== null) setActiveTab(fallback);
    else createTab(DEFAULT_URL, true);
  }
  broadcastTabsState();
  if (workspaceId !== sourceWorkspaceId) {
    const target = getWorkspace(workspaceId);
    if (target) {
      const name = workspaceDisplayName(target, appLanguage);
      const movedId = tab.id;
      showToast(
        appLanguage === "pl" ? `Przeniesiono do przestrzeni „${name}”` : `Moved to space “${name}”`,
        {
          label: appLanguage === "pl" ? "Przełącz" : "Switch",
          run: () => {
            if (!switchWorkspace(workspaceId, true)) return;
            if (tabs.get(movedId)?.workspaceId === workspaceId) setActiveTab(movedId);
          },
        },
      );
    }
  }
  return true;
};

const workspacePopupContext = (): WorkspacePopupContext => ({
  language: appLanguage,
  themeCss: themeCss(getThemeTokens()),
  popupStyles: POPUP_MENU_STYLES,
  heightScript: POPUP_HEIGHT_REPORT_SCRIPT,
});

const workspaceViews = () => workspaces.map((workspace) => ({ ...workspace, count: workspaceContentTabCount(workspace.id) }));

const openWorkspaceDeleteConfirm = async (id: unknown): Promise<boolean> => {
  const workspace = getWorkspace(id);
  if (!workspace || workspace.id === MAIN_WORKSPACE_ID || !mainWindow || mainWindow.isDestroyed()) return false;
  const mainWorkspace = getWorkspace(MAIN_WORKSPACE_ID) ?? createMainWorkspace();
  const { html, height } = renderWorkspaceDeleteHtml(
    workspacePopupContext(),
    workspace,
    workspaceContentTabCount(workspace.id),
    workspaceDisplayName(mainWorkspace, appLanguage),
  );
  const width = 400;
  const [contentWidth] = mainWindow.getContentSize();
  return openStyledPopup("message", { x: Math.round((contentWidth - width) / 2), y: 72 }, width, height, html, (actionUrl) => {
    const workspaceId = actionUrl.searchParams.get("id");
    if (actionUrl.hostname === "ws-delete-move") deleteWorkspaceById(workspaceId, "move");
    else if (actionUrl.hostname === "ws-delete-close") deleteWorkspaceById(workspaceId, "close");
  });
};

const handleWorkspacePopupAction = async (actionUrl: URL, anchor: PopupAnchor): Promise<void> => {
  const id = actionUrl.searchParams.get("id") ?? "";
  switch (actionUrl.hostname) {
    case "ws-switch": switchWorkspace(id, true); break;
    case "ws-new": openEditorForNewWorkspace(anchor); break;
    case "ws-edit": await openWorkspaceEditor(id, anchor); break;
    case "ws-left": moveWorkspaceById(id, -1); break;
    case "ws-right": moveWorkspaceById(id, 1); break;
    case "ws-delete": await openWorkspaceDeleteConfirm(id); break;
    case "ws-save":
      updateWorkspaceById(id, {
        name: actionUrl.searchParams.get("name") ?? "",
        icon: actionUrl.searchParams.get("icon") ?? "",
        color: actionUrl.searchParams.get("color") ?? "",
      });
      break;
    default: break;
  }
};

// A new space is created at once and its editor (name / icon / color) opens right away; the popup that triggered it has closed already.
const openEditorForNewWorkspace = (anchor: PopupAnchor | null): Workspace | null => {
  const created = createWorkspaceAndSwitch();
  if (created && anchor) setTimeout(() => void openWorkspaceEditor(created.id, anchor), 220);
  return created;
};

const openWorkspaceEditor = async (id: unknown, anchor: PopupAnchor): Promise<boolean> => {
  const workspace = getWorkspace(id);
  if (!workspace) return false;
  const { html, height } = renderWorkspaceEditorHtml(workspacePopupContext(), workspace);
  return openStyledPopup("context", anchor, 360, height, html, (actionUrl) => handleWorkspacePopupAction(actionUrl, anchor));
};

const openWorkspaceMenu = async (id: unknown, anchorValue: unknown): Promise<boolean> => {
  const workspace = getWorkspace(id);
  const anchor = getMenuAnchor(anchorValue);
  if (!workspace || !anchor) return false;
  const { html, height } = renderWorkspaceMenuHtml(
    workspacePopupContext(),
    workspace,
    { index: workspaces.findIndex((entry) => entry.id === workspace.id), total: workspaces.length },
    layoutSettings.tabBarLayout === "vertical" ? "row" : "column",
  );
  return openStyledPopup("context", anchor, 320, height, html, (actionUrl) => handleWorkspacePopupAction(actionUrl, anchor));
};

const openWorkspaceSwitcher = async (anchorValue: unknown): Promise<boolean> => {
  const anchor = getMenuAnchor(anchorValue);
  if (!anchor) return false;
  const { html, height } = renderWorkspaceSwitcherHtml(workspacePopupContext(), workspaceViews(), currentWorkspaceId);
  return openStyledPopup("workspaces", anchor, 300, height, html, (actionUrl) => handleWorkspacePopupAction(actionUrl, anchor));
};

const getActiveTab = (): TabRecord | null => {
  if (activeTabId === null) {
    return null;
  }

  return tabs.get(activeTabId) ?? null;
};

const AUTO_ALLOWED_PERMISSIONS = new Set([
  "fullscreen",
  "clipboard-sanitized-write",
  "pointerLock",
  "keyboardLock",
]);

const PROMPTED_PERMISSIONS: Record<string, { pl: string; en: string }> = {
  media: { pl: "używać kamery lub mikrofonu", en: "use your camera or microphone" },
  geolocation: { pl: "poznać Twoją lokalizację", en: "know your location" },
  notifications: { pl: "wyświetlać powiadomienia", en: "show notifications" },
  "clipboard-read": { pl: "odczytywać schowek", en: "read your clipboard" },
  "idle-detection": { pl: "wykrywać bezczynność", en: "detect when you are idle" },
};

const permissionDecisions = new Map<string, boolean>();
const privatePermissionDecisions = new Map<string, boolean>();
const pendingPermissionPrompts = new Map<string, Promise<boolean>>();

const promptForPermission = (
  origin: string,
  permission: string,
  decisions: Map<string, boolean>,
  scope: string,
  tabId: number,
  owner: WebContents,
): Promise<boolean> => {
  const key = `${origin}|${permission}`;
  const pendingKey = `${scope}|${key}`;
  const known = decisions.get(key);
  if (known !== undefined) {
    return Promise.resolve(known);
  }

  const pending = pendingPermissionPrompts.get(pendingKey);
  if (pending) {
    return pending;
  }

  const overlay = promptOverlay;
  if (!overlay) {
    return Promise.resolve(false);
  }
  const label = PROMPTED_PERMISSIONS[permission];
  const controller = new AbortController();
  const onDestroyed = (): void => controller.abort();
  owner.once("destroyed", onDestroyed);

  // Allow / Block are remembered until the app closes; dismissing (Escape, tab closed) denies without storing.
  const prompt = overlay.request(buildPermissionRequest(appLanguage, tabId, origin, label[appLanguage]), controller.signal)
    .then((result) => {
      if (result.action === "dismiss") return false;
      const allowed = result.action === "primary";
      decisions.set(key, allowed);
      return allowed;
    })
    .catch(() => false)
    .finally(() => {
      owner.removeListener("destroyed", onDestroyed);
      pendingPermissionPrompts.delete(pendingKey);
    });
  pendingPermissionPrompts.set(pendingKey, prompt);
  return prompt;
};

const getPermissionOrigin = (url: string): string | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.origin : null;
  } catch {
    return null;
  }
};

function setupPermissionHandlers(
  targetSession: Electron.Session,
  decisions: Map<string, boolean> = permissionDecisions,
  scope: string = "default",
): void {
  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    if (AUTO_ALLOWED_PERMISSIONS.has(permission)) {
      callback(true);
      return;
    }
    const origin = getPermissionOrigin(details.requestingUrl || webContents.getURL());
    const ownerTab = resolveTabByWebContentsId(webContents.id);
    if (!origin || !(permission in PROMPTED_PERMISSIONS) || !ownerTab) {
      callback(false);
      return;
    }
    void promptForPermission(origin, permission, decisions, scope, ownerTab.id, webContents).then(callback);
  });

  targetSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) => {
    if (AUTO_ALLOWED_PERMISSIONS.has(permission)) {
      return true;
    }
    // Electron potrafi podać origin z końcowym "/", a decyzje są zapisane jako URL.origin.
    const origin = getPermissionOrigin(requestingOrigin) ?? requestingOrigin;
    return decisions.get(`${origin}|${permission}`) === true;
  });
}

// HTTP authentication (Basic / Digest / NTLM, proxies): asked in the window, for the owning tab only.
// Credentials go straight from the prompt to Chromium's callback; they are never stored or logged.
type AuthAnswer = { username: string; password: string } | null;
const pendingAuthPrompts = createPendingGroups<AuthAnswer>();

const registerAuthHandler = (): void => {
  app.on("login", (event, owner, details, authInfo, callback) => {
    event.preventDefault();
    const ownerTab = owner ? resolveTabByWebContentsId(owner.id) : null;
    const overlay = promptOverlay;
    if (!owner || !ownerTab || !overlay) {
      callback();
      return;
    }
    const isDefaultPort = authInfo.port === 80 || authInfo.port === 443 || !authInfo.port;
    const host = isDefaultPort ? authInfo.host : `${authInfo.host}:${authInfo.port}`;
    const key = authDedupeKey(host, authInfo.realm ?? "", ownerTab.id);
    const isFirst = pendingAuthPrompts.join(key, (answer) => {
      if (answer) callback(answer.username, answer.password);
      else callback();
    });
    if (!isFirst) return;

    // A page's own login (not a subresource's): show where we are going while the prompt is open and hide a stale
    // error/interstitial page, which would otherwise stay visible behind the prompt.
    const isMainFrameAuth = pendingMainFrameUrls.get(owner) === details.url;
    let hiddenStaleView: WebContentsView | null = null;
    if (isMainFrameAuth && !ownerTab.internalKind) {
      ownerTab.url = details.url;
      ownerTab.title = authInfo.host;
      broadcastTabsState();
      if (getFailedUrlForErrorPage(owner.getURL()) !== null && ownerTab.view) {
        hiddenStaleView = ownerTab.view;
        hiddenStaleView.setVisible(false);
      }
    }
    const controller = new AbortController();
    const onDestroyed = (): void => controller.abort();
    owner.once("destroyed", onDestroyed);
    const request = buildAuthRequest({
      lang: appLanguage,
      tabId: ownerTab.id,
      host,
      realm: authInfo.realm ?? "",
      isProxy: authInfo.isProxy,
      scheme: authInfo.scheme,
      secure: authInfo.isProxy || /^https:/i.test(details.url),
    });
    void overlay.request(request, controller.signal)
      .then((result) => (result.action === "primary"
        ? { username: result.username ?? "", password: result.password ?? "" }
        : null))
      .catch(() => null)
      .then((answer) => {
        owner.removeListener("destroyed", onDestroyed);
        if (hiddenStaleView && !hiddenStaleView.webContents.isDestroyed() && ownerTab.view === hiddenStaleView
          && (ownerTab.id === activeTabId || isSplitPartnerOfActive(ownerTab.id))) {
          revealTabView(hiddenStaleView);
        }
        pendingAuthPrompts.resolve(key, answer);
        // Cancel / success: the response (or its error page) commits next; make sure the tab reflects it.
        setTimeout(() => updateTabFromWebContents(ownerTab), 300);
      });
  });
};

// Kanały IPC są dostępne wyłącznie dla własnych okien aplikacji (file:/data:), nigdy dla kart z internetu.
const isTrustedIpcSender = (event: IpcMainEvent | IpcMainInvokeEvent): boolean => {
  const senderTab = resolveTabByWebContentsId(event.sender.id);
  const frameUrl = event.senderFrame?.url ?? "";
  if (senderTab) {
    // Zaufany most mają tylko wewnętrzne strony MonoBrowser: główna ramka karty wewnętrznej, strona data:text/html.
    return isInternalKind(senderTab.internalKind)
      && event.senderFrame === event.sender.mainFrame
      && frameUrl.startsWith("data:text/html");
  }
  return frameUrl.startsWith("file:") || frameUrl.startsWith("data:");
};

const handleTrusted = (
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: any[]) => unknown,
): void => {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedIpcSender(event)) {
      console.warn(`Rejected IPC call on "${channel}" from untrusted sender`);
      return undefined;
    }
    return listener(event, ...args);
  });
};

const onTrusted = (
  channel: string,
  listener: (event: IpcMainEvent, ...args: any[]) => void,
): void => {
  ipcMain.on(channel, (event, ...args) => {
    if (isTrustedIpcSender(event)) {
      listener(event, ...args);
    }
  });
};

const registerIpc = (): void => {
  registerPortableIpc(handleTrusted);
  handleTrusted("tabs:create", (_event, initialUrl?: string) => {
    return openNewTab(initialUrl);
  });

  onTrusted("tabs:create-shortcut", (_event, initialUrl?: string) => {
    openNewTab(initialUrl);
  });

  handleTrusted("tabs:move", (_event, tabId: unknown, beforeTabId: unknown) => {
    if (!Number.isInteger(tabId) || !(beforeTabId === null || Number.isInteger(beforeTabId))) {
      return false;
    }
    return moveTab(tabId as number, beforeTabId as number | null);
  });
  handleTrusted("tabs:close", (_event, tabId: number) => {
    return requestCloseTab(tabId);
  });

  onTrusted("tabs:close-shortcut", () => {
    closeCurrentTab();
  });

  handleTrusted("tabs:switch", (_event, tabId: number) => {
    const switched = setActiveTab(tabId);
    broadcastTabsState();
    return switched;
  });

  handleTrusted("workspaces:get", () => getWorkspacesPayload());
  handleTrusted("workspaces:switch", (_event, id: unknown) => typeof id === "string" && switchWorkspace(id));
  handleTrusted("workspaces:create", (_event, anchor?: unknown) => openEditorForNewWorkspace(getMenuAnchor(anchor))?.id ?? null);
  handleTrusted("workspaces:update", (_event, id: unknown, patch: unknown) =>
    typeof patch === "object" && patch !== null && updateWorkspaceById(id, patch as WorkspaceDraft));
  handleTrusted("workspaces:move", (_event, id: unknown, delta: unknown) =>
    typeof delta === "number" && Number.isInteger(delta) && moveWorkspaceById(id, delta));
  handleTrusted("workspaces:delete", (_event, id: unknown) => openWorkspaceDeleteConfirm(id));
  handleTrusted("workspaces:move-tab", (_event, tabId: unknown, workspaceId: unknown) => moveTabToWorkspace(tabId, workspaceId));
  handleTrusted("workspaces:open-switcher", (_event, anchor: unknown) => openWorkspaceSwitcher(anchor));
  handleTrusted("workspaces:open-menu", (_event, id: unknown, anchor: unknown) => openWorkspaceMenu(id, anchor));

  handleTrusted("tabs:get-state", () => {
    return getTabsStatePayload();
  });

  handleTrusted("tabs:open-context-menu", (_event, tabId: unknown, anchor: unknown) => {
    if (typeof tabId !== "number" || !Number.isInteger(tabId)) return false;
    return openTabContextMenu(tabId, anchor);
  });

  handleTrusted("find:start", async (_event, query: unknown, options: unknown) => {
    const tab = getActiveTab();
    if (!tab || typeof query !== "string" || query.length === 0 || query.length > 1000) return null;
    const raw = typeof options === "object" && options !== null
      ? options as { forward?: unknown; findNext?: unknown }
      : {};
    const requestId = nextFindRequestId++;
    const queryJson = JSON.stringify(query);
    const forward = raw.forward !== false;
    const findNext = raw.findNext === true;
    const script = `(() => {
      const query = ${queryJson};
      const root = document.documentElement;
      const allName = 'monobrowser-find-all';
      const activeName = 'monobrowser-find-active';
      if (!globalThis.CSS?.highlights || typeof globalThis.Highlight !== 'function') {
        return { matches: 0, activeMatchOrdinal: 0 };
      }
      let ranges = [...(CSS.highlights.get(allName) || [])];
      if (!${findNext} || root.dataset.monobrowserFindQuery !== query) {
        ranges = [];
        root.dataset.monobrowserFindQuery = query;
        root.dataset.monobrowserFindIndex = '-1';
        const lowerQuery = query.toLocaleLowerCase();
        const walker = document.createTreeWalker(document.body || root, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const parent = node.parentElement;
          const text = node.nodeValue || '';
          if (!parent || !text || parent.closest('script,style,noscript,textarea,select')) continue;
          const lowerText = text.toLocaleLowerCase();
          let cursor = 0;
          while (cursor < text.length) {
            const index = lowerText.indexOf(lowerQuery, cursor);
            if (index === -1) break;
            const range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + query.length);
            ranges.push(range);
            cursor = index + query.length;
          }
        }
        CSS.highlights.set(allName, new Highlight(...ranges));
        let style = document.getElementById('monobrowser-find-style');
        if (!style) {
          style = document.createElement('style');
          style.id = 'monobrowser-find-style';
          (document.head || root).append(style);
        }
        style.textContent = ${JSON.stringify(findHighlightCss(getThemeTokens()))};
      }
      if (!ranges.length) {
        CSS.highlights.delete(activeName);
        return { matches: 0, activeMatchOrdinal: 0 };
      }
      let current = Number.parseInt(root.dataset.monobrowserFindIndex || '-1', 10);
      if (!${findNext} || current < 0 || current >= ranges.length) current = 0;
      else current = (current + (${forward} ? 1 : -1) + ranges.length) % ranges.length;
      root.dataset.monobrowserFindIndex = String(current);
      const active = ranges[current];
      CSS.highlights.set(activeName, new Highlight(active));
      const rect = active.getBoundingClientRect();
      const outsideViewport = rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth;
      if ((rect.width || rect.height) && outsideViewport) {
        window.scrollBy({ top: rect.top - (window.innerHeight / 2), left: rect.left - (window.innerWidth / 2), behavior: 'instant' });
      }
      return { matches: ranges.length, activeMatchOrdinal: current + 1 };
    })()`;
    try {
      const contents = getTabContents(tab);
      if (!contents) return null;
      const result = await contents.executeJavaScript(script, true) as { matches?: unknown; activeMatchOrdinal?: unknown };
      return {
        requestId,
        matches: typeof result?.matches === "number" ? result.matches : 0,
        activeMatchOrdinal: typeof result?.activeMatchOrdinal === "number" ? result.activeMatchOrdinal : 0,
        finalUpdate: true,
      };
    } catch {
      return { requestId, matches: 0, activeMatchOrdinal: 0, finalUpdate: true };
    }
  });

  handleTrusted("find:stop", async () => clearActiveFindHighlights());

  handleTrusted("find:show-window", () => {
    focusFindBar();
    return true;
  });

  handleTrusted("find:hide-window", async () => {
    await hideFindWindow();
    return true;
  });

  handleTrusted("nav:go", async (_event, rawInput: string) => {
    if (typeof rawInput !== "string") return false;
    let input = rawInput;
    const internalTarget = parseInternalPageUrl(input);
    if (internalTarget) {
      await openInternalPage(internalTarget);
      return true;
    }
    if (isInternalSchemeInput(input) && input.trim().replace(/\/$/, "") !== START_PAGE_URL) {
      // "monobrowser://settingshttps://example.com" (typed after the old text): use the URL, otherwise ignore the input.
      const recovered = recoverEmbeddedUrl(input);
      if (!recovered) return false;
      input = recovered;
    }

    let tab = getActiveTab();
    if (!tab) {
      // Brak kart (po zamknięciu ostatniej) – wpisanie adresu otwiera nową kartę.
      recordSearchIfQuery(input, false);
      openNewTab(normalizeInputToUrl(input));
      return true;
    }

    if (tab.internalKind) {
      // Karta wewnętrzna nigdy nie ładuje stron z internetu (ma most preload).
      recordSearchIfQuery(input, tab.isPrivate);
      openNewTab(normalizeInputToUrl(input), tab.isPrivate);
      return true;
    }

    if (!tab.view) {
      wakeTab(tab);
    }

    const contents = getTabContents(tab);
    if (!contents) {
      return false;
    }

    try {
      const normalizedUrl = normalizeInputToUrl(input);
      recordSearchIfQuery(input, tab.isPrivate);
      tab.url = normalizedUrl;
      await contents.loadURL(resolveUrlForLoading(normalizedUrl));
    } catch (err: unknown) {
      // Ignorujemy ERR_ABORTED, ponieważ występuje naturalnie podczas szybkiej nawigacji lub przekierowań na stronach
      if (getErrorCode(err) !== "ERR_ABORTED") {
        console.error("Navigation failed:", err);
      }
    }
    
    updateTabFromWebContents(tab);
    return true;
  });

  handleTrusted("nav:back", async () => {
    const contents = getTabContents(getActiveTab());
    if (!contents) {
      return false;
    }

    if (contents.navigationHistory.canGoBack()) {
      contents.navigationHistory.goBack();
      return true;
    }

    return false;
  });

  handleTrusted("nav:forward", async () => {
    const contents = getTabContents(getActiveTab());
    if (!contents) {
      return false;
    }

    if (contents.navigationHistory.canGoForward()) {
      contents.navigationHistory.goForward();
      return true;
    }

    return false;
  });

  handleTrusted("nav:reload", async () => {
    const contents = getTabContents(getActiveTab());
    if (!contents) {
      return false;
    }

    contents.reload();
    return true;
  });

  onTrusted("nav:reload-shortcut", () => {
    reloadActiveTabView();
  });

  handleTrusted("history:get", () => {
    return historyEntries;
  });

  handleTrusted("downloads:get", () => {
    return getDownloadStatePayload().downloads;
  });

  handleTrusted("downloads:cancel", (_event, id: unknown) => {
    if (typeof id !== "string" || !id || id.length > 200) {
      return false;
    }
    if (id === UPDATE_DOWNLOAD_ID) {
      return cancelUpdateDownload();
    }
    const item = activeDownloads.get(id);
    if (!item) {
      return false;
    }
    item.cancel();
    return true;
  });

  handleTrusted("downloads:clear-history", async () => {
    downloadRecords = downloadRecords.filter((record) => activeDownloads.has(record.id) || (record.kind === "update" && record.status === "in-progress"));
    await saveDownloads();
    broadcastDownloads();
    return true;
  });

  handleTrusted("downloads:open-file", async (_event, id: unknown) => {
    if (typeof id !== "string" || !id || id.length > 200) {
      return false;
    }
    const record = downloadRecords.find((entry) => entry.id === id);
    if (!record || record.status !== "completed") {
      return false;
    }
    try {
      const stats = await fs.stat(record.savePath);
      if (!stats.isFile()) {
        return false;
      }
      return (await shell.openPath(record.savePath)) === "";
    } catch {
      return false;
    }
  });

  handleTrusted("downloads:show-in-folder", async (_event, id: unknown) => {
    if (typeof id !== "string" || !id || id.length > 200) {
      return false;
    }
    const record = downloadRecords.find((entry) => entry.id === id);
    if (!record || record.status !== "completed") {
      return false;
    }
    try {
      const stats = await fs.stat(record.savePath);
      if (!stats.isFile()) {
        return false;
      }
      shell.showItemInFolder(record.savePath);
      return true;
    } catch {
      return false;
    }
  });

  handleTrusted("site-data:list", async () => listSiteData());
  handleTrusted("site-data:clear", async (_event, origin: unknown, dataTypes: unknown) => {
    return clearSiteData(origin, dataTypes);
  });
  handleTrusted("site-data:clear-global", async (_event, dataTypes: unknown) => {
    return clearGlobalSiteData(dataTypes);
  });
  handleTrusted("site-data:clear-history", async () => {
    try {
      await clearHistory();
      return { ok: true, message: appLanguage === "pl" ? "Historia przeglądania została wyczyszczona." : "Browsing history was cleared." } satisfies ClearResult;
    } catch (error) {
      const detail = error instanceof Error ? error.message : appLanguage === "pl" ? "Nieznany błąd." : "Unknown error.";
      return { ok: false, message: appLanguage === "pl" ? `Nie udało się wyczyścić historii: ${detail}` : `History could not be cleared: ${detail}` } satisfies ClearResult;
    }
  });

  handleTrusted("language:get", () => appLanguage);
  handleTrusted("language:set", async (_event, value: unknown) => {
    const language = normalizeLanguage(value);
    if (!language) {
      return false;
    }
    return setApplicationLanguage(language);
  });
  handleTrusted("settings:get-search", () => ({ ...searchSettings }));
  handleTrusted("theme:get", () => getThemeState());
  handleTrusted("theme:set", async (_event, value: unknown) => setThemeSettings(value));
  handleTrusted("settings:set-search", async (_event, value: unknown) => setSearchSettings(value));

  handleTrusted("userscripts:list", () => userScriptEntries.map((script) => ({ ...script })));
  handleTrusted("userscripts:get", (_event, id: unknown) =>
    userScriptEntries.find((script) => script.id === id) ?? null);
  handleTrusted("userscripts:save", (_event, input: unknown) => saveUserScriptInput(input));
  handleTrusted("userscripts:toggle", (_event, id: unknown, enabled: unknown) => toggleUserScript(id, enabled));
  handleTrusted("userscripts:remove", (_event, id: unknown) => removeUserScript(id));
  handleTrusted("userscripts:import-file", () => importUserScriptFromFile());

  handleTrusted("settings:open-window", async () => {
    await openSettingsWindow();
    return true;
  });
  handleTrusted("adblock:status", () => getAdblockerStatus());
  handleTrusted("adblock:toggle", async () => {
    await setAdblockEnabled(!adblockEnabled);
    return getAdblockerStatus();
  });
  handleTrusted("adblock:exceptions-list", () => listAdblockExceptions());
  handleTrusted("adblock:exceptions-add", (_event, host: unknown) => setAdblockException(host, true));
  handleTrusted("adblock:exceptions-remove", (_event, host: unknown) => setAdblockException(host, false));
  handleTrusted("adblock:toggle-tab-pause", () => {
    toggleActiveTabAdblockPause();
    return getAdblockerStatus();
  });
  handleTrusted("navigation-menu:open", (_event, anchor: unknown) => openNavigationMenu(anchor));
  handleTrusted("site-info-menu:open", async (_event, anchor: unknown) => openSiteInfoMenu(anchor));

  handleTrusted("palette:show", () => {
    focusPalette();
    return true;
  });
  handleTrusted("palette:hide", () => {
    hidePalette();
    return true;
  });
  onTrusted("palette:toggle-shortcut", () => {
    togglePalette();
  });
  handleTrusted("palette:get-items", () => buildPaletteItems());
  handleTrusted("palette:execute", async (_event, id: unknown) => {
    if (typeof id !== "string" || !id || id.length > 200) {
      return false;
    }
    await executePaletteCommand(id);
    return true;
  });
  onTrusted("palette:report-height", (_event, height: unknown) => {
    if (typeof height !== "number" || !Number.isFinite(height)) {
      return;
    }
    paletteViewHeight = Math.max(96, Math.min(760, Math.ceil(height)));
    positionPaletteView();
  });

  handleTrusted("notes:show", () => {
    showNotesView();
    return true;
  });
  handleTrusted("notes:hide", () => {
    hideNotesView();
    return true;
  });
  handleTrusted("notes:toggle", () => {
    toggleNotesView();
    return true;
  });
  handleTrusted("notes:get", () => notesContent);
  handleTrusted("notes:save", async (_event, value: unknown) => saveNotesContent(value));

  handleTrusted("layout:set-viewport", (event, rect: unknown) => {
    const { x, y } = (typeof rect === "object" && rect !== null ? rect : {}) as { x?: unknown; y?: unknown };
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return false;
    }
    // The compact-mode chrome overlay is a second shell instance; only the window's own shell reports the viewport.
    if (compactChrome?.getContents()?.id === event.sender.id) return true;

    reportedViewportLeft = Math.max(0, Math.floor(x));
    reportedViewportTop = Math.max(0, Math.floor(y));
    applyEffectiveViewport();
    relayoutViews();
    return true;
  });
  handleTrusted("layout:sidebar-dragging", (_event, dragging: unknown) => {
    sidebarDragging = dragging === true;
    applyActiveViewBounds();
    compactChrome?.refresh();
    return true;
  });
  // Shell reports what keeps the compact-mode chrome open (focused address field, a tab being dragged)
  // and whether a tab drag may end in a split-view drop.
  onTrusted("compact:keep", (event, flags: unknown) => {
    if (compactChrome?.getContents()?.id !== event.sender.id) return;
    const raw = (typeof flags === "object" && flags !== null ? flags : {}) as { address?: unknown };
    if (typeof raw.address === "boolean") compactChrome.setKeep({ address: raw.address });
  });
  onTrusted("compact:pointer", (event, inside: unknown) => {
    if (compactChrome?.getContents()?.id !== event.sender.id || typeof inside !== "boolean") return;
    compactChrome.setPointerInside(inside);
  });
  onTrusted("split:tab-drag", (_event, tabId: unknown) => {
    const id = typeof tabId === "number" && Number.isInteger(tabId) ? tabId : null;
    compactChrome?.setKeep({ tabDrag: id !== null });
    setSplitTabDrag(id);
  });
  handleTrusted("split:close", () => closeSplit());
  handleTrusted("experimental:get", () => getExperimentalPayload());
  handleTrusted("experimental:set", (_event, patch: unknown) => setExperimentalSettings(patch));
  handleTrusted("glance:get", () => ({ ...glanceSettings }));
  handleTrusted("glance:set", (_event, patch: unknown) => setGlanceSettings(patch));
  handleTrusted("glance:get-state", (event) => (glance && event.sender.id === glance.shell.webContents.id ? buildGlanceViewState(glance) : null));
  handleTrusted("glance:close", () => { closeGlance(); return true; });
  handleTrusted("glance:expand", () => expandGlance(true));
  handleTrusted("glance:background", () => expandGlance(false));
  handleTrusted("layout:get", () => ({ ...layoutSettings }));
  handleTrusted("layout:set", (_event, patch: unknown) => setLayoutSettings(patch));

  handleTrusted("tabs:toggle-mute", (_event, tabId: unknown) => Number.isInteger(tabId) && toggleTabMuted(tabId as number));
  handleTrusted("tabs:reset-zoom", () => {
    const tab = getActiveTab();
    if (!tab || tab.internalKind) return false;
    setTabZoom(tab, 1);
    return true;
  });
  handleTrusted("tabs:open-dropped", (_event, payload: unknown) => {
    const targets = resolveDropTargets((typeof payload === "object" && payload !== null ? payload : {}) as Record<string, unknown>);
    const inheritPrivate = getActiveTab()?.isPrivate ?? false;
    for (const target of targets) openNewTab(target, inheritPrivate);
    return targets.length;
  });
  handleTrusted("about:get-update-status", () => getAboutUpdatePayload());
  handleTrusted("about:check-updates", async () => {
    await runUpdateCheck();
    return getAboutUpdatePayload();
  });
  handleTrusted("about:open-link", (_event, url: unknown) => {
    if (!isAllowedAboutLink(url) && !(typeof url === "string" && ((updateStatus.releaseUrl && url === updateStatus.releaseUrl) || licenseLinkAllowList.has(normalizeLinkHref(url))))) return false;
    openNewTab(url);
    return true;
  });
  handleTrusted("about:get-licenses", async () => {
    const text = await readLicensesText();
    licenseLinkAllowList = new Set(extractMarkdownUrls(text).map(normalizeLinkHref));
    return text ? renderMarkdownLite(text) : "";
  });
  handleTrusted("onboarding:set-step", (_event, index: unknown) => { onboardingStep = clampStep(index); return true; });
  handleTrusted("onboarding:finish", () => finishOnboarding());
  handleTrusted("animations:get", () => ({ ...animationSettings }));
  handleTrusted("animations:set", (_event, patch: unknown) => setAnimationSettings(patch));
  handleTrusted("startup:get", () => ({ ...startupSettings }));
  handleTrusted("startup:set", (_event, patch: unknown) => setStartupSettings(patch));
};

const UPDATE_DOWNLOAD_ID = "app-update";
const UPDATE_PROGRESS_THROTTLE_MS = 400;
let updateCancellationToken: CancellationToken | null = null;
let updateDownloadInFlight = false;
let downloadedUpdateVersion: string | null = null;
let lastUpdateProgressBroadcast = 0;

const createUpdateDownloadRecord = (version: string): void => {
  const pl = appLanguage === "pl";
  const record: DownloadRecord = {
    id: UPDATE_DOWNLOAD_ID,
    kind: "update",
    fileName: pl ? `Aktualizacja MonoBrowser ${version}` : `MonoBrowser update ${version}`,
    sourceUrl: "https://github.com/4tmwz7/monobrowser/releases",
    sourceOrigin: "github.com",
    savePath: "",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    receivedBytes: 0,
    totalBytes: 0,
    status: "in-progress",
  };
  downloadRecords = [record, ...downloadRecords.filter((entry) => entry.id !== UPDATE_DOWNLOAD_ID)].slice(0, MAX_DOWNLOAD_ITEMS);
  broadcastDownloads();
};

const updateDownloadRecord = (patch: Partial<DownloadRecord>): void => {
  downloadRecords = downloadRecords.map((record) =>
    record.id === UPDATE_DOWNLOAD_ID ? { ...record, ...patch } : record);
  broadcastDownloads();
};

const finishUpdateDownload = (status: DownloadStatus, error?: string): void => {
  updateDownloadInFlight = false;
  updateCancellationToken = null;
  updateDownloadRecord({ status, finishedAt: new Date().toISOString(), ...(error ? { error } : {}) });
  if (status === "cancelled") setUpdateStatus({ state: "available" });
  if (status === "failed") setUpdateStatus({ state: "error" });
};

const cancelUpdateDownload = (): boolean => {
  if (!updateDownloadInFlight || !updateCancellationToken) {
    return false;
  }
  updateCancellationToken.cancel();
  return true;
};

const startUpdateDownload = async (version: string): Promise<void> => {
  if (updateDownloadInFlight || downloadedUpdateVersion === version) {
    return;
  }

  updateDownloadInFlight = true;
  updateCancellationToken = new CancellationToken();
  lastUpdateProgressBroadcast = 0;
  createUpdateDownloadRecord(version);

  try {
    await autoUpdater.downloadUpdate(updateCancellationToken);
  } catch (error) {
    const cancelled = updateCancellationToken?.cancelled === true;
    finishUpdateDownload(
      cancelled ? "cancelled" : "failed",
      cancelled ? undefined : (error instanceof Error ? error.message : String(error)),
    );
    if (!cancelled) {
      console.error("Update download failed:", error);
    }
  }
};

const registerAutoUpdater = (): void => {
  // Pobieranie uruchamiamy ręcznie (startUpdateDownload), żeby było widoczne i anulowalne.
  autoUpdater.autoDownload = false;

  autoUpdater.on("checking-for-update", () => {
    updateCheckInProgress = true;
  });

  autoUpdater.on("update-not-available", () => {
    updateCheckInProgress = false;
  });

  autoUpdater.on("update-available", () => {
    updateCheckInProgress = false;
  });

  autoUpdater.on("error", (error) => {
    updateCheckInProgress = false;
    if (updateStatus.state === "checking" || updateStatus.state === "downloading") setUpdateStatus({ state: "error" });
    console.error("Auto-update error:", error);
  });

  autoUpdater.on("download-progress", (progress) => {
    const now = Date.now();
    if (now - lastUpdateProgressBroadcast < UPDATE_PROGRESS_THROTTLE_MS) {
      return;
    }
    lastUpdateProgressBroadcast = now;
    updateDownloadRecord({
      receivedBytes: Math.round(progress.transferred),
      totalBytes: Math.round(progress.total),
    });
  });

  autoUpdater.on("update-downloaded", async (info) => {
    downloadedUpdateVersion = info.version;
    setUpdateStatus({ state: "downloaded", version: info.version });
    const record = downloadRecords.find((entry) => entry.id === UPDATE_DOWNLOAD_ID);
    updateDownloadRecord({
      receivedBytes: record?.totalBytes || record?.receivedBytes || 0,
      totalBytes: record?.totalBytes || record?.receivedBytes || 0,
    });
    finishUpdateDownload("completed");

    const windowRef = mainWindow;
    if (!windowRef || windowRef.isDestroyed()) {
      return;
    }

    const pl = appLanguage === "pl";
    const result = await dialog.showMessageBox(windowRef, {
      type: "info",
      title: pl ? "Aktualizacja gotowa" : "Update ready",
      message: pl
        ? "Pobrano nową wersję MonoBrowser."
        : "A new version of MonoBrowser has been downloaded.",
      detail: pl ? "Uruchom ponownie teraz, aby ją zainstalować." : "Restart now to install the update.",
      buttons: pl ? ["Uruchom ponownie", "Później"] : ["Restart now", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (result.response === 0) {
      setImmediate(() => {
        autoUpdater.quitAndInstall();
      });
    }
  });
};

const parseReleaseVersion = (value: string): [number, number, number] | null => {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

const isNewerRelease = (candidate: string, current: string): boolean => {
  const candidateParts = parseReleaseVersion(candidate);
  const currentParts = parseReleaseVersion(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) {
      return candidateParts[index] > currentParts[index];
    }
  }
  return false;
};

// Stan aktualizacji pokazywany na stronie monobrowser://about.
let updateStatus: UpdateStatus = { state: "idle", version: null, checkedAt: null, packaged: app.isPackaged, portable: isPortableMode() };
const setUpdateStatus = (patch: Partial<UpdateStatus>): void => {
  // "portable" = przenośna kompilacja (tylko powiadomienie o nowej wersji, bez pobierania).
  updateStatus = { ...updateStatus, ...patch, packaged: app.isPackaged, portable: isPortableMode() && getUpdateMode() === "notify" };
};

// Wersja przenośna: jedno nieblokujące powiadomienie w oknie na każdą nową wersję w danym uruchomieniu.
const noticedVersions = new Set<string>();
const showNewVersionNotice = async (version: string, url: string): Promise<void> => {
  if (noticedVersions.has(version) || !promptOverlay) return;
  noticedVersions.add(version);
  try {
    const result = await promptOverlay.request(buildNewVersionNotice(appLanguage === "pl" ? "pl" : "en", version));
    if (result.action === "primary") openNewTab(url);
  } catch (error) {
    console.error("New version notice failed:", error);
  }
};

const runUpdateCheck = async (): Promise<UpdateStatus> => {
  if (updateCheckInProgress) {
    return updateStatus;
  }

  updateCheckInProgress = true;
  setUpdateStatus({ state: "checking" });
  if (getUpdateMode() === "notify") {
    try {
      const newer = await checkForNewerRelease();
      if (newer) {
        setUpdateStatus({ state: "available", version: newer.version, checkedAt: Date.now(), releaseUrl: newer.url });
        void showNewVersionNotice(newer.version, newer.url);
      } else {
        setUpdateStatus({ state: "up-to-date", version: null, checkedAt: Date.now(), releaseUrl: null });
      }
    } catch (error) {
      setUpdateStatus({ state: "error", checkedAt: Date.now() });
      console.error("Portable update check failed:", error);
    } finally {
      updateCheckInProgress = false;
    }
    return updateStatus;
  }
  try {
    const response = await fetch(
      "https://api.github.com/repos/4tmwz7/monobrowser/releases/latest",
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": `MonoBrowser/${app.getVersion()}`,
        },
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (!response.ok) {
      throw new Error(`GitHub release check failed with HTTP ${response.status}`);
    }
    const release = await response.json() as { tag_name?: unknown };
    const tagName = typeof release.tag_name === "string" ? release.tag_name : "";
    if (!isNewerRelease(tagName, app.getVersion())) {
      setUpdateStatus({ state: "up-to-date", version: null, checkedAt: Date.now() });
      return updateStatus;
    }
    const latestVersion = tagName.replace(/^v/i, "");
    if (getUpdateMode() === "dev") {
      // Wersja deweloperska – tylko informujemy o nowym wydaniu.
      setUpdateStatus({ state: "available", version: latestVersion, checkedAt: Date.now() });
      return updateStatus;
    }
    if (downloadedUpdateVersion) {
      setUpdateStatus({ state: "downloaded", version: downloadedUpdateVersion, checkedAt: Date.now() });
      return updateStatus;
    }
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) {
      setUpdateStatus({ state: "downloading", version: result.updateInfo.version, checkedAt: Date.now() });
      void startUpdateDownload(result.updateInfo.version);
    } else {
      setUpdateStatus({ state: "up-to-date", version: null, checkedAt: Date.now() });
    }
  } catch (error) {
    setUpdateStatus({ state: "error", checkedAt: Date.now() });
    console.error("Lightweight update check failed:", error);
  } finally {
    updateCheckInProgress = false;
  }
  return updateStatus;
};

const scheduleAutoUpdateChecks = (): void => {
  setUpdateStatus({});
  // Dev: tylko ręczne sprawdzanie. Wersje przenośne ("notify") sprawdzają wydania, ale tylko powiadamiają;
  // zainstalowane buildy i AppImage (także w trybie przenośnym) używają electron-updater.
  const mode = getUpdateMode();
  if (mode === "dev") {
    return;
  }

  if (mode === "electron-updater") {
    registerAutoUpdater();
  }

  const sixHoursMs = 6 * 60 * 60 * 1000;
  // Pierwsze sprawdzenie od razu po uruchomieniu, kolejne co 6 godzin.
  void runUpdateCheck();
  setInterval(() => { void runUpdateCheck(); }, sixHoursMs);
};

type CreateMainWindowOptions = {
  showImmediately?: boolean;
  onProgress?: (percent: number, label: string) => void;
};

const createMainWindow = async (
  options: CreateMainWindowOptions = {},
): Promise<void> => {
  const { showImmediately = true, onProgress } = options;

  const currentBackgroundColor = getSafeStartPageBackgroundColor(
    startPageBackgroundColor,
  );

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: currentBackgroundColor,
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  promptOverlay?.dispose();
  promptOverlay = createPromptOverlay({
    getMainWindow: () => mainWindow,
    getPaneRect: () => getActivePaneRect(),
    getActiveTabId: () => activeTabId,
    attachViewOnTop,
    onViewCreated: (contents) => {
      trackThemedContents(contents);
      // The prompt title uses the display font like the other headings (the page itself ships no font).
      contents.on("dom-ready", () => {
        const font = getBebasNeueFontDataUrl();
        if (font) contents.insertCSS(`@font-face{font-family:"Bebas Neue";src:url("${font}") format("truetype");font-weight:400;font-display:block}`).catch(() => undefined);
      });
    },
    detachView,
    focusMainWindow: focusMainWindowForOverlay,
    restoreFocus: focusActiveTabView,
    preloadPath: path.join(__dirname, "prompt-preload.js"),
    htmlPath: path.join(__dirname, "../renderer/prompt.html"),
  });

  compactChrome?.dispose();
  compactChrome = createCompactChrome({
    getMainWindow: () => mainWindow,
    getLayout: () => layoutSettings,
    preloadPath: path.join(__dirname, "preload.js"),
    stripPreloadPath: path.join(__dirname, "compact-strip-preload.js"),
    htmlPath: path.join(__dirname, "../renderer/index.html"),
    onContentsCreated: (contents) => {
      trackThemedContents(contents);
      contents.on("before-input-event", handleBeforeInputEvent);
      contents.on("focus", dismissOverlaysOnOutsideClick);
    },
    raiseView: (view) => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.contentView.addChildView(view);
      if (isPopupVisible()) attachPopupViewOnTop();
    },
    isPopupOpen: isPopupVisible,
    isForcedOpen: () => activeTabId === null,
    isSuppressed: () => htmlFullscreenTabId !== null,
    onViewportChanged: () => {
      applyEffectiveViewport();
      relayoutViews();
    },
    isSidebarDragging: () => sidebarDragging,
    restoreFocus: focusActiveTabView,
  });

  mainWindow.on("resize", () => {
    closePopup(false, false);
    applyActiveViewBounds();
    compactChrome?.refresh();
    positionDownloadProgressView();
    positionFindView();
    positionPaletteView();
    positionNotesView();
    positionGlance();
    positionHudViews();
    promptOverlay?.refresh();
  });
  mainWindow.on("leave-full-screen", () => {
    // F11 / system exit from fullscreen while a page is in HTML5 fullscreen ends that too.
    if (htmlFullscreenTabId === null) return;
    const fullscreenTab = tabs.get(htmlFullscreenTabId);
    leaveHtmlFullscreen(htmlFullscreenTabId);
    exitHtmlFullscreenInPage(fullscreenTab);
  });
  mainWindow.webContents.on("focus", dismissOverlaysOnOutsideClick);
  trackThemedContents(mainWindow.webContents);
  mainWindow.webContents.on("context-menu", (_event, params) => {
    if (params.isEditable) void openShellEditContextMenu(params);
  });
  mainWindow.on("minimize", hideDownloadProgressView);
  mainWindow.on("restore", broadcastDownloadProgress);
  mainWindow.on("close", () => {
    // Stan kart zapisujemy zanim okno je zniszczy; później zapis jest wyłączony.
    flushSessionSync();
    sessionSavingEnabled = false;
    flushSplitSync();
    splitSavingEnabled = false;
  });
  mainWindow.on("closed", () => {
    promptOverlay?.dispose();
    promptOverlay = null;
    compactChrome?.dispose();
    compactChrome = null;
    splitFrame?.dispose();
    splitFrame = null;
    splitRegistry.clear();
    splitDropMode = false;
    destroyHudViews();
    htmlFullscreenTabId = null;
    if (downloadProgressHideTimer) {
      clearTimeout(downloadProgressHideTimer);
      downloadProgressHideTimer = null;
    }
    if (downloadProgressView && !downloadProgressView.webContents.isDestroyed()) {
      downloadProgressView.webContents.close();
    }
    for (const tab of tabs.values()) {
      if (tab.view && !tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    }
    tabs.clear();
    tabMruOrder.splice(0);
    activeTabId = null;
    downloadProgressView = null;
    downloadProgressVisible = false;
    if (findView && !findView.webContents.isDestroyed()) findView.webContents.close();
    findView = null;
    findVisible = false;
    if (paletteView && !paletteView.webContents.isDestroyed()) paletteView.webContents.close();
    paletteView = null;
    paletteVisible = false;
    if (notesView && !notesView.webContents.isDestroyed()) notesView.webContents.close();
    notesView = null;
    notesVisible = false;
    closeGlance(false);
    activePopup = null;
    if (popupView && !popupView.webContents.isDestroyed()) popupView.webContents.close();
    popupView = null;
    mainWindow = null;
  });

  registerWindowShortcuts(mainWindow);

  mainWindow.setMenuBarVisibility(false);

  onProgress?.(58, "Loading app shell...");
  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  onProgress?.(79, "Opening first tab...");
  createHudViews();
  compactChrome?.setEnabled(layoutSettings.compactMode);
  const previousSession = await loadSession();
  // Ostatnio zamknięte karty przeżywają restart (Ctrl+Shift+T), także gdy karty nie są przywracane.
  recentlyClosedTabs = previousSession.recentlyClosed;
  workspaces = previousSession.workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name, icon: workspace.icon, color: workspace.color }));
  currentWorkspaceId = previousSession.currentWorkspaceId;
  if (startupSettings.startupMode === "restore" && restoreSession(previousSession)) {
    await restoreSplits();
  } else {
    createTab(DEFAULT_URL, true);
    splitSavingEnabled = true;
  }
  sessionSavingEnabled = true;
  if (onboardingAutoShow) {
    onboardingAutoShow = false;
    onboardingStep = 0;
    await openInternalPage("onboarding");
  }
  scheduleSessionSave();
  broadcastHistory();

  if (showImmediately && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
};

const setupApplicationMenu = (): void => {
  const isMac = process.platform === "darwin";
  const copy = appLanguage === "pl" ? {
    file: "Plik", newTab: "Nowa karta", newPrivateTab: "Nowa karta prywatna", closeTab: "Zamknij kartę", quit: "Zakończ",
    edit: "Edycja", undo: "Cofnij", redo: "Ponów", cut: "Wytnij", copy: "Kopiuj", paste: "Wklej",
    pasteMatch: "Wklej i dopasuj styl", delete: "Usuń", selectAll: "Zaznacz wszystko", speech: "Mowa",
    view: "Widok", reload: "Odśwież", forceReload: "Wymuś odświeżenie", devTools: "Narzędzia deweloperskie",
    resetZoom: "Rozmiar rzeczywisty", zoomIn: "Powiększ", zoomOut: "Pomniejsz", fullscreen: "Pełny ekran",
    window: "Okno", minimize: "Minimalizuj", zoom: "Maksymalizuj", front: "Przenieś wszystko na wierzch",
    help: "Pomoc", about: "O programie",
  } : {
    file: "File", newTab: "New Tab", newPrivateTab: "New Private Tab", closeTab: "Close Tab", quit: "Quit",
    edit: "Edit", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste",
    pasteMatch: "Paste and Match Style", delete: "Delete", selectAll: "Select All", speech: "Speech",
    view: "View", reload: "Reload", forceReload: "Force Reload", devTools: "Developer Tools",
    resetZoom: "Actual Size", zoomIn: "Zoom In", zoomOut: "Zoom Out", fullscreen: "Full Screen",
    window: "Window", minimize: "Minimize", zoom: "Zoom", front: "Bring All to Front",
    help: "Help", about: "About",
  };

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: copy.file,
      submenu: [
        {
          label: copy.newTab,
          accelerator: "CmdOrCtrl+T",
          click: () => {
            openNewTab();
          },
        },
        {
          label: copy.newPrivateTab,
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            openNewPrivateTab();
          },
        },
        {
          label: copy.closeTab,
          accelerator: "CmdOrCtrl+W",
          click: () => {
            closeCurrentTab();
          },
        },
        { role: "quit", label: copy.quit } as MenuItemConstructorOptions,
      ],
    },
    {
      label: copy.edit,
      submenu: [
        { role: "undo", label: copy.undo } as MenuItemConstructorOptions,
        { role: "redo", label: copy.redo } as MenuItemConstructorOptions,
        { type: "separator" } as MenuItemConstructorOptions,
        { role: "cut", label: copy.cut } as MenuItemConstructorOptions,
        { role: "copy", label: copy.copy } as MenuItemConstructorOptions,
        { role: "paste", label: copy.paste } as MenuItemConstructorOptions,
        ...(isMac
          ? ([
              { role: "pasteAndMatchStyle", label: copy.pasteMatch },
              { role: "delete", label: copy.delete },
              { role: "selectAll", label: copy.selectAll },
              { type: "separator" },
              {
                label: copy.speech,
                submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
              },
            ] as MenuItemConstructorOptions[])
          : ([{ role: "delete", label: copy.delete }, { type: "separator" }, { role: "selectAll", label: copy.selectAll }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: copy.view,
      submenu: [
        {
          label: copy.reload,
          accelerator: "CmdOrCtrl+R",
          click: () => {
            reloadActiveTabView();
          },
        },
        {
          label: copy.forceReload,
          click: () => getTabContents(getActiveTab())?.reloadIgnoringCache(),
        },
        {
          label: copy.devTools,
          accelerator: "CmdOrCtrl+Shift+I",
          click: toggleActiveTabDevTools,
        },
        { type: "separator" },
        { label: copy.resetZoom, accelerator: "CmdOrCtrl+0", click: () => changeActiveTabZoom("reset") },
        { label: copy.zoomIn, accelerator: "CmdOrCtrl+Plus", click: () => changeActiveTabZoom("in") },
        { label: copy.zoomOut, accelerator: "CmdOrCtrl+-", click: () => changeActiveTabZoom("out") },
        { type: "separator" },
        {
          label: appLanguage === "pl" ? "Tryb kompaktowy" : "Compact mode",
          accelerator: "CmdOrCtrl+Shift+C",
          click: toggleCompactMode,
        },
        {
          label: appLanguage === "pl" ? "Notatki" : "Notes",
          accelerator: "CmdOrCtrl+Shift+M",
          click: toggleNotesView,
        },
        {
          label: appLanguage === "pl" ? "Podzielony widok (przełącz)" : "Split view (toggle)",
          click: toggleSplitForActiveTab,
        },
        { type: "separator" },
        { role: "togglefullscreen", label: copy.fullscreen },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: copy.window,
      submenu: [
        { role: "minimize", label: copy.minimize },
        { role: "zoom", label: copy.zoom },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front", label: copy.front },
              { type: "separator" },
              { role: "window" },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
    {
      label: copy.help,
      submenu: [{ label: copy.about, click: () => void openInternalPage("about") }],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const bootstrap = async (): Promise<void> => {
  app.setName("MonoBrowser");
  experimentalSettingsFilePath = path.join(app.getPath("userData"), "experimental-settings.json");
  if (await relaunchWithHardMemoryLimitIfNeeded()) {
    app.exit(0);
    return;
  }
  const activeHardLimit = getActiveHardLimitMb();
  if (activeHardLimit) limitOwnScopeIfNeeded(activeHardLimit);
  historyFilePath = path.join(app.getPath("userData"), "history.json");
  bookmarksFilePath = path.join(app.getPath("userData"), "bookmarks.json");
  userscriptsFilePath = path.join(app.getPath("userData"), "userscripts.json");
  downloadsFilePath = path.join(app.getPath("userData"), "downloads.json");
  siteOriginsFilePath = path.join(app.getPath("userData"), "site-origins.json");
  languageFilePath = path.join(app.getPath("userData"), "language.json");
  onboardingFilePath = path.join(app.getPath("userData"), ONBOARDING_FILE);
  searchSettingsFilePath = path.join(app.getPath("userData"), "search-settings.json");
  layoutSettingsFilePath = path.join(app.getPath("userData"), "layout-settings.json");
  splitFilePath = path.join(app.getPath("userData"), "split-view.json");
  glanceSettingsFilePath = path.join(app.getPath("userData"), "glance-settings.json");
  adblockSettingsFilePath = path.join(app.getPath("userData"), "adblock-settings.json");
  adblockExceptionsFilePath = path.join(app.getPath("userData"), "adblock-exceptions.json");
  adblockEngineCachePath = path.join(app.getPath("userData"), "adblock-engine.bin");
  notesFilePath = path.join(app.getPath("userData"), "notes.md");
  statsFilePath = path.join(app.getPath("userData"), "stats.json");
  sessionFilePath = path.join(app.getPath("userData"), "session.json");
  animationSettingsFilePath = path.join(app.getPath("userData"), "animation-settings.json");
  startupSettingsFilePath = path.join(app.getPath("userData"), "startup-settings.json");
  zoomFilePath = path.join(app.getPath("userData"), "zoom.json");
  startPageBackgroundFilePath = path.join(
    app.getPath("userData"),
    START_PAGE_BACKGROUND_FILE,
  );

  await detectOnboarding();
  await Promise.all([loadStartPageBackgroundColor(), loadLanguage(), loadSearchSettings(), loadLayoutSettings(), loadGlanceSettings(), loadAdblockSettings(), loadAdblockExceptions(), loadExperimentalSettings(), loadStartupSettings(), loadAnimationSettings(), loadZoomStore()]);
  applyExperimentalSettings();
  startPageBackgroundColor = getThemeTokens().bg;
  applyStartPageBackgroundColor();
  nativeTheme.on("updated", () => { if (themeSettings.id === "default") applyThemeEverywhere(); });

  const persistentDataLoad = Promise.all([
    loadHistory(),
    loadBookmarks(),
    loadUserScripts(),
    loadDownloads(),
    loadSiteOrigins(),
    loadNotesContent(),
    loadStats(),
  ]);

  await createSplashWindow();
  updateSplashProgress(8, "Starting MonoBrowser...");

  // Tryb przenośny: przywróć sesje z magazynu na nośniku (ew. po haśle) przed odtworzeniem kart.
  await initPortableSession(() => (appLanguage === "pl" ? "pl" : "en"));

  if (SPLASH_ONLY_MODE) {
    updateSplashProgress(100, "Splash preview mode");
    return;
  }

  setupPermissionHandlers(session.defaultSession);
  registerCertificateErrorHandler((contents) => resolveTabByWebContentsId(contents.id)?.isPrivate ?? false);
  registerAuthHandler();
  applySpellcheckLanguages();
  registerIpc();
  await persistentDataLoad;
  registerDownloadHandling();
  initAdblocker();
  startStatsTimer();
  startTabSleepTimer();

  updateSplashProgress(28, "Preparing interface...");
  setupApplicationMenu();
  await createMainWindow({
    showImmediately: false,
    onProgress: updateSplashProgress,
  });

  updateSplashProgress(94, "Finalizing startup...");
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }

  updateSplashProgress(100, "Ready");
  destroySplashWindow();

  scheduleAutoUpdateChecks();
};

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.focus();
    const requestedUrl = argv.find((arg) => isHttpUrl(arg));
    openNewTab(requestedUrl);
  });

  app
    .whenReady()
    .then(bootstrap)
    .catch((error) => {
      console.error("Failed to bootstrap app:", error);
      app.quit();
    });
}

app.on("before-quit", () => {
  flushSessionSync();
  flushZoomSync();
  if (statsDirty) {
    void saveStats();
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createMainWindow();
  }
});
