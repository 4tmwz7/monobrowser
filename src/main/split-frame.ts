// Split view frame: one WebContentsView covering the page area, stacked BELOW the two page views.
// It paints the gaps between/around the panes (the active pane's accent border and the draggable
// divider). While the divider is dragged or a tab is dragged over the page it is raised above the
// pages (transparent) so it receives the pointer / drop.
import { ipcMain, WebContentsView } from "electron";
import type { BrowserWindow, IpcMainEvent, WebContents } from "electron";
import type { Rect, SplitSide } from "./split-layout.js";

export type SplitFrameState = {
  mode: "split" | "drop" | "idle";
  width: number;
  height: number;
  left?: Rect;
  right?: Rect;
  divider?: Rect;
  active?: SplitSide;
  dragging?: boolean;
  labels: { drop: string; reset: string };
};

export type SplitFrameDeps = {
  getMainWindow: () => BrowserWindow | null;
  preloadPath: string;
  htmlPath: string;
  onContentsCreated: (contents: WebContents) => void;
  onDragStart: () => void;
  /** x = pointer position from the frame's left edge. */
  onDragMove: (x: number) => void;
  onDragEnd: () => void;
  onDrop: (zone: SplitSide) => void;
  onReset: () => void;
};

export type SplitFrame = {
  /** Positions the frame over `area`, pushes the state and makes it visible; `top` raises it above the pages. */
  show: (area: Rect, state: SplitFrameState, top: boolean) => void;
  /** Re-stacks the frame (below the panes: call right before attaching the panes). */
  raise: () => void;
  hide: () => void;
  isVisible: () => boolean;
  getContents: () => WebContents | null;
  dispose: () => void;
};

export const createSplitFrame = (deps: SplitFrameDeps): SplitFrame => {
  let view: WebContentsView | null = null;
  let ready = false;
  let visible = false;
  let pending: SplitFrameState | null = null;

  const alive = (): boolean => Boolean(view && !view.webContents.isDestroyed());

  const push = (): void => {
    if (!alive() || !ready || !pending) return;
    view!.webContents.send("split-frame:state", pending);
  };

  const ensure = (): void => {
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
      if (view === created) { view = null; ready = false; visible = false; }
    });
    win.contentView.addChildView(created);
    created.webContents.loadFile(deps.htmlPath).then(() => {
      if (view !== created) return;
      ready = true;
      push();
    }).catch(() => undefined);
  };

  const fromFrame = (event: IpcMainEvent): boolean =>
    alive() && event.sender === view!.webContents && (event.senderFrame?.url ?? "").startsWith("file:");

  const listeners: Array<[string, (event: IpcMainEvent, ...args: unknown[]) => void]> = [
    ["split-frame:drag-start", (event) => { if (fromFrame(event)) deps.onDragStart(); }],
    ["split-frame:drag-move", (event, x) => { if (fromFrame(event) && typeof x === "number" && Number.isFinite(x)) deps.onDragMove(x); }],
    ["split-frame:drag-end", (event) => { if (fromFrame(event)) deps.onDragEnd(); }],
    ["split-frame:drop", (event, zone) => { if (fromFrame(event) && (zone === "left" || zone === "right")) deps.onDrop(zone); }],
    ["split-frame:reset", (event) => { if (fromFrame(event)) deps.onReset(); }],
  ];
  for (const [channel, listener] of listeners) ipcMain.on(channel, listener);

  return {
    show: (area, state, top) => {
      const win = deps.getMainWindow();
      if (!win || win.isDestroyed()) return;
      ensure();
      if (!alive()) return;
      pending = state;
      view!.setBounds(area);
      if (top || !visible || !win.contentView.children.includes(view!)) win.contentView.addChildView(view!);
      view!.setVisible(true);
      visible = true;
      push();
    },
    raise: () => {
      const win = deps.getMainWindow();
      if (!alive() || !visible || !win || win.isDestroyed()) return;
      win.contentView.addChildView(view!);
    },
    hide: () => {
      if (!alive()) return;
      visible = false;
      pending = null;
      view!.setVisible(false);
      view!.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    },
    isVisible: () => visible,
    getContents: () => (alive() ? view!.webContents : null),
    dispose: () => {
      for (const [channel, listener] of listeners) ipcMain.removeListener(channel, listener);
      const current = view;
      view = null;
      ready = false;
      visible = false;
      const win = deps.getMainWindow();
      if (current && win && !win.isDestroyed() && win.contentView.children.includes(current)) win.contentView.removeChildView(current);
      if (current && !current.webContents.isDestroyed()) current.webContents.close();
    },
  };
};
