import { contextBridge, ipcRenderer, webUtils } from "electron";

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
  splitGroupId?: number | null;
  splitSide?: "left" | "right" | null;
};

type WorkspaceInfo = { id: string; name: string; icon: string; color: string | null; colorCss: string | null; count: number };

type WorkspacesPayload = {
  workspaces: WorkspaceInfo[];
  currentWorkspaceId: string;
};

type TabsStatePayload = {
  tabs: TabState[];
  activeTabId: number | null;
} & Partial<WorkspacesPayload>;

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
  kind?: "update";
};
type SiteDataType = "cookies" | "localStorage" | "indexedDB" | "cache" | "serviceWorkers";
type SiteDataEntry = { origin: string; lastSeenAt: string | null; cookieCount: number };
type ClearResult = { ok: boolean; message: string };
type AppLanguage = "pl" | "en";
type LayoutSettings = {
  tabBarLayout: "horizontal" | "vertical";
  verticalTabBarWidth: number;
  verticalTabBarCollapsed: boolean;
  compactMode: boolean;
};
type StartupSettings = { startupMode: "restore" | "newtab" };
type GlanceSettings = { enabled: boolean; trigger: "alt" | "ctrl" | "shift" | "longpress" };
type GlanceViewState = {
  title: string;
  url: string;
  loading: boolean;
  frame: { x: number; y: number; width: number; height: number };
  barHeight: number;
  labels: { close: string; expand: string; background: string; loading: string };
};
type SearchEngine = "google" | "duckduckgo" | "custom";
type SearchSettings = { engine: SearchEngine; customUrl: string };
type ThemeSettingsPayload = { id: string; custom?: Record<string, string> };
type ThemeStatePayload = { settings: ThemeSettingsPayload; tokens: Record<string, string>; systemDark: boolean };
type SearchSettingsResult = { ok: boolean; message: string; settings: SearchSettings };
type AdblockerStatus = {
  enabled: boolean;
  ready: boolean;
  blockedTotal: number;
  activeTabBlocked: number;
  activeTabPaused: boolean;
  error: string | null;
};type FindResult = { requestId: number; activeMatchOrdinal: number; matches: number; finalUpdate: boolean };
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
type UserScriptResult = { ok: boolean; message: string; script?: UserScript };
type UserScriptImportResult = { ok: boolean; message: string; draft: UserScriptDraft | null };
type PaletteItem = {
  id: string;
  kind: "command" | "tab";
  label: string;
  hint?: string;
  keywords?: string;
  tabId?: number;
};

