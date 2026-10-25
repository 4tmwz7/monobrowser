// In-window prompt overlay: site permissions, HTTP authentication and confirmations
// ("Leave site?"). One overlay view serves a queue of requests; a request that belongs
// to a tab is only shown while that tab is active. Nothing here logs prompt contents:
// credentials travel only from the overlay renderer to the resolved promise.
import { ipcMain, WebContentsView } from "electron";
import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";
import { computeOverlayBounds, selectVisibleEntry } from "./prompt-queue.js";

export type PromptKind = "permission" | "auth" | "confirm";

export type PromptLine = { text: string; style?: "strong" | "muted" | "warn" };

/** A checkbox row; the primary result lists the ids of the checked ones. */
export type PromptChoice = { id: string; label: string; checked?: boolean };

export type PromptRequest = {
  kind: PromptKind;
  /** The tab this prompt belongs to; null = always visible. */
  tabId: number | null;
  title: string;
  lines: PromptLine[];
  fields?: { username: string; password: string };
  choices?: PromptChoice[];
  primary: string;
  secondary: string;
  danger?: boolean;
};

export type PromptResult =
  | { action: "primary"; username?: string; password?: string; selected?: string[] }
  | { action: "secondary" }
  | { action: "dismiss" };

export type PromptOverlayDeps = {
  getMainWindow: () => BrowserWindow | null;
  /** Rect to anchor to: the active pane (the whole page area when not split). */
  getPaneRect: () => { x: number; y: number; width: number; height: number } | null;
  getActiveTabId: () => number | null;
  attachViewOnTop: (view: WebContentsView) => void;
  /** Called for every freshly created overlay view (theme tracking). */
  onViewCreated?: (contents: WebContents) => void;
  detachView: (view: WebContentsView) => void;
  /** Gives the OS focus to the main window so the overlay receives keys. */
  focusMainWindow: () => void;
  /** Hands keyboard focus back to the page. */
  restoreFocus: () => void;
  preloadPath: string;
  htmlPath: string;
};

type Entry = { id: number; request: PromptRequest; resolve: (result: PromptResult) => void };

export type PromptOverlay = {
  /** The optional signal dismisses the prompt when aborted (owner page gone). */
  request: (request: PromptRequest, signal?: AbortSignal) => Promise<PromptResult>;
  /** Re-evaluates what is visible (tab switched, window resized) and keeps the overlay on top. */
  refresh: () => void;
  cancelForTab: (tabId: number) => void;
  dispose: () => void;
  isOpen: () => boolean;
  /** Dismisses the prompt that is on screen right now (Escape from the page or shell). */
  dismissVisible: () => boolean;
};

