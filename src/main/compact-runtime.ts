// Compact mode runtime: the shell (toolbar / sidebar) hides and the page fills the window.
// The window's own webContents sits below every page view, so the revealed chrome is a second
// instance of the shell renderer (index.html?chrome=overlay) hosted in a WebContentsView placed
// above the page views. It overlays the page without resizing it (no reflow).
//
// Reveal: an invisible 3px "hot strip" view at the window edge (above the page) reports the pointer
// entering it. (screen.getCursorScreenPoint() is unusable under native Wayland: it returns 0,0.)
// Hide: the overlay's renderer reports the pointer leaving it; the chrome hides after a short delay.
import { ipcMain, WebContentsView } from "electron";
import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";
import {
  INITIAL_COMPACT_STATE, chromeOverlayRect, hotStripRect, sidebarWidthFor, stepCompact,
  type CompactGeometry, type CompactState,
} from "./compact-layout.js";
import type { LayoutSettings } from "./layout-settings.js";

/** Housekeeping tick while the chrome is revealed (hide delay, forced-open conditions released). */
export const COMPACT_TICK_MS = 100;

export type CompactDeps = {
  getMainWindow: () => BrowserWindow | null;
  getLayout: () => LayoutSettings;
  /** Preload of the chrome overlay (the regular shell preload). */
  preloadPath: string;
  /** Preload of the hot strip (reports pointer entry). */
  stripPreloadPath: string;
  htmlPath: string;
  /** Called for the freshly created overlay contents (theme tracking, shortcuts, focus hooks). */
  onContentsCreated: (contents: WebContents) => void;
  /** Puts the view on top of the page views (but below find/palette/... overlays) without closing menus. */
  raiseView: (view: WebContentsView) => void;
  /** A menu/popup is open: the chrome has to stay. */
  isPopupOpen: () => boolean;
  /** No page is shown (nothing to reveal over): the chrome stays visible. */
  isForcedOpen: () => boolean;
  /** HTML fullscreen: never reveal. */
  isSuppressed: () => boolean;
  /** Viewport origin changed (compact toggled): re-layout everything. */
  onViewportChanged: () => void;
  isSidebarDragging: () => boolean;
  /** Hands keyboard focus back to the page when the chrome hides. */
  restoreFocus: () => void;
};

export type CompactChrome = {
  setEnabled: (enabled: boolean) => void;
  isEnabled: () => boolean;
  isRevealed: () => boolean;
  /** Reveals the chrome right away (Ctrl+L, focus address bar) and keeps it for a while. */
  reveal: () => void;
  /** Layout/settings/size changed: recompute bounds. */
  refresh: () => void;
  /** Re-stack above page views (after a tab switch). */
  raise: () => void;
  getContents: () => WebContents | null;
  /** Top-left of the overlay view in window content coordinates. */
  getOrigin: () => { x: number; y: number };
  setKeep: (flags: { address?: boolean; tabDrag?: boolean }) => void;
  /** The overlay renderer reports the pointer entering/leaving it. */
  setPointerInside: (inside: boolean) => void;
  dispose: () => void;
};

const STRIP_HTML = "data:text/html;charset=utf-8,"
  + encodeURIComponent("<!doctype html><html style=\"height:100%\"><body style=\"margin:0;height:100%\"></body></html>");

