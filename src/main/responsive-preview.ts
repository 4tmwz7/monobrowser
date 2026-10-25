// Pure logic of the "responsive preview" developer feature: a split whose right pane shows the
// left tab's page emulated at a device width. No Electron imports.

export type DevicePreset = { id: "phone" | "tablet" | "laptop"; width: number };

export const DEVICE_PRESETS: readonly DevicePreset[] = [
  { id: "phone", width: 375 },
  { id: "tablet", width: 768 },
  { id: "laptop", width: 1280 },
];
export const DEFAULT_PREVIEW_WIDTH = 375;
export const MOBILE_MAX_WIDTH = 768;
export const MIN_PREVIEW_WIDTH = 200;
export const MAX_PREVIEW_WIDTH = 4000;

export const clampPreviewWidth = (width: unknown): number => {
  if (typeof width !== "number" || !Number.isFinite(width)) return DEFAULT_PREVIEW_WIDTH;
  return Math.min(MAX_PREVIEW_WIDTH, Math.max(MIN_PREVIEW_WIDTH, Math.round(width)));
};

/** Narrow devices get the mobile screen type and a mobile user agent. */
export const isMobileWidth = (width: number): boolean => width <= MOBILE_MAX_WIDTH;

export type EmulationParams = {
  screenPosition: "mobile" | "desktop";
  screenSize: { width: number; height: number };
  viewSize: { width: number; height: number };
  viewPosition: { x: number; y: number };
  deviceScaleFactor: number;
  scale: number;
};

export const computeEmulation = (deviceWidth: number, paneWidth: number, paneHeight: number): EmulationParams => {
  const width = clampPreviewWidth(deviceWidth);
  const pw = Math.max(1, Math.round(Number.isFinite(paneWidth) ? paneWidth : 1));
  const height = Math.max(1, Math.round(Number.isFinite(paneHeight) ? paneHeight : 1));
  const scale = Math.min(1, pw / width);
  return {
    screenPosition: isMobileWidth(width) ? "mobile" : "desktop",
    screenSize: { width, height },
    viewSize: { width, height: Math.round(height / scale) },
    viewPosition: { x: 0, y: 0 },
    deviceScaleFactor: 0,
    scale,
  };
};

export const emulationKey = (params: EmulationParams): string =>
  `${params.screenPosition}|${params.screenSize.width}x${params.screenSize.height}|${params.viewSize.height}|${params.scale.toFixed(4)}`;

/** Turns a desktop Chromium user agent into an Android phone one (keeps the Chrome version). */
export const toMobileUserAgent = (userAgent: string): string => {
  if (!userAgent) return userAgent;
  let mobile = userAgent.replace(/\((?:X11|Windows|Macintosh)[^)]*\)/, "(Linux; Android 14; Pixel 7)");
  if (!/\bMobile\b/.test(mobile)) mobile = mobile.replace(/(\s)(Safari\/)/, "$1Mobile Safari/");
  return mobile;
};

export type PreviewEntry = { sourceTabId: number; width: number };

export type PreviewRegistry = {
  set: (previewTabId: number, sourceTabId: number, width: number) => PreviewEntry;
  get: (previewTabId: number) => PreviewEntry | null;
  setWidth: (previewTabId: number, width: number) => PreviewEntry | null;
  /** The preview tab following the given source tab. */
  previewOfSource: (sourceTabId: number) => number | null;
  remove: (previewTabId: number) => boolean;
  ids: () => number[];
  clear: () => void;
};

export const createPreviewRegistry = (): PreviewRegistry => {
  const entries = new Map<number, PreviewEntry>();
  return {
    set: (previewTabId, sourceTabId, width) => {
      const entry = { sourceTabId, width: clampPreviewWidth(width) };
      entries.set(previewTabId, entry);
      return { ...entry };
    },
    get: (previewTabId) => {
      const entry = entries.get(previewTabId);
      return entry ? { ...entry } : null;
    },
    setWidth: (previewTabId, width) => {
      const entry = entries.get(previewTabId);
      if (!entry) return null;
      entry.width = clampPreviewWidth(width);
      return { ...entry };
    },
    previewOfSource: (sourceTabId) => {
      for (const [id, entry] of entries) if (entry.sourceTabId === sourceTabId) return id;
      return null;
    },
    remove: (previewTabId) => entries.delete(previewTabId),
    ids: () => [...entries.keys()],
    clear: () => entries.clear(),
  };
};
