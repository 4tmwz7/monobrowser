import { app, BrowserView, BrowserWindow, dialog, ipcMain } from "electron";
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

type HistoryEntry = {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
};

const DEFAULT_URL = "https://www.google.com";
const MAX_HISTORY_ITEMS = 500;

let mainWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let historyFilePath = "";
let viewportTop = 170;
let nextTabId = 1;
let activeTabId: number | null = null;
let historyEntries: HistoryEntry[] = [];

const tabs = new Map<number, TabRecord>();

let updateCheckInProgress = false;

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

const renderHistoryWindowHtml = (entries: HistoryEntry[]): string => {
  const rows = entries
    .map((entry) => {
      const safeUrl = escapeHtml(entry.url);
      const safeTitle = escapeHtml(entry.title || entry.url);
      const safeVisitedAt = escapeHtml(
        new Date(entry.visitedAt).toLocaleString("pl-PL"),
      );

      return `<li><a href="${safeUrl}" title="${safeTitle}">${safeTitle}</a><span>${safeVisitedAt}</span></li>`;
    })
    .join("");

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
      }

      main {
        padding: 8px;
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
    </style>
  </head>
  <body>
    <header>Historia przeglądania</header>
    <main>
      ${rows ? `<ul>${rows}</ul>` : '<div class="empty">Brak wpisów w historii.</div>'}
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

  historyWindow.on("closed", () => {
    historyWindow = null;
  });

  await loadHistoryWindowContent();
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
  tab.canGoBack = contents.canGoBack();
  tab.canGoForward = contents.canGoForward();

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
  tabToClose.view.webContents.close();

  if (tabs.size === 0) {
    activeTabId = null;
    if (mainWindow) {
      mainWindow.setBrowserView(null);
    }
  } else if (wasActive) {
    const nextId = tabs.keys().next().value as number;
    setActiveTab(nextId);
  }

  broadcastTabsState();
  return true;
};

const createTab = (
  initialUrl: string = DEFAULT_URL,
  makeActive: boolean = true,
): number => {
  const id = nextTabId++;

  const view = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const tab: TabRecord = {
    id,
    title: "New Tab",
    url: initialUrl,
    isLoading: false,
    canGoBack: false,
    canGoForward: false,
    view,
  };

  const contents = view.webContents;

  contents.on("did-start-loading", () => updateTabFromWebContents(tab));
  contents.on("did-stop-loading", () => updateTabFromWebContents(tab));
  contents.on("page-title-updated", () => updateTabFromWebContents(tab));
  contents.on("did-navigate", () => updateTabFromWebContents(tab));
  contents.on("did-navigate-in-page", () => updateTabFromWebContents(tab));
  contents.on("did-finish-load", async () => {
    updateTabFromWebContents(tab);
    await appendHistory(contents.getURL(), contents.getTitle());
  });

  tabs.set(id, tab);

  if (makeActive) {
    setActiveTab(id);
  } else {
    broadcastTabsState();
  }

  contents.loadURL(normalizeInputToUrl(initialUrl)).catch(() => undefined);

  return id;
};

const getActiveTab = (): TabRecord | null => {
  if (activeTabId === null) {
    return null;
  }

  return tabs.get(activeTabId) ?? null;
};

const registerIpc = (): void => {
  ipcMain.handle("tabs:create", (_event, initialUrl?: string) => {
    return createTab(initialUrl || DEFAULT_URL, true);
  });

  ipcMain.handle("tabs:close", (_event, tabId: number) => {
    return closeTab(tabId);
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

    await tab.view.webContents.loadURL(normalizeInputToUrl(input));
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

  checkForUpdates();

  const sixHoursMs = 6 * 60 * 60 * 1000;
  setInterval(checkForUpdates, sixHoursMs);
};

const createMainWindow = async (): Promise<void> => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    autoHideMenuBar: true,
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
    mainWindow = null;
  });

  mainWindow.setMenuBarVisibility(false);

  await mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  createTab(DEFAULT_URL, true);
  broadcastHistory();
};

const bootstrap = async (): Promise<void> => {
  app.setName("MonoBrowser");
  historyFilePath = path.join(app.getPath("userData"), "history.json");
  await loadHistory();
  registerIpc();
  await createMainWindow();
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
