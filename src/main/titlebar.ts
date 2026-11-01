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

/** Where the page starts in compact mode: 0, except on Windows where the thin title strip stays above it. */
export const compactViewportTop = (platform: string): number => (usesNativeControlsOverlay(platform) ? COMPACT_TITLEBAR_HEIGHT : 0);

export type TitleBarOverlay = { color: string; symbolColor: string; height: number };

/** Native controls take the chrome's colors, so they blend into the tab strip in every theme. */
export const titleBarOverlayFor = (tokens: { surface: string; fg: string }, compact: boolean): TitleBarOverlay => ({
  color: tokens.surface,
  symbolColor: tokens.fg,
  height: titlebarHeightFor(compact),
});

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

/** Rect of the native controls in window content coordinates (popups keep clear of it); null when not drawn. */
export const windowControlsRect = (
  platform: string,
  contentWidth: number,
  compact: boolean,
  fullscreen: boolean,
): { x: number; y: number; width: number; height: number } | null => {
  if (!usesNativeControlsOverlay(platform) || fullscreen) return null;
  const width = Math.min(WINDOW_CONTROLS_FALLBACK_WIDTH, contentWidth);
  return { x: contentWidth - width, y: 0, width, height: titlebarHeightFor(compact) };
};

/**
 * Viewport (where the page starts) reported by the shell. Windows with the vertical layout gets a full-width top bar
 * (address row + the controls) above sidebar and page, so the controls never cover page content or the sidebar.
 */
export const shellViewport = (input: {
  platform: string;
  vertical: boolean;
  sidebarRight: boolean;
  sidebarWidth: number;
}): { x: number; y: number; right: number } => {
  if (!input.vertical) return { x: 0, y: TITLEBAR_HEIGHT, right: 0 };
  const top = usesNativeControlsOverlay(input.platform) ? TITLEBAR_HEIGHT : 0;
  return input.sidebarRight ? { x: 0, y: top, right: input.sidebarWidth } : { x: input.sidebarWidth, y: top, right: 0 };
};
