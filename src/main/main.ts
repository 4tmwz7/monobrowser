import { app, BrowserView, BrowserWindow, dialog, ipcMain, session, Menu, shell, MenuItemConstructorOptions } from "electron";
import type { DownloadItem, Extension, WebContents } from "electron";
import fsSync from "node:fs";
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

type HistoryEntry = {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
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

type UBlockStatus = {
  loaded: boolean;
  name: string;
  version: string;
  error: string | null;
};

type SearchSettingsResult = {
  ok: boolean;
  message: string;
  settings: SearchSettings;
};

const START_PAGE_URL = "monobrowser://new-tab";
const DEFAULT_URL = START_PAGE_URL;
const DEFAULT_SEARCH_SETTINGS: SearchSettings = {
  engine: "google",
  customUrl: "https://example.com/search?q={query}",
};
const MAX_HISTORY_ITEMS = 500;
const MAX_DOWNLOAD_ITEMS = 500;
const ALLOWED_SITE_DATA_TYPES = new Set<SiteDataType>([
  "cookies",
  "localStorage",
  "indexedDB",
  "cache",
  "serviceWorkers",
]);
const CLEAR_HISTORY_URL = "monobrowser://clear-history";
const SPLASH_ONLY_MODE =
  process.argv.includes("--splash-only") ||
  process.env.MONOBROWSER_SPLASH_ONLY === "1";

let mainWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let downloadsWindow: BrowserWindow | null = null;
let downloadProgressView: BrowserView | null = null;
let downloadProgressVisible = false;
let siteDataWindow: BrowserWindow | null = null;
let settingsWindow: BrowserWindow | null = null;
let historyFilePath = "";
let downloadsFilePath = "";
let siteOriginsFilePath = "";
let languageFilePath = "";
let searchSettingsFilePath = "";
let viewportTop = 170;
let nextTabId = 1;
let activeTabId: number | null = null;
let historyEntries: HistoryEntry[] = [];
let downloadRecords: DownloadRecord[] = [];
let siteOriginRecords: SiteOriginRecord[] = [];
let appLanguage: AppLanguage = "pl";
let searchSettings: SearchSettings = { ...DEFAULT_SEARCH_SETTINGS };
let ublockExtension: Extension | null = null;
let ublockLoadError: string | null = null;
let bebasNeueFontDataUrl: string | null = null;
let splashWindow: BrowserWindow | null = null;

const tabs = new Map<number, TabRecord>();
const activeDownloads = new Map<string, DownloadItem>();
const jsonWriteQueues = new Map<string, Promise<void>>();
const tabMruOrder: number[] = [];
const startPageDataUrls = new Set<string>();
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
  <meta name="theme-color" content="#0a0a0a">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:">
  <title>${copy.title}</title>
  <style>
    @font-face { font-family:"Bebas Neue"; src:url("${bebasNeueFontUrl}") format("truetype"); font-style:normal; font-weight:400; font-display:block; }
    :root { color-scheme: light; --black:#0a0a0a; --white:#f0efe9; --accent:#9c9b95; --grey:#5c5b57; font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace; }
    * { box-sizing: border-box; }
    body { min-height:100vh; margin:0; overflow:hidden; background:var(--white); color:var(--black); cursor:crosshair; }
    body::after { content:""; position:fixed; inset:0; z-index:5; pointer-events:none; opacity:.035; background:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
    main { min-height:100vh; display:grid; grid-template-columns:minmax(330px,.82fr) minmax(520px,1.18fr); }
    .brand-panel { position:relative; padding:clamp(38px,5vw,76px); border-right:3px solid var(--black); display:flex; flex-direction:column; justify-content:center; overflow:hidden; }
    .brand-panel::after { content:"0.3.3"; position:absolute; right:16px; bottom:18px; color:var(--grey); font-size:10px; letter-spacing:.28em; writing-mode:vertical-rl; }
    .brand { margin:0; font-family:"Bebas Neue", Impact, sans-serif; font-size:clamp(72px,10vw,160px); font-weight:400; line-height:.85; letter-spacing:-2px; text-transform:uppercase; }
    .brand .outline { color:transparent; -webkit-text-stroke:2px var(--black); }
    .brand .accent { color:var(--accent); display:inline-block; animation:glitch 4s infinite; }
    .search-panel { position:relative; padding:clamp(42px,6vw,84px); display:flex; flex-direction:column; justify-content:center; background:var(--black); color:var(--white); }
    h1 { max-width:640px; margin:0 0 34px; font-family:"Bebas Neue",Impact,sans-serif; font-size:clamp(54px,7vw,96px); font-weight:400; line-height:.9; letter-spacing:1px; text-transform:uppercase; }
    form { display:grid; grid-template-columns:minmax(0,1fr) auto; border:2px solid var(--white); background:var(--black); transition:transform .15s, box-shadow .15s; }
    form:focus-within { transform:translate(-4px,-4px); box-shadow:6px 6px 0 var(--accent); }
    input { min-width:0; height:62px; padding:0 18px; border:0; outline:0; background:transparent; color:var(--white); font:14px ui-monospace,"Cascadia Mono","Courier New",monospace; }
    input::placeholder { color:#777671; }
    button { min-width:132px; height:62px; padding:0 22px; border:0; border-left:2px solid var(--white); background:var(--white); color:var(--black); font:700 10px ui-monospace,"Cascadia Mono","Courier New",monospace; letter-spacing:.22em; text-transform:uppercase; cursor:pointer; }
    button:hover { background:var(--accent); }
    @keyframes glitch { 0%,94%,100%{transform:none} 95%{transform:translate(-3px,1px)} 97%{transform:translate(3px,-1px)} 99%{transform:translate(-1px,-1px)} }
    @media(max-width:900px) { body{overflow:auto} main{grid-template-columns:1fr} .brand-panel{min-height:38vh;border-right:0;border-bottom:3px solid var(--black)} .brand{font-size:clamp(72px,17vw,120px)} .search-panel{min-height:62vh} }
    @media(max-width:620px) { .search-panel,.brand-panel{padding:30px 22px} form{grid-template-columns:1fr} button{width:100%;border-left:0;border-top:2px solid var(--white)} }
  </style>
</head>
<body>
  <main>
    <section class="brand-panel">
      <div class="brand"><span class="outline">MONO</span><br><span class="accent">BROW</span><br>SER</div>
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
  const url = `data:text/html;charset=utf-8,${encodeURIComponent(renderStartPageHtml())}`;
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

  if (trimmed === START_PAGE_URL) {
    return START_PAGE_URL;
  }

  if (/^about:blank(?:[?#].*)?$/i.test(trimmed)) {
    return trimmed;
  }

  const hasProtocol = /^https?:\/\//i.test(trimmed);
  if (hasProtocol) {
    return trimmed;
  }

  const host = trimmed.split("/")[0];
  const looksLikeHost = !/\s/.test(trimmed) && (
    /^localhost(?::\d+)?$/i.test(host) ||
    /^(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?$/.test(host) ||
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d+)?$/i.test(host)
  );
  if (looksLikeHost) {
    return `https://${trimmed}`;
  }

  return buildSearchUrl(trimmed);
};

const openUrlInNewTab = (url: string): void => {
  const trimmed = url.trim();

  if (!trimmed) {
    openNewTab(DEFAULT_URL);
    return;
  }

  if (/^https?:\/\//i.test(trimmed) || /^about:blank(?:[?#].*)?$/i.test(trimmed)) {
    openNewTab(trimmed);
  }
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

  view.webContents.setWindowOpenHandler(({ url }) => {
    openUrlInNewTab(url);
    return { action: "deny" };
  });

  return view;
};

const broadcastTabsState = (): void => {
  if (tabsBroadcastScheduled) {
    return;
  }

  tabsBroadcastScheduled = true;
  setImmediate(() => {
    tabsBroadcastScheduled = false;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("tabs:state", getTabsStatePayload());
    }
  });
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
    searchSettings = normalizeSearchSettings(JSON.parse(raw)) ?? { ...DEFAULT_SEARCH_SETTINGS };
  } catch {
    searchSettings = { ...DEFAULT_SEARCH_SETTINGS };
  }
};

const saveSearchSettings = async (): Promise<void> => {
  await writeJsonAtomically(searchSettingsFilePath, searchSettings);
};

const refreshStartPages = async (): Promise<void> => {
  const reloads: Promise<void>[] = [];
  for (const tab of tabs.values()) {
    if (tab.url !== START_PAGE_URL || tab.view.webContents.isDestroyed()) {
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

const getBundledUBlockPath = (): string | null => {
  const candidates = [
    path.join(process.resourcesPath, "extensions", "ublock-origin"),
    path.join(app.getAppPath(), "vendor", "ublock-origin"),
    path.join(__dirname, "..", "..", "vendor", "ublock-origin"),
  ];

  for (const candidate of candidates) {
    if (fsSync.existsSync(path.join(candidate, "manifest.json"))) {
      return candidate;
    }
  }

  return null;
};

const loadBundledUBlock = async (): Promise<void> => {
  const extensionPath = getBundledUBlockPath();
  if (!extensionPath) {
    ublockLoadError = appLanguage === "pl"
      ? "Nie znaleziono plików rozszerzenia."
      : "Extension files were not found.";
    return;
  }

  try {
    ublockExtension = await session.defaultSession.extensions.loadExtension(extensionPath);
    ublockLoadError = null;
    console.info(`Loaded ${ublockExtension.name} ${ublockExtension.version}`);
  } catch (error) {
    ublockExtension = null;
    ublockLoadError = error instanceof Error ? error.message : String(error);
    console.error("Failed to load uBlock Origin:", error);
  }
};

const getUBlockStatus = (): UBlockStatus => ({
  loaded: ublockExtension !== null,
  name: ublockExtension?.name ?? "uBlock Origin",
  version: ublockExtension?.version ?? "1.72.2",
  error: ublockLoadError,
});

const localeForLanguage = (): string => appLanguage === "pl" ? "pl-PL" : "en-US";

const saveDownloads = async (): Promise<void> => {
  downloadRecords = downloadRecords.slice(0, MAX_DOWNLOAD_ITEMS);
  await writeJsonAtomically(downloadsFilePath, downloadRecords);
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
    x: Math.max(0, contentWidth - width - margin),
    y: Math.max(viewportTop, contentHeight - height - margin),
    width,
    height,
  });
};

const attachDownloadProgressView = (): void => {
  if (!mainWindow || mainWindow.isDestroyed() || !downloadProgressView || downloadProgressView.webContents.isDestroyed()) {
    return;
  }
  if (!mainWindow.getBrowserViews().includes(downloadProgressView)) {
    mainWindow.addBrowserView(downloadProgressView);
  }
  mainWindow.setTopBrowserView(downloadProgressView);
  positionDownloadProgressView();
  downloadProgressVisible = true;
};

const hideDownloadProgressView = (): void => {
  if (mainWindow && !mainWindow.isDestroyed() && downloadProgressView && mainWindow.getBrowserViews().includes(downloadProgressView)) {
    mainWindow.removeBrowserView(downloadProgressView);
  }
  downloadProgressVisible = false;
};

const createDownloadProgressView = async (): Promise<BrowserView | null> => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return null;
  }
  if (downloadProgressView && !downloadProgressView.webContents.isDestroyed()) {
    return downloadProgressView;
  }

  downloadProgressView = new BrowserView({
    webPreferences: {
      preload: path.join(__dirname, "download-progress-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  downloadProgressView.setBackgroundColor("#00000000");
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
  if (downloadsWindow && !downloadsWindow.isDestroyed()) {
    downloadsWindow.webContents.send("downloads:updated", getDownloadStatePayload());
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

      return `<li><a href="${safeUrl}" title="${safeTitle}" target="_blank" rel="noopener noreferrer">${safeTitle}</a><span>${safeVisitedAt}</span></li>`;
    })
    .join("");
};

const renderHistoryWindowHtml = (entries: HistoryEntry[]): string => {
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
    <title>${copy.documentTitle}</title>
    <style>
      :root {
        color-scheme: light;
        --black: #0a0a0a;
        --white: #f0efe9;
        --accent: #9c9b95;
        --grey: #5c5b57;
        font-family: ui-monospace, "Cascadia Mono", "Courier New", monospace;
      }

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

      .clear-history {
        border: 2px solid var(--white);
        background: var(--white);
        color: var(--black);
        border-radius: 0;
        padding: 8px 11px;
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
        font-family: inherit;
        cursor: pointer;
        transition: background 0.12s;
      }

      .clear-history:hover:not(:disabled) {
        background: var(--accent);
      }

      .clear-history:disabled {
        opacity: 0.45;
        cursor: not-allowed;
      }

      main {
        padding: 14px;
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
        background: #d7d6d0;
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

      .empty {
        padding: 16px;
        color: var(--grey);
        flex: 1 1 auto;
      }

    </style>
  </head>
  <body>
    <header>
      <span>${copy.heading}</span>
      <form action="${CLEAR_HISTORY_URL}" method="get" onsubmit="return confirm('${copy.confirm}')">
        <button class="clear-history" type="submit" ${clearHistoryDisabled}>${clearHistoryLabel}</button>
      </form>
    </header>
    <main>
      <section class="panel history-panel">
        ${rows ? `<ul>${rows}</ul>` : `<div class="empty">${copy.empty}</div>`}
      </section>
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
    title: appLanguage === "pl" ? "MonoBrowser — Historia" : "MonoBrowser — History",
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  historyWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isClearHistoryUrl(url)) {
      void handleHistoryWindowNavigation(url);
      return { action: "deny" };
    }

    openUrlInNewTab(url);
    return { action: "deny" };
  });

  historyWindow.webContents.on("will-navigate", (event, url) => {
    if (isClearHistoryUrl(url)) {
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
    await clearHistory();
  }
};

const INTERNAL_WINDOW_STYLES = `
  :root { color-scheme:light; --black:#0a0a0a; --white:#f0efe9; --accent:#9c9b95; --grey:#5c5b57; font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; }
  * { box-sizing: border-box; }
  body { min-height:100vh; margin:0; background:var(--white); color:var(--black); }
  body::after { content:""; position:fixed; inset:0; z-index:20; pointer-events:none; opacity:.03; background:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  header { position:sticky; top:0; z-index:2; display:flex; align-items:center; justify-content:space-between; gap:12px; padding:15px 18px; border-bottom:3px solid var(--black); background:var(--black); color:var(--white); }
  h1 { margin:0; font-size:14px; letter-spacing:.12em; text-transform:uppercase; }
  button, input { font: inherit; }
  button { border:2px solid var(--black); background:var(--black); color:var(--white); border-radius:0; padding:8px 11px; font-size:10px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; }
  header button { border-color:var(--white); background:var(--white); color:var(--black); }
  button:hover:not(:disabled) { background:var(--accent); color:var(--black); }
  button:disabled { opacity: .45; cursor: not-allowed; }
  button.danger { border-color:var(--black); background:var(--white); color:var(--black); }
  header button.danger { border-color:var(--white); }
  main { padding: 14px 18px; }
  .empty, .muted { color:var(--grey); }
  .empty { padding: 30px 12px; text-align: center; }
  .status-message { margin:10px 0; padding:10px 12px; border:2px solid var(--black); border-radius:0; background:var(--white); font-size:12px; }
`;

const renderDownloadsWindowHtml = (): string => {
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
  .status { font-size:10px; border:1px solid var(--black); border-radius:0; padding:4px 7px; background:var(--black); color:var(--white); text-transform:uppercase; white-space:nowrap; }
  .status.completed { color:#b8e1b9; } .status.cancelled,.status.interrupted,.status.failed { color:#f0b8b8; }
  .details { display:grid; gap:3px; color:var(--grey); font-size:11px; }
  .path { overflow-wrap: anywhere; }
  .progress-row { display: flex; align-items: center; gap: 10px; font-size: 12px; }
  progress { flex:1; height:10px; accent-color:var(--black); }
  .actions { display: flex; flex-wrap: wrap; gap: 7px; }
  .error { color:#8b2931; font-size:11px; }
</style></head><body>
<header><h1>${copy.heading}</h1><button id="clear" class="danger">${copy.clearHistory}</button></header>
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
      if (record.status === 'completed') {
        actions.append(action(copy.openFile, async () => { if (!await window.browserApi.openDownloadedFile(record.id)) showMessage(copy.openFailed); }));
        actions.append(action(copy.showInFolder, async () => { if (!await window.browserApi.showDownloadInFolder(record.id)) showMessage(copy.showFailed); }));
      }
      if (actions.childElementCount) card.append(actions); list.append(card);
    }
  };
  clearButton.addEventListener('click', async () => {
    if (!confirm(copy.clearConfirm)) return;
    if (!await window.browserApi.clearDownloadsHistory()) showMessage(copy.clearFailed);
  });
  window.browserApi.onDownloadsUpdated(payload => render(payload.downloads));
  window.browserApi.getDownloads().then(render).catch(() => showMessage(copy.loadFailed));
})();
</script></body></html>`;
};

const renderSiteDataWindowHtml = (): string => {
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
  #filter { width:100%; border:2px solid var(--white); background:var(--black); color:var(--white); border-radius:0; padding:10px 11px; outline:none; }
  #filter:focus { box-shadow:4px 4px 0 var(--accent); }
  table { width:100%; border-collapse:collapse; background:var(--white); border:2px solid var(--black); }
  th,td { padding:11px 12px; border-bottom:1px solid var(--black); text-align:left; font-size:12px; }
  th { color:var(--grey); font-size:10px; letter-spacing:.08em; text-transform:uppercase; } td:first-child { overflow-wrap:anywhere; }
  footer { margin-top:16px; padding:15px; background:var(--white); border:2px solid var(--black); border-radius:0; }
  footer h2 { margin:0 0 6px; font-size:14px; } .global-actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
  dialog { width:min(520px,calc(100vw - 30px)); border:3px solid var(--black); border-radius:0; padding:0; background:var(--white); color:var(--black); }
  dialog::backdrop { background:rgba(0,0,0,.65); } .modal-body { padding:18px; } .modal-body h2 { margin:0 0 7px; font-size:16px; overflow-wrap:anywhere; }
  .warning { color:#8b4c12; font-size:12px; line-height:1.45; } .choices { display:grid; gap:9px; margin:16px 0; } label { display:flex; align-items:center; gap:9px; } input[type=checkbox] { accent-color:var(--black); }
  .modal-actions { display:flex; justify-content:flex-end; gap:8px; }
  @media(max-width:720px) { th:nth-child(2),td:nth-child(2) { display:none; } }
</style></head><body>
<header><div class="heading"><h1>${copy.heading}</h1><button id="refresh">${copy.refresh}</button></div><input id="filter" type="text" placeholder="${copy.filter}" autocomplete="off"></header>
<main><div id="message" hidden class="status-message"></div><div id="content"></div>
<footer><h2>${copy.allSites}</h2><div class="muted">${copy.globalNote}</div><div class="global-actions"><button id="clear-history" class="danger">${copy.clearHistory}</button><button id="clear-cookies" class="danger">${copy.clearCookies}</button><button id="clear-cache" class="danger">${copy.clearCache}</button></div></footer></main>
<dialog id="dialog"><form method="dialog" class="modal-body"><h2 id="modal-title"></h2><p class="warning">${copy.warning}</p><div class="choices">
  <label><input type="checkbox" value="cookies" checked> ${copy.cookieType}</label><label><input type="checkbox" value="localStorage" checked> ${copy.localStorageType}</label><label><input type="checkbox" value="indexedDB" checked> ${copy.indexedDbType}</label><label><input type="checkbox" value="cache" checked> ${copy.cacheType}</label><label><input type="checkbox" value="serviceWorkers" checked> ${copy.serviceWorkersType}</label>
</div><div class="modal-actions"><button value="cancel">${copy.cancel}</button><button id="confirm" value="default" class="danger">${copy.clearData}</button></div></form></dialog>
<script>
(() => {
  const copy = ${copyJson};
  let entries = []; let selectedOrigin = null;
  const content = document.getElementById('content'), filter = document.getElementById('filter'), dialog = document.getElementById('dialog'), confirmButton = document.getElementById('confirm'), message = document.getElementById('message');
  const showMessage = (text, ok) => { message.textContent = text; message.style.borderColor = ok ? '#46734f' : '#724247'; message.hidden = false; };
  const render = () => {
    const query = filter.value.trim().toLowerCase(); const visible = entries.filter(entry => entry.origin.toLowerCase().includes(query)); content.replaceChildren();
    if (!visible.length) { const empty=document.createElement('div'); empty.className='empty'; empty.textContent=query?copy.noMatches:copy.noOrigins; content.append(empty); return; }
    const table=document.createElement('table'), head=document.createElement('thead'), body=document.createElement('tbody'); head.innerHTML='<tr><th>'+copy.origin+'</th><th>'+copy.lastActivity+'</th><th>'+copy.cookies+'</th><th></th></tr>';
    for (const entry of visible) { const row=document.createElement('tr'); const origin=document.createElement('td'); origin.textContent=entry.origin; const seen=document.createElement('td'); seen.textContent=entry.lastSeenAt?new Date(entry.lastSeenAt).toLocaleString(copy.locale):copy.cookieOnly; const count=document.createElement('td'); count.textContent=String(entry.cookieCount); const action=document.createElement('td'); const button=document.createElement('button'); button.textContent=copy.clearData; button.addEventListener('click',()=>openModal(entry.origin)); action.append(button); row.append(origin,seen,count,action); body.append(row); }
    table.append(head,body); content.append(table);
  };
  const load = async () => { try { entries=await window.browserApi.listSiteData(); render(); } catch { showMessage(copy.loadFailed,false); } };
  const openModal = origin => { selectedOrigin=origin; document.getElementById('modal-title').textContent=copy.clearTitle+origin; dialog.querySelectorAll('input[type=checkbox]').forEach(input=>input.checked=true); updateConfirm(); dialog.showModal(); };
  const updateConfirm = () => { confirmButton.disabled=!dialog.querySelector('input[type=checkbox]:checked'); };
  dialog.querySelectorAll('input[type=checkbox]').forEach(input=>input.addEventListener('change',updateConfirm));
  dialog.addEventListener('close', async () => { if (dialog.returnValue!=='default'||!selectedOrigin) return; const types=[...dialog.querySelectorAll('input[type=checkbox]:checked')].map(input=>input.value); const result=await window.browserApi.clearSiteData(selectedOrigin,types); showMessage(result.message,result.ok); selectedOrigin=null; await load(); });
  filter.addEventListener('input',render); document.getElementById('refresh').addEventListener('click',load);
  document.getElementById('clear-history').addEventListener('click',async()=>{ if(!confirm(copy.confirmHistory))return; const result=await window.browserApi.clearGlobalHistory(); showMessage(result.message,result.ok); });
  document.getElementById('clear-cookies').addEventListener('click',async()=>{ if(!confirm(copy.confirmCookies))return; const result=await window.browserApi.clearGlobalSiteData(['cookies']); showMessage(result.message,result.ok); await load(); });
  document.getElementById('clear-cache').addEventListener('click',async()=>{ if(!confirm(copy.confirmCache))return; const result=await window.browserApi.clearGlobalSiteData(['cache']); showMessage(result.message,result.ok); await load(); });
  load();
})();
</script></body></html>`;
};

const configureInternalWindow = (windowRef: BrowserWindow): void => {
  windowRef.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  windowRef.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("data:text/html")) {
      event.preventDefault();
    }
  });
};

