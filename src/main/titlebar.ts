// Windows: the tab strip doubles as the title bar and the native window controls (minimize / maximize / close) are
// drawn over its right end (Electron `titleBarOverlay`, like Chrome and Edge). Pure helpers, no Electron or Node
// imports: shared by the main process and the renderer bundle. Other platforms keep the regular window frame.

/** Height of the tab strip / top bar, and with it of the native controls. Equals the shell's single toolbar row. */
export const TITLEBAR_HEIGHT = 36;
/** In compact mode the chrome is hidden; a thin strip stays so the window can still be dragged and controlled. */
export const COMPACT_TITLEBAR_HEIGHT = 32;
/** Width of the three native controls at 100% scaling; used until the real geometry is known. */
export const WINDOW_CONTROLS_FALLBACK_WIDTH = 138;
/** A reported controls width above this is not plausible (e.g. a partially laid out window): fall back. */
const MAX_PLAUSIBLE_CONTROLS_WIDTH = 320;

export const usesNativeControlsOverlay = (platform: string): boolean => platform === "win32";

export const titlebarHeightFor = (compact: boolean): number => (compact ? COMPACT_TITLEBAR_HEIGHT : TITLEBAR_HEIGHT);

/**
 * Height of the native controls overlay. With the tab strip as title bar (horizontal layout, compact strip) it is one
 * pixel shorter than the strip, so the strip's bottom line (1 px) runs under the controls to the window's right edge.
 * The vertical layout has no strip: the controls float over the page / sidebar and use the full height.
 */
export const titleBarOverlayHeight = (compact: boolean, vertical: boolean): number =>
  vertical && !compact ? TITLEBAR_HEIGHT : titlebarHeightFor(compact) - 1;

/** Where the page starts in compact mode: 0, except on Windows where the thin title strip stays above it. */
export const compactViewportTop = (platform: string): number => (usesNativeControlsOverlay(platform) ? COMPACT_TITLEBAR_HEIGHT : 0);

/**
 * Lowest top edge a page view may have. On Windows with the tab strip on top (horizontal layout, compact strip) the
 * native controls are drawn in that strip, so page views never reach into it, whatever the shell last reported.
 * The vertical layout has no strip (the page starts at y=0, the controls float over it) and other platforms have a
 * regular window frame: 0.
 */
export const minViewportTop = (platform: string, compact: boolean, vertical: boolean): number =>
  usesNativeControlsOverlay(platform) && (compact || !vertical) ? titlebarHeightFor(compact) : 0;

export type TitleBarOverlay = { color: string; symbolColor: string; height: number };

/** Native controls take the chrome's colors, so they blend into the tab strip in every theme. */
export const titleBarOverlayFor = (tokens: { surface: string; fg: string }, compact: boolean, vertical = false): TitleBarOverlay => ({
  color: tokens.surface,
  symbolColor: tokens.fg,
  height: titleBarOverlayHeight(compact, vertical),
});

/** Fully transparent: the native buttons stay in place (and clickable) but nothing of them is painted. */
export const TRANSPARENT_OVERLAY_COLOR = "#00000000";

/**
 * Whether the native buttons are auto-hidden at all: Windows, vertical layout (they float over the page there), not
 * in compact mode (thin strip) and not in fullscreen (the OS draws no buttons), and only if the user keeps the option on.
 */
export const autoHidesControls = (input: {
  platform: string;
  vertical: boolean;
  compact: boolean;
  fullscreen: boolean;
  enabled: boolean;
}): boolean => usesNativeControlsOverlay(input.platform) && input.vertical && !input.compact && !input.fullscreen && input.enabled;

/**
 * The single source of truth for the overlay state: null where there is no overlay (other platforms); transparent
 * colors while the buttons are auto-hidden and not revealed; the chrome colors otherwise. Always call this, whatever
 * changed (theme, layout, setting, fullscreen, pointer).
 */
