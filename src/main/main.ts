import { app, BrowserView, BrowserWindow, dialog, ipcMain, session, Menu, MenuItemConstructorOptions } from "electron";
import type { WebContents } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { autoUpdater } from "electron-updater";

type TabState = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
};

type TabRecord = TabState & {
  view: BrowserView;
};

type ShortcutAction = "new-tab" | "close-tab" | "reload";

type PreloadedHomeTab = {
  view: BrowserView;
  isReady: boolean;
  removeListeners: () => void;
};

type HistoryEntry = {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
};

const DEFAULT_URL = "https://www.google.com";
const MAX_HISTORY_ITEMS = 500;
const CLEAR_HISTORY_URL = "monobrowser://clear-history";
const CLEAR_COOKIES_URL = "monobrowser://clear-cookies";
const CLEAR_CACHE_URL = "monobrowser://clear-cache";
const SPLASH_ONLY_MODE =
  process.argv.includes("--splash-only") ||
  process.env.MONOBROWSER_SPLASH_ONLY === "1";

let mainWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let historyFilePath = "";
let viewportTop = 170;
let nextTabId = 1;
let activeTabId: number | null = null;
let historyEntries: HistoryEntry[] = [];
let preloadedHomeTab: PreloadedHomeTab | null = null;
let splashWindow: BrowserWindow | null = null;
let dataPanelStatusMessage = "";

const tabs = new Map<number, TabRecord>();
const tabMruOrder: number[] = [];

let updateCheckInProgress = false;
let startPageBackgroundColor = "#ffffff";
let startPageBackgroundFilePath = "";

const START_PAGE_BACKGROUND_FILE = "start-page-background.json";

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
  return normalizeHexColor(value) ?? "#ffffff";
};

const isDefaultStartPageUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const isGoogleHost =
      host === "google.com" ||
      host === "www.google.com" ||
      /^([a-z0-9-]+\.)?google\.[a-z.]+$/.test(host);

    if (!isGoogleHost) {
      return false;
    }

    const pathname = parsed.pathname.toLowerCase();
    if (pathname !== "/" && pathname !== "/webhp") {
      return false;
    }

    return !parsed.searchParams.has("q");
  } catch {
    return false;
  }
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

const applyStartPageBackgroundToView = (view: BrowserView): void => {
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

  if (preloadedHomeTab) {
    applyStartPageBackgroundToView(preloadedHomeTab.view);
  }

  for (const tab of tabs.values()) {
    if (isDefaultStartPageUrl(tab.url)) {
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
        transition: width 0.2s ease;
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

const normalizeInputToUrl = (input: string): string => {
  const trimmed = input.trim();

  if (!trimmed) {
    return DEFAULT_URL;
  }

  const hasProtocol = /^https?:\/\//i.test(trimmed);
  if (hasProtocol) {
    return trimmed;
  }

  const looksLikeHost =
    /^localhost(:\d+)?(\/.*)?$/i.test(trimmed) || /\./.test(trimmed);
  if (looksLikeHost) {
    return `https://${trimmed}`;
  }

  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
};

const isClearHistoryUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "monobrowser:" &&
      parsed.hostname === "clear-history"
    );
  } catch {
    return false;
  }
};

const isClearCookiesUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "monobrowser:" && parsed.hostname === "clear-cookies"
    );
  } catch {
    return false;
  }
};

const isClearCacheUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "monobrowser:" && parsed.hostname === "clear-cache";
  } catch {
    return false;
  }
};

const getTabSnapshot = (tab: TabRecord): TabState => ({
  id: tab.id,
  title: tab.title,
  url: tab.url,
  isLoading: tab.isLoading,
  canGoBack: tab.canGoBack,
  canGoForward: tab.canGoForward,
});