const openDownloadsWindow = async (): Promise<void> => {
  if (downloadsWindow && !downloadsWindow.isDestroyed()) {
    downloadsWindow.focus();
    return;
  }
  downloadsWindow = new BrowserWindow({
    width: 820, height: 640, minWidth: 540, minHeight: 400,
    title: appLanguage === "pl" ? "MonoBrowser — Pobieranie" : "MonoBrowser — Downloads", autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  configureInternalWindow(downloadsWindow);
  downloadsWindow.on("closed", () => { downloadsWindow = null; });
  await downloadsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderDownloadsWindowHtml())}`);
};

const openSiteDataWindow = async (): Promise<void> => {
  if (siteDataWindow && !siteDataWindow.isDestroyed()) {
    siteDataWindow.focus();
    return;
  }
  siteDataWindow = new BrowserWindow({
    width: 900, height: 680, minWidth: 600, minHeight: 440,
    title: appLanguage === "pl" ? "MonoBrowser — Dane witryn" : "MonoBrowser — Site data", autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  configureInternalWindow(siteDataWindow);
  siteDataWindow.on("closed", () => { siteDataWindow = null; });
  await siteDataWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderSiteDataWindowHtml())}`);
};

const renderSettingsWindowHtml = (): string => {
  const copy = appLanguage === "pl" ? {
    title: "MonoBrowser — Ustawienia", heading: "Ustawienia", searchHeading: "Domyślna wyszukiwarka",
    searchDescription: "Wybierz usługę używaną przez pasek adresu i stronę startową.",
    googleDescription: "Szybkie wyniki wyszukiwania Google.", duckDescription: "Wyszukiwanie z naciskiem na prywatność.",
    custom: "Własna", customDescription: "Użyj dowolnego adresu wyszukiwania HTTP(S).",
    customLabel: "Adres wyszukiwania", customHint: "Wstaw {query} w miejscu wyszukiwanego tekstu.",
    save: "Zapisz ustawienia", blockerHeading: "Blokowanie treści", blockerDescription: "Wbudowana ochrona przed reklamami i modułami śledzącymi.",
    active: "Aktywny", unavailable: "Niedostępny", loading: "Wczytywanie ustawień…", loadFailed: "Nie udało się wczytać ustawień.",
  } : {
    title: "MonoBrowser — Settings", heading: "Settings", searchHeading: "Default search engine",
    searchDescription: "Choose the service used by the address bar and start page.",
    googleDescription: "Fast results powered by Google Search.", duckDescription: "Search with a focus on privacy.",
    custom: "Custom", customDescription: "Use any HTTP(S) search URL.",
    customLabel: "Search URL", customHint: "Place {query} where the search text should appear.",
    save: "Save settings", blockerHeading: "Content blocking", blockerDescription: "Built-in protection against ads and trackers.",
    active: "Active", unavailable: "Unavailable", loading: "Loading settings…", loadFailed: "Settings could not be loaded.",
  };
  const copyJson = JSON.stringify(copy).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${appLanguage}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:">
<title>${copy.title}</title><style>${INTERNAL_WINDOW_STYLES}
  :root { color-scheme:light; --black:#0a0a0a; --white:#f0efe9; --accent:#9c9b95; --grey:#5c5b57; font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; }
  body { min-height:100vh; background:var(--white); color:var(--black); }
  body::after { content:""; position:fixed; inset:0; pointer-events:none; opacity:.03; background:url("data:image/svg+xml,%3Csvg viewBox='0 0 180 180' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.95' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
  header { padding:19px 24px; border-bottom:3px solid var(--black); background:var(--black); color:var(--white); }
  header h1 { font-family:Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif; font-size:30px; letter-spacing:.06em; text-transform:uppercase; }
  main { width:min(760px,100%); margin:0 auto; padding:24px; display:grid; gap:16px; }
  .card { border:3px solid var(--black); border-radius:0; background:var(--white); padding:20px; box-shadow:none; }
  h2 { margin:0 0 5px; font-family:Impact,Haettenschweiler,"Arial Narrow Bold",sans-serif; font-size:22px; letter-spacing:.05em; text-transform:uppercase; } .description { margin:0 0 16px; color:var(--grey); font-size:11px; line-height:1.6; }
  .engines { display:grid; grid-template-columns:repeat(3,1fr); gap:9px; }
  .engine { position:relative; display:block; min-width:0; }
  .engine input { position:absolute; opacity:0; pointer-events:none; }
  .engine-body { height:100%; min-height:94px; padding:13px; border:2px solid var(--black); border-radius:0; background:transparent; cursor:pointer; display:block; transition:background .12s,color .12s,transform .12s,box-shadow .12s; }
  .engine-body:hover { transform:translate(-2px,-2px); box-shadow:3px 3px 0 var(--black); }
  .engine input:checked + .engine-body { background:var(--black); color:var(--white); box-shadow:4px 4px 0 var(--accent); }
  .engine-name { display:flex; align-items:center; gap:8px; margin-bottom:7px; font-size:13px; font-weight:650; }
  .engine-mark { width:9px; height:9px; border:1px solid currentColor; border-radius:0; background:transparent; }
  input:checked + .engine-body .engine-mark { background:var(--white); }
  .engine-copy { display:block; color:var(--grey); font-size:10px; line-height:1.5; } input:checked + .engine-body .engine-copy { color:#aaa9a3; }
  .custom-field { margin-top:14px; display:grid; gap:7px; }
  .custom-field label { color:var(--black); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  #custom-url { width:100%; padding:11px; border:2px solid var(--black); border-radius:0; outline:0; background:var(--white); color:var(--black); font:11px ui-monospace,"Cascadia Mono","Courier New",monospace; }
  #custom-url:focus { box-shadow:4px 4px 0 var(--accent); } #custom-url:disabled { opacity:.42; }
  .hint { color:var(--grey); font-size:10px; } code { color:var(--black); font-weight:700; }
  .actions { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:17px; }
  #message { min-height:18px; color:#34633e; font-size:11px; } #message.error { color:#8b2931; }
  #save { border:2px solid var(--black); border-radius:0; background:var(--black); color:var(--white); font-weight:700; text-transform:uppercase; letter-spacing:.12em; }
  #save:hover { background:var(--accent); color:var(--black); }
  .blocker-row { display:flex; align-items:center; justify-content:space-between; gap:16px; }
  .blocker-copy { display:grid; gap:4px; } .blocker-name { font-size:11px; font-weight:700; }
  .badge { display:inline-flex; align-items:center; gap:7px; padding:7px 10px; border:2px solid var(--black); border-radius:0; color:var(--white); background:var(--black); font-size:10px; text-transform:uppercase; letter-spacing:.1em; white-space:nowrap; }
  .badge::before { content:""; width:7px; height:7px; background:#7fc78e; }
  .badge.off::before { background:#c87f84; }
  @media(max-width:640px) { .engines { grid-template-columns:1fr; } .engine-body { min-height:0; } .blocker-row { align-items:flex-start; flex-direction:column; } }
</style></head><body>
<header><h1>${copy.heading}</h1></header>
<main>
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
  <section class="card blocker-row"><div class="blocker-copy"><h2>${copy.blockerHeading}</h2><p class="description">${copy.blockerDescription}</p><span id="blocker-name" class="blocker-name">uBlock Origin</span></div><span id="blocker-status" class="badge">${copy.active}</span></section>
</main>
<script>
(() => {
  const copy = ${copyJson};
  const form = document.getElementById('settings-form');
  const customUrl = document.getElementById('custom-url');
  const message = document.getElementById('message');
  const blockerName = document.getElementById('blocker-name');
  const blockerStatus = document.getElementById('blocker-status');
  const selectedEngine = () => form.querySelector('input[name=engine]:checked')?.value || 'google';
  const syncCustomState = () => { customUrl.disabled = selectedEngine() !== 'custom'; };
  form.querySelectorAll('input[name=engine]').forEach(input => input.addEventListener('change', syncCustomState));
  form.addEventListener('submit', async event => {
    event.preventDefault(); message.className = ''; message.textContent = '';
    const result = await window.browserApi.setSearchSettings({ engine:selectedEngine(), customUrl:customUrl.value });
    message.textContent = result.message; message.className = result.ok ? '' : 'error';
  });
  Promise.all([window.browserApi.getSearchSettings(), window.browserApi.getUBlockStatus()]).then(([settings, blocker]) => {
    const option = form.querySelector('input[value="' + settings.engine + '"]'); if (option) option.checked = true;
    customUrl.value = settings.customUrl; syncCustomState(); message.textContent = '';
    blockerName.textContent = blocker.name + ' ' + blocker.version;
    blockerStatus.textContent = blocker.loaded ? copy.active : copy.unavailable;
    blockerStatus.classList.toggle('off', !blocker.loaded);
    if (!blocker.loaded && blocker.error) blockerStatus.title = blocker.error;
  }).catch(() => { message.textContent = copy.loadFailed; message.className = 'error'; });
})();
</script></body></html>`;
};

const loadSettingsWindowContent = async (): Promise<void> => {
  if (!settingsWindow || settingsWindow.isDestroyed()) return;
  await settingsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderSettingsWindowHtml())}`);
};

const openSettingsWindow = async (): Promise<void> => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 760, height: 650, minWidth: 560, minHeight: 520,
    title: appLanguage === "pl" ? "MonoBrowser — Ustawienia" : "MonoBrowser — Settings", autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), "assets", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  configureInternalWindow(settingsWindow);
  settingsWindow.on("closed", () => { settingsWindow = null; });
  await loadSettingsWindowContent();
};

const refreshLocalizedWindows = async (): Promise<void> => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("language:changed", appLanguage);
  }
  broadcastDownloadProgress();
  if (historyWindow && !historyWindow.isDestroyed()) {
    await loadHistoryWindowContent();
  }
  if (downloadsWindow && !downloadsWindow.isDestroyed()) {
    await downloadsWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderDownloadsWindowHtml())}`);
  }
  if (siteDataWindow && !siteDataWindow.isDestroyed()) {
    await siteDataWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderSiteDataWindowHtml())}`);
  }
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    await loadSettingsWindowContent();
  }
  await refreshStartPages();
};