export const createCompactChrome = (deps: CompactDeps): CompactChrome => {
  let enabled = false;
  let view: WebContentsView | null = null;
  let strip: WebContentsView | null = null;
  let ready = false;
  let state: CompactState = INITIAL_COMPACT_STATE;
  let timer: NodeJS.Timeout | null = null;
  let addressFocused = false;
  let tabDragging = false;
  let pointerInside = false;
  // The pointer is assumed inside after a reveal from the edge strip until the overlay renderer confirms it
  // (or it is dropped after a grace period, e.g. when the pointer left before the overlay painted).
  let pointerConfirmed = false;
  let revealedAt = 0;
  let forceUntil = 0;

  const alive = (): boolean => Boolean(view && !view.webContents.isDestroyed());
  const stripAlive = (): boolean => Boolean(strip && !strip.webContents.isDestroyed());

  const geometry = (): CompactGeometry | null => {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) return null;
    const [contentWidth, contentHeight] = win.getContentSize();
    const layout = deps.getLayout();
    return { kind: layout.tabBarLayout, contentWidth, contentHeight, sidebarWidth: sidebarWidthFor(layout), side: layout.verticalTabBarSide };
  };

  const keepOpen = (now: number): boolean =>
    addressFocused || tabDragging || deps.isPopupOpen() || deps.isSidebarDragging() || deps.isForcedOpen() || now < forceUntil;

  const applyBounds = (): void => {
    const geo = geometry();
    if (!geo) return;
    if (alive()) {
      if (!state.revealed) {
        view!.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      } else {
        const rect = chromeOverlayRect(geo);
        // While the sidebar edge is dragged the overlay spans the window (transparent beyond the
        // sidebar) so the shell keeps receiving the pointer.
        view!.setBounds(deps.isSidebarDragging() && geo.kind === "vertical" ? { ...rect, x: 0, width: geo.contentWidth } : rect);
      }
    }
    if (stripAlive()) {
      if (state.revealed || deps.isSuppressed()) {
        strip!.setVisible(false);
        strip!.setBounds({ x: 0, y: 0, width: 0, height: 0 });
      } else {
        strip!.setBounds(hotStripRect(geo));
        strip!.setVisible(true);
      }
    }
  };

  const raiseAll = (): void => {
    // Strip above the page, overlay above the strip.
    if (stripAlive() && !state.revealed) deps.raiseView(strip!);
    if (alive() && state.revealed) deps.raiseView(view!);
  };

  const show = (): void => {
    if (!alive()) return;
    applyBounds();
    raiseAll();
    view!.setVisible(true);
    setImmediate(() => { if (alive()) view!.webContents.invalidate(); });
  };

  const hide = (): void => {
    if (!alive()) return;
    const contents = view!.webContents;
    view!.setVisible(false);
    // The focused address field is gone from view: keyboard focus goes back to the page.
    if (contents.isFocused() && !addressFocused) deps.restoreFocus();
    applyBounds();
    raiseAll();
  };

  const setRevealed = (next: CompactState, viaStrip: boolean): void => {
    const wasRevealed = state.revealed;
    state = next;
    if (next.revealed && !wasRevealed) {
      pointerInside = viaStrip; // revealed from the edge strip: the pointer is on the chrome's edge
      pointerConfirmed = false;
      revealedAt = Date.now();
      show();
    } else if (!next.revealed && wasRevealed) {
      pointerInside = false;
      pointerConfirmed = false;
      hide();
    }
  };

  const step = (hot: boolean): void => {
    if (!enabled || !alive()) return;
    if (deps.isSuppressed()) {
      if (state.revealed) setRevealed(INITIAL_COMPACT_STATE, false);
      else applyBounds();
      return;
    }
    const now = Date.now();
    if (pointerInside && !pointerConfirmed && now - revealedAt > 700) pointerInside = false;
    setRevealed(stepCompact(state, { hot, inside: pointerInside, keepOpen: keepOpen(now), now }), hot);
  };

  const startTimer = (): void => {
    if (timer) return;
    timer = setInterval(() => step(false), COMPACT_TICK_MS);
  };
  const stopTimer = (): void => {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  };

  const onStripEnter = (event: IpcMainEvent): void => {
    if (!stripAlive() || event.sender !== strip!.webContents) return;
    step(true);
  };
  ipcMain.on("compact:strip-enter", onStripEnter);

  const create = (): void => {
    const win = deps.getMainWindow();
    if (alive() || !win || win.isDestroyed()) return;
    const created = new WebContentsView({
      webPreferences: { preload: deps.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    view = created;
    ready = false;
    created.setBackgroundColor("#00000000");
    created.setVisible(false);
    created.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    deps.onContentsCreated(created.webContents);
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.webContents.once("destroyed", () => {
      if (view === created) { view = null; ready = false; }
    });
    win.contentView.addChildView(created);
    created.webContents.loadFile(deps.htmlPath, { query: { chrome: "overlay" } }).then(() => {
      if (view === created) ready = true;
    }).catch(() => undefined);

    const hot = new WebContentsView({
      webPreferences: { preload: deps.stripPreloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    strip = hot;
    hot.setBackgroundColor("#00000000");
    hot.setVisible(false);
    hot.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    hot.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    hot.webContents.on("will-navigate", (event) => event.preventDefault());
    hot.webContents.once("destroyed", () => { if (strip === hot) strip = null; });
    win.contentView.addChildView(hot);
    hot.webContents.loadURL(STRIP_HTML).catch(() => undefined);
    applyBounds();
    raiseAll();
  };

  const destroy = (): void => {
    const current = view;
    const currentStrip = strip;
    view = null;
    strip = null;
    ready = false;
    state = INITIAL_COMPACT_STATE;
    addressFocused = false;
    tabDragging = false;
    pointerInside = false;
    const win = deps.getMainWindow();
    for (const entry of [current, currentStrip]) {
      if (!entry) continue;
      if (win && !win.isDestroyed() && win.contentView.children.includes(entry)) win.contentView.removeChildView(entry);
      if (!entry.webContents.isDestroyed()) entry.webContents.close();
    }
  };

  return {
    setEnabled: (next) => {
      if (next === enabled) return;
      enabled = next;
      if (next) {
        create();
        startTimer();
      } else {
        stopTimer();
        destroy();
      }
      deps.onViewportChanged();
      // New/removed views must not leave keyboard focus on a helper view.
      setTimeout(() => deps.restoreFocus(), 50);
    },
    isEnabled: () => enabled,
    isRevealed: () => state.revealed,
    reveal: () => {
      if (!enabled) return;
      forceUntil = Date.now() + 1500;
      setRevealed({ revealed: true, hideAt: null }, false);
    },
    refresh: () => {
      applyBounds();
    },
    raise: () => {
      if (enabled) raiseAll();
    },
    getContents: () => (alive() && ready ? view!.webContents : null),
    getOrigin: () => {
      if (!alive()) return { x: 0, y: 0 };
      const b = view!.getBounds();
      return { x: b.x, y: b.y };
    },
    setKeep: (flags) => {
      if (typeof flags.address === "boolean") addressFocused = flags.address;
      if (typeof flags.tabDrag === "boolean") tabDragging = flags.tabDrag;
    },
    setPointerInside: (inside) => {
      pointerInside = inside;
      if (inside) pointerConfirmed = true;
      if (enabled && state.revealed) step(false);
    },
    dispose: () => {
      enabled = false;
      stopTimer();
      ipcMain.removeListener("compact:strip-enter", onStripEnter);
      destroy();
    },
  };
};