export const createPromptOverlay = (deps: PromptOverlayDeps): PromptOverlay => {
  const queue: Entry[] = [];
  let nextId = 1;
  let view: WebContentsView | null = null;
  let ready = false;
  let shownId: number | null = null;
  let reportedHeight = 140;

  const viewAlive = (): boolean => Boolean(view && !view.webContents.isDestroyed());

  const visibleEntry = (): Entry | null => {
    return selectVisibleEntry(queue, deps.getActiveTabId());
  };

  const position = (): void => {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed() || !viewAlive()) return;
    const entry = queue.find((candidate) => candidate.id === shownId);
    if (!entry) return;
    const [contentWidth, contentHeight] = win.getContentSize();
    const pane = deps.getPaneRect() ?? { x: 0, y: 0, width: contentWidth, height: contentHeight };
    view!.setBounds(computeOverlayBounds({
      kind: entry.request.kind, contentWidth, contentHeight, top: pane.y, left: pane.x, reportedHeight,
      areaWidth: pane.width, areaHeight: pane.height,
    }));
  };

  const destroyView = (): void => {
    const current = view;
    view = null;
    ready = false;
    shownId = null;
    if (!current) return;
    deps.detachView(current);
    if (!current.webContents.isDestroyed()) current.webContents.close();
  };

  const pushPayload = (entry: Entry): void => {
    if (!viewAlive() || !ready) return;
    shownId = entry.id;
    reportedHeight = 140;
    view!.webContents.send("prompt-overlay:show", {
      id: entry.id,
      title: entry.request.title,
      lines: entry.request.lines,
      fields: entry.request.fields,
      choices: entry.request.choices,
      primary: entry.request.primary,
      secondary: entry.request.secondary,
      danger: entry.request.danger,
      focusFirst: entry.request.kind !== "permission",
    });
  };

  const settle = (entry: Entry, result: PromptResult): void => {
    const index = queue.indexOf(entry);
    if (index < 0) return;
    queue.splice(index, 1);
    if (shownId === entry.id) shownId = null;
    entry.resolve(result);
    refresh();
  };

  const ensureView = (): void => {
    const win = deps.getMainWindow();
    if (viewAlive() || !win || win.isDestroyed()) return;
    const created = new WebContentsView({
      webPreferences: { preload: deps.preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    view = created;
    created.setBackgroundColor("#00000000");
    deps.onViewCreated?.(created.webContents);
    created.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    created.webContents.on("will-navigate", (event) => event.preventDefault());
    created.webContents.on("before-input-event", (event, input) => {
      if ((input.type !== "keyDown" && input.type !== "rawKeyDown") || (input.key || "").toLowerCase() !== "escape") return;
      event.preventDefault();
      const entry = queue.find((candidate) => candidate.id === shownId);
      if (entry) settle(entry, { action: "dismiss" });
    });
    created.webContents.once("destroyed", () => {
      if (view === created) { view = null; ready = false; shownId = null; }
    });
    created.webContents.loadFile(deps.htmlPath).then(() => {
      if (view !== created) return;
      ready = true;
      refresh();
    }).catch(() => destroyView());
  };

  function refresh(): void {
    const win = deps.getMainWindow();
    if (!win || win.isDestroyed()) return;
    const entry = visibleEntry();
    if (!entry) {
      if (view) {
        const hadFocus = viewAlive() && view!.webContents.isFocused();
        destroyView();
        if (hadFocus) deps.restoreFocus();
      }
      return;
    }
    ensureView();
    if (!viewAlive() || !ready) return;
    if (shownId !== entry.id) pushPayload(entry);
    position();
    deps.attachViewOnTop(view!);
    view!.setVisible(true);
    if (entry.request.kind !== "permission") {
      deps.focusMainWindow();
      view!.webContents.focus();
    }
  }

  const onSubmit = (event: IpcMainEvent, id: unknown, result: unknown): void => {
    if (!viewAlive() || event.sender !== view!.webContents || !(event.senderFrame?.url ?? "").startsWith("file:")) return;
    const entry = queue.find((candidate) => candidate.id === id);
    if (!entry || typeof result !== "object" || result === null) return;
    const data = result as { action?: unknown; username?: unknown; password?: unknown; selected?: unknown };
    if (data.action === "primary") {
      if (entry.request.choices) {
        const known = new Set(entry.request.choices.map((choice) => choice.id));
        const selected = Array.isArray(data.selected) ? data.selected.filter((id): id is string => typeof id === "string" && known.has(id)) : [];
        settle(entry, { action: "primary", selected: [...new Set(selected)] });
        return;
      }
      settle(entry, entry.request.fields
        ? { action: "primary", username: String(data.username ?? ""), password: String(data.password ?? "") }
        : { action: "primary" });
    } else if (data.action === "secondary") {
      settle(entry, { action: "secondary" });
    }
  };

  const onHeight = (event: IpcMainEvent, height: unknown): void => {
    if (!viewAlive() || event.sender !== view!.webContents || typeof height !== "number" || !Number.isFinite(height)) return;
    reportedHeight = Math.max(80, Math.min(520, Math.ceil(height)));
    position();
  };

  ipcMain.on("prompt-overlay:submit", onSubmit);
  ipcMain.on("prompt-overlay:height", onHeight);

  return {
    request: (request, signal) => new Promise<PromptResult>((resolve) => {
      const win = deps.getMainWindow();
      if (!win || win.isDestroyed() || signal?.aborted) {
        resolve({ action: "dismiss" });
        return;
      }
      const entry: Entry = { id: nextId++, request, resolve };
      signal?.addEventListener("abort", () => settle(entry, { action: "dismiss" }), { once: true });
      queue.push(entry);
      refresh();
    }),
    refresh,
    cancelForTab: (tabId) => {
      for (const entry of [...queue]) {
        if (entry.request.tabId === tabId) settle(entry, { action: "dismiss" });
      }
    },
    dispose: () => {
      ipcMain.removeListener("prompt-overlay:submit", onSubmit);
      ipcMain.removeListener("prompt-overlay:height", onHeight);
      for (const entry of queue.splice(0)) entry.resolve({ action: "dismiss" });
      destroyView();
    },
    isOpen: () => shownId !== null,
    dismissVisible: () => {
      const entry = queue.find((candidate) => candidate.id === shownId);
      if (!entry) return false;
      settle(entry, { action: "dismiss" });
      return true;
    },
  };
};
