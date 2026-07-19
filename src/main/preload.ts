import { contextBridge, ipcRenderer } from "electron";

type TabState = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  isPinned: boolean;
  isMuted: boolean;
};

type TabsStatePayload = {
  tabs: TabState[];
  activeTabId: number | null;
};

type HistoryEntry = {
  id: string;
  url: string;
  title: string;
  visitedAt: string;
};

type DownloadStatus = "in-progress" | "completed" | "cancelled" | "interrupted" | "failed";
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
type SiteDataType = "cookies" | "localStorage" | "indexedDB" | "cache" | "serviceWorkers";
type SiteDataEntry = { origin: string; lastSeenAt: string | null; cookieCount: number };
type ClearResult = { ok: boolean; message: string };
type AppLanguage = "pl" | "en";
type SearchEngine = "google" | "duckduckgo" | "custom";
type SearchSettings = { engine: SearchEngine; customUrl: string };
type SearchSettingsResult = { ok: boolean; message: string; settings: SearchSettings };
type UBlockStatus = { loaded: boolean; name: string; version: string; error: string | null };
type FindResult = { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean };

const browserApi = {
  createTab: (initialUrl?: string): Promise<number> =>
    ipcRenderer.invoke("tabs:create", initialUrl),
  closeTab: (tabId: number): Promise<boolean> =>
    ipcRenderer.invoke("tabs:close", tabId),
  switchTab: (tabId: number): Promise<boolean> =>
    ipcRenderer.invoke("tabs:switch", tabId),
  getTabsState: (): Promise<TabsStatePayload> =>
    ipcRenderer.invoke("tabs:get-state"),
  openTabContextMenu: (tabId: number, anchor: { x: number; y: number }): Promise<boolean> =>
    ipcRenderer.invoke("tabs:open-context-menu", tabId, anchor),
  findInPage: (query: string, options: { forward: boolean; findNext: boolean }): Promise<FindResult | null> =>
    ipcRenderer.invoke("find:start", query, options),
  stopFindInPage: (action: "clearSelection" | "keepSelection" | "activateSelection"): Promise<boolean> =>
    ipcRenderer.invoke("find:stop", action),
  showFindWindow: (): Promise<boolean> => ipcRenderer.invoke("find:show-window"),
  hideFindWindow: (): Promise<boolean> => ipcRenderer.invoke("find:hide-window"),
  navigate: (input: string): Promise<boolean> =>
    ipcRenderer.invoke("nav:go", input),
  back: (): Promise<boolean> => ipcRenderer.invoke("nav:back"),
  forward: (): Promise<boolean> => ipcRenderer.invoke("nav:forward"),
  reload: (): Promise<boolean> => ipcRenderer.invoke("nav:reload"),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke("history:get"),
  openHistoryWindow: (): Promise<boolean> =>
    ipcRenderer.invoke("history:open-window"),
  openDownloadsWindow: (): Promise<boolean> =>
    ipcRenderer.invoke("downloads:open-window"),
  openSiteDataWindow: (): Promise<boolean> =>
    ipcRenderer.invoke("site-data:open-window"),
  getDownloads: (): Promise<DownloadRecord[]> => ipcRenderer.invoke("downloads:get"),
  cancelDownload: (id: string): Promise<boolean> => ipcRenderer.invoke("downloads:cancel", id),
  clearDownloadsHistory: (): Promise<boolean> => ipcRenderer.invoke("downloads:clear-history"),
  openDownloadedFile: (id: string): Promise<boolean> => ipcRenderer.invoke("downloads:open-file", id),
  showDownloadInFolder: (id: string): Promise<boolean> => ipcRenderer.invoke("downloads:show-in-folder", id),
  listSiteData: (): Promise<SiteDataEntry[]> => ipcRenderer.invoke("site-data:list"),
  clearSiteData: (origin: string, dataTypes: SiteDataType[]): Promise<ClearResult> =>
    ipcRenderer.invoke("site-data:clear", origin, dataTypes),
  clearGlobalSiteData: (dataTypes: SiteDataType[]): Promise<ClearResult> =>
    ipcRenderer.invoke("site-data:clear-global", dataTypes),
  clearGlobalHistory: (): Promise<ClearResult> => ipcRenderer.invoke("site-data:clear-history"),
  getLanguage: (): Promise<AppLanguage> => ipcRenderer.invoke("language:get"),
  setLanguage: (language: AppLanguage): Promise<boolean> => ipcRenderer.invoke("language:set", language),
  getSearchSettings: (): Promise<SearchSettings> => ipcRenderer.invoke("settings:get-search"),
  setSearchSettings: (settings: SearchSettings): Promise<SearchSettingsResult> =>
    ipcRenderer.invoke("settings:set-search", settings),
  openSettingsWindow: (): Promise<boolean> => ipcRenderer.invoke("settings:open-window"),
  getUBlockStatus: (): Promise<UBlockStatus> => ipcRenderer.invoke("ublock:get-status"),
  openNavigationMenu: (anchor: { x: number; y: number }): Promise<boolean> =>
    ipcRenderer.invoke("navigation-menu:open", anchor),
  openSiteInfoMenu: (anchor: { x: number; y: number }): Promise<boolean> =>
    ipcRenderer.invoke("site-info-menu:open", anchor),
  setViewportTop: (top: number): Promise<boolean> =>
    ipcRenderer.invoke("layout:set-viewport-top", top),
  onTabsState: (
    callback: (payload: TabsStatePayload) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: TabsStatePayload,
    ) => callback(payload);
    ipcRenderer.on("tabs:state", listener);
    return () => ipcRenderer.removeListener("tabs:state", listener);
  },
  onHistoryUpdated: (
    callback: (entries: HistoryEntry[]) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      entries: HistoryEntry[],
    ) => callback(entries);
    ipcRenderer.on("history:updated", listener);
    return () => ipcRenderer.removeListener("history:updated", listener);
  },
  onDownloadsUpdated: (
    callback: (payload: { downloads: DownloadRecord[] }) => void,
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: { downloads: DownloadRecord[] },
    ) => callback(payload);
    ipcRenderer.on("downloads:updated", listener);
    return () => ipcRenderer.removeListener("downloads:updated", listener);
  },
  onLanguageChanged: (callback: (language: AppLanguage) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, language: AppLanguage) => callback(language);
    ipcRenderer.on("language:changed", listener);
    return () => ipcRenderer.removeListener("language:changed", listener);
  },
  onFocusAddress: (callback: () => void): (() => void) => {
    const listener = () => callback();
    ipcRenderer.on("address:focus", listener);
    return () => ipcRenderer.removeListener("address:focus", listener);
  },
  triggerNewTabShortcut: (initialUrl?: string): void => {
    ipcRenderer.send("tabs:create-shortcut", initialUrl);
  },
  triggerCloseTabShortcut: (): void => {
    ipcRenderer.send("tabs:close-shortcut");
  },
  triggerReloadShortcut: (): void => {
    ipcRenderer.send("nav:reload-shortcut");
  },
};

contextBridge.exposeInMainWorld("browserApi", browserApi);