export const resolveTitleBarOverlay = (input: {
  platform: string;
  tokens: { surface: string; fg: string };
  compact: boolean;
  vertical: boolean;
  fullscreen: boolean;
  hideControls: boolean;
  revealed: boolean;
}): TitleBarOverlay | null => {
  if (!usesNativeControlsOverlay(input.platform)) return null;
  const overlay = titleBarOverlayFor(input.tokens, input.compact, input.vertical);
  const hidden = autoHidesControls({ ...input, enabled: input.hideControls }) && !input.revealed;
  return hidden ? { ...overlay, color: TRANSPARENT_OVERLAY_COLOR, symbolColor: TRANSPARENT_OVERLAY_COLOR } : overlay;
};

/** Margin (px) around the controls rect in which the pointer still counts as "on the buttons". */
export const CONTROLS_HOVER_MARGIN = 4;
/** The buttons hide only after the pointer has stayed outside their zone this long (no flicker on a quick pass). */
export const CONTROLS_HIDE_DELAY_MS = 400;
/** While revealed, the pointer position is checked at this interval (the fallback for missed window messages). */
export const CONTROLS_POLL_MS = 150;

type Point = { x: number; y: number };

/** Is `point` (window content coordinates) inside `rect` grown by `margin` on every side? */
export const pointInControlsZone = (point: Point, rect: Rect | null | undefined, margin: number = CONTROLS_HOVER_MARGIN): boolean =>
  Boolean(rect)
  && point.x >= rect!.x - margin && point.x < rect!.x + rect!.width + margin
  && point.y >= rect!.y - margin && point.y < rect!.y + rect!.height + margin;

export type ControlsRevealState = { revealed: boolean; outsideSince: number | null };

/**
 * Reveal / hide transition: the pointer in the zone reveals at once and cancels a pending hide; outside the zone a
 * revealed state is kept for `delay` ms (from the first check outside) and then drops. Pure, `now` in ms.
 */
export const nextControlsReveal = (
  state: ControlsRevealState,
  inside: boolean,
  now: number,
  delay: number = CONTROLS_HIDE_DELAY_MS,
): ControlsRevealState => {
  if (inside) return { revealed: true, outsideSince: null };
  if (!state.revealed) return { revealed: false, outsideSince: null };
  const since = state.outsideSince ?? now;
  return now - since >= delay ? { revealed: false, outsideSince: null } : { revealed: true, outsideSince: since };
};

export type ControlsGeometry = {
  fullscreen: boolean;
  /** navigator.windowControlsOverlay.getTitlebarAreaRect() when the API is available and visible. */
  titlebarArea?: { x: number; width: number } | null;
  viewportWidth: number;
};

/** Space (px) to keep free at the right end of the top bar for the native controls. */
export const windowControlsReserve = (geometry: ControlsGeometry): number => {
  if (geometry.fullscreen) return 0; // the controls are not drawn in fullscreen
  const area = geometry.titlebarArea;
  if (area && Number.isFinite(area.x) && Number.isFinite(area.width)) {
    const reserve = Math.round(geometry.viewportWidth - (area.x + area.width));
    if (reserve > 0 && reserve <= MAX_PLAUSIBLE_CONTROLS_WIDTH) return reserve;
  }
  return WINDOW_CONTROLS_FALLBACK_WIDTH;
};

/**
 * Rect of the native controls in window content coordinates (popups and overlays keep clear of it); null when not drawn.
 * `controlsWidth` is the measured width (see sanitizeControlsWidth), the height is the real overlay height.
 */
export const windowControlsRect = (
  platform: string,
  contentWidth: number,
  compact: boolean,
  fullscreen: boolean,
  controlsWidth: number = WINDOW_CONTROLS_FALLBACK_WIDTH,
  vertical = false,
): { x: number; y: number; width: number; height: number } | null => {
  if (!usesNativeControlsOverlay(platform) || fullscreen) return null;
  const width = Math.min(controlsWidth, contentWidth);
  return { x: contentWidth - width, y: 0, width, height: titleBarOverlayHeight(compact, vertical) };
};

type Rect = { x: number; y: number; width: number; height: number };

const overlapsControlsHorizontally = (rect: Rect, controls: Rect): boolean =>
  rect.x < controls.x + controls.width && rect.x + rect.width > controls.x;

/**
 * An overlay positioned from the top of the page area (notes panel, command palette, find bar, toast...) must not sit
 * under the native controls: when it overlaps their rect horizontally and starts above their bottom edge, it moves
 * down to just below them and loses that much height (its bottom edge stays). Otherwise it is returned unchanged.
 */