const setApplicationLanguage = async (language: AppLanguage): Promise<boolean> => {
  if (language === appLanguage) {
    return true;
  }
  appLanguage = language;
  await saveLanguage();
  setupApplicationMenu();
  await refreshLocalizedWindows();
  return true;
};

const openNavigationMenu = (anchor: unknown): boolean => {
  if (!mainWindow || mainWindow.isDestroyed() || typeof anchor !== "object" || anchor === null) {
    return false;
  }
  const raw = anchor as { x?: unknown; y?: unknown };
  if (typeof raw.x !== "number" || typeof raw.y !== "number" || !Number.isFinite(raw.x) || !Number.isFinite(raw.y)) {
    return false;
  }
  const copy = appLanguage === "pl" ? {
    settings: "Ustawienia", history: "Historia", downloads: "Pobieranie", siteData: "Dane witryn", language: "Język", polish: "Polski", english: "Angielski",
  } : {
    settings: "Settings", history: "History", downloads: "Downloads", siteData: "Site data", language: "Language", polish: "Polish", english: "English",
  };
  const menu = Menu.buildFromTemplate([
    { label: copy.settings, click: () => { void openSettingsWindow(); } },
    { type: "separator" },
    { label: copy.history, click: () => { void openHistoryWindow(); } },
    { label: copy.downloads, click: () => { void openDownloadsWindow(); } },
    { label: copy.siteData, click: () => { void openSiteDataWindow(); } },
    { type: "separator" },
    {
      label: copy.language,
      submenu: [
        { label: copy.polish, type: "radio", checked: appLanguage === "pl", click: () => { void setApplicationLanguage("pl"); } },
        { label: copy.english, type: "radio", checked: appLanguage === "en", click: () => { void setApplicationLanguage("en"); } },
      ],
    },
  ]);
  menu.popup({
    window: mainWindow,
    x: Math.max(0, Math.floor(raw.x)),
    y: Math.max(0, Math.floor(raw.y)),
  });
  return true;
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

  if (contents.isDestroyed() || !tabs.has(tab.id)) {
    return;
  }

  const loadedUrl = contents.getURL();
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

const setActiveTab = (id: number): boolean => {
  if (!mainWindow) {
    return false;
  }

  const tab = tabs.get(id);
  if (!tab) {
    return false;
  }

  mainWindow.setBrowserView(tab.view);
  if (downloadProgressVisible) {
    attachDownloadProgressView();
  }
  activeTabId = id;
  promoteTabInMruOrder(id);
  applyActiveViewBounds();
  updateTabFromWebContents(tab);
  broadcastTabsState();

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
): number => {
  const id = nextTabId++;
  const normalizedInitialUrl = normalizeInputToUrl(initialUrl);
  const view = createTabView();

  if (isDefaultStartPageUrl(normalizedInitialUrl)) {
    applyStartPageBackgroundToView(view);
  }

  const tab: TabRecord = {
    id,
    title: appLanguage === "pl" ? "Nowa karta" : "New Tab",
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

  contents.loadURL(resolveUrlForLoading(normalizedInitialUrl)).catch(() => undefined);

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
      const normalizedUrl = normalizeInputToUrl(input);
      tab.url = normalizedUrl;
      await tab.view.webContents.loadURL(resolveUrlForLoading(normalizedUrl));
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

  ipcMain.handle("downloads:open-window", async () => {
    await openDownloadsWindow();
    return true;
  });

  ipcMain.handle("site-data:open-window", async () => {
    await openSiteDataWindow();
    return true;
  });

  ipcMain.handle("downloads:get", () => {
    return getDownloadStatePayload().downloads;
  });

  ipcMain.handle("downloads:cancel", (_event, id: unknown) => {
    if (typeof id !== "string" || !id || id.length > 200) {
      return false;
    }
    const item = activeDownloads.get(id);
    if (!item) {
      return false;
    }
    item.cancel();
    return true;
  });

  ipcMain.handle("downloads:clear-history", async () => {
    downloadRecords = downloadRecords.filter((record) => activeDownloads.has(record.id));
    await saveDownloads();
    broadcastDownloads();
    return true;
  });

  ipcMain.handle("downloads:open-file", async (_event, id: unknown) => {
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

  ipcMain.handle("downloads:show-in-folder", async (_event, id: unknown) => {
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

  ipcMain.handle("site-data:list", async () => listSiteData());
  ipcMain.handle("site-data:clear", async (_event, origin: unknown, dataTypes: unknown) => {
    return clearSiteData(origin, dataTypes);
  });
  ipcMain.handle("site-data:clear-global", async (_event, dataTypes: unknown) => {
    return clearGlobalSiteData(dataTypes);
  });
  ipcMain.handle("site-data:clear-history", async () => {
    try {
      await clearHistory();
      return { ok: true, message: appLanguage === "pl" ? "Historia przeglądania została wyczyszczona." : "Browsing history was cleared." } satisfies ClearResult;
    } catch (error) {
      const detail = error instanceof Error ? error.message : appLanguage === "pl" ? "Nieznany błąd." : "Unknown error.";
      return { ok: false, message: appLanguage === "pl" ? `Nie udało się wyczyścić historii: ${detail}` : `History could not be cleared: ${detail}` } satisfies ClearResult;
    }
  });

  ipcMain.handle("language:get", () => appLanguage);
  ipcMain.handle("language:set", async (_event, value: unknown) => {
    const language = normalizeLanguage(value);
    if (!language) {
      return false;
    }
    return setApplicationLanguage(language);
  });
  ipcMain.handle("settings:get-search", () => ({ ...searchSettings }));
  ipcMain.handle("settings:set-search", async (_event, value: unknown) => setSearchSettings(value));
  ipcMain.handle("settings:open-window", async () => {
    await openSettingsWindow();
    return true;
  });
  ipcMain.handle("ublock:get-status", () => getUBlockStatus());
  ipcMain.handle("navigation-menu:open", (_event, anchor: unknown) => openNavigationMenu(anchor));

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

const scheduleAutoUpdateChecks = (): void => {
  if (!app.isPackaged) {
    return;
  }

  registerAutoUpdater();

  const checkForUpdates = async (): Promise<void> => {
    if (updateCheckInProgress) {
      return;
    }

    updateCheckInProgress = true;
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
        updateCheckInProgress = false;
        return;
      }
      await autoUpdater.checkForUpdatesAndNotify();
    } catch (error) {
      updateCheckInProgress = false;
      console.error("Lightweight update check failed:", error);
    }
  };

  const initialDelayMs = 45 * 1000;
  const sixHoursMs = 6 * 60 * 60 * 1000;
  setTimeout(() => { void checkForUpdates(); }, initialDelayMs);
  setInterval(() => { void checkForUpdates(); }, sixHoursMs);
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

  mainWindow.on("resize", () => {
    applyActiveViewBounds();
    positionDownloadProgressView();
  });
  mainWindow.on("minimize", hideDownloadProgressView);
  mainWindow.on("restore", broadcastDownloadProgress);
  mainWindow.on("closed", () => {
    if (downloadProgressHideTimer) {
      clearTimeout(downloadProgressHideTimer);
      downloadProgressHideTimer = null;
    }
    if (downloadProgressView && !downloadProgressView.webContents.isDestroyed()) {
      downloadProgressView.webContents.close();
    }
    downloadProgressView = null;
    downloadProgressVisible = false;
    mainWindow = null;
  });

  registerWindowShortcuts(mainWindow);

  mainWindow.setMenuBarVisibility(false);

  onProgress?.(58, "Loading app shell...");
  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  onProgress?.(79, "Opening first tab...");
  createTab(DEFAULT_URL, true);
  broadcastHistory();

  if (showImmediately && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
  }
};

const setupApplicationMenu = (): void => {
  const isMac = process.platform === "darwin";
  const copy = appLanguage === "pl" ? {
    file: "Plik", newTab: "Nowa karta", closeTab: "Zamknij kartę", quit: "Zakończ",
    edit: "Edycja", undo: "Cofnij", redo: "Ponów", cut: "Wytnij", copy: "Kopiuj", paste: "Wklej",
    pasteMatch: "Wklej i dopasuj styl", delete: "Usuń", selectAll: "Zaznacz wszystko", speech: "Mowa",
    view: "Widok", reload: "Odśwież", forceReload: "Wymuś odświeżenie", devTools: "Narzędzia deweloperskie",
    resetZoom: "Rozmiar rzeczywisty", zoomIn: "Powiększ", zoomOut: "Pomniejsz", fullscreen: "Pełny ekran",
    window: "Okno", minimize: "Minimalizuj", zoom: "Maksymalizuj", front: "Przenieś wszystko na wierzch",
  } : {
    file: "File", newTab: "New Tab", closeTab: "Close Tab", quit: "Quit",
    edit: "Edit", undo: "Undo", redo: "Redo", cut: "Cut", copy: "Copy", paste: "Paste",
    pasteMatch: "Paste and Match Style", delete: "Delete", selectAll: "Select All", speech: "Speech",
    view: "View", reload: "Reload", forceReload: "Force Reload", devTools: "Developer Tools",
    resetZoom: "Actual Size", zoomIn: "Zoom In", zoomOut: "Zoom Out", fullscreen: "Full Screen",
    window: "Window", minimize: "Minimize", zoom: "Zoom", front: "Bring All to Front",
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
            const tab = getActiveTab();
            if (tab) {
              tab.view.webContents.reload();
            }
          },
        },
        { role: "forceReload", label: copy.forceReload },
        { role: "toggleDevTools", label: copy.devTools },
        { type: "separator" },
        { role: "resetZoom", label: copy.resetZoom },
        { role: "zoomIn", label: copy.zoomIn },
        { role: "zoomOut", label: copy.zoomOut },
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
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
};

const bootstrap = async (): Promise<void> => {
  app.setName("MonoBrowser");
  historyFilePath = path.join(app.getPath("userData"), "history.json");
  downloadsFilePath = path.join(app.getPath("userData"), "downloads.json");
  siteOriginsFilePath = path.join(app.getPath("userData"), "site-origins.json");
  languageFilePath = path.join(app.getPath("userData"), "language.json");
  searchSettingsFilePath = path.join(app.getPath("userData"), "search-settings.json");
  startPageBackgroundFilePath = path.join(
    app.getPath("userData"),
    START_PAGE_BACKGROUND_FILE,
  );

  await Promise.all([loadStartPageBackgroundColor(), loadLanguage(), loadSearchSettings()]);
  applyStartPageBackgroundColor();

  const persistentDataLoad = Promise.all([
    loadHistory(),
    loadDownloads(),
    loadSiteOrigins(),
  ]);

  await createSplashWindow();
  updateSplashProgress(8, "Starting MonoBrowser...");

  if (SPLASH_ONLY_MODE) {
    updateSplashProgress(100, "Splash preview mode");
    return;
  }

  registerIpc();
  await persistentDataLoad;
  registerDownloadHandling();
  await loadBundledUBlock();

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
