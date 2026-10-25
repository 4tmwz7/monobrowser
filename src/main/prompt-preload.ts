import { contextBridge, ipcRenderer } from "electron";

type PromptResult = { action: "primary" | "secondary"; username?: string; password?: string; selected?: string[] };

// Bridge of the in-window prompt overlay (permissions, HTTP auth, confirmations).
contextBridge.exposeInMainWorld("promptApi", {
  onShow: (callback: (payload: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) => callback(payload);
    ipcRenderer.on("prompt-overlay:show", listener);
    return () => ipcRenderer.removeListener("prompt-overlay:show", listener);
  },
  submit: (id: number, result: PromptResult): void => {
    ipcRenderer.send("prompt-overlay:submit", id, result);
  },
  reportHeight: (height: number): void => {
    ipcRenderer.send("prompt-overlay:height", height);
  },
});
