import { contextBridge, ipcRenderer } from "electron";

type DownloadStatus = "in-progress" | "completed" | "cancelled" | "interrupted" | "failed";

type DownloadProgressRecord = {
  id: string;
  fileName: string;
  receivedBytes: number;
  totalBytes: number;
  status: DownloadStatus;
};

type DownloadProgressPayload = {
  downloads: DownloadProgressRecord[];
  language: "pl" | "en";
};

contextBridge.exposeInMainWorld("downloadProgressApi", {
  onUpdated: (callback: (payload: DownloadProgressPayload) => void): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      payload: DownloadProgressPayload,
    ) => callback(payload);
    ipcRenderer.on("download-progress:updated", listener);
    return () => ipcRenderer.removeListener("download-progress:updated", listener);
  },
});
