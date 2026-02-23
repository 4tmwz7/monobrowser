import { contextBridge, ipcRenderer } from "electron";

type TabState = {
  id: number;
  title: string;
  url: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
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

const browserApi = {
  createTab: (initialUrl?: string): Promise<number> =>
    ipcRenderer.invoke("tabs:create", initialUrl),
  closeTab: (tabId: number): Promise<boolean> =>
    ipcRenderer.invoke("tabs:close", tabId),
  switchTab: (tabId: number): Promise<boolean> =>
    ipcRenderer.invoke("tabs:switch", tabId),
  getTabsState: (): Promise<TabsStatePayload> =>
    ipcRenderer.invoke("tabs:get-state"),
  navigate: (input: string): Promise<boolean> =>
    ipcRenderer.invoke("nav:go", input),
  back: (): Promise<boolean> => ipcRenderer.invoke("nav:back"),
  forward: (): Promise<boolean> => ipcRenderer.invoke("nav:forward"),
  reload: (): Promise<boolean> => ipcRenderer.invoke("nav:reload"),
  getHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke("history:get"),
  openHistoryWindow: (): Promise<boolean> =>
    ipcRenderer.invoke("history:open-window"),
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
};

contextBridge.exposeInMainWorld("browserApi", browserApi);