export const keepBelowControls = (rect: Rect, controls: Rect | null | undefined): Rect => {
  if (!controls || !overlapsControlsHorizontally(rect, controls)) return rect;
  const clearY = controls.y + controls.height;
  if (rect.y >= clearY || rect.y + rect.height <= controls.y) return rect;
  const bottom = rect.y + rect.height;
  return { ...rect, y: clearY, height: Math.max(0, bottom - clearY) };
};

/**
 * A thin strip along the top edge (the load progress line) cannot move down without floating over the page: it is
 * shortened instead so that it ends where the native controls begin.
 */
export const clipLeftOfControls = (rect: Rect, controls: Rect | null | undefined): Rect => {
  if (!controls || !overlapsControlsHorizontally(rect, controls)) return rect;
  if (rect.y >= controls.y + controls.height || rect.y + rect.height <= controls.y) return rect;
  return { ...rect, width: Math.max(0, controls.x - rect.x) };
};

/**
 * Viewport (where the page starts) reported by the shell. Horizontal layout: below the tab strip. Vertical layout: the
 * page fills the window height (y=0) next to the sidebar, on every platform; on Windows the native controls float over it.
 */
export const shellViewport = (input: {
  vertical: boolean;
  sidebarRight: boolean;
  sidebarWidth: number;
}): { x: number; y: number; right: number } => {
  if (!input.vertical) return { x: 0, y: TITLEBAR_HEIGHT, right: 0 };
  return input.sidebarRight ? { x: 0, y: 0, right: input.sidebarWidth } : { x: input.sidebarWidth, y: 0, right: 0 };
};

/**
 * Sanitizes a controls width reported by the shell (CSS px = DIP, from getTitlebarAreaRect): a plausible positive
 * number is kept (rounded up, never a fractional edge), anything else falls back to the 100% scaling width.
 */
export const sanitizeControlsWidth = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_PLAUSIBLE_CONTROLS_WIDTH
    ? Math.ceil(value)
    : WINDOW_CONTROLS_FALLBACK_WIDTH;

/**
 * Bounds (window content coordinates) of the native "frame" view behind the window controls in the vertical layout:
 * the controls float over the page there, so the shell DOM cannot draw their outline. The view is one pixel wider and
 * taller than the controls, in the border color, at the top-right corner; the controls (opaque overlay) cover its
 * inside, leaving a 1 px line on the left and at the bottom (top and right are the window's edge). Null when nothing
 * is to be drawn: other platforms, horizontal / compact layout (the shell DOM draws it there), fullscreen and while the buttons are auto-hidden.
 */
export const controlsFrameRect = (input: {
  platform: string;
  vertical: boolean;
  compact: boolean;
  fullscreen: boolean;
  controlsWidth: number;
  contentWidth: number;
  /** The buttons are auto-hidden right now (transparent overlay): there is nothing to outline. */
  controlsHidden?: boolean;
}): { x: number; y: number; width: number; height: number } | null => {
  if (!usesNativeControlsOverlay(input.platform) || !input.vertical || input.compact || input.fullscreen || input.controlsHidden) return null;
  if (!(input.contentWidth > 0)) return null;
  const width = Math.min(input.controlsWidth + 1, input.contentWidth);
  return { x: input.contentWidth - width, y: 0, width, height: titleBarOverlayHeight(false, true) + 1 };
};

/**
 * Where to (re)insert the frame view in the window's child list so that it sits directly above the topmost page
 * view and below every overlay (popups, menus, HUD, find bar...). `children` is the current list (bottom to top);
 * returns the index to insert at once the frame is removed from the list, or null when the frame is already there
 * (or no page view is attached and the frame already is).
 */
export const controlsFrameIndex = <T>(children: readonly T[], pages: ReadonlySet<T>, frame: T): number | null => {
  const others = children.filter((child) => child !== frame);
  let top = -1;
  others.forEach((child, index) => { if (pages.has(child)) top = index; });
  const target = top + 1 > 0 ? top + 1 : others.length;
  return children.indexOf(frame) === target ? null : target;
};
