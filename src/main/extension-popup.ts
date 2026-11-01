import { BrowserWindow, WebContentsView } from "electron";
import type { Session, WebContents } from "electron";
import type { ElectronChromeExtensions } from "electron-chrome-extensions";
import { computeAnchoredPopupBounds, type PopupRect } from "./popup-placement.js";

// Extension action popups (the page an extension shows when its toolbar button is clicked) hosted INSIDE the main
// window as a WebContentsView. electron-chrome-extensions opens them as a child BrowserWindow it positions with
// setBounds(): native Wayland ignores that (the compositor centers the window), so the popup appeared mid-window
// instead of under its button. A view positioned with our own bounds behaves the same on every platform.
// The library's `activateClick` is replaced for popups only; actions without a popup still dispatch onClicked through it.

export type InWindowPopupHost = {
  getWindow: () => BrowserWindow | null;
  /** Top-left of the shell view the button lives in (non-zero for the compact-mode chrome overlay). */
  getShellOrigin: () => { x: number; y: number };
  /** An area popups keep clear of (native window controls on Windows). */
  getAvoidRect: (contentWidth: number) => PopupRect | null;
  /** Opens a link the popup asked for in a new tab. */
  openLink: (url: string, isPrivate: boolean) => void;
};

type ActivateDetails = {
  extensionId: string;
  tabId: number;
  anchorRect: { x: number; y: number; width: number; height: number };
  alignment?: string;
};

type BrowserActionApi = {
  activateClick: (details: ActivateDetails) => void;
  getPopupUrl: (extensionId: string, tabId: number) => string | undefined;
};

const MIN_SIZE = 25;
const MAX_WIDTH = 800;
const MAX_HEIGHT = 600;
/** Focus events right after opening (the menu closing, the page regaining focus) must not dismiss the popup. */
const OPEN_GRACE_MS = 500;

type ActivePopup = { extensionId: string; view: WebContentsView; openedAt: number; close: () => void };
let active: ActivePopup | null = null;

const alive = (popup: ActivePopup | null): popup is ActivePopup => Boolean(popup && !popup.view.webContents.isDestroyed());

export const isInWindowPopupOpen = (): boolean => alive(active);

export const closeInWindowPopup = (): void => {
  if (active) active.close();
};

/** Focus moved to the shell or a page: the user clicked outside the popup. */
export const closeInWindowPopupFromOutside = (): void => {
  if (alive(active) && Date.now() - active.openedAt > OPEN_GRACE_MS && !active.view.webContents.isFocused()) active.close();
};

const clampSize = (size: { width: number; height: number }): { width: number; height: number } => ({
  width: Math.floor(Math.min(MAX_WIDTH, Math.max(MIN_SIZE, size.width || 0))),
  height: Math.floor(Math.min(MAX_HEIGHT, Math.max(MIN_SIZE, size.height || 0))),
});

