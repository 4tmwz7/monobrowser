import { contextBridge, ipcRenderer } from "electron";

// Bridge of the portable-vault unlock window (password prompt shown at startup).
contextBridge.exposeInMainWorld("unlockApi", {
  tryPassword: (password: string): Promise<boolean> => ipcRenderer.invoke("portable-unlock:try", password),
  skip: (): void => ipcRenderer.send("portable-unlock:skip"),
});