const browserApi = {
  createTab: (initialUrl?: string): Promise<number> =>
    ipcRenderer.invoke("tabs:create", initialUrl),
  closeTab: (tabId: number): Promise<boolean> =>
    ipcRenderer.invoke("tabs:close", tabId),
  moveTab: (tabId: number, beforeTabId: number | null): Promise<boolean> =>
    ipcRenderer.invoke("tabs:move", tabId, beforeTabId),
  switchTab: (tabId: number): Promise<boolean> =>
    ipcRenderer.invoke("tabs:switch", tabId),
  getTabsState: (): Promise<TabsStatePayload> =>
    ipcRenderer.invoke("tabs:get-state"),
  getWorkspaces: (): Promise<WorkspacesPayload> => ipcRenderer.invoke("workspaces:get"),
  switchWorkspace: (id: string): Promise<boolean> => ipcRenderer.invoke("workspaces:switch", id),
  createWorkspace: (anchor?: { x: number; y: number; rect?: { x: number; y: number; width: number; height: number }; placement?: "below" | "above" | "right" }): Promise<string | null> =>
    ipcRenderer.invoke("workspaces:create", anchor),
  updateWorkspace: (id: string, patch: { name?: string; icon?: string; color?: string | null }): Promise<boolean> =>
    ipcRenderer.invoke("workspaces:update", id, patch),
  moveWorkspace: (id: string, delta: number): Promise<boolean> => ipcRenderer.invoke("workspaces:move", id, delta),
  deleteWorkspace: (id: string): Promise<boolean> => ipcRenderer.invoke("workspaces:delete", id),
  moveTabToWorkspace: (tabId: number, workspaceId: string): Promise<boolean> =>
    ipcRenderer.invoke("workspaces:move-tab", tabId, workspaceId),
  openWorkspaceSwitcher: (anchor: { x: number; y: number; rect?: { x: number; y: number; width: number; height: number }; placement?: "below" | "above" | "right" }): Promise<boolean> =>
    ipcRenderer.invoke("workspaces:open-switcher", anchor),
  openWorkspaceMenu: (id: string, anchor: { x: number; y: number; rect?: { x: number; y: number; width: number; height: number }; placement?: "below" | "above" | "right" }): Promise<boolean> =>
    ipcRenderer.invoke("workspaces:open-menu", id, anchor),
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
  getTheme: (): Promise<ThemeStatePayload> => ipcRenderer.invoke("theme:get"),
  setTheme: (settings: ThemeSettingsPayload): Promise<ThemeStatePayload> => ipcRenderer.invoke("theme:set", settings),
  onThemeChanged: (callback: (state: ThemeStatePayload) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ThemeStatePayload) => callback(state);
    ipcRenderer.on("theme:changed", listener);
    return () => ipcRenderer.removeListener("theme:changed", listener);
  },
  onSettingsDataChanged: (callback: (topic: string, data: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, topic: string, data: unknown) => callback(topic, data);
    ipcRenderer.on("settings:data-changed", listener);
    return () => ipcRenderer.removeListener("settings:data-changed", listener);
  },
  openSettingsWindow: (): Promise<boolean> => ipcRenderer.invoke("settings:open-window"),
  getAdblockStatus: (): Promise<AdblockerStatus> => ipcRenderer.invoke("adblock:status"),
  toggleAdblock: (): Promise<AdblockerStatus> => ipcRenderer.invoke("adblock:toggle"),
  listAdblockExceptions: (): Promise<string[]> => ipcRenderer.invoke("adblock:exceptions-list"),
  addAdblockException: (host: string): Promise<{ ok: boolean; hosts: string[] }> => ipcRenderer.invoke("adblock:exceptions-add", host),
  removeAdblockException: (host: string): Promise<{ ok: boolean; hosts: string[] }> => ipcRenderer.invoke("adblock:exceptions-remove", host),
  toggleAdblockTabPause: (): Promise<AdblockerStatus> =>
    ipcRenderer.invoke("adblock:toggle-tab-pause"),
  listUserScripts: (): Promise<UserScript[]> => ipcRenderer.invoke("userscripts:list"),
  saveUserScript: (draft: UserScriptDraft): Promise<UserScriptResult> =>
    ipcRenderer.invoke("userscripts:save", draft),
  toggleUserScript: (id: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke("userscripts:toggle", id, enabled),
  removeUserScript: (id: string): Promise<boolean> => ipcRenderer.invoke("userscripts:remove", id),
  importUserScriptFromFile: (): Promise<UserScriptImportResult> =>
    ipcRenderer.invoke("userscripts:import-file"),
  openNavigationMenu: (anchor: { x: number; y: number; rect?: { x: number; y: number; width: number; height: number }; placement?: "below" | "above" | "right" }): Promise<boolean> =>
    ipcRenderer.invoke("navigation-menu:open", anchor),
  openSiteInfoMenu: (anchor: { x: number; y: number; rect?: { x: number; y: number; width: number; height: number }; placement?: "below" | "above" | "right" }): Promise<boolean> =>
    ipcRenderer.invoke("site-info-menu:open", anchor),
  setViewport: (rect: { x: number; y: number }): Promise<boolean> =>
    ipcRenderer.invoke("layout:set-viewport", rect),
  setSidebarDragging: (dragging: boolean): Promise<boolean> =>
    ipcRenderer.invoke("layout:sidebar-dragging", dragging),
  // Compact mode (chrome overlay): what keeps the revealed chrome open.
  setCompactKeep: (flags: { address: boolean }): void => ipcRenderer.send("compact:keep", flags),
  setCompactPointer: (inside: boolean): void => ipcRenderer.send("compact:pointer", inside),
  // Split view: a tab drag started/ended (page area turns into left/right drop zones).
  notifyTabDrag: (tabId: number | null): void => ipcRenderer.send("split:tab-drag", tabId),
  getLayoutSettings: (): Promise<LayoutSettings> => ipcRenderer.invoke("layout:get"),
  setLayoutSettings: (patch: Partial<LayoutSettings>): Promise<LayoutSettings> =>
    ipcRenderer.invoke("layout:set", patch),
  onLayoutChanged: (callback: (layout: LayoutSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, layout: LayoutSettings) => callback(layout);
    ipcRenderer.on("layout:changed", listener);
    return () => ipcRenderer.removeListener("layout:changed", listener);
  },
  getExperimentalSettings: (): Promise<unknown> => ipcRenderer.invoke("experimental:get"),
  setExperimentalSettings: (patch: Record<string, unknown>): Promise<unknown> =>
    ipcRenderer.invoke("experimental:set", patch),
  getGlanceSettings: (): Promise<GlanceSettings> => ipcRenderer.invoke("glance:get"),
  setGlanceSettings: (patch: Partial<GlanceSettings>): Promise<GlanceSettings> =>
    ipcRenderer.invoke("glance:set", patch),
  onGlanceSettingsChanged: (callback: (settings: GlanceSettings) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, settings: GlanceSettings) => callback(settings);
    ipcRenderer.on("glance:changed", listener);
    return () => ipcRenderer.removeListener("glance:changed", listener);
  },
  getGlanceState: (): Promise<GlanceViewState | null> => ipcRenderer.invoke("glance:get-state"),
  onGlanceState: (callback: (state: GlanceViewState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: GlanceViewState) => callback(state);
    ipcRenderer.on("glance:state", listener);
    return () => ipcRenderer.removeListener("glance:state", listener);
  },
  closeGlance: (): Promise<boolean> => ipcRenderer.invoke("glance:close"),
  expandGlance: (): Promise<boolean> => ipcRenderer.invoke("glance:expand"),
  openGlanceInBackground: (): Promise<boolean> => ipcRenderer.invoke("glance:background"),
  showPaletteWindow: (): Promise<boolean> => ipcRenderer.invoke("palette:show"),
  hidePaletteWindow: (): Promise<boolean> => ipcRenderer.invoke("palette:hide"),
  getPaletteItems: (): Promise<PaletteItem[]> =>
    ipcRenderer.invoke("palette:get-items"),
  executePaletteCommand: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("palette:execute", id),
  reportPaletteHeight: (height: number): void =>
    ipcRenderer.send("palette:report-height", height),
  triggerPaletteShortcut: (): void => {
    ipcRenderer.send("palette:toggle-shortcut");
  },
  showNotesWindow: (): Promise<boolean> => ipcRenderer.invoke("notes:show"),
  hideNotesWindow: (): Promise<boolean> => ipcRenderer.invoke("notes:hide"),
  toggleNotesWindow: (): Promise<boolean> => ipcRenderer.invoke("notes:toggle"),
  getNotes: (): Promise<string> => ipcRenderer.invoke("notes:get"),
  saveNotes: (value: string): Promise<boolean> =>
    ipcRenderer.invoke("notes:save", value),
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
  toggleTabMute: (tabId: number): Promise<boolean> => ipcRenderer.invoke("tabs:toggle-mute", tabId),
  resetZoom: (): Promise<boolean> => ipcRenderer.invoke("tabs:reset-zoom"),
  getPathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return "";
    }
  },
  openDropped: (payload: { uriList: string; text: string; filePaths: string[] }): Promise<number> =>
    ipcRenderer.invoke("tabs:open-dropped", payload),
  getUpdateStatus: (): Promise<{ status: { state: string; releaseUrl?: string | null }; text: string }> => ipcRenderer.invoke("about:get-update-status"),
  checkForUpdates: (): Promise<{ status: { state: string; releaseUrl?: string | null }; text: string }> => ipcRenderer.invoke("about:check-updates"),
  openAboutLink: (url: string): Promise<boolean> => ipcRenderer.invoke("about:open-link", url),
  getLicenses: (): Promise<string> => ipcRenderer.invoke("about:get-licenses"),
  setOnboardingStep: (index: number): Promise<boolean> => ipcRenderer.invoke("onboarding:set-step", index),
  finishOnboarding: (): Promise<boolean> => ipcRenderer.invoke("onboarding:finish"),
  getAnimationSettings: (): Promise<{ enabled: boolean }> => ipcRenderer.invoke("animations:get"),
  setAnimationSettings: (patch: { enabled: boolean }): Promise<{ enabled: boolean }> => ipcRenderer.invoke("animations:set", patch),
  getStartupSettings: (): Promise<StartupSettings> => ipcRenderer.invoke("startup:get"),
  setStartupSettings: (patch: Partial<StartupSettings>): Promise<StartupSettings> =>
    ipcRenderer.invoke("startup:set", patch),
  getPortableState: (): Promise<unknown> => ipcRenderer.invoke("portable:get-state"),
  setPortableEncryption: (payload: { enabled: boolean; password?: string; confirm?: string }): Promise<unknown> =>
    ipcRenderer.invoke("portable:set-encryption", payload),
  syncPortableVault: (): Promise<unknown> => ipcRenderer.invoke("portable:sync-now"),
  resetPortableVault: (): Promise<unknown> => ipcRenderer.invoke("portable:reset-vault"),
  setPortableDownloads: (enabled: boolean): Promise<unknown> => ipcRenderer.invoke("portable:set-downloads", enabled),
};

contextBridge.exposeInMainWorld("browserApi", browserApi);