const openPopup = (host: InWindowPopupHost, target: Session, isPrivate: boolean, details: ActivateDetails, url: string): void => {
  const win = host.getWindow();
  if (!win || win.isDestroyed()) return;
  const sameExtension = alive(active) && active.extensionId === details.extensionId;
  closeInWindowPopup();
  if (sameExtension) return; // a second click on the same button closes its popup

  const view = new WebContentsView({
    webPreferences: { session: target, sandbox: true, nodeIntegration: false, nodeIntegrationInWorker: false, contextIsolation: true, enablePreferredSizeMode: true },
  });
  const contents = view.webContents;
  view.setBackgroundColor("#ffffff");
  view.setVisible(false);
  let size = { width: MAX_WIDTH, height: MAX_HEIGHT };
  let shown = false;
  let closed = false;

  const origin = host.getShellOrigin();
  const anchor: PopupRect = {
    x: Math.round(details.anchorRect.x + origin.x),
    y: Math.round(details.anchorRect.y + origin.y),
    width: Math.round(details.anchorRect.width),
    height: Math.round(details.anchorRect.height),
  };
  const position = (): void => {
    if (closed || win.isDestroyed()) return;
    const [contentWidth, contentHeight] = win.getContentSize();
    view.setBounds(computeAnchoredPopupBounds({ anchor, alignment: details.alignment, ...size, contentWidth, contentHeight, avoid: host.getAvoidRect(contentWidth) }));
  };
  const show = (): void => {
    if (closed || shown || win.isDestroyed()) return;
    shown = true;
    position();
    win.contentView.addChildView(view); // (re)adding puts it above every other view
    view.setVisible(true);
    contents.focus();
  };

  const close = (): void => {
    if (closed) return;
    closed = true;
    if (active?.view === view) active = null;
    win.off("resize", close);
    win.off("closed", close);
    if (!win.isDestroyed() && win.contentView.children.includes(view)) win.contentView.removeChildView(view);
    if (!contents.isDestroyed()) {
      if (contents.isDevToolsOpened()) contents.closeDevTools();
      contents.close();
    }
  };
  active = { extensionId: details.extensionId, view, openedAt: Date.now(), close };

  win.contentView.addChildView(view);
  win.on("resize", close);
  win.on("closed", close);
  contents.once("destroyed", () => { if (!closed) { closed = true; if (active?.view === view) active = null; } });
  contents.setWindowOpenHandler(({ url: linkUrl }) => {
    if (/^https?:\/\//i.test(linkUrl)) { host.openLink(linkUrl, isPrivate); close(); }
    return { action: "deny" };
  });
  contents.on("before-input-event", (event, input) => {
    if (input.type === "keyDown" && input.key === "Escape") { event.preventDefault(); close(); }
  });
  contents.on("blur", () => {
    // Focus can bounce while the compositor settles; dismiss only when it really left (and not for another app window).
    setTimeout(() => {
      if (closed || contents.isDestroyed() || contents.isFocused() || contents.isDevToolsOpened()) return;
      if (BrowserWindow.getAllWindows().some((window) => window.isFocused())) close();
    }, 120);
  });
  contents.on("preferred-size-changed", (_event, preferred) => {
    size = clampSize(preferred);
    position();
    show();
  });
  contents.on("did-finish-load", () => {
    // Pages that never report a preferred size still get shown, sized to their body.
    setTimeout(() => {
      if (closed || shown || contents.isDestroyed()) return;
      void contents.executeJavaScript("(() => { const r = document.body.getBoundingClientRect(); return { width: r.width, height: r.height }; })()", true)
        .then((rect: { width: number; height: number }) => { size = clampSize(rect); show(); })
        .catch(() => show());
    }, 300);
  });
  contents.loadURL(url).catch((error) => {
    console.error("[extensions] popup failed to load:", error);
    close();
  });
};

/**
 * Makes `instance` open action popups in the window. `scopeIsPrivate` tells where links opened from the popup go.
 * Falls back silently to the library's popup when its internals are not as expected.
 */
export const installInWindowPopups = (instance: ElectronChromeExtensions, target: Session, scopeIsPrivate: boolean, host: InWindowPopupHost): boolean => {
  const api = (instance as unknown as { api?: { browserAction?: Partial<BrowserActionApi> } }).api?.browserAction;
  if (!api || typeof api.activateClick !== "function" || typeof api.getPopupUrl !== "function") {
    console.warn("[extensions] in-window popups unavailable: electron-chrome-extensions internals changed");
    return false;
  }
  const original = api.activateClick.bind(api);
  const getPopupUrl = api.getPopupUrl.bind(api);
  api.activateClick = (details: ActivateDetails): void => {
    let url: string | undefined;
    try { url = getPopupUrl(details.extensionId, details.tabId); } catch { url = undefined; }
    if (!url || !details.anchorRect) { closeInWindowPopup(); original(details); return; }
    openPopup(host, target, scopeIsPrivate, details, url);
  };
  return true;
};

export type { WebContents };
