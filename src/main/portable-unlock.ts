// Themed in-app password prompt (a small BrowserWindow with our own HTML - never a native dialog) shown at startup
// when the portable cookie vault on the drive is password protected.
import path from "node:path";
import { BrowserWindow, ipcMain } from "electron";

type Language = "pl" | "en";

const UNLOCK_COPY = {
  pl: {
    title: "Odblokuj sesje", heading: "Odblokuj sesje przenośne",
    description: "Zalogowane sesje na tym nośniku są zaszyfrowane hasłem. Podaj hasło, aby zostać zalogowanym na stronach.",
    label: "Hasło", unlock: "Odblokuj", skip: "Pomiń", wrong: "Nieprawidłowe hasło.", working: "Sprawdzanie…",
    skipHint: "Pominięcie: przeglądarka wystartuje bez zapisanych logowań, a zaszyfrowany magazyn pozostanie nietknięty.",
  },
  en: {
    title: "Unlock sessions", heading: "Unlock portable sessions",
    description: "The logged-in sessions on this drive are protected with a password. Enter it to stay signed in to your sites.",
    label: "Password", unlock: "Unlock", skip: "Skip", wrong: "Wrong password.", working: "Checking…",
    skipHint: "Skipping starts the browser without saved logins and leaves the encrypted vault untouched.",
  },
} as const;

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] as string));

export const renderUnlockHtml = (language: Language): string => {
  const copy = UNLOCK_COPY[language];
  const clientCopy = JSON.stringify({ wrong: copy.wrong, working: copy.working }).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="${language}"><head><meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<title>${escapeHtml(copy.title)}</title>
<style>
  :root { color-scheme:light; --u-bg:var(--mb-bg,#f0efe9); --u-surface:var(--mb-surface,#f0efe9); --u-fg:var(--mb-fg,#0a0a0a); --u-muted:var(--mb-muted,#5c5b57); --u-accent:var(--mb-accent,#9c9b95); --u-on-accent:var(--mb-on-accent,#f0efe9); --u-border:var(--mb-border,#0a0a0a); --u-danger:var(--mb-danger,#8b2931); font-family:ui-monospace,"Cascadia Mono","Courier New",monospace; }
  * { box-sizing:border-box; }
  html, body { margin:0; height:100%; }
  body { display:flex; flex-direction:column; background:var(--u-bg); color:var(--u-fg); }
  header { padding:13px 18px; background:var(--u-fg); color:var(--u-bg); font-size:12px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  form { flex:1; padding:18px; display:grid; gap:12px; align-content:start; }
  p { margin:0; font-size:12px; line-height:1.5; }
  .hint { color:var(--u-muted); font-size:10px; }
  label { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.08em; }
  input { width:100%; padding:10px; border:2px solid var(--u-border); border-radius:0; outline:0; background:var(--u-surface); color:var(--u-fg); font:inherit; font-size:13px; transition:box-shadow var(--mb-dur,160ms) var(--mb-ease,cubic-bezier(.2,.7,.2,1)); }
  input:focus { box-shadow:4px 4px 0 var(--u-accent); }
  #error { min-height:16px; color:var(--u-danger); font-size:11px; }
  .actions { display:flex; justify-content:flex-end; gap:8px; }
  button { border:2px solid var(--u-border); border-radius:0; padding:9px 14px; font:inherit; font-size:10px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; cursor:pointer; background:var(--u-surface); color:var(--u-fg); transition:background var(--mb-dur,160ms) var(--mb-ease,cubic-bezier(.2,.7,.2,1)); }
  button.primary { background:var(--u-fg); color:var(--u-bg); }
  button:hover:not(:disabled), button:focus-visible { background:var(--u-accent); color:var(--u-fg); outline:0; }
  button:disabled { opacity:.45; cursor:not-allowed; }
</style></head><body>
<header>MonoBrowser / ${escapeHtml(copy.heading)}</header>
<form id="form" autocomplete="off">
  <p>${escapeHtml(copy.description)}</p>
  <label for="password">${escapeHtml(copy.label)}</label>
  <input id="password" type="password" autocomplete="off" spellcheck="false" autofocus>
  <div id="error" role="alert"></div>
  <div class="actions"><button type="button" id="skip">${escapeHtml(copy.skip)}</button><button type="submit" id="unlock" class="primary">${escapeHtml(copy.unlock)}</button></div>
  <p class="hint">${escapeHtml(copy.skipHint)}</p>
</form>
<script>
(() => {
  const L = ${clientCopy};
  const form = document.getElementById('form'), input = document.getElementById('password');
  const error = document.getElementById('error'), unlock = document.getElementById('unlock'), skip = document.getElementById('skip');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input.value) return;
    unlock.disabled = true; error.textContent = L.working;
    let ok = false;
    try { ok = await window.unlockApi.tryPassword(input.value); } catch { ok = false; }
    if (!ok) { error.textContent = L.wrong; unlock.disabled = false; input.select(); input.focus(); }
  });
  skip.addEventListener('click', () => window.unlockApi.skip());
  window.addEventListener('keydown', (event) => { if (event.key === 'Escape') window.unlockApi.skip(); });
  input.focus();
})();
</script></body></html>`;
};

/**
 * Shows the prompt until `verify` accepts a password (resolves true) or the user skips / closes the window
 * (resolves false). `verify` receives the typed password and must report whether it unlocked the vault.
 */
export const promptVaultPassword = (
  language: Language,
  verify: (password: string) => Promise<boolean>,
): Promise<boolean> => new Promise((resolve) => {
  const win = new BrowserWindow({
    width: 470,
    height: 330,
    useContentSize: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    // The splash window is always on top as well; this one is created later, so it stays above it.
    alwaysOnTop: true,
    show: false,
    autoHideMenuBar: true,
    title: UNLOCK_COPY[language].title,
    backgroundColor: "#f0efe9",
    webPreferences: {
      preload: path.join(__dirname, "portable-unlock-preload.js"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setMenu(null);

  let settled = false;
  const finish = (unlocked: boolean): void => {
    if (settled) return;
    settled = true;
    ipcMain.removeHandler("portable-unlock:try");
    ipcMain.removeListener("portable-unlock:skip", onSkip);
    if (!win.isDestroyed()) win.close();
    resolve(unlocked);
  };
  const fromWindow = (sender: Electron.WebContents): boolean => !win.isDestroyed() && sender === win.webContents;
  const onSkip = (event: Electron.IpcMainEvent): void => {
    if (fromWindow(event.sender)) finish(false);
  };

  ipcMain.removeHandler("portable-unlock:try");
  ipcMain.handle("portable-unlock:try", async (event, password: unknown) => {
    if (!fromWindow(event.sender) || typeof password !== "string") return false;
    const ok = await verify(password).catch(() => false);
    if (ok) setImmediate(() => finish(true));
    return ok;
  });
  ipcMain.on("portable-unlock:skip", onSkip);

  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.once("ready-to-show", () => { win.show(); win.focus(); });
  win.on("closed", () => finish(false));
  void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderUnlockHtml(language))}`);
});
