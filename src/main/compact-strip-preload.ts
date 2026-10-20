import { ipcRenderer } from "electron";

// The hot-zone strip of compact mode: a thin invisible view at the window edge that reports the
// pointer entering it (the chrome is then revealed as an overlay).
const notify = (): void => ipcRenderer.send("compact:strip-enter");
window.addEventListener("mouseover", notify, true);
window.addEventListener("mousemove", notify, true);
