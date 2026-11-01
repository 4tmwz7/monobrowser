// Pure logic for compact mode: where the revealed chrome overlay and the hot-zone strip sit,
// and when to reveal/hide. No Electron imports so it is unit-testable.
import type { Rect } from "./split-layout.js";

export type CompactChromeKind = "horizontal" | "vertical";

/** Thickness of the invisible strip at the window edge that reveals the chrome on pointer entry. */
export const COMPACT_HOT_ZONE = 3;
export const COMPACT_HIDE_DELAY_MS = 400;
export const HORIZONTAL_CHROME_HEIGHT = 36;
export const COLLAPSED_SIDEBAR_WIDTH = 52;

export type CompactGeometry = {
  kind: CompactChromeKind;
  contentWidth: number;
  contentHeight: number;
  /** Current sidebar width (vertical layout only). */
  sidebarWidth: number;
  /** Window edge the sidebar sits on (vertical layout only); defaults to the left edge. */
  side?: "left" | "right";
  /** Height of a title strip that stays visible above the page (Windows: native window controls); 0 by default. */
  topInset?: number;
};

export const sidebarWidthFor = (layout: { verticalTabBarWidth: number; verticalTabBarCollapsed: boolean }): number =>
  layout.verticalTabBarCollapsed ? COLLAPSED_SIDEBAR_WIDTH : layout.verticalTabBarWidth;

/** A full-height strip of the given width flush with the sidebar's window edge. */
const sidebarEdgeRect = (geometry: CompactGeometry, width: number): Rect => {
  const top = Math.min(Math.max(0, geometry.topInset ?? 0), geometry.contentHeight);
  return {
    x: geometry.side === "right" ? geometry.contentWidth - width : 0,
    y: top,
    width,
    height: geometry.contentHeight - top,
  };
};

/** Bounds of the revealed chrome overlay in window content coordinates. */
export const chromeOverlayRect = (geometry: CompactGeometry): Rect =>
  geometry.kind === "vertical"
    ? sidebarEdgeRect(geometry, Math.min(geometry.sidebarWidth, geometry.contentWidth))
    : { x: 0, y: 0, width: geometry.contentWidth, height: Math.min(HORIZONTAL_CHROME_HEIGHT, geometry.contentHeight) };

/** The invisible hot-zone strip at the top (horizontal layout) or left/right (vertical layout) edge. */
export const hotStripRect = (geometry: CompactGeometry): Rect =>
  geometry.kind === "vertical"
    ? sidebarEdgeRect(geometry, Math.min(COMPACT_HOT_ZONE, geometry.contentWidth))
    : { x: 0, y: 0, width: geometry.contentWidth, height: Math.min(COMPACT_HOT_ZONE, geometry.contentHeight) };

export type CompactState = { revealed: boolean; hideAt: number | null };

export const INITIAL_COMPACT_STATE: CompactState = { revealed: false, hideAt: null };

export type CompactInput = {
  /** The pointer just entered the hot-zone strip. */
  hot: boolean;
  /** The pointer is over the revealed chrome. */
  inside: boolean;
  /** Something forces the chrome open (address bar focused, menu open, dragging...). */
  keepOpen: boolean;
  now: number;
};

/** One step of the reveal/hide state machine (called on pointer events and on a slow timer while revealed). */
export const stepCompact = (state: CompactState, input: CompactInput): CompactState => {
  if (input.keepOpen || input.hot || (state.revealed && input.inside)) {
    return state.revealed && state.hideAt === null ? state : { revealed: true, hideAt: null };
  }
  if (!state.revealed) return state;
  if (state.hideAt === null) return { revealed: true, hideAt: input.now + COMPACT_HIDE_DELAY_MS };
  if (input.now >= state.hideAt) return INITIAL_COMPACT_STATE;
  return state;
};

/**
 * Area where the pointer reveals the chrome when it is tracked by polling (Windows): there the top strip is a
 * window drag region, which swallows pointer events, so the invisible hot strip view cannot see the pointer.
 */
export const pollHotRect = (geometry: CompactGeometry): Rect =>
  geometry.kind === "vertical"
    ? hotStripRect(geometry)
    : { x: 0, y: 0, width: geometry.contentWidth, height: Math.min(Math.max(COMPACT_HOT_ZONE, geometry.topInset ?? 0), geometry.contentHeight) };

export const rectContains = (rect: Rect, point: { x: number; y: number }): boolean =>
  rect.width > 0 && rect.height > 0 && point.x >= rect.x && point.x < rect.x + rect.width && point.y >= rect.y && point.y < rect.y + rect.height;
