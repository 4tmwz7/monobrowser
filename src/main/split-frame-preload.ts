import { contextBridge, ipcRenderer } from "electron";

// Bridge of the split-view frame (divider drag, tab drop zones, active pane border).
contextBridge.exposeInMainWorld("splitFrameApi", {
  onState: (callback: (state: unknown) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state);
    ipcRenderer.on("split-frame:state", listener);
    return () => ipcRenderer.removeListener("split-frame:state", listener);
  },
  dragStart: (): void => ipcRenderer.send("split-frame:drag-start"),
  dragMove: (x: number): void => ipcRenderer.send("split-frame:drag-move", x),
  dragEnd: (): void => ipcRenderer.send("split-frame:drag-end"),
  drop: (zone: "left" | "right"): void => ipcRenderer.send("split-frame:drop", zone),
  reset: (): void => ipcRenderer.send("split-frame:reset"),
});