const getTabsStatePayload = () => ({
  tabs: Array.from(tabs.values()).map(getTabSnapshot),
  activeTabId,
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

const getMostRecentTabId = (): number | null => {
  for (const tabId of tabMruOrder) {
    if (tabs.has(tabId)) {
      return tabId;
    }
  }

  return null;
};

const createTabView = (): BrowserView => {
  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  return view;
};

const ensurePreloadedHomeTab = (): void => {
  if (!mainWindow || preloadedHomeTab) {
    return;
  }

  const view = createTabView();
  applyStartPageBackgroundToView(view);
  const contents = view.webContents;

  const handleDomReady = (): void => {
    runBackgroundProbeIfStartPage(contents);
  };

  const handleDidFinishLoad = (): void => {
    if (!preloadedHomeTab || preloadedHomeTab.view !== view) {
      return;
    }

    preloadedHomeTab.isReady = true;
    runBackgroundProbeIfStartPage(contents);
  };

  const handleDidFailLoad = (): void => {
    if (!preloadedHomeTab || preloadedHomeTab.view !== view) {
      return;
    }

    preloadedHomeTab.removeListeners();
    preloadedHomeTab = null;
    contents.close();
  };

  const removeListeners = (): void => {
    contents.removeListener("dom-ready", handleDomReady);
    contents.removeListener("did-finish-load", handleDidFinishLoad);
    contents.removeListener("did-fail-load", handleDidFailLoad);
  };

  preloadedHomeTab = {
    view,
    isReady: false,
    removeListeners,
  };

  contents.on("dom-ready", handleDomReady);
  contents.on("did-finish-load", handleDidFinishLoad);
  contents.on("did-fail-load", handleDidFailLoad);
  contents.loadURL(DEFAULT_URL).catch(() => {
    handleDidFailLoad();
  });
};

const destroyPreloadedHomeTab = (): void => {
  if (!preloadedHomeTab) {
    return;
  }

  const view = preloadedHomeTab.view;
  preloadedHomeTab.removeListeners();
  preloadedHomeTab = null;
  view.webContents.close();
};

const consumePreloadedHomeTabView = (url: string): BrowserView | null => {
  if (
    url !== DEFAULT_URL ||
    !preloadedHomeTab ||
    !preloadedHomeTab.isReady
  ) {
    return null;
  }

  const consumedView = preloadedHomeTab.view;
  preloadedHomeTab.removeListeners();
  preloadedHomeTab = null;
  return consumedView;
};

const broadcastTabsState = (): void => {
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send("tabs:state", getTabsStatePayload());
};

const broadcastHistory = (): void => {
  if (!mainWindow) {
    return;
  }

  mainWindow.webContents.send("history:updated", historyEntries);

  if (historyWindow && !historyWindow.isDestroyed()) {
    void loadHistoryWindowContent();
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

const clearCookies = async (): Promise<void> => {
  await session.defaultSession.clearStorageData({
    storages: ["cookies"],
  });
};

const clearCacheData = async (): Promise<void> => {
  await session.defaultSession.clearCache();
};

const getDataPanelStatusHtml = (): string => {
  if (!dataPanelStatusMessage) {
    return "";
  }

  return `<p class="status">${escapeHtml(dataPanelStatusMessage)}</p>`;
};

const getHistoryRowsHtml = (entries: HistoryEntry[]): string => {
  return entries
    .map((entry) => {
      const safeUrl = escapeHtml(entry.url);
      const safeTitle = escapeHtml(entry.title || entry.url);
      const safeVisitedAt = escapeHtml(
        new Date(entry.visitedAt).toLocaleString("pl-PL"),
      );

      return `<li><a href="${safeUrl}" title="${safeTitle}">${safeTitle}</a><span>${safeVisitedAt}</span></li>`;
    })
    .join("");
};

const renderHistoryWindowHtml = (entries: HistoryEntry[]): string => {
  const rows = getHistoryRowsHtml(entries);

  const clearHistoryLabel = rows ? "Usuń całą historię" : "Historia jest już pusta";
  const clearHistoryDisabled = rows ? "" : "disabled";

  return `<!doctype html>
<html lang="pl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MonoBrowser History</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "Segoe UI", system-ui, sans-serif;
      }

      body {
        margin: 0;
        background: #1e1f22;
        color: #dde1e6;
      }

      header {
        padding: 14px 16px;
        border-bottom: 1px solid #3c3f41;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }

      .clear-history {
        border: 1px solid #4a4d50;
        background: #2b2d30;
        color: #dde1e6;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.12s;
      }

      .clear-history:hover:not(:disabled) {
        background: #3a3d40;
      }

      .clear-history:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      main {
        padding: 8px;
      }

      .split {
        display: grid;
        grid-template-columns: minmax(0, 1.7fr) minmax(220px, 1fr);
        gap: 12px;
      }

      .panel {
        background: #25272a;
        border: 1px solid #3c3f41;
        border-radius: 10px;
        min-height: 340px;
      }

      .panel-title {
        padding: 10px 12px;
        border-bottom: 1px solid #3c3f41;
        font-size: 12px;
        color: #a7adb5;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }

      .history-panel ul {
        padding: 6px;
      }

      .data-panel {
        padding: 12px;
        display: grid;
        gap: 8px;
        align-content: start;
      }

      .data-panel p {
        color: #b6bcc4;
        font-size: 12px;
        line-height: 1.45;
        margin: 0 0 6px;
      }

      .danger-btn {
        border: 1px solid #4a4d50;
        background: #2b2d30;
        color: #dde1e6;
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 12px;
        font-family: inherit;
        cursor: pointer;
        text-align: left;
        transition: background 0.12s;
      }

      .danger-btn:hover {
        background: #3a3d40;
      }

      .status {
        margin-top: 6px;
        padding: 8px 10px;
        border: 1px solid #4a4d50;
        border-radius: 8px;
        background: #2b2d30;
        color: #d6dbe1;
        font-size: 12px;
      }

      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }

      li {
        display: grid;
        gap: 2px;
        padding: 10px;
        border-radius: 8px;
      }

      li:hover {
        background: #2b2d30;
      }

      a {
        color: #6ab4ff;
        text-decoration: none;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      a:hover {
        text-decoration: underline;
      }

      span {
        color: #8c9198;
        font-size: 12px;
      }

      .empty {
        padding: 16px;
        color: #8c9198;
      }

      @media (max-width: 820px) {
        .split {
          grid-template-columns: 1fr;
        }

        .panel {
          min-height: auto;
        }
      }
    </style>
  </head>
  <body>
    <header>
      <span>Historia przeglądania</span>
      <form action="${CLEAR_HISTORY_URL}" method="get">
        <button class="clear-history" type="submit" ${clearHistoryDisabled}>${clearHistoryLabel}</button>
      </form>
    </header>
    <main>
      <div class="split">
        <section class="panel history-panel">
          <div class="panel-title">Historia</div>
          ${rows ? `<ul>${rows}</ul>` : '<div class="empty">Brak wpisów w historii.</div>'}
        </section>
        <aside class="panel data-panel">
          <div class="panel-title">Wyczyść dane</div>
          <p>W tym panelu usuniesz dane przeglądarki dla wszystkich stron.</p>
          <form action="${CLEAR_COOKIES_URL}" method="get">
            <button class="danger-btn" type="submit">Usuń wszystkie cookies</button>
          </form>
          <form action="${CLEAR_CACHE_URL}" method="get">
            <button class="danger-btn" type="submit">Usuń cache</button>
          </form>
          ${getDataPanelStatusHtml()}
        </aside>
      </div>
    </main>
  </body>
</html>`;
};

const loadHistoryWindowContent = async (): Promise<void> => {
  if (!historyWindow || historyWindow.isDestroyed()) {
    return;
  }

  const html = renderHistoryWindowHtml(historyEntries);
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
  await historyWindow.loadURL(url);
};

const openHistoryWindow = async (): Promise<void> => {
  if (historyWindow && !historyWindow.isDestroyed()) {
    historyWindow.focus();
    return;
  }

  historyWindow = new BrowserWindow({
    width: 720,
    height: 540,
    minWidth: 520,
    minHeight: 380,
    title: "MonoBrowser History",
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  historyWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isClearHistoryUrl(url) || isClearCookiesUrl(url) || isClearCacheUrl(url)) {
      void handleHistoryWindowNavigation(url);
      return { action: "deny" };
    }

    return { action: "deny" };
  });

  historyWindow.webContents.on("will-navigate", (event, url) => {
    if (isClearHistoryUrl(url) || isClearCookiesUrl(url) || isClearCacheUrl(url)) {
      event.preventDefault();
      void handleHistoryWindowNavigation(url);
    }
  });

  historyWindow.on("closed", () => {
    historyWindow = null;
  });

  await loadHistoryWindowContent();
};

const handleHistoryWindowNavigation = async (url: string): Promise<void> => {
  if (isClearHistoryUrl(url)) {
    dataPanelStatusMessage = "Historia została wyczyszczona.";
    await clearHistory();
    return;
  }

  if (isClearCookiesUrl(url)) {
    await clearCookies();
    dataPanelStatusMessage = "Wszystkie cookies zostały usunięte.";
    broadcastHistory();
    return;
  }

  if (isClearCacheUrl(url)) {
    await clearCacheData();
    dataPanelStatusMessage = "Cache został wyczyszczony.";
    broadcastHistory();
  }
};

const saveHistory = async (): Promise<void> => {
  if (!historyFilePath) {
    return;
  }

  await fs.mkdir(path.dirname(historyFilePath), { recursive: true });
  await fs.writeFile(
    historyFilePath,
    JSON.stringify(historyEntries, null, 2),
    "utf8",
  );
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
  if (!/^https?:\/\//i.test(url)) {
    return;
  }

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

const handleBeforeInputEvent = (
  event: Electron.Event,
  input: Electron.Input,
): void => {
  if (input.type !== "keyDown" && input.type !== "rawKeyDown") {
    return;
  }

  const hasCommandModifier = !!(input.control || input.meta);
  if (!hasCommandModifier || input.alt) {
    return;
  }

  const key = (input.key || "").toLowerCase();
  const code = (input.code || "").toLowerCase();
  let action: ShortcutAction | null = null;

  if (key === "t" || code === "keyt") {
    action = "new-tab";
  } else if (key === "w" || code === "keyw") {
    action = "close-tab";
  } else if (key === "r" || code === "keyr") {
    action = "reload";
  }

  if (!action) {
    return;
  }

  event.preventDefault();

  if (action === "new-tab") {
    openNewTab();
    return;
  }

  if (action === "close-tab") {
    const activeTab = getActiveTab();
    if (!activeTab) {
      return;
    }

    closeCurrentTab();
    return;
  }

  const activeTab = getActiveTab();
  if (activeTab) {
    activeTab.view.webContents.reload();
  }
};

const registerWindowShortcuts = (windowRef: BrowserWindow): void => {
  // Menu is now configured globally via setApplicationMenu.
};

const applyActiveViewBounds = (): void => {
  if (!mainWindow || activeTabId === null) {
    return;
  }

  const activeTab = tabs.get(activeTabId);
  if (!activeTab) {
    return;
  }

  const [width, height] = mainWindow.getContentSize();
  const safeTop = Math.max(0, Math.min(viewportTop, Math.max(0, height - 100)));

  activeTab.view.setBounds({
    x: 0,
    y: safeTop,
    width,
    height: Math.max(height - safeTop, 0),
  });
};

const updateTabFromWebContents = (tab: TabRecord): void => {
  const contents = tab.view.webContents;

  tab.url = contents.getURL() || tab.url;
  tab.title = contents.getTitle() || tab.title;
  tab.isLoading = contents.isLoading();
  tab.canGoBack = contents.navigationHistory.canGoBack();
  tab.canGoForward = contents.navigationHistory.canGoForward();

  broadcastTabsState();
};

const setActiveTab = (id: number): boolean => {
  if (!mainWindow) {
    return false;
  }

  const tab = tabs.get(id);
  if (!tab) {
    return false;
  }

  mainWindow.setBrowserView(tab.view);
  activeTabId = id;
  promoteTabInMruOrder(id);
  applyActiveViewBounds();
  updateTabFromWebContents(tab);

  return true;
};

const closeTab = (id: number): boolean => {
  if (!tabs.has(id)) {
    return false;
  }

  const wasActive = activeTabId === id;
  const tabToClose = tabs.get(id)!;
  tabs.delete(id);
  removeTabFromMruOrder(id);
  tabToClose.view.webContents.close();

  if (tabs.size === 0) {
    activeTabId = null;
    if (mainWindow) {
      mainWindow.setBrowserView(null);
    }
  } else if (wasActive) {
    const nextId = getMostRecentTabId();
    if (nextId !== null) {
      setActiveTab(nextId);
    } else if (mainWindow) {
      activeTabId = null;
      mainWindow.setBrowserView(null);
    }
  }

  broadcastTabsState();
  return true;
};

const createTab = (
  initialUrl: string = DEFAULT_URL,
  makeActive: boolean = true,
  preloadNextHomeTab: boolean = true,
): number => {
  const id = nextTabId++;
  const normalizedInitialUrl = normalizeInputToUrl(initialUrl);
  const preloadedView = consumePreloadedHomeTabView(normalizedInitialUrl);
  const view = preloadedView ?? createTabView();

  if (isDefaultStartPageUrl(normalizedInitialUrl)) {
    applyStartPageBackgroundToView(view);
  }

  const tab: TabRecord = {
    id,
    title: "New Tab",
    url: normalizedInitialUrl,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    view,
  };

  const contents = view.webContents;

  contents.on("dom-ready", () => {
    runBackgroundProbeIfStartPage(contents);
  });
  contents.on("did-start-loading", () => updateTabFromWebContents(tab));
  contents.on("did-stop-loading", () => updateTabFromWebContents(tab));
  contents.on("page-title-updated", () => updateTabFromWebContents(tab));
  contents.on("did-navigate", () => updateTabFromWebContents(tab));
  contents.on("did-navigate-in-page", () => updateTabFromWebContents(tab));
  contents.on("did-finish-load", async () => {
    updateTabFromWebContents(tab);
    void updateStartPageBackgroundFromContents(contents);
    await appendHistory(contents.getURL(), contents.getTitle());
  });

  tabs.set(id, tab);
  appendTabToMruOrder(id);

  if (makeActive) {
    setActiveTab(id);
  } else {
    broadcastTabsState();
  }

  if (!preloadedView) {
    contents.loadURL(normalizedInitialUrl).catch(() => undefined);
  } else if (!contents.isLoading()) {
    updateTabFromWebContents(tab);
    void appendHistory(contents.getURL(), contents.getTitle());
  }

  if (preloadNextHomeTab) {
    ensurePreloadedHomeTab();
  }

  return id;
};

const openNewTab = (initialUrl?: string): number => {
  const requestedUrl = initialUrl?.trim();
  if (requestedUrl) {
    return createTab(requestedUrl, true);
  }

  return createTab(DEFAULT_URL, true);
};

const closeCurrentTab = (): boolean => {
  if (activeTabId === null) {
    return false;
  }

  return closeTab(activeTabId);
};

const getActiveTab = (): TabRecord | null => {
  if (activeTabId === null) {
    return null;
  }

  return tabs.get(activeTabId) ?? null;
};

const registerIpc = (): void => {
  ipcMain.handle("tabs:create", (_event, initialUrl?: string) => {
    return openNewTab(initialUrl);
  });

  ipcMain.on("tabs:create-shortcut", (_event, initialUrl?: string) => {
    openNewTab(initialUrl);
  });

  ipcMain.handle("tabs:close", (_event, tabId: number) => {
    return closeTab(tabId);
  });

  ipcMain.on("tabs:close-shortcut", () => {
    closeCurrentTab();
  });

  ipcMain.handle("tabs:switch", (_event, tabId: number) => {
    const switched = setActiveTab(tabId);
    broadcastTabsState();
    return switched;
  });

  ipcMain.handle("tabs:get-state", () => {
    return getTabsStatePayload();
  });

  ipcMain.handle("nav:go", async (_event, input: string) => {
    const tab = getActiveTab();
    if (!tab) {
      return false;
    }

    try {
      await tab.view.webContents.loadURL(normalizeInputToUrl(input));
    } catch (err: any) {
      // Ignorujemy ERR_ABORTED, ponieważ występuje naturalnie podczas szybkiej nawigacji lub przekierowań na stronach
      if (err?.code !== "ERR_ABORTED") {
        console.error("Navigation failed:", err);
      }
    }
    
    updateTabFromWebContents(tab);
    return true;
  });

  ipcMain.handle("nav:back", async () => {
    const tab = getActiveTab();
    if (!tab) {
      return false;
    }

    if (tab.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
      return true;
    }

    return false;
  });

  ipcMain.handle("nav:forward", async () => {
    const tab = getActiveTab();
    if (!tab) {
      return false;
    }

    if (tab.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
      return true;
    }

    return false;
  });

  ipcMain.handle("nav:reload", async () => {
    const tab = getActiveTab();
    if (!tab) {
      return false;
    }

    tab.view.webContents.reload();
    return true;
  });

  ipcMain.on("nav:reload-shortcut", () => {
    const tab = getActiveTab();
    if (!tab) {
      return;
    }

    tab.view.webContents.reload();
  });

  ipcMain.handle("history:get", () => {
    return historyEntries;
  });

  ipcMain.handle("history:open-window", async () => {
    await openHistoryWindow();
    return true;
  });

  ipcMain.handle("layout:set-viewport-top", (_event, top: number) => {
    if (typeof top !== "number" || Number.isNaN(top)) {
      return false;
    }

    viewportTop = Math.max(80, Math.floor(top));
    applyActiveViewBounds();
    return true;
  });
};

const registerAutoUpdater = (): void => {
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
    console.error("Auto-update error:", error);
  });

  autoUpdater.on("update-downloaded", async () => {
    const windowRef = mainWindow;
    if (!windowRef) {
      autoUpdater.quitAndInstall();
      return;
    }

    const result = await dialog.showMessageBox(windowRef, {
      type: "info",
      title: "Update ready",
      message: "A new version of MonoBrowser has been downloaded.",
      detail: "Restart now to install the update.",
      buttons: ["Restart now", "Later"],
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

const scheduleAutoUpdateChecks = (): void => {
  if (!app.isPackaged) {
    return;
  }

  registerAutoUpdater();

  const checkForUpdates = (): void => {
    if (updateCheckInProgress) {
      return;
    }

    updateCheckInProgress = true;
    void autoUpdater.checkForUpdatesAndNotify();
  };

  const initialDelayMs = 45 * 1000;
  const sixHoursMs = 6 * 60 * 60 * 1000;
  setTimeout(checkForUpdates, initialDelayMs);
  setInterval(checkForUpdates, sixHoursMs);
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

  mainWindow.on("resize", () => applyActiveViewBounds());
  mainWindow.on("closed", () => {
    destroyPreloadedHomeTab();
    mainWindow = null;
  });

  registerWindowShortcuts(mainWindow);

  mainWindow.setMenuBarVisibility(false);

  onProgress?.(58, "Loading app shell...");
  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  onProgress?.(79, "Opening first tab...");
  createTab(DEFAULT_URL, true, false);
  broadcastHistory();

  if (showImmediately && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
};

const setupApplicationMenu = (): void => {
  const isMac = process.platform === "darwin";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        {
          label: "New Tab",
          accelerator: "CmdOrCtrl+T",
          click: () => {
            openNewTab();
          },
        },
        {
          label: "Close Tab",
          accelerator: "CmdOrCtrl+W",
          click: () => {
            closeCurrentTab();
          },
        },
        { role: "quit" } as MenuItemConstructorOptions,
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" } as MenuItemConstructorOptions,
        { role: "redo" } as MenuItemConstructorOptions,
        { type: "separator" } as MenuItemConstructorOptions,
        { role: "cut" } as MenuItemConstructorOptions,
        { role: "copy" } as MenuItemConstructorOptions,
        { role: "paste" } as MenuItemConstructorOptions,
        ...(isMac
          ? ([
              { role: "pasteAndMatchStyle" },
              { role: "delete" },
              { role: "selectAll" },
              { type: "separator" },
              {
                label: "Speech",
                submenu: [{ role: "startSpeaking" }, { role: "stopSpeaking" }],
              },
            ] as MenuItemConstructorOptions[])
          : ([{ role: "delete" }, { type: "separator" }, { role: "selectAll" }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            const tab = getActiveTab();
            if (tab) {
              tab.view.webContents.reload();
            }
          },
        },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ] as MenuItemConstructorOptions[],
    },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        { role: "zoom" },
        ...(isMac
          ? ([
              { type: "separator" },
              { role: "front" },
              { type: "separator" },
              { role: "window" },
            ] as MenuItemConstructorOptions[])
          : []),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const bootstrap = async (): Promise<void> => {
  app.setName("MonoBrowser");
  historyFilePath = path.join(app.getPath("userData"), "history.json");
  startPageBackgroundFilePath = path.join(
    app.getPath("userData"),
    START_PAGE_BACKGROUND_FILE,
  );

  await loadStartPageBackgroundColor();
  applyStartPageBackgroundColor();

  await createSplashWindow();
  updateSplashProgress(8, "Starting MonoBrowser...");

  if (SPLASH_ONLY_MODE) {
    updateSplashProgress(100, "Splash preview mode");
    return;
  }

  registerIpc();

  const historyLoadPromise = loadHistory().then(() => {
    broadcastHistory();
  });

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

  void historyLoadPromise;
  scheduleAutoUpdateChecks();
};

app
  .whenReady()
  .then(bootstrap)
  .catch((error) => {
    console.error("Failed to bootstrap app:", error);
    app.quit();
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
