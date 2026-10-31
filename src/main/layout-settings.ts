export type TabBarLayout = "horizontal" | "vertical";

export type VerticalTabBarSide = "left" | "right";

export type LayoutSettings = {
  tabBarLayout: TabBarLayout;
  verticalTabBarWidth: number;
  verticalTabBarCollapsed: boolean;
  /** Which window edge the vertical tab bar (sidebar) sits on. */
  verticalTabBarSide: VerticalTabBarSide;
  /** Compact mode: the chrome (toolbar / sidebar) is hidden and revealed from the screen edge. */
  compactMode: boolean;
};

export const MIN_VERTICAL_TAB_BAR_WIDTH = 180;
export const MAX_VERTICAL_TAB_BAR_WIDTH = 400;

export const DEFAULT_LAYOUT_SETTINGS: LayoutSettings = {
  tabBarLayout: "horizontal",
  verticalTabBarWidth: 240,
  verticalTabBarCollapsed: false,
  verticalTabBarSide: "left",
  compactMode: false,
};

export const clampVerticalTabBarWidth = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_LAYOUT_SETTINGS.verticalTabBarWidth;
  }
  return Math.min(MAX_VERTICAL_TAB_BAR_WIDTH, Math.max(MIN_VERTICAL_TAB_BAR_WIDTH, Math.round(value)));
};

/** Merges a (possibly partial, untrusted) patch over the current settings, ignoring invalid fields. */
export const mergeLayoutSettings = (current: LayoutSettings, patch: unknown): LayoutSettings => {
  if (typeof patch !== "object" || patch === null) {
    return { ...current };
  }
  const raw = patch as Record<string, unknown>;
  return {
    tabBarLayout: raw.tabBarLayout === "horizontal" || raw.tabBarLayout === "vertical"
      ? raw.tabBarLayout
      : current.tabBarLayout,
    verticalTabBarWidth: raw.verticalTabBarWidth === undefined
      ? current.verticalTabBarWidth
      : clampVerticalTabBarWidth(raw.verticalTabBarWidth),
    verticalTabBarCollapsed: typeof raw.verticalTabBarCollapsed === "boolean"
      ? raw.verticalTabBarCollapsed
      : current.verticalTabBarCollapsed,
    verticalTabBarSide: raw.verticalTabBarSide === "left" || raw.verticalTabBarSide === "right"
      ? raw.verticalTabBarSide
      : current.verticalTabBarSide,
    compactMode: typeof raw.compactMode === "boolean" ? raw.compactMode : current.compactMode,
  };
};

export const normalizeLayoutSettings = (value: unknown): LayoutSettings =>
  mergeLayoutSettings(DEFAULT_LAYOUT_SETTINGS, value);
